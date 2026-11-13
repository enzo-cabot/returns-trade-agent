# Database guide

Supabase project `xgihyjvktkkjcroezqyx`. Schema lives in `supabase/migrations/`; change it only by adding a new migration file (`supabase migration new <name>`), never by editing one that has already been pushed.

## Sign up and login
Supabase Auth, email and password. Pass `full_name` and `phone` in the sign up `data` field; they are copied into `profiles`.

On sign up the database automatically:
- creates the `profiles` row,
- links any shop `orders` with the same email to the new user,
- writes a `sign_up` row to `login_logs`.

The seed creates orders for demo emails such as `customer.one@example.com`, and it does not create auth users. On a fresh hosted project those orders stay unlinked until someone creates the auth user for that email. Create it in the Supabase dashboard with auto-confirm so they can sign in without a confirmation email. Until that user exists, signing in as the demo email fails. Creating the user runs the sign-up trigger, which links the matching orders.

Hosted sign-up email uses Supabase's built-in mailer, which stops after a few messages with "email rate limit exceeded". Set a custom SMTP provider in the Supabase dashboard (Authentication → SMTP). This project uses Resend for that. The Resend API key stays in the Supabase SMTP settings or in Edge Function secrets. It does not go in the frontend or in Netlify. Local `supabase start` catches mail instead of sending it.

Every successful sign in writes a `sign_in` row. Note that a sign up with email confirmation off also counts as a first sign in. Failed sign ins and sign outs are not visible to the database. The frontend posts them to the Edge Function `log-auth-event`, which calls `log_auth_event(event, email, user_id, ip_address, user_agent)` with the service key. The browser never receives that key. A backend can call the same function directly. Pass IP and device there too. The function accepts only `sign_in_failed` and `sign_out`.

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
- item is not food (`order_items.category = 'food'`, including any `SKU-FOOD-*` row),
- quantity not more than bought,
- no other open return for that item (rejected or cancelled ones do not count).

New returns always start as `submitted`. Only an employee can change `returns.status` (row level security). The customer screens never approve a return.

The database rules decide whether an item can be returned. The browser does not call a model. A future LLM call has to go through a server-side Edge Function that reads an `XAI_API_KEY` secret. That key must not be placed in frontend code or in Netlify.

Each status, including the first `submitted` row, is written to `return_logs` and queued in `return_notifications`. That outbox stores the order number, item, status, and who it is for, plus `customer_sent_at`, `owner_sent_at`, `slack_sent_at`, `attempts`, `last_error`, and `sent_at` (set only when all three sends succeeded). A failed send stays visible and is retried, up to 5 attempts. Once a minute `invoke_return_notifications()` calls the Edge Function `notify-return-events` when a row is waiting. The function URL and shared secret live in Vault as `notify_return_function_url` and `notify_return_secret`. Until both are set, the timer does nothing.

Customers place a new shop order with `place_order` (pending, or delivered only when `p_demo` is true). They cannot insert into `orders` directly.

`notify-return-events` reads these Edge Function secrets (`supabase secrets set`). None of them belong in the frontend or in Netlify:

- `NOTIFY_RETURN_SECRET` (same value as Vault `notify_return_secret`)
- `RESEND_API_KEY` and `EMAIL_FROM` (Resend), or `GMAIL_ADDRESS` and `GMAIL_APP_PASSWORD` (Gmail SMTP on port 465)
- `SLACK_RETURNS_WEBHOOK`
- `OWNER_EMAIL`

Optional: `EMAIL_FROM_NAME`, `BRAND_NAME`. `NOTIFY_MODE=mock` skips the network and is only for a local test. Vault also needs `notify_return_function_url` (the function URL) before the timer will call it.

The number 14 lives only in `return_window_days()`. `return_decision()` is the only copy of the checks. The insert trigger raises that function's `reason`. Signed-in customers read the same decision, per item, with `customer_return_eligibility(quantity)` and the wording with `return_policy()`. A partial unique index stops two open returns for one item from both being inserted at once.

**Contact requests:**
- `type = 'appeal'` needs a `return_id`, and it must be the customer's own return.
- Business hours are Monday to Friday, 08:00 to 17:00 South Africa time, excluding `public_holidays`. Check any time with `is_business_hours(timestamp)`.
- A request sent outside business hours gets `outside_business_hours = true` and `forward_to_human = true`.
- Flagged requests are sent on automatically (see "After-hours alerts" below). Nothing for the Java app to do.

**Courier tracking (dummy):**
- Create a `courier_tracking` row with the waybill and `collected_at` when the parcel is collected. Only staff can insert that row, and only after the return is approved.
- Call `mock_courier_tracking(waybill)`. It returns a fake The Courier Guy response and stores status changes: collected (under 12 hours), in transit (under 48), out for delivery (under 60), then delivered. The storefront shows a customer's own tracking and refreshes it with this function.
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

## Frontend
The static site lives in `frontend/`. Netlify publishes that folder with no build step (`netlify.toml`).

The browser only receives the project URL and the anon/publishable key, from `frontend/supabase-public.example.js`. The committed key is the placeholder `YOUR_SUPABASE_ANON_PUBLIC_KEY`. For local Supabase, replace that placeholder with the anon key printed by `supabase status`. For a Netlify deploy, edit the same file before publishing. There is no build, so a Netlify environment variable is not substituted into the page.

The service role key, Resend, Slack, and Gmail credentials stay in Supabase Edge Function secrets (`supabase secrets set`). They do not go in the frontend or in Netlify.

## Running locally
`supabase start` then `supabase db reset` rebuilds the database with the dummy data. Local email confirmation is off; on the live project it is on. Serve the site with `python3 -m http.server 3000` from `frontend/`.
