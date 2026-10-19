
"use strict";

/* ==========================================
   TRAVELVAULT SUPABASE CONNECTION
========================================== */

const SUPABASE_URL =
  "https://swrhzkbrnszecywaoqrz.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_FIBjqvQUxTdQ6eo28b7Naw_Ms1KOJJo";

// Create the Supabase client
window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

console.log("TravelVault: Supabase client initialized.");
