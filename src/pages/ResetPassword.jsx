import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext.jsx"
import { Lock, User, AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react"
import Logo from "../components/Logo.jsx"

export default function ResetPassword() {
  const navigate = useNavigate()
  const { resetPassword } = useAuth()
  
  const [loginKey, setLoginKey] = useState("") // Aceita e-mail ou telefone
  const [newPassword, setNewPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setSuccessMsg("")
    setLoading(true)

    if (!loginKey.trim()) {
      setError("Por favor, insira seu telefone ou e-mail cadastrado.")
      setLoading(false)
      return
    }

    if (newPassword.length < 4) {
      setError("A senha deve ter pelo menos 4 caracteres.")
      setLoading(false)
      return
    }

    try {
      const res = await resetPassword(loginKey.trim(), newPassword)
      setSuccessMsg(res.message || "Solicitação de redefinição processada com sucesso!")
      setLoginKey("")
      setNewPassword("")
    } catch (err) {
      setError(err.message || "Não foi possível redefinir a senha.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center px-4 relative py-20">
      {/* Back Button */}
      <button 
        onClick={() => navigate("/login")}
        className="absolute top-20 left-4 md:left-10 inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border border-border bg-card/80 text-foreground hover:bg-muted transition-colors cursor-pointer text-xs font-semibold"
      >
        <ArrowLeft size={16} /> Voltar para o Login
      </button>

      <div className="w-full max-w-md z-10">
        {/* Header Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Logo size="lg" showText={false} className="" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold font-display tracking-tight uppercase text-foreground">
            Redefinir Senha
          </h1>
          <p className="text-muted-foreground text-sm mt-1 text-center font-medium">
            Insira suas credenciais cadastradas para criar uma nova senha
          </p>
        </div>

        {/* Card Form */}
        <div className="club-card p-6 sm:p-8">
          {error && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-4 mb-6">
              <AlertCircle size={20} className="shrink-0" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-xl p-5">
                <CheckCircle2 size={36} className="text-emerald-400 mb-1" />
                <span className="font-semibold text-base">{successMsg}</span>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  Sua conta foi atualizada. Agora você pode entrar com a sua nova senha.
                </p>
              </div>
              <button
                onClick={() => navigate("/login")}
                className="btn-primary w-full h-14 text-base"
              >
                Ir para o Login
              </button>
            </div>
          )}

          {!successMsg && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-foreground">E-mail ou Telefone</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5 pointer-events-none" />
                  <input
                    type="text"
                    required
                    value={loginKey}
                    onChange={(e) => setLoginKey(e.target.value)}
                    placeholder="E-mail ou telefone"
                    className="club-input w-full pl-12"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-foreground">Nova Senha</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5 pointer-events-none" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="club-input w-full pl-12 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                    title={showPassword ? "Ocultar senha" : "Exibir senha"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full h-14 text-base"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  "Confirmar Nova Senha"
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

