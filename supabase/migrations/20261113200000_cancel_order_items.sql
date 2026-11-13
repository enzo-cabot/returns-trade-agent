-- Customers can cancel items on an order that has not shipped yet.
-- A blocked return ("not delivered yet") now has a next step instead of a dead end.
--
-- * order_items.cancelled_quantity: how many units of a line were cancelled.
-- * order_cancellations: audit log, one row per cancelled line.
-- * cancel_order_items(order_id, items, reason): customer RPC, own pending orders only.
--   Recomputes orders.total_amount, marks the order cancelled when nothing is left,
--   and queues customer + owner emails and a Slack post on the existing outbox.
-- * Returns use the quantity that is left after cancellations.

alter table public.order_items
  add column if not exists cancelled_quantity integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'order_items_cancelled_quantity_check'
  ) then
    alter table public.order_items
      add constraint order_items_cancelled_quantity_check
      check (cancelled_quantity >= 0 and cancelled_quantity <= quantity);
  end if;
end $$;

create table if not exists public.order_cancellations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  user_id uuid not null,
  quantity integer not null check (quantity > 0),
  amount numeric(12, 2) not null default 0,
  reason text,
  order_cancelled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists order_cancellations_order_id_idx
  on public.order_cancellations (order_id);

alter table public.order_cancellations enable row level security;

drop policy if exists "Own cancellations or staff" on public.order_cancellations;
create policy "Own cancellations or staff" on public.order_cancellations
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_employee()));

revoke all on public.order_cancellations from anon;
grant select on public.order_cancellations to authenticated;

-- Outbox: a row is either a return status change or an order cancellation.
alter table public.return_notifications
  add column if not exists kind text not null default 'return',
  add column if not exists cancellation_id uuid references public.order_cancellations (id) on delete cascade,
  add column if not exists amount numeric(12, 2);

alter table public.return_notifications alter column return_log_id drop not null;
alter table public.return_notifications alter column return_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'return_notifications_kind_check'
  ) then
    alter table public.return_notifications
      add constraint return_notifications_kind_check check (
        (kind = 'return' and return_id is not null and return_log_id is not null)
        or (kind = 'order_cancellation' and cancellation_id is not null)
      );
  end if;
end $$;

drop function if exists public.claim_return_notifications(integer);

create function public.claim_return_notifications(p_limit integer default 20)
returns table (
  id uuid,
  kind text,
  return_id uuid,
  cancellation_id uuid,
  old_status public.return_status,
  new_status public.return_status,
  customer_email text,
  customer_name text,
  order_number text,
  product_name text,
  quantity integer,
  reason text,
  amount numeric,
  customer_sent_at timestamptz,
  owner_sent_at timestamptz,
  slack_sent_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select n.id
    from public.return_notifications n
    where n.sent_at is null
      and n.attempts < 5
      and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
    order by n.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.return_notifications n
       set claimed_at = now(),
           attempts = n.attempts + 1
      from picked
     where n.id = picked.id
    returning n.*
  )
  select c.id, c.kind, c.return_id, c.cancellation_id, c.old_status, c.new_status,
         c.customer_email, c.customer_name, c.order_number, c.product_name,
         c.quantity, c.reason, c.amount,
         c.customer_sent_at, c.owner_sent_at, c.slack_sent_at
  from claimed c;
$$;

revoke all on function public.claim_return_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_return_notifications(integer) to service_role;

create or replace function public.cancel_order_items(
  p_order_id uuid,
  p_items jsonb default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_profile public.profiles%rowtype;
  v_email text;
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  v_req jsonb;
  v_item_id uuid;
  v_qty integer;
  v_left integer;
  v_old_total numeric(12, 2);
  v_new_total numeric(12, 2);
  v_all_cancelled boolean;
  v_cancel_id uuid;
  v_done jsonb := '[]'::jsonb;
  v_ids uuid[] := '{}';
begin
  if v_user is null then
    raise exception 'Sign in to cancel an order.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id is distinct from v_user then
    raise exception 'This order does not belong to you.' using errcode = 'P0001';
  end if;

  if v_order.status = 'shipped' then
    raise exception 'This order has already shipped, so it can no longer be cancelled. You can refuse the delivery, or return the item within % days once it is delivered.', public.return_window_days()
      using errcode = 'P0001';
  elsif v_order.status = 'delivered' then
    raise exception 'This order was already delivered, so it cannot be cancelled. Request a return instead (within % days of delivery).', public.return_window_days()
      using errcode = 'P0001';
  elsif v_order.status = 'cancelled' then
    raise exception 'This order is already cancelled.' using errcode = 'P0001';
  elsif v_order.status is distinct from 'pending' then
    raise exception 'This order cannot be cancelled.' using errcode = 'P0001';
  end if;

  -- Default: cancel everything that is left on the order.
  if p_items is null or jsonb_typeof(p_items) = 'null' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'order_item_id', i.id,
             'quantity', i.quantity - i.cancelled_quantity)), '[]'::jsonb)
      into p_items
      from public.order_items i
     where i.order_id = v_order.id and i.quantity > i.cancelled_quantity;
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 30 then
    raise exception 'Choose at least one item to cancel.' using errcode = 'P0001';
  end if;

  select total_amount into v_old_total from public.orders where id = v_order.id;

  for v_req in select value from jsonb_array_elements(p_items) loop
    begin
      v_item_id := (v_req ->> 'order_item_id')::uuid;
      v_qty := (v_req ->> 'quantity')::integer;
    exception when others then
      raise exception 'Each item to cancel needs an item id and a whole quantity.' using errcode = 'P0001';
    end;

    if v_item_id = any (v_ids) then
      raise exception 'Each item can only be listed once.' using errcode = 'P0001';
    end if;
    v_ids := v_ids || v_item_id;

    select * into v_item from public.order_items
     where id = v_item_id and order_id = v_order.id
     for update;
    if not found then
      raise exception 'This item is not part of that order.' using errcode = 'P0001';
    end if;

    v_left := v_item.quantity - v_item.cancelled_quantity;
    if v_qty is null then
      v_qty := v_left;
    end if;
    if v_left < 1 then
      raise exception '% is already cancelled.', v_item.product_name using errcode = 'P0001';
    end if;
    if v_qty < 1 or v_qty > v_left then
      raise exception 'You can cancel 1 to % of %.', v_left, v_item.product_name using errcode = 'P0001';
    end if;

    update public.order_items
       set cancelled_quantity = cancelled_quantity + v_qty
     where id = v_item.id;

    insert into public.order_cancellations (
      order_id, order_item_id, user_id, quantity, amount, reason
    ) values (
      v_order.id, v_item.id, v_user, v_qty, round(v_item.unit_price * v_qty, 2), v_reason
    ) returning id into v_cancel_id;

    v_done := v_done || jsonb_build_array(jsonb_build_object(
      'cancellation_id', v_cancel_id,
      'order_item_id', v_item.id,
      'product_name', v_item.product_name,
      'quantity', v_qty,
      'amount', round(v_item.unit_price * v_qty, 2),
      'quantity_left', v_left - v_qty
    ));
  end loop;

  select coalesce(sum(i.unit_price * (i.quantity - i.cancelled_quantity)), 0),
         bool_and(i.cancelled_quantity >= i.quantity)
    into v_new_total, v_all_cancelled
    from public.order_items i
   where i.order_id = v_order.id;

  update public.orders
     set total_amount = v_new_total,
         status = case when v_all_cancelled then 'cancelled'::public.order_status else status end
   where id = v_order.id;

  if v_all_cancelled then
    update public.order_cancellations set order_cancelled = true
     where id in (select (x ->> 'cancellation_id')::uuid from jsonb_array_elements(v_done) x);
  end if;

  select * into v_profile from public.profiles where id = v_user;
  v_email := coalesce(nullif(v_profile.email, ''), nullif(v_order.customer_email, ''), 'missing');

  insert into public.return_notifications (
    kind, cancellation_id, new_status, customer_email, customer_name,
    order_number, product_name, quantity, reason, amount
  )
  select 'order_cancellation',
         (x ->> 'cancellation_id')::uuid,
         'cancelled',
         v_email,
         v_profile.full_name,
         v_order.order_number,
         x ->> 'product_name',
         (x ->> 'quantity')::integer,
         v_reason,
         (x ->> 'amount')::numeric
    from jsonb_array_elements(v_done) x;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'order_status', case when v_all_cancelled then 'cancelled' else v_order.status::text end,
    'old_total', v_old_total,
    'new_total', v_new_total,
    'refund_amount', v_old_total - v_new_total,
    'currency', v_order.currency,
    'cancelled', v_done
  );
end;
$$;

revoke all on function public.cancel_order_items(uuid, jsonb, text) from public, anon;
grant execute on function public.cancel_order_items(uuid, jsonb, text) to authenticated, service_role;

-- Returns only count units that were not cancelled. A fully cancelled line says so.
create or replace function public.customer_return_eligibility(p_quantity integer default 1)
returns table (
  order_id uuid, order_number text, order_status public.order_status,
  ordered_at timestamptz, delivered_at timestamptz, order_item_id uuid, sku text,
  product_name text, quantity_bought integer, unit_price numeric, on_sale boolean,
  eligible boolean, code text, reason text, detail text, window_days integer,
  days_since_delivery integer
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be at least 1.' using errcode = 'P0001';
  end if;

  return query
  select
    o.id,
    o.order_number::text,
    o.status,
    o.ordered_at,
    o.delivered_at,
    i.id,
    i.sku::text,
    i.product_name::text,
    i.quantity - i.cancelled_quantity,
    i.unit_price,
    i.on_sale,
    case when i.cancelled_quantity >= i.quantity then false else (d.decision).eligible end,
    case when i.cancelled_quantity >= i.quantity then 'item_cancelled' else (d.decision).code end,
    case when i.cancelled_quantity >= i.quantity then 'This item was cancelled before it shipped.' else (d.decision).reason end,
    case when i.cancelled_quantity >= i.quantity then 'cancelled before shipping' else (d.decision).detail end,
    (d.decision).window_days,
    (d.decision).days_since_delivery
  from public.order_items i
  join public.orders o on o.id = i.order_id
  cross join lateral (
    select public.return_decision(
      true, i.order_id, true, o.id, o.user_id, (select auth.uid()),
      o.status, o.delivered_at, i.on_sale, i.category,
      i.quantity - i.cancelled_quantity, p_quantity,
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
    case when v_item_found then v_item.category else 'apparel' end,
    case when v_item_found then v_item.quantity - v_item.cancelled_quantity else 0 end,
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
