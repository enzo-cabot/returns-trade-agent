-- Run after the migrations, against local Postgres:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/place_order.sql

do $$
declare
  v_user uuid := '33333333-3333-4333-8333-333333333333';
  v_order jsonb;
  v_row public.orders%rowtype;
  v_item public.order_items%rowtype;
begin
  begin
    perform public.place_order('[{"sku":"SKU-X","product_name":"Hat","quantity":1,"unit_price":10}]'::jsonb);
    raise exception 'signed-out place_order should fail';
  exception
    when sqlstate 'P0001' then
      null;
  end;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_user, 'buyer.place@example.com', '{"full_name":"Buyer"}'::jsonb)
  on conflict (id) do nothing;

  perform set_config('request.jwt.claim.sub', v_user::text, true);

  begin
    perform public.place_order('[{"sku":"SKU-X","product_name":"Hat","quantity":0,"unit_price":10}]'::jsonb);
    raise exception 'quantity 0 should fail';
  exception
    when sqlstate 'P0001' then
      null;
  end;

  v_order := public.place_order(
    '[
      {"sku":"SKU-FOOD-BURGER","product_name":"Burger","quantity":2,"unit_price":10.5,"category":"food"},
      {"sku":"SKU-HAT","product_name":"Hat","quantity":1,"unit_price":20,"category":"clothes","on_sale":false}
    ]'::jsonb,
    'Returns Trade Agent',
    false
  );

  if v_order ->> 'status' is distinct from 'pending'
     or (v_order ->> 'total_amount')::numeric is distinct from 41.00
     or v_order ->> 'customer_email' is distinct from 'buyer.place@example.com'
     or v_order ->> 'order_number' not like 'TEST-%' then
    raise exception 'unexpected place_order result %', v_order;
  end if;

  select * into v_row from public.orders where id = (v_order ->> 'id')::uuid;
  if v_row.user_id is distinct from v_user or v_row.status is distinct from 'pending'
     or v_row.delivered_at is not null or v_row.total_amount is distinct from 41.00 then
    raise exception 'order row was not stored as pending for the caller';
  end if;

  select * into v_item from public.order_items
   where order_id = v_row.id and sku = 'SKU-FOOD-BURGER';
  if v_item.category is distinct from 'food' or v_item.quantity is distinct from 2 then
    raise exception 'food line was not stored, category=%', v_item.category;
  end if;

  select * into v_item from public.order_items
   where order_id = v_row.id and sku = 'SKU-HAT';
  if v_item.category is distinct from 'apparel' then
    raise exception 'clothes should be stored as apparel, got %', v_item.category;
  end if;

  v_order := public.place_order(
    '[{"sku":"SKU-HAT","product_name":"Hat","quantity":1,"unit_price":15,"category":"apparel"}]'::jsonb,
    'Returns Trade Agent',
    true
  );
  select * into v_row from public.orders where id = (v_order ->> 'id')::uuid;
  if v_row.status is distinct from 'delivered' or v_row.delivered_at is null then
    raise exception 'p_demo should mark the order delivered';
  end if;
end $$;
