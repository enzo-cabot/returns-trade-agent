-- Notify the customer and the store when a return is submitted or its
-- status changes. The return_logs insert (already written by the status
-- trigger) queues one outbox row. A cron job calls notify-return-events,
-- which sends the email and Slack message and records the result.
--
-- Created as 180000 so it runs after place_order (170000). The earlier
-- migration files are unchanged.

create table public.return_notifications (
  id               uuid primary key default gen_random_uuid(),
  return_log_id    bigint not null unique references public.return_logs (id) on delete cascade,
  return_id        uuid not null references public.returns (id) on delete cascade,
  old_status       public.return_status,
  new_status       public.return_status not null,
  customer_email   text not null,
  customer_name    text,
  order_number     text,
  product_name     text,
  quantity         integer,
  reason           text,
  customer_sent_at timestamptz,
  owner_sent_at    timestamptz,
  slack_sent_at    timestamptz,
  attempts         integer not null default 0,
  claimed_at       timestamptz,
  last_error       text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index return_notifications_pending_idx
  on public.return_notifications (created_at)
  where sent_at is null;

alter table public.return_notifications enable row level security;

-- Customers do not read the outbox. Staff can see what was sent and what failed.
create policy "Staff read return notifications" on public.return_notifications
  for select to authenticated
  using ((select public.is_employee()));

grant select on public.return_notifications to authenticated;
grant all on public.return_notifications to service_role;

-- Snapshot the return at the moment the log row is written, so a later edit
-- cannot change what the customer was told.
create or replace function public.enqueue_return_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns%rowtype;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_profile public.profiles%rowtype;
  v_email text;
begin
  select * into v_return from public.returns where id = new.return_id;
  if not found then
    return new;
  end if;

  select * into v_order from public.orders where id = v_return.order_id;
  select * into v_item from public.order_items where id = v_return.order_item_id;
  select * into v_profile from public.profiles where id = v_return.user_id;

  v_email := coalesce(nullif(v_profile.email, ''), nullif(v_order.customer_email, ''));
  if v_email is null then
    v_email := 'missing';
  end if;

  insert into public.return_notifications (
    return_log_id, return_id, old_status, new_status,
    customer_email, customer_name, order_number, product_name, quantity, reason
  ) values (
    new.id,
    new.return_id,
    new.old_status,
    new.new_status,
    v_email,
    v_profile.full_name,
    v_order.order_number,
    v_item.product_name,
    v_return.quantity,
    v_return.reason
  );

  return new;
end;
$$;

create trigger return_logs_enqueue_notification
  after insert on public.return_logs
  for each row execute function public.enqueue_return_notification();

revoke execute on function public.enqueue_return_notification() from public, anon, authenticated;

-- Service key only. Claims a batch so two runs cannot send the same row.
create or replace function public.claim_return_notifications(p_limit integer default 20)
returns table (
  id              uuid,
  return_id       uuid,
  old_status      public.return_status,
  new_status      public.return_status,
  customer_email  text,
  customer_name   text,
  order_number    text,
  product_name    text,
  quantity        integer,
  reason          text,
  customer_sent_at timestamptz,
  owner_sent_at   timestamptz,
  slack_sent_at   timestamptz
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
  select c.id, c.return_id, c.old_status, c.new_status, c.customer_email, c.customer_name,
         c.order_number, c.product_name, c.quantity, c.reason,
         c.customer_sent_at, c.owner_sent_at, c.slack_sent_at
  from claimed c;
$$;

create or replace function public.complete_return_notification(
  p_id             uuid,
  p_customer_sent  boolean,
  p_owner_sent     boolean,
  p_slack_sent     boolean,
  p_error          text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.return_notifications n
     set customer_sent_at = coalesce(n.customer_sent_at, case when p_customer_sent then now() end),
         owner_sent_at = coalesce(n.owner_sent_at, case when p_owner_sent then now() end),
         slack_sent_at = coalesce(n.slack_sent_at, case when p_slack_sent then now() end),
         last_error = p_error,
         claimed_at = null,
         sent_at = case
           when coalesce(n.customer_sent_at, case when p_customer_sent then now() end) is not null
            and coalesce(n.owner_sent_at, case when p_owner_sent then now() end) is not null
            and coalesce(n.slack_sent_at, case when p_slack_sent then now() end) is not null
           then now()
         end
   where n.id = p_id;
$$;

revoke execute on function public.claim_return_notifications(integer) from public, anon, authenticated;
revoke execute on function public.complete_return_notification(uuid, boolean, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_return_notifications(integer) to service_role;
grant execute on function public.complete_return_notification(uuid, boolean, boolean, boolean, text) to service_role;

-- Calls the Edge Function only when a notification is waiting. The URL and
-- shared secret live in Vault as notify_return_function_url and
-- notify_return_secret. Until both exist, this does nothing.
create or replace function public.invoke_return_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.return_notifications n
    where n.sent_at is null
      and n.attempts < 5
      and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'notify_return_function_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notify_return_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.invoke_return_notifications() from public, anon, authenticated;

select cron.schedule(
  'notify-return-events',
  '* * * * *',
  'select public.invoke_return_notifications()'
);
