-- Returns management app: core schema.
-- Customers sign up with email and password (Supabase Auth), submit returns
-- and contact support or appeal. Staff work from the employees table.

-- =====================================================================
-- Types
-- =====================================================================

create type public.employee_role as enum ('customer_service');

create type public.auth_event as enum ('sign_up', 'sign_in', 'sign_in_failed', 'sign_out');

create type public.order_status as enum ('pending', 'shipped', 'delivered', 'cancelled');

create type public.return_status as enum (
  'submitted', 'approved', 'rejected', 'in_transit', 'received', 'refunded', 'cancelled'
);

create type public.contact_type as enum ('support', 'appeal');

create type public.contact_status as enum ('open', 'in_progress', 'resolved', 'closed');

create type public.forward_channel as enum ('email', 'slack');

create type public.tracking_status as enum (
  'awaiting_collection', 'collected', 'in_transit', 'out_for_delivery', 'delivered', 'exception'
);

-- =====================================================================
-- Shared helpers
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- Tables
-- =====================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  full_name   text not null,
  email       text not null unique,
  role        public.employee_role not null default 'customer_service',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.login_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  event       public.auth_event not null,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index login_logs_user_id_idx on public.login_logs (user_id, created_at desc);

-- Orders come from the shop. user_id is filled in when a customer signs up
-- with the same email address as the order.
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text not null unique,
  shop_name       text not null,
  customer_email  text not null,
  user_id         uuid references public.profiles (id) on delete set null,
  status          public.order_status not null default 'pending',
  ordered_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  total_amount    numeric(12, 2) not null default 0,
  currency        char(3) not null default 'ZAR',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index orders_user_id_idx on public.orders (user_id);
create index orders_customer_email_idx on public.orders (lower(customer_email));

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  sku           text not null,
  product_name  text not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12, 2) not null check (unit_price >= 0),
  on_sale       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index order_items_order_id_idx on public.order_items (order_id);

create table public.returns (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  order_id       uuid not null references public.orders (id),
  order_item_id  uuid not null references public.order_items (id),
  quantity       integer not null default 1 check (quantity > 0),
  reason         text not null,
  notes          text,
  status         public.return_status not null default 'submitted',
  decided_by     uuid references public.employees (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index returns_user_id_idx on public.returns (user_id);
create index returns_order_item_id_idx on public.returns (order_item_id);

-- History of every status change on a return.
create table public.return_logs (
  id          bigint generated always as identity primary key,
  return_id   uuid not null references public.returns (id) on delete cascade,
  old_status  public.return_status,
  new_status  public.return_status not null,
  changed_by  uuid references auth.users (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index return_logs_return_id_idx on public.return_logs (return_id, created_at);

create table public.contact_requests (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  type                    public.contact_type not null default 'support',
  return_id               uuid references public.returns (id) on delete set null,
  subject                 text not null,
  message                 text not null,
  status                  public.contact_status not null default 'open',
  assigned_employee_id    uuid references public.employees (id) on delete set null,
  outside_business_hours  boolean not null default false,
  forward_to_human        boolean not null default false,
  forward_channel         public.forward_channel,
  forwarded_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint appeal_needs_return check (type <> 'appeal' or return_id is not null)
);
create index contact_requests_user_id_idx on public.contact_requests (user_id);
create index contact_requests_to_forward_idx on public.contact_requests (created_at)
  where forward_to_human and forwarded_at is null;

create table public.courier_tracking (
  id              uuid primary key default gen_random_uuid(),
  return_id       uuid not null references public.returns (id) on delete cascade,
  courier         text not null default 'The Courier Guy',
  waybill_number  text not null unique,
  status          public.tracking_status not null default 'awaiting_collection',
  collected_at    timestamptz,
  last_checked_at timestamptz,
  raw_response    jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index courier_tracking_return_id_idx on public.courier_tracking (return_id);

create table public.courier_tracking_events (
  id           bigint generated always as identity primary key,
  tracking_id  uuid not null references public.courier_tracking (id) on delete cascade,
  status       public.tracking_status not null,
  location     text,
  description  text,
  occurred_at  timestamptz not null default now()
);
create index courier_tracking_events_tracking_id_idx
  on public.courier_tracking_events (tracking_id, occurred_at);

create table public.public_holidays (
  holiday_date  date primary key,
  name          text not null
);

-- updated_at triggers
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger employees_updated_at before update on public.employees
  for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create trigger returns_updated_at before update on public.returns
  for each row execute function public.set_updated_at();
create trigger contact_requests_updated_at before update on public.contact_requests
  for each row execute function public.set_updated_at();
create trigger courier_tracking_updated_at before update on public.courier_tracking
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Business rules
-- =====================================================================

-- Mon to Fri, 08:00 to 17:00 South Africa time, not on a public holiday.
create or replace function public.is_business_hours(at_time timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from (at_time at time zone 'Africa/Johannesburg')) between 1 and 5
     and (at_time at time zone 'Africa/Johannesburg')::time >= time '08:00'
     and (at_time at time zone 'Africa/Johannesburg')::time <  time '17:00'
     and not exists (
       select 1 from public.public_holidays h
       where h.holiday_date = (at_time at time zone 'Africa/Johannesburg')::date
     );
$$;

create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid() and e.is_active
  );
$$;

-- New sign up: create the profile, link shop orders with the same email,
-- and log the sign up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone'
  );

  update public.orders
     set user_id = new.id
   where user_id is null
     and lower(customer_email) = lower(new.email);

  insert into public.login_logs (user_id, email, event)
  values (new.id, new.email, 'sign_up');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Successful sign in: Supabase Auth updates last_sign_in_at.
create or replace function public.handle_user_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.login_logs (user_id, email, event)
  values (new.id, new.email, 'sign_in');
  return new;
end;
$$;

create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute function public.handle_user_sign_in();

-- For the backend: log events the database cannot see by itself
-- (failed sign ins, sign outs) with IP address and device.
create or replace function public.log_auth_event(
  p_event      public.auth_event,
  p_email      text,
  p_user_id    uuid default null,
  p_ip_address inet default null,
  p_user_agent text default null
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.login_logs (user_id, email, event, ip_address, user_agent)
  values (p_user_id, p_email, p_event, p_ip_address, p_user_agent)
  returning id;
$$;

-- Return rules: own order, delivered, within 14 days of delivery, item not
-- on sale, quantity available, and no other open return for the same item.
create or replace function public.validate_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item  public.order_items%rowtype;
begin
  select * into v_item from public.order_items where id = new.order_item_id;
  if not found or v_item.order_id <> new.order_id then
    raise exception 'This item is not part of that order.' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = new.order_id;
  if v_order.user_id is distinct from new.user_id then
    raise exception 'This order does not belong to you.' using errcode = 'P0001';
  end if;

  if v_order.status <> 'delivered' or v_order.delivered_at is null then
    raise exception 'This order has not been delivered yet.' using errcode = 'P0001';
  end if;

  if v_order.delivered_at < now() - interval '14 days' then
    raise exception 'Returns must be made within 14 days of delivery.' using errcode = 'P0001';
  end if;

  if v_item.on_sale then
    raise exception 'Items bought on sale cannot be returned.' using errcode = 'P0001';
  end if;

  if new.quantity > v_item.quantity then
    raise exception 'You cannot return more items than you bought.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.returns r
    where r.order_item_id = new.order_item_id
      and r.status not in ('rejected', 'cancelled')
  ) then
    raise exception 'A return for this item already exists.' using errcode = 'P0001';
  end if;

  new.status := 'submitted';
  return new;
end;
$$;

create trigger returns_validate
  before insert on public.returns
  for each row execute function public.validate_return();

create or replace function public.log_return_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.return_logs (return_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.return_logs (return_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger returns_log_status
  after insert or update of status on public.returns
  for each row execute function public.log_return_status();

-- Contact requests: an appeal must be about the customer's own return, and
-- anything sent outside business hours is flagged for a human. The app sends
-- the Slack or email message, then fills forward_channel and forwarded_at.
create or replace function public.prepare_contact_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.return_id is not null and not exists (
    select 1 from public.returns r
    where r.id = new.return_id and r.user_id = new.user_id
  ) then
    raise exception 'That return does not belong to you.' using errcode = 'P0001';
  end if;

  -- Customers cannot pick their own timestamp to dodge the hours check.
  if auth.role() = 'authenticated' then
    new.created_at := now();
  end if;

  new.outside_business_hours := not public.is_business_hours(new.created_at);
  new.forward_to_human := new.outside_business_hours;
  return new;
end;
$$;

create trigger contact_requests_prepare
  before insert on public.contact_requests
  for each row execute function public.prepare_contact_request();

-- Dummy The Courier Guy tracking call. Works out a fake status from the time
-- since collection, stores it and returns an API style JSON response.
-- Replace the body with a real API call later; the tables stay the same.
create or replace function public.mock_courier_tracking(p_waybill text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track     public.courier_tracking%rowtype;
  v_hours     numeric;
  v_status    public.tracking_status;
  v_location  text;
  v_response  jsonb;
begin
  select * into v_track from public.courier_tracking where waybill_number = p_waybill;
  if not found then
    raise exception 'Unknown waybill %', p_waybill using errcode = 'P0002';
  end if;

  -- Customers may only track their own returns.
  if auth.uid() is not null and not public.is_employee() and not exists (
    select 1 from public.returns r
    where r.id = v_track.return_id and r.user_id = auth.uid()
  ) then
    raise exception 'Not allowed to track this waybill.' using errcode = '42501';
  end if;

  if v_track.collected_at is null then
    v_status := 'awaiting_collection';
    v_location := 'Customer address';
  else
    v_hours := extract(epoch from now() - v_track.collected_at) / 3600;
    if v_hours < 12 then
      v_status := 'collected';        v_location := 'Collection branch';
    elsif v_hours < 48 then
      v_status := 'in_transit';       v_location := 'Johannesburg hub';
    elsif v_hours < 60 then
      v_status := 'out_for_delivery'; v_location := 'Returns warehouse branch';
    else
      v_status := 'delivered';        v_location := 'Returns warehouse';
    end if;
  end if;

  v_response := jsonb_build_object(
    'courier', 'The Courier Guy',
    'waybill', p_waybill,
    'status', v_status,
    'location', v_location,
    'checked_at', now(),
    'mock', true
  );

  if v_status is distinct from v_track.status then
    insert into public.courier_tracking_events (tracking_id, status, location, description)
    values (v_track.id, v_status, v_location, 'Mock tracking update');
  end if;

  update public.courier_tracking
     set status = v_status, last_checked_at = now(), raw_response = v_response
   where id = v_track.id;

  return v_response;
end;
$$;

-- =====================================================================
-- Permissions and row level security
-- =====================================================================

-- Backend-only functions.
revoke execute on function public.log_auth_event(public.auth_event, text, uuid, inet, text)
  from public, anon, authenticated;
grant execute on function public.log_auth_event(public.auth_event, text, uuid, inet, text)
  to service_role;

revoke execute on function public.mock_courier_tracking(text) from public, anon;
grant execute on function public.mock_courier_tracking(text) to authenticated, service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_sign_in() from public, anon, authenticated;

grant execute on function public.is_business_hours(timestamptz) to anon, authenticated, service_role;
grant execute on function public.is_employee() to authenticated, service_role;

-- Supabase grants everything on new public tables by default. Start from
-- nothing, then give signed-in users only what they need; row level
-- security narrows it down further.
revoke all on all tables in schema public from anon, authenticated;
-- Table access for signed-in users; row level security narrows it down.
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant select on public.employees, public.login_logs, public.orders, public.order_items,
  public.return_logs, public.courier_tracking_events to authenticated;
grant select, insert, update on public.returns, public.contact_requests to authenticated;
grant select, insert, update on public.courier_tracking to authenticated;
grant insert on public.courier_tracking_events to authenticated;
grant select on public.public_holidays to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table public.profiles                enable row level security;
alter table public.employees               enable row level security;
alter table public.login_logs              enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.returns                 enable row level security;
alter table public.return_logs             enable row level security;
alter table public.contact_requests        enable row level security;
alter table public.courier_tracking        enable row level security;
alter table public.courier_tracking_events enable row level security;
alter table public.public_holidays         enable row level security;

-- profiles
create policy "Own profile or staff can read" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_employee()));
create policy "Customers update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- employees (managed by the backend only)
create policy "Staff can read staff list" on public.employees
  for select to authenticated
  using ((select public.is_employee()));

-- login_logs
create policy "Own login history or staff" on public.login_logs
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_employee()));

-- orders and items
create policy "Own orders or staff" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_employee()));
create policy "Own order items or staff" on public.order_items
  for select to authenticated
  using (
    (select public.is_employee())
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = (select auth.uid())
    )
  );

-- returns
create policy "Own returns or staff" on public.returns
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_employee()));
create policy "Customers submit own returns" on public.returns
  for insert to authenticated
  with check (user_id = (select auth.uid()) and decided_by is null);
create policy "Staff update returns" on public.returns
  for update to authenticated
  using ((select public.is_employee()))
  with check ((select public.is_employee()));

-- return_logs
create policy "Own return history or staff" on public.return_logs
  for select to authenticated
  using (
    (select public.is_employee())
    or exists (
      select 1 from public.returns r
      where r.id = return_logs.return_id and r.user_id = (select auth.uid())
    )
  );

-- contact_requests
create policy "Own contact requests or staff" on public.contact_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_employee()));
create policy "Customers create own contact requests" on public.contact_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and assigned_employee_id is null
    and forward_channel is null
    and forwarded_at is null
  );
create policy "Staff update contact requests" on public.contact_requests
  for update to authenticated
  using ((select public.is_employee()))
  with check ((select public.is_employee()));

-- courier tracking
create policy "Own tracking or staff" on public.courier_tracking
  for select to authenticated
  using (
    (select public.is_employee())
    or exists (
      select 1 from public.returns r
      where r.id = courier_tracking.return_id and r.user_id = (select auth.uid())
    )
  );
create policy "Staff create tracking" on public.courier_tracking
  for insert to authenticated
  with check ((select public.is_employee()));
create policy "Staff update tracking" on public.courier_tracking
  for update to authenticated
  using ((select public.is_employee()))
  with check ((select public.is_employee()));

create policy "Own tracking events or staff" on public.courier_tracking_events
  for select to authenticated
  using (
    (select public.is_employee())
    or exists (
      select 1
      from public.courier_tracking t
      join public.returns r on r.id = t.return_id
      where t.id = courier_tracking_events.tracking_id and r.user_id = (select auth.uid())
    )
  );
create policy "Staff add tracking events" on public.courier_tracking_events
  for insert to authenticated
  with check ((select public.is_employee()));

-- public_holidays
create policy "Anyone can read holidays" on public.public_holidays
  for select to anon, authenticated
  using (true);
