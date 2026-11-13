-- Outbox rows are created when a return is submitted and when staff change
-- its status. Senders are not called here; the Edge Function is mocked in
-- tests/notify_messages.test.mjs and by NOTIFY_MODE=mock.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/return_notifications.sql

do $$
declare
  v_user uuid := '44444444-4444-4444-8444-444444444444';
  v_order uuid;
  v_item uuid;
  v_return uuid;
  v_count integer;
  v_note public.return_notifications%rowtype;
  v_claimed integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_user, 'notify.buyer@example.com', '{"full_name":"Notify Buyer"}'::jsonb)
  on conflict (id) do nothing;

  insert into public.orders (
    order_number, shop_name, customer_email, user_id, status, ordered_at, delivered_at, total_amount
  ) values (
    'TEST-8801', 'Returns Trade Agent', 'notify.buyer@example.com', v_user,
    'delivered', now() - interval '3 days', now() - interval '1 day', 199
  )
  returning id into v_order;

  insert into public.order_items (order_id, sku, product_name, quantity, unit_price, on_sale, category)
  values (v_order, 'SKU-TEE', 'Cotton T-shirt', 1, 199, false, 'apparel')
  returning id into v_item;

  insert into public.returns (user_id, order_id, order_item_id, quantity, reason)
  values (v_user, v_order, v_item, 1, 'Wrong size')
  returning id into v_return;

  select count(*) into v_count from public.return_notifications where return_id = v_return;
  if v_count is distinct from 1 then
    raise exception 'expected 1 notification on submit, got %', v_count;
  end if;

  select * into v_note from public.return_notifications where return_id = v_return;
  if v_note.new_status is distinct from 'submitted'
     or v_note.customer_email is distinct from 'notify.buyer@example.com'
     or v_note.order_number is distinct from 'TEST-8801'
     or v_note.product_name is distinct from 'Cotton T-shirt'
     or v_note.sent_at is not null then
    raise exception 'submit notification snapshot is wrong: %', v_note;
  end if;

  -- A staff status change (this session bypasses row level security, the same
  -- way an employee update is allowed). The customer UI cannot do this.
  update public.returns set status = 'approved' where id = v_return;

  select count(*) into v_count from public.return_notifications where return_id = v_return;
  if v_count is distinct from 2 then
    raise exception 'expected a second notification on approval, got %', v_count;
  end if;

  select * into v_note from public.return_notifications
   where return_id = v_return and new_status = 'approved';
  if v_note.old_status is distinct from 'submitted' then
    raise exception 'approval notification lost the previous status';
  end if;

  -- Claim and complete without a network send, which is what NOTIFY_MODE=mock does.
  select count(*) into v_claimed from public.claim_return_notifications(20) c
   where c.return_id = v_return;
  if v_claimed is distinct from 2 then
    raise exception 'claim did not pick both rows, got %', v_claimed;
  end if;

  perform public.complete_return_notification(n.id, true, true, true, null)
  from public.return_notifications n
  where n.return_id = v_return;

  if exists (
    select 1 from public.return_notifications
    where return_id = v_return and sent_at is null
  ) then
    raise exception 'completed notifications should have sent_at';
  end if;
end $$;
