-- Shared return rules.
--
-- Created with `supabase migration new return_eligibility` (CLI stamp
-- 20261113101212). That stamp sorts before the schema migrations already in
-- this repo (120000 and 140000 on the same day), so the version is 150000
-- and this file runs after them. The existing migration files are unchanged.
--
-- return_window_days() is the only copy of the 14-day window.
-- return_decision() is the only copy of the checks. validate_return() raises
-- its reason, and customer_return_eligibility() returns the same decision
-- for each item the caller can see. The decision function does not read
-- tables; callers pass the row facts in, so the comparison cannot drift.

create or replace function public.return_window_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 14;
$$;

comment on function public.return_window_days() is
  'Sole copy of the returns window. Measured backwards from delivery, not purchase.';

create type public.return_decision_result as (
  eligible boolean,
  code text,
  reason text,
  detail text,
  window_days integer,
  days_since_delivery integer
);

-- reason is the customer-facing message validate_return raises.
-- detail is a shorter explanation for replies. Both are produced here.
create or replace function public.return_decision(
  p_item_found boolean,
  p_item_order_id uuid,
  p_order_found boolean,
  p_order_id uuid,
  p_order_user_id uuid,
  p_return_user_id uuid,
  p_order_status public.order_status,
  p_delivered_at timestamptz,
  p_on_sale boolean,
  p_bought_qty integer,
  p_return_qty integer,
  p_open_return_exists boolean,
  p_now timestamptz
)
returns public.return_decision_result
language plpgsql
stable
set search_path = ''
as $$
declare
  v_window integer := public.return_window_days();
  v_days integer;
  v_code text;
  v_reason text;
  v_detail text;
begin
  if p_delivered_at is not null and p_now is not null then
    v_days := floor(extract(epoch from (p_now - p_delivered_at)) / 86400)::integer;
  end if;

  if not p_item_found or p_item_order_id is distinct from p_order_id then
    v_code := 'not_on_order';
    v_reason := 'This item is not part of that order.';
    v_detail := v_reason;
  elsif not p_order_found or p_order_user_id is distinct from p_return_user_id then
    v_code := 'not_owner';
    v_reason := 'This order does not belong to you.';
    v_detail := v_reason;
  elsif p_order_status is distinct from 'delivered' or p_delivered_at is null then
    v_code := 'not_delivered';
    v_reason := 'This order has not been delivered yet.';
    v_detail := v_reason;
  elsif p_delivered_at < p_now - make_interval(days => v_window) then
    v_code := 'past_window';
    v_reason := format('Returns must be made within %s days of delivery.', v_window);
    if v_days is null or v_days <= v_window then
      v_detail := format(
        'delivered more than %s days ago, past the %s-day window',
        v_window, v_window
      );
    else
      v_detail := format(
        'delivered %s days ago, past the %s-day window',
        v_days, v_window
      );
    end if;
  elsif p_on_sale then
    v_code := 'on_sale';
    v_reason := 'Items bought on sale cannot be returned.';
    v_detail := 'bought on sale';
  elsif p_return_qty is null or p_return_qty < 1 or p_return_qty > p_bought_qty then
    v_code := 'quantity';
    v_reason := 'You cannot return more items than you bought.';
    v_detail := v_reason;
  elsif p_open_return_exists then
    v_code := 'open_return';
    v_reason := 'A return for this item already exists.';
    v_detail := 'already has an open return';
  end if;

  return row(
    v_reason is null,
    v_code,
    v_reason,
    v_detail,
    v_window,
    v_days
  )::public.return_decision_result;
end;
$$;

comment on function public.return_decision(
  boolean, uuid, boolean, uuid, uuid, uuid,
  public.order_status, timestamptz, boolean, integer, integer, boolean, timestamptz
) is
  'Pure return check. Does not read tables. validate_return and customer_return_eligibility both call it.';

-- Same checks as before; the messages and the order of the checks now come
-- from return_decision so a reply cannot disagree with the trigger.
create or replace function public.validate_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_item_found boolean;
  v_order_found boolean;
  v_decision public.return_decision_result;
begin
  select * into v_item from public.order_items where id = new.order_item_id;
  v_item_found := found;

  select * into v_order from public.orders where id = new.order_id;
  v_order_found := found;

  v_decision := public.return_decision(
    v_item_found,
    case when v_item_found then v_item.order_id else null end,
    v_order_found,
    new.order_id,
    case when v_order_found then v_order.user_id else null end,
    new.user_id,
    case when v_order_found then v_order.status else null end,
    case when v_order_found then v_order.delivered_at else null end,
    case when v_item_found then v_item.on_sale else false end,
    case when v_item_found then v_item.quantity else 0 end,
    new.quantity,
    exists (
      select 1 from public.returns r
      where r.order_item_id = new.order_item_id
        and r.status not in ('rejected', 'cancelled')
    ),
    now()
  );

  if v_decision.reason is not null then
    raise exception '%', v_decision.reason using errcode = 'P0001';
  end if;

  new.status := 'submitted';
  return new;
end;
$$;

-- Closes the gap where two inserts for the same item could both pass the
-- exists() check. Rejected and cancelled rows stay out of the index, which
-- is the same set the check ignores. A normal duplicate still hits the
-- trigger first and keeps the friendly message.
create unique index returns_one_open_per_item
  on public.returns (order_item_id)
  where status not in ('rejected', 'cancelled');

create or replace function public.customer_return_eligibility(p_quantity integer default 1)
returns table (
  order_id uuid,
  order_number text,
  order_status public.order_status,
  ordered_at timestamptz,
  delivered_at timestamptz,
  order_item_id uuid,
  sku text,
  product_name text,
  quantity_bought integer,
  unit_price numeric,
  on_sale boolean,
  eligible boolean,
  code text,
  reason text,
  detail text,
  window_days integer,
  days_since_delivery integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.' using errcode = 'P0001';
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.status,
    o.ordered_at,
    o.delivered_at,
    i.id,
    i.sku,
    i.product_name,
    i.quantity,
    i.unit_price,
    i.on_sale,
    (d.decision).eligible,
    (d.decision).code,
    (d.decision).reason,
    (d.decision).detail,
    (d.decision).window_days,
    (d.decision).days_since_delivery
  from public.order_items i
  join public.orders o on o.id = i.order_id
  cross join lateral (
    select public.return_decision(
      true,
      i.order_id,
      true,
      o.id,
      o.user_id,
      (select auth.uid()),
      o.status,
      o.delivered_at,
      i.on_sale,
      i.quantity,
      p_quantity,
      exists (
        select 1 from public.returns r
        where r.order_item_id = i.id
          and r.status not in ('rejected', 'cancelled')
      ),
      now()
    ) as decision
  ) d
  where o.user_id = (select auth.uid());
end;
$$;

comment on function public.customer_return_eligibility(integer) is
  'Per-item return decision for the signed-in customer. Row level security applies.';

create or replace function public.return_policy()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'window_days', public.return_window_days(),
    'measured_from', 'delivered_at',
    'requires_order_status', 'delivered',
    'sale_items_returnable', false,
    'open_return_blocks_another', true,
    'statuses_that_do_not_block', jsonb_build_array('rejected', 'cancelled'),
    'initial_status', 'submitted',
    'status_changes_by', 'staff',
    'summary', format(
      'A return is allowed only when the order belongs to you, the order is delivered, delivery was no more than %s days ago, the item was not bought on sale, the quantity is not more than you bought, and there is no other open return for that item. Rejected and cancelled returns do not count as open. New returns start as submitted, and only staff can change the status.',
      public.return_window_days()
    )
  );
$$;

comment on function public.return_policy() is
  'Public description of the return rules, built from return_window_days().';

revoke all on function public.return_window_days() from public;
grant execute on function public.return_window_days() to anon, authenticated, service_role;

revoke all on function public.return_policy() from public;
grant execute on function public.return_policy() to anon, authenticated, service_role;

revoke all on function public.return_decision(
  boolean, uuid, boolean, uuid, uuid, uuid,
  public.order_status, timestamptz, boolean, integer, integer, boolean, timestamptz
) from public, anon;
grant execute on function public.return_decision(
  boolean, uuid, boolean, uuid, uuid, uuid,
  public.order_status, timestamptz, boolean, integer, integer, boolean, timestamptz
) to authenticated, service_role;

revoke all on function public.customer_return_eligibility(integer) from public, anon;
grant execute on function public.customer_return_eligibility(integer) to authenticated, service_role;

revoke all on function public.validate_return() from public, anon;
grant execute on function public.validate_return() to authenticated, service_role;
