-- After-hours contact requests: Slack to the support team and an email to
-- the customer. A cron job calls the forward-contact-requests Edge Function
-- every minute while there is something to send.

-- =====================================================================
-- Tracking columns (replace the unused single forward_channel)
-- =====================================================================

drop policy "Customers create own contact requests" on public.contact_requests;

alter table public.contact_requests
  drop column forward_channel,
  add column slack_sent_at      timestamptz,
  add column email_sent_at      timestamptz,
  add column forward_attempts   integer not null default 0,
  add column forward_claimed_at timestamptz,
  add column forward_error      text;

drop type public.forward_channel;

create policy "Customers create own contact requests" on public.contact_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and assigned_employee_id is null
    and forwarded_at is null
    and slack_sent_at is null
    and email_sent_at is null
    and forward_attempts = 0
    and forward_claimed_at is null
  );

-- =====================================================================
-- Next time a person is at work
-- =====================================================================

-- Returns from_time itself during business hours, otherwise the next
-- weekday 08:00 South Africa time that is not a public holiday.
create or replace function public.next_business_opening(from_time timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := from_time at time zone 'Africa/Johannesburg';
  v_day   date := v_local::date;
begin
  if public.is_business_hours(from_time) then
    return from_time;
  end if;

  if v_local::time >= time '08:00' then
    v_day := v_day + 1;
  end if;

  while extract(isodow from v_day) > 5
     or exists (select 1 from public.public_holidays h where h.holiday_date = v_day)
  loop
    v_day := v_day + 1;
  end loop;

  return (v_day + time '08:00') at time zone 'Africa/Johannesburg';
end;
$$;

grant execute on function public.next_business_opening(timestamptz) to anon, authenticated, service_role;

-- =====================================================================
-- Work queue for the Edge Function (service key only)
-- =====================================================================

-- Picks requests still to send, marks them claimed so overlapping runs never
-- send twice, and counts the attempt. Gives up after 5 attempts; a claim
-- older than 5 minutes is treated as a crashed run and picked up again.
create or replace function public.claim_contact_requests_to_forward(p_limit integer default 20)
returns table (
  id             uuid,
  type           public.contact_type,
  subject        text,
  message        text,
  return_id      uuid,
  created_at     timestamptz,
  slack_sent_at  timestamptz,
  email_sent_at  timestamptz,
  customer_email text,
  customer_name  text,
  reply_from     timestamptz
)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select c.id
    from public.contact_requests c
    where c.forward_to_human
      and c.forwarded_at is null
      and c.forward_attempts < 5
      and (c.forward_claimed_at is null or c.forward_claimed_at < now() - interval '5 minutes')
    order by c.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.contact_requests c
       set forward_claimed_at = now(),
           forward_attempts = c.forward_attempts + 1
      from picked
     where c.id = picked.id
    returning c.*
  )
  select cl.id, cl.type, cl.subject, cl.message, cl.return_id, cl.created_at,
         cl.slack_sent_at, cl.email_sent_at, p.email, p.full_name,
         public.next_business_opening(cl.created_at)
  from claimed cl
  join public.profiles p on p.id = cl.user_id;
$$;

-- Records the result of one attempt and releases the claim.
create or replace function public.complete_contact_forward(
  p_id         uuid,
  p_slack_sent boolean,
  p_email_sent boolean,
  p_error      text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.contact_requests c
     set slack_sent_at = coalesce(c.slack_sent_at, case when p_slack_sent then now() end),
         email_sent_at = coalesce(c.email_sent_at, case when p_email_sent then now() end),
         forward_error = p_error,
         forward_claimed_at = null,
         forwarded_at = case
           when coalesce(c.slack_sent_at, case when p_slack_sent then now() end) is not null
            and coalesce(c.email_sent_at, case when p_email_sent then now() end) is not null
           then now()
         end
   where c.id = p_id;
$$;

revoke execute on function public.claim_contact_requests_to_forward(integer)
  from public, anon, authenticated;
revoke execute on function public.complete_contact_forward(uuid, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_contact_requests_to_forward(integer) to service_role;
grant execute on function public.complete_contact_forward(uuid, boolean, boolean, text) to service_role;

-- =====================================================================
-- Timer
-- =====================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Calls the Edge Function only when something is waiting. The function URL
-- and shared secret live in Supabase Vault as 'forward_function_url' and
-- 'forward_secret'; until both are set this does nothing.
create or replace function public.invoke_contact_forwarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (
    select 1 from public.contact_requests c
    where c.forward_to_human
      and c.forwarded_at is null
      and c.forward_attempts < 5
      and (c.forward_claimed_at is null or c.forward_claimed_at < now() - interval '5 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'forward_function_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'forward_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-forward-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke execute on function public.invoke_contact_forwarding() from public, anon, authenticated;

select cron.schedule(
  'forward-contact-requests',
  '* * * * *',
  'select public.invoke_contact_forwarding()'
);
