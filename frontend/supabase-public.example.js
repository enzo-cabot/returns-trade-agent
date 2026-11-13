// Public Supabase settings for the browser. The pages load this file.
// Fill SUPABASE_ANON_KEY from `supabase status` for local dev.
// Only the project URL and the anon/publishable key belong here.
//
// Only the project URL and the anon/publishable key belong here.
// Never put the service-role key, a database password, or an AI API key in
// this file. Anything in frontend JavaScript is visible to anyone who loads
// the page.
//
// Leave the key as the placeholder to run the pages in their offline demo.
// Point SUPABASE_URL at local Supabase (supabase start). Do not point this
// file at the hosted project.

window.SUPABASE_PUBLIC_CONFIG = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
};
