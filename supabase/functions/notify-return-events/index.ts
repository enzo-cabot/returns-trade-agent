// Sends queued return and order-cancellation notifications:
//   - email to the customer (order, item, status, next step)
//   - email to the store owner
//   - a Slack message on the returns webhook
// Called every minute by the database. Each channel is sent once.
// Failures stay on the outbox row (last_error, attempts) and are retried.
//
// Secrets (supabase secrets set), never in the repo or the frontend:
//   NOTIFY_RETURN_SECRET, RESEND_API_KEY, EMAIL_FROM, GMAIL_ADDRESS,
//   GMAIL_APP_PASSWORD, SLACK_RETURNS_WEBHOOK, OWNER_EMAIL
// Optional: EMAIL_FROM_NAME, BRAND_NAME, NOTIFY_MODE=mock (local tests only)

import nodemailer from "npm:nodemailer@6.9.16";
import { customerEmail, ownerEmail, slackText } from "./messages.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("NOTIFY_RETURN_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "";
const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS") ?? "";
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";
const SLACK_RETURNS_WEBHOOK = Deno.env.get("SLACK_RETURNS_WEBHOOK") ?? "";
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL") ?? "";
const EMAIL_FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") ?? "Returns Trade Agent";
const BRAND_NAME = Deno.env.get("BRAND_NAME") ?? "Returns Trade Agent";
const MOCK = Deno.env.get("NOTIFY_MODE") === "mock";

type Note = {
  id: string;
  kind?: string; // "return" (default) or "order_cancellation"
  return_id: string | null;
  cancellation_id?: string | null;
  amount?: number | string | null;
  old_status: string | null;
  new_status: string;
  customer_email: string;
  customer_name: string | null;
  order_number: string | null;
  product_name: string | null;
  quantity: number | null;
  reason: string | null;
  customer_sent_at: string | null;
  owner_sent_at: string | null;
  slack_sent_at: string | null;
};

const mockSent: Array<{ channel: string; to?: string; subject?: string; text: string }> = [];

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (MOCK) {
    mockSent.push({ channel: "email", to, subject, text });
    return;
  }
  if (RESEND_API_KEY) {
    if (!EMAIL_FROM) throw new Error("EMAIL_FROM not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return;
  }
  if (!GMAIL_ADDRESS || !GMAIL_APP_PASSWORD) {
    throw new Error("RESEND_API_KEY or GMAIL_ADDRESS and GMAIL_APP_PASSWORD not set");
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
  });
  await transport.sendMail({
    from: { name: EMAIL_FROM_NAME, address: GMAIL_ADDRESS },
    to,
    subject,
    text,
  });
}

async function sendSlack(text: string): Promise<void> {
  if (MOCK) {
    mockSent.push({ channel: "slack", text });
    return;
  }
  if (!SLACK_RETURNS_WEBHOOK) throw new Error("SLACK_RETURNS_WEBHOOK not set");
  const res = await fetch(SLACK_RETURNS_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

async function deliver(note: Note): Promise<{ customer: boolean; owner: boolean; slack: boolean; error: string | null }> {
  const errors: string[] = [];
  let customer = note.customer_sent_at !== null;
  let owner = note.owner_sent_at !== null;
  let slack = note.slack_sent_at !== null;

  if (!customer) {
    try {
      const mail = customerEmail(note, BRAND_NAME);
      await sendEmail(mail.to, mail.subject, mail.text);
      customer = true;
    } catch (e) {
      errors.push(`customer: ${e}`);
    }
  }
  if (!owner) {
    try {
      if (!MOCK && !OWNER_EMAIL) throw new Error("OWNER_EMAIL not set");
      const mail = ownerEmail(note, BRAND_NAME);
      await sendEmail(MOCK ? "owner@example.com" : OWNER_EMAIL, mail.subject, mail.text);
      owner = true;
    } catch (e) {
      errors.push(`owner: ${e}`);
    }
  }
  if (!slack) {
    try {
      await sendSlack(slackText(note));
      slack = true;
    } catch (e) {
      errors.push(`slack: ${e}`);
    }
  }
  return { customer, owner, slack, error: errors.length ? errors.join("; ") : null };
}

Deno.serve(async (req) => {
  if (!SECRET || req.headers.get("x-notify-secret") !== SECRET) {
    return new Response("Unauthorised", { status: 401 });
  }
  const rows = await rpc<Note[]>("claim_return_notifications", { p_limit: 20 });
  const results = [];
  for (const note of rows ?? []) {
    const out = await deliver(note);
    await rpc("complete_return_notification", {
      p_id: note.id,
      p_customer_sent: out.customer,
      p_owner_sent: out.owner,
      p_slack_sent: out.slack,
      p_error: out.error,
    });
    results.push({ id: note.id, ...out });
  }
  return Response.json({ processed: results.length, results, mock: MOCK ? mockSent.splice(0) : undefined });
});
