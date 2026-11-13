// Records sign_in_failed and sign_out. public.log_auth_event is granted only
// to the service role, so the browser calls this function and never sees that key.
// Successful sign-up and sign-in are written by database triggers, not here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const buckets = new Map<string, number[]>();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "Auth logging is not configured." });

  const providedKey = req.headers.get("apikey") || "";
  if (!providedKey || (ANON_KEY && providedKey !== ANON_KEY && providedKey !== SERVICE_KEY)) {
    return json(401, { error: "A publishable key is required." });
  }

  const ip = clientIp(req);
  if (tooMany(ip)) return json(429, { error: "Too many attempts. Wait a few minutes and try again." });

  const body = await req.json().catch(() => null);
  const event = (body as { event?: string } | null)?.event;
  let email = "";
  let userId: string | null = null;

  if (event === "sign_out") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || token === ANON_KEY || token === providedKey) {
      return json(401, { error: "Sign-in token is required to record sign-out." });
    }
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || providedKey, Authorization: `Bearer ${token}` },
    });
    if (!userResponse.ok) return json(401, { error: "Sign-in token is not valid." });
    const user = (await userResponse.json()) as { id?: string; email?: string };
    if (!user.id || !user.email) return json(401, { error: "Sign-in token is not valid." });
    email = user.email;
    userId = user.id;
  } else if (event === "sign_in_failed") {
    email = String((body as { email?: string } | null)?.email || "").trim().toLowerCase();
    if (!email.includes("@") || email.length > 320) {
      return json(400, { error: "A valid email is required." });
    }
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(email)}&select=id`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (lookup.ok) {
      const rows = (await lookup.json()) as { id: string }[];
      userId = rows[0]?.id ?? null;
    }
  } else {
    return json(400, { error: "Unsupported event." });
  }

  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_auth_event`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_event: event,
      p_email: email,
      p_user_id: userId,
      p_ip_address: ip,
      p_user_agent: req.headers.get("user-agent"),
    }),
  });
  if (!rpc.ok) {
    console.error("log_auth_event failed", rpc.status, await rpc.text());
    return json(502, { error: "Could not record the auth event." });
  }
  return json(200, { ok: true });
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function tooMany(ip: string): boolean {
  const now = Date.now();
  const recent = (buckets.get(ip) ?? []).filter((stamp) => now - stamp < 5 * 60 * 1000);
  if (recent.length >= 30) {
    buckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return false;
}

function clientIp(req: Request): string {
  const raw = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "")
    .split(",")[0]
    .trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw) || /^[0-9a-fA-F:]+$/.test(raw)) return raw;
  return "127.0.0.1";
}
