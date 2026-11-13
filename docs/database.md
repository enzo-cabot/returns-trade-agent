# Database guide

Supabase project `xgihyjvktkkjcroezqyx`. Schema lives in `supabase/migrations/`; change it only by adding a new migration file (`supabase migration new <name>`), never by editing one that has already been pushed.

## Sign up and login
Supabase Auth, email and password. Pass `full_name` and `phone` in the sign up `data` field; they are copied into `profiles`.

On sign up the database automatically:
- creates the `profiles` row,
- links any shop `orders` with the same email to the new user,
- writes a `sign_up` row to `login_logs`.

Every successful sign in writes a `sign_in` row. Note that a sign up with email confirmation off also counts as a first sign in. Failed sign ins and sign outs are not visible to the database: the Java backend must log them with `log_auth_event(event, email, user_id, ip_address, user_agent)` (service key only). Pass IP and device there too.

## Tables
| Table | Purpose |
|---|---|
| `profiles` | One row per customer login. Customers may edit only `full_name` and `phone`. |
| `employees` | Staff. `role` is an enum, currently only `customer_service`; add roles with `alter type employee_role add value '...'`. Set `user_id` to give a staff member a login. |
| `login_logs` | Sign up, sign in, failed sign in, sign out. |
| `orders`, `order_items` | Shop orders (dummy `DEMO-*` data for now). `order_items.on_sale` drives the return rule. |
| `returns` | One return per order item. |
| `return_logs` | Every status change of a return, written automatically. |
| `contact_requests` | Support messages and appeals. |
| `courier_tracking`, `courier_tracking_events` | The Courier Guy waybill and its history. |
| `public_holidays` | South African public holidays 2026 and 2027. Add later years before they start. |

## Rules the database enforces
**Returns** (on insert, error messages are customer friendly):
- the order belongs to the customer and is `delivered`,
- delivered no more than 14 days ago,
- item not bought on sale,
- quantity not more than bought,
- no other open return for that item (rejected or cancelled ones do not count).

New returns always start as `submitted`. Only staff can change status.

**Contact requests:**
- `type = 'appeal'` needs a `return_id`, and it must be the customer's own return.
- Business hours are Monday to Friday, 08:00 to 17:00 South Africa time, excluding `public_holidays`. Check any time with `is_business_hours(timestamp)`.
- A request sent outside business hours gets `outside_business_hours = true` and `forward_to_human = true`.
- Flagged requests are sent on automatically (see "After-hours alerts" below). Nothing for the Java app to do.

**Courier tracking (dummy):**
- Create a `courier_tracking` row with the waybill and `collected_at` when the parcel is collected.
- Call `mock_courier_tracking(waybill)`. It returns a fake The Courier Guy response and stores status changes: collected (under 12 hours), in transit (under 48), out for delivery (under 60), then delivered.
- Swap its body for the real API later; the tables stay the same.

## After-hours alerts
Every minute a database timer (`pg_cron`) checks for flagged requests not yet sent. If there are any, it calls the Edge Function `supabase/functions/forward-contact-requests`, which:
- posts the request to the support Slack channel,
- emails the customer that a person will reply from `next_business_opening()` (next weekday 08:00 SA time, skipping holidays).

Columns on `contact_requests`: `slack_sent_at`, `email_sent_at`, `forwarded_at` (both done), `forward_attempts`, `forward_error`. Each part is sent once; failures are retried each minute and given up after 5 tries. Staff should check for rows with `forward_attempts >= 5 and forwarded_at is null`.

Settings:
- Function secrets (`supabase secrets set`): `FORWARD_SECRET`, `SLACK_WEBHOOK_URL`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` (a Google app password), optional `EMAIL_FROM_NAME` and `BRAND_NAME`.
- Emails go through Gmail (port 465). Gmail allows about 500 emails a day; move to a sending service with your own domain before that becomes a limit.
- Supabase Vault: `forward_function_url` (the function's URL) and `forward_secret` (same value as `FORWARD_SECRET`). The timer does nothing until both exist.

To add another channel later, add a `<channel>_sent_at` column and a send step in the function.

## Who can see what (row level security)
- Customers: only their own profile, orders, returns, return history, contact requests, tracking and login history.
- Staff (an active `employees` row linked to their login): read everything, update returns, contact requests and tracking.
- Signed-out visitors: only `public_holidays`.
- The **service key** (secret key) skips all of these rules. Use it only in the Java backend, never in the frontend.

## Connecting from Java
- Calls on behalf of a customer: Supabase REST API (`https://xgihyjvktkkjcroezqyx.supabase.co/rest/v1/`) with the publishable key and the user's access token, so the rules above apply.
- Backend jobs (forwarding alerts, logging failed sign ins): the secret key, or a direct Postgres connection via JDBC using the connection string from the dashboard (Project Settings, Database).

## Running locally
`supabase start` then `supabase db reset` rebuilds the database with the dummy data. Local email confirmation is off; on the live project it is on.
