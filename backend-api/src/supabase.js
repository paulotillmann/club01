import { createClient } from "@supabase/supabase-js"

const DEFAULT_SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co"
const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4"

export function getSupabase(c) {
  const url = c?.env?.SUPABASE_URL || DEFAULT_SUPABASE_URL
  const key = c?.env?.SUPABASE_SERVICE_ROLE_KEY || c?.env?.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY

  const authHeader = c?.req?.header("Authorization")
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }

  // If request contains a Bearer token, attach it so Supabase RLS receives the authenticated context
  if (authHeader && authHeader.startsWith("Bearer ")) {
    options.global = {
      headers: {
        Authorization: authHeader
      }
    }
  }

  return createClient(url, key, options)
}
