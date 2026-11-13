-- The hosted orders.order_number and order_items.product_name columns are
-- varchar(255), not text as in the init migration, so the RETURNS TABLE
-- types did not match (42804). Cast to text. Behaviour is unchanged.

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
    o.order_number::text,
    o.status,
    o.ordered_at,
    o.delivered_at,
    i.id,
    i.sku::text,
    i.product_name::text,
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
      i.category,
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

revoke all on function public.customer_return_eligibility(integer) from public, anon;
grant execute on function public.customer_return_eligibility(integer) to authenticated, service_role;
