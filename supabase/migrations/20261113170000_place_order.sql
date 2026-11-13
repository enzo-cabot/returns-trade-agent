-- Customers cannot insert into orders. Row level security only lets them
-- read their own rows, which is why a browser insert returns 403.
--
-- Created with `supabase migration new place_order` (CLI stamp
-- 20261113115519). That stamp sorts before the schema migrations, so this
-- file is 170000 and runs after them. The earlier files are unchanged.
--
-- place_order writes the order for auth.uid() and ignores any user id in
-- the payload. The total is the sum of the validated line prices. Status
-- is pending unless p_demo is true, which marks the order delivered.

create or replace function public.place_order(
  p_items jsonb,
  p_shop_name text default 'Returns Trade Agent',
  p_demo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_order_id uuid;
  v_number text;
  v_status public.order_status;
  v_delivered timestamptz;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
  v_qty integer;
  v_price numeric(12, 2);
  v_name text;
  v_sku text;
  v_category text;
  v_on_sale boolean;
  v_saved jsonb := '[]'::jsonb;
  i integer;
begin
  if v_user is null then
    raise exception 'Sign in before placing an order.' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;
  if v_email is null or length(trim(v_email)) = 0 then
    raise exception 'Sign in before placing an order.' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'An order needs between 1 and 30 items.' using errcode = 'P0001';
  end if;

  if coalesce(p_demo, false) then
    v_status := 'delivered';
    v_delivered := now();
  else
    v_status := 'pending';
    v_delivered := null;
  end if;

  for i in 1..8 loop
    v_number := 'TEST-' || (2000 + floor(random() * 7000))::integer::text;
    exit when not exists (
      select 1 from public.orders o where o.order_number = v_number
    );
    v_number := null;
  end loop;
  if v_number is null then
    raise exception 'Could not allocate an order number. Try again.' using errcode = 'P0001';
  end if;

  insert into public.orders (
    order_number, shop_name, customer_email, user_id, status,
    ordered_at, delivered_at, total_amount, currency
  ) values (
    v_number,
    coalesce(nullif(trim(p_shop_name), ''), 'Returns Trade Agent'),
    v_email,
    v_user,
    v_status,
    now(),
    v_delivered,
    0,
    'ZAR'
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_qty := (v_item ->> 'quantity')::integer;
      v_price := round((v_item ->> 'unit_price')::numeric, 2);
    exception
      when others then
        raise exception 'Each item needs a whole quantity and a price.' using errcode = 'P0001';
    end;

    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Each item quantity must be from 1 to 20.' using errcode = 'P0001';
    end if;
    if v_price is null or v_price < 0 or v_price > 100000 then
      raise exception 'Each item price must be from 0 to 100000.' using errcode = 'P0001';
    end if;

    v_sku := trim(coalesce(v_item ->> 'sku', ''));
    v_name := trim(coalesce(v_item ->> 'product_name', v_item ->> 'name', ''));
    if length(v_sku) < 1 or length(v_sku) > 80 or length(v_name) < 1 or length(v_name) > 200 then
      raise exception 'Each item needs a name and a SKU.' using errcode = 'P0001';
    end if;

    v_category := lower(trim(coalesce(v_item ->> 'category', '')));
    if v_category = 'food' or v_sku ilike 'SKU-FOOD-%' then
      v_category := 'food';
    elsif v_category in ('apparel', 'clothes', '') then
      v_category := 'apparel';
    else
      raise exception 'Item category must be food or apparel.' using errcode = 'P0001';
    end if;

    v_on_sale := lower(coalesce(v_item ->> 'on_sale', 'false')) in ('true', 't', '1');

    insert into public.order_items (
      order_id, sku, product_name, quantity, unit_price, on_sale, category
    ) values (
      v_order_id, v_sku, v_name, v_qty, v_price, v_on_sale, v_category
    );

    v_total := v_total + (v_price * v_qty);
    v_saved := v_saved || jsonb_build_array(jsonb_build_object(
      'sku', v_sku,
      'product_name', v_name,
      'quantity', v_qty,
      'unit_price', v_price,
      'on_sale', v_on_sale,
      'category', v_category
    ));
  end loop;

  update public.orders
     set total_amount = v_total
   where id = v_order_id;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_number,
    'status', v_status,
    'customer_email', v_email,
    'total_amount', v_total,
    'demo', coalesce(p_demo, false),
    'items', v_saved
  );
end;
$$;

comment on function public.place_order(jsonb, text, boolean) is
  'Creates the signed-in customer''s order. Pending unless p_demo marks it delivered. Prices are summed here; the browser cannot set the user id.';

revoke all on function public.place_order(jsonb, text, boolean) from public, anon;
grant execute on function public.place_order(jsonb, text, boolean) to authenticated, service_role;
