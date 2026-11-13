-- Checks the food return rule without touching a hosted project.
-- Run after `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/food_not_returnable.sql

do $$
declare
  v public.return_decision_result;
  order_id uuid := '11111111-1111-4111-8111-111111111111';
  user_id uuid := '22222222-2222-4222-8222-222222222222';
  policy jsonb;
begin
  v := public.return_decision(
    true, order_id, true, order_id, user_id, user_id,
    'delivered', now(), false, 'food', 1, 1, false, now()
  );
  if v.eligible or v.code is distinct from 'food'
     or v.reason is distinct from 'Food items cannot be returned.' then
    raise exception 'food item was returnable: % / %', v.code, v.reason;
  end if;

  v := public.return_decision(
    true, order_id, true, order_id, user_id, user_id,
    'delivered', now(), false, 'apparel', 1, 1, false, now()
  );
  if not v.eligible or v.reason is not null then
    raise exception 'apparel item was rejected: %', v.reason;
  end if;

  v := public.return_decision(
    true, order_id, true, order_id, user_id, user_id,
    'delivered', now(), true, 'apparel', 1, 1, false, now()
  );
  if v.eligible or v.reason is distinct from 'Items bought on sale cannot be returned.' then
    raise exception 'sale item reason changed: %', v.reason;
  end if;

  v := public.return_decision(
    true, order_id, true, order_id, user_id, user_id,
    'delivered', now() - interval '20 days', false, 'food', 1, 1, false, now()
  );
  if v.code is distinct from 'past_window' then
    raise exception 'window should be reported before food, got %', v.code;
  end if;

  policy := public.return_policy();
  if (policy ->> 'food_items_returnable')::boolean is distinct from false
     or (policy ->> 'window_days')::integer is distinct from 14
     or position('not food' in policy ->> 'summary') = 0 then
    raise exception 'return_policy() does not describe the food rule: %', policy;
  end if;

  if exists (
    select 1 from public.order_items
    where category not in ('food', 'apparel')
       or (sku ilike 'SKU-FOOD-%' and category is distinct from 'food')
  ) then
    raise exception 'order_items.category was not backfilled';
  end if;
end $$;
