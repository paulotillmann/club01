import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ""
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ""

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "ERRO DE CONFIGURAÇÃO (CLUB 01): VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY devem estar configuradas no arquivo .env."
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    storageKey: "club01-auth-token"
  }
})

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)
