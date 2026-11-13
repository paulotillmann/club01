import React, { useState } from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Send, Sparkles, CheckCircle2 } from "lucide-react"
import Logo from "../components/Logo.jsx"

export default function TrabalheConosco() {
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState({
    nome: "",
    email: "",
    telefone: "",
    cargo: "Barbeiro",
    experiencia: "",
    portfolio: ""
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="bg-background min-h-screen text-foreground pt-24 pb-16 flex items-center justify-center relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        {/* Back Link */}
        <div className="max-w-2xl mx-auto mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-border bg-card/80 text-foreground hover:bg-muted transition-colors text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o Início
          </Link>
        </div>

        {/* Card */}
        <div className="max-w-2xl mx-auto club-card p-6 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <Logo size="md" showText={false} className="" />
            </div>
            <h1 className="font-display text-3xl md:text-5xl font-bold uppercase tracking-tight mb-2 text-foreground">
              Faça Parte do CLUB 01
            </h1>
            <p className="text-muted-foreground text-sm font-medium leading-relaxed max-w-md mx-auto">
              Buscamos talentos apaixonados pela arte da barbearia que desejam crescer conosco com excelência e comprometimento.
            </p>
          </div>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Nome */}
                <div className="space-y-2">
                  <label htmlFor="nome" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    id="nome"
                    name="nome"
                    required
                    value={formData.nome}
                    onChange={handleChange}
                    placeholder="Seu nome"
                    className="club-input w-full"
                  />
                </div>

                {/* E-mail */}
                <div className="space-y-2">
                  <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    E-mail
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="seu.email@exemplo.com"
                    className="club-input w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Telefone */}
                <div className="space-y-2">
                  <label htmlFor="telefone" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Telefone / WhatsApp
                  </label>
                  <input
                    type="tel"
                    id="telefone"
                    name="telefone"
                    required
                    value={formData.telefone}
                    onChange={handleChange}
                    placeholder="(34) 99999-9999"
                    className="club-input w-full"
                  />
                </div>

                {/* Cargo */}
                <div className="space-y-2">
                  <label htmlFor="cargo" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                    Vaga Pretendida
                  </label>
                  <select
                    id="cargo"
                    name="cargo"
                    value={formData.cargo}
                    onChange={handleChange}
                    className="club-input w-full cursor-pointer"
                  >
                    <option value="Barbeiro">Barbeiro Especialista</option>
                    <option value="Recepcionista">Recepcionista / Atendimento</option>
                    <option value="Gerente">Gestão / Coordenação</option>
                  </select>
                </div>
              </div>

              {/* Redes Sociais / Portfólio */}
              <div className="space-y-2">
                <label htmlFor="portfolio" className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Link do Portfólio ou Instagram Profissional
                </label>
                <input
                  type="url"
                  id="portfolio"
                  name="portfolio"
                  value={formData.portfolio}
                  onChange={handleChange}
                  placeholder="https://instagram.com/seu.perfil"
                  className="club-input w-full"
                />
              </div>


              {/* Mensagem / Experiência */}
              <div className="space-y-2">
                <label htmlFor="experiencia" className="text-sm font-semibold text-muted-foreground">
                  Fale sobre sua experiência profissional
                </label>
                <textarea
                  id="experiencia"
                  name="experiencia"
                  required
                  rows={4}
                  value={formData.experiencia}
                  onChange={handleChange}
                  placeholder="Conte um pouco sobre suas habilidades e histórico de trabalho..."
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 resize-none"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn-primary w-full h-14 text-base"
              >
                <Send className="w-5 h-5 mr-1" />
                Enviar Candidatura
              </button>
            </form>
          ) : (
            /* Success State */
            <div className="text-center py-8 space-y-6 animate-scale-up">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-2xl font-bold uppercase">Candidatura Recebida!</h3>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
                  Obrigado pelo seu interesse, <strong>{formData.nome}</strong>! Nossa equipe analisará seu perfil profissional e entrará em contato em breve.
                </p>
              </div>
              <div className="pt-4">
                <Link
                  to="/"
                  className="btn-secondary inline-flex items-center justify-center gap-2 h-12 px-8 text-sm"
                >
                  Voltar para o Início
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
