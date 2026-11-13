// Public Supabase settings. The HTML pages load this file.
//
// Set SUPABASE_ANON_KEY here:
//   - locally, paste the anon key from `supabase status`
//   - on Netlify, edit this file before deploy (there is no build step, so a
//     Netlify environment variable is not injected into the page)
// The committed value stays the placeholder. This key is visible to anyone
// who loads the site.
//
// Never put a service-role key, database password, Resend key, Slack webhook,
// or Gmail app password in this file. Those belong in Supabase Edge Function
// secrets (`supabase secrets set`), not in the frontend and not in Netlify.
// Do not point SUPABASE_URL at the hosted project from this checkout.

window.SUPABASE_PUBLIC_CONFIG = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
};
