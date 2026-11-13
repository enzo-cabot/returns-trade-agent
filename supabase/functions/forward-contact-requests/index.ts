// Sends after-hours contact requests on to people:
//   - a Slack message to the support team
//   - an email to the customer saying when a person will reply
// Called every minute by the database (see the contact_forwarding migration).
// Each part is sent once; anything that fails is retried on the next run.

import nodemailer from "npm:nodemailer@6.9.16";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FORWARD_SECRET = Deno.env.get("FORWARD_SECRET");
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL");
const GMAIL_ADDRESS = Deno.env.get("GMAIL_ADDRESS");
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");
const EMAIL_FROM_NAME = Deno.env.get("EMAIL_FROM_NAME") ?? "Returns Support";
const BRAND_NAME = Deno.env.get("BRAND_NAME") ?? "Customer Support";

type ContactRequest = {
  id: string;
  type: "support" | "appeal";
  subject: string;
  message: string;
  return_id: string | null;
  created_at: string;
  slack_sent_at: string | null;
  email_sent_at: string | null;
  customer_email: string;
  customer_name: string | null;
  reply_from: string;
};

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

function formatSaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(text: string): string {
  return escapeSlack(text).replace(/"/g, "&quot;");
}

async function sendSlack(r: ContactRequest): Promise<void> {
  if (!SLACK_WEBHOOK_URL) throw new Error("SLACK_WEBHOOK_URL not set");
  const label = r.type === "appeal" ? "Appeal" : "Support request";
  const lines = [
    `*${label} received after hours*`,
    `*From:* ${escapeSlack(r.customer_name ?? "")} <mailto:${r.customer_email}|${escapeSlack(r.customer_email)}>`,
    `*Sent:* ${formatSaTime(r.created_at)}`,
    r.return_id ? `*Return:* \`${r.return_id}\`` : null,
    `*Subject:* ${escapeSlack(r.subject)}`,
    `>${escapeSlack(r.message).replace(/\n/g, "\n>")}`,
    `Request \`${r.id}\``,
  ].filter(Boolean);

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

async function sendEmail(r: ContactRequest): Promise<void> {
  if (!GMAIL_ADDRESS || !GMAIL_APP_PASSWORD) throw new Error("GMAIL_ADDRESS or GMAIL_APP_PASSWORD not set");
  const name = r.customer_name ? ` ${r.customer_name}` : "";
  const when = formatSaTime(r.reply_from);
  const what = r.type === "appeal" ? "appeal" : "message";
  const text = [
    `Hi${name},`,
    ``,
    `Thanks for your ${what}: "${r.subject}".`,
    `Our team is offline right now. A person will pick it up from ${when} (South Africa time).`,
    ``,
    `${BRAND_NAME}`,
  ].join("\n");
  const html = text
    .split("\n")
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : ""))
    .join("");

  // Port 465 (TLS): Supabase blocks outgoing ports 25 and 587.
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
  });
  await transport.sendMail({
    from: { name: EMAIL_FROM_NAME, address: GMAIL_ADDRESS },
    to: r.customer_email,
    subject: `We got your ${what}: ${r.subject}`,
    text,
    html,
  });
}

async function forward(r: ContactRequest): Promise<{ slack: boolean; email: boolean; error: string | null }> {
  const errors: string[] = [];
  let slack = r.slack_sent_at !== null;
  let email = r.email_sent_at !== null;

  if (!slack) {
    try {
      await sendSlack(r);
      slack = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (!email) {
    try {
      await sendEmail(r);
      email = true;
    } catch (e) {
      errors.push(String(e));
    }
  }
  return { slack, email, error: errors.length ? errors.join("; ") : null };
}

Deno.serve(async (req) => {
  if (!FORWARD_SECRET || req.headers.get("x-forward-secret") !== FORWARD_SECRET) {
    return new Response("Unauthorised", { status: 401 });
  }

  const rows = await rpc<ContactRequest[]>("claim_contact_requests_to_forward", { p_limit: 20 });
  const results = [];
  for (const r of rows) {
    const out = await forward(r);
    await rpc("complete_contact_forward", {
      p_id: r.id,
      p_slack_sent: out.slack,
      p_email_sent: out.email,
      p_error: out.error,
    });
    results.push({ id: r.id, ...out });
  }

  return Response.json({ processed: results.length, results });
});
