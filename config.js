// Open Items settings.
// Fill in the two values from Supabase > Project Settings > API (or "Connect" at the top of the project).
// Leave them blank to run in demo mode with sample data saved only in this browser.
//
// The anon key is meant to be public. It can't read or change anything without a login,
// as long as you ran schema.sql and turned off public sign-ups (see README).

window.OPEN_ITEMS_CONFIG = {
  supabaseUrl: 'https://xsvaucqabeuobgwewegz.supabase.co',
  supabaseAnonKey: 'sb_publishable_8kQ_ma8W2cmODnl2-K-8yQ_eCgJAlMk',
  companyName: 'Grunloh Building',
  adminContact: 'Brock'   // shown on the sign-in page: "Forgot your password? Ask Brock to reset it."
};
