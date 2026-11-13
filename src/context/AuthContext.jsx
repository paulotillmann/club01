/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react"
import { supabase, isSupabaseConfigured } from "../lib/supabase.js"

const AuthContext = createContext(null)

export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787"
export const IS_API_CONFIGURED = isSupabaseConfigured

const getInactivityTimeoutMs = () => {
  const saved = Number(localStorage.getItem("inactivityMinutes"))
  if (saved && !isNaN(saved) && saved > 0) {
    return saved * 60 * 1000
  }
  return 5 * 60 * 1000 // Padrão 5 minutos
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)

  // Função para buscar os dados de perfil da tabela public.users
  const fetchUserProfile = useCallback(async (authUser) => {
    if (!authUser) return null
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, auth_user_id, name, phone, email, role, created_at")
        .or(`auth_user_id.eq.${authUser.id},id.eq.${authUser.id}`)
        .maybeSingle()

      if (error) {
        console.error("Erro ao carregar perfil do usuário:", error.message)
      }

      if (data) {
        return {
          ...data,
          email: data.email || authUser.email,
          auth_user_id: authUser.id
        }
      }

      // Se ainda não existir registro em public.users, cria com fallback seguro
      const defaultProfile = {
        id: authUser.id,
        auth_user_id: authUser.id,
        name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Usuário",
        email: authUser.email,
        phone: authUser.user_metadata?.phone || null,
        role: "client"
      }

      await supabase.from("users").upsert(defaultProfile, { onConflict: "id" })
      return defaultProfile
    } catch (err) {
      console.error("Exceção ao buscar perfil:", err)
      return {
        id: authUser.id,
        auth_user_id: authUser.id,
        name: authUser.email,
        email: authUser.email,
        role: "client"
      }
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error("Erro ao efetuar signOut no Supabase:", err)
    } finally {
      localStorage.removeItem("last_activity")
      setToken(null)
      setUser(null)
    }
  }, [])

  // Inicialização e sincronização da sessão do Supabase Auth
  useEffect(() => {
    let mounted = true

    async function initializeAuth() {
      if (!isSupabaseConfigured) {
        setLoading(false)
        return
      }

      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) {
          console.error("Erro ao obter sessão:", error.message)
        }

        if (session?.user && mounted) {
          setToken(session.access_token)
          const profile = await fetchUserProfile(session.user, session.access_token)
          if (mounted) {
            setUser(profile)
            localStorage.setItem("last_activity", Date.now().toString())
          }
        } else if (mounted) {
          setUser(null)
          setToken(null)
        }
      } catch (err) {
        console.error("Erro ao inicializar autenticação:", err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    initializeAuth()

    // Listener reativo para alterações no estado de autenticação (Login, Logout, Token Refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        if (session?.user) {
          setToken(session.access_token)
          const profile = await fetchUserProfile(session.user, session.access_token)
          if (mounted) {
            setUser(profile)
            localStorage.setItem("last_activity", Date.now().toString())
          }
        }
      } else if (event === "SIGNED_OUT") {
        if (mounted) {
          setUser(null)
          setToken(null)
        }
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchUserProfile])

  // Controle de encerramento por inatividade (configurável pela administração)
  useEffect(() => {
    if (!user) return

    let timeoutId = null

    const handleInactivityLogout = () => {
      console.warn("Sessão expirada por inatividade.")
      logout()
    }

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId)
      localStorage.setItem("last_activity", Date.now().toString())
      const timeoutMs = getInactivityTimeoutMs()
      timeoutId = setTimeout(handleInactivityLogout, timeoutMs)
    }

    const checkLastActivity = () => {
      const lastActivity = Number(localStorage.getItem("last_activity"))
      const timeoutMs = getInactivityTimeoutMs()
      if (lastActivity && Date.now() - lastActivity >= timeoutMs) {
        handleInactivityLogout()
      } else {
        resetTimer()
      }
    }

    checkLastActivity()

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"]
    let lastEventTime = 0

    const onUserActivity = () => {
      const now = Date.now()
      if (now - lastEventTime > 1000) {
        lastEventTime = now
        resetTimer()
      }
    }

    events.forEach((eventName) => {
      window.addEventListener(eventName, onUserActivity, { passive: true })
    })

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkLastActivity()
      }
    }

    const onSettingsUpdated = () => {
      resetTimer()
    }

    const intervalId = setInterval(() => {
      const lastActivity = Number(localStorage.getItem("last_activity"))
      const timeoutMs = getInactivityTimeoutMs()
      if (lastActivity && Date.now() - lastActivity >= timeoutMs) {
        handleInactivityLogout()
      }
    }, 10000)

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", checkLastActivity)
    window.addEventListener("storage_inactivity_updated", onSettingsUpdated)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      clearInterval(intervalId)
      events.forEach((eventName) => {
        window.removeEventListener(eventName, onUserActivity)
      })
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", checkLastActivity)
      window.removeEventListener("storage_inactivity_updated", onSettingsUpdated)
    }
  }, [user, logout])

  // Login via Supabase Auth (suporta e-mail ou telefone)
  const login = async (loginKey, password) => {
    if (!isSupabaseConfigured) {
      throw new Error("Erro de configuração: VITE_SUPABASE_URL ou Chave não configuradas.")
    }

    let targetEmail = loginKey.trim()

    // Se o usuário digitou telefone em vez de e-mail, busca o e-mail via RPC seguro
    if (!targetEmail.includes("@")) {
      const cleanPhone = targetEmail.replace(/\D/g, "")
      const { data: foundEmail, error: rpcError } = await supabase.rpc("get_email_by_phone", {
        p_phone: cleanPhone
      })

      if (rpcError || !foundEmail) {
        throw new Error("Não encontramos nenhum cadastro associado a este telefone.")
      }
      targetEmail = foundEmail
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password: password
    })

    if (error) {
      throw new Error(error.message === "Invalid login credentials" ? "E-mail/telefone ou senha incorretos." : error.message)
    }

    const profile = await fetchUserProfile(data.user, data.session?.access_token)
    setUser(profile)
    setToken(data.session?.access_token)
    localStorage.setItem("last_activity", Date.now().toString())
    return profile
  }

  // Cadastro de novo usuário via Supabase Auth
  const register = async (name, phone, email, password, role = "client") => {
    if (!isSupabaseConfigured) {
      throw new Error("Erro de configuração: VITE_SUPABASE_URL ou Chave não configuradas.")
    }

    const targetEmail = email ? email.trim().toLowerCase() : `${phone.replace(/\D/g, "")}@club01.internal`

    const { data, error } = await supabase.auth.signUp({
      email: targetEmail,
      password: password,
      options: {
        data: {
          name: name.trim().toUpperCase(),
          phone: phone.replace(/\D/g, ""),
          role: role === "client" ? "client" : "client" // Força client no self-signup
        }
      }
    })

    if (error) {
      if (error.message.includes("already registered")) {
        throw new Error("Este e-mail ou telefone já está cadastrado.")
      }
      throw new Error(error.message)
    }

    return data.user
  }

  // Redefinição de senha
  const resetPassword = async (loginKey, newPassword) => {
    let targetEmail = loginKey.trim()
    if (!targetEmail.includes("@")) {
      const cleanPhone = targetEmail.replace(/\D/g, "")
      const { data: foundEmail } = await supabase.rpc("get_email_by_phone", {
        p_phone: cleanPhone
      })
      if (!foundEmail) {
        throw new Error("Telefone não encontrado no cadastro.")
      }
      targetEmail = foundEmail
    }

    // Se já autenticado, altera a senha do usuário logado
    if (user) {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw new Error(error.message)
      return { success: true, message: "Senha alterada com sucesso!" }
    }

    // Se não logado, envia email de recuperação oficial do Supabase
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${window.location.origin}/reset-password`
    })

    if (error) throw new Error(error.message)
    return { success: true, message: "Instruções de recuperação de senha enviadas por e-mail!" }
  }

  const updateUserSession = (newUser, newToken) => {
    if (newToken) setToken(newToken)
    if (newUser) setUser(prev => ({ ...prev, ...newUser }))
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isApiConfigured: isSupabaseConfigured,
        login,
        register,
        logout,
        resetPassword,
        updateUserSession
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de um AuthProvider")
  }
  return context
}
