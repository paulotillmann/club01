import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Scissors,
  Clock,
  ArrowRight,
  Calendar,
  Sparkles,
  Droplet,
  Flame
} from "lucide-react"
import Logo from "../components/Logo.jsx"
import { useAuth } from "../context/AuthContext.jsx"
import { servicesApi } from "../lib/api.js"

const DEFAULT_SERVICES = [
  {
    id: "srv-corte",
    name: "CORTE",
    description: "Corte clássico e contemporâneo com acabamento de alta precisão realizado por profissionais experientes.",
    duration_minutes: 30,
    price: 55.00
  },
  {
    id: "srv-barba",
    name: "BARBA",
    description: "Alinhamento e corte de barba com vaporizador de ozônio, hidratação profunda e toalha quente para máximo conforto.",
    duration_minutes: 30,
    price: 55.00
  },
  {
    id: "srv-barboterapia",
    name: "BARBOTERAPIA",
    description: "Experiência completa de relaxamento e cuidados com a pele: vaporizador, óleos essenciais, esfoliação e toalha quente.",
    duration_minutes: 30,
    price: 70.00
  },
  {
    id: "srv-hidratacao",
    name: "HIDRATAÇÃO",
    description: "Tratamento capilar intensivo que restaura o brilho, maciez e força dos fios masculinos.",
    duration_minutes: 30,
    price: 35.00
  },
  {
    id: "srv-sobrancelha",
    name: "SOBRANCELHA",
    description: "Design e alinhamento preciso das sobrancelhas masculinas, valorizando o olhar de forma natural.",
    duration_minutes: 30,
    price: 35.00
  },
  {
    id: "srv-combo",
    name: "CORTE E BARBA",
    description: "O combo completo de cuidados masculinos: corte de precisão e barba com vaporizador e toalha quente.",
    duration_minutes: 60,
    price: 110.00
  }
]

export default function Home() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [servicesList, setServicesList] = useState(DEFAULT_SERVICES)

  useEffect(() => {
    if (!loading && user) {
      if (user.role === "barber") {
        navigate("/agenda-barbeiros", { replace: true })
      } else {
        navigate("/dashboard", { replace: true })
      }
    }
  }, [user, loading, navigate])

  useEffect(() => {
    async function loadServices() {
      try {
        const data = await servicesApi.getPublic()
        if (Array.isArray(data) && data.length > 0) {
          setServicesList(data)
        }
      } catch (err) {
        console.error("Erro ao carregar serviços da API na Home:", err)
      }
    }
    loadServices()
  }, [])

  if (user) {
    return null
  }

  const handleBookingClick = () => {
    navigate("/agendar")
  }

  const getServiceIcon = (name = "", id = "") => {
    const text = (String(name) + " " + String(id)).toLowerCase()
    if (text.includes("barboterapia")) return <Sparkles className="w-6 h-6" />
    if (text.includes("barba")) return <Flame className="w-6 h-6" />
    if (text.includes("hidrata") || text.includes("trata")) return <Droplet className="w-6 h-6" />
    if (text.includes("sobrancelha")) return <Sparkles className="w-6 h-6" />
    return <Scissors className="w-6 h-6" />
  }

  const team = [
    {
      name: "MÁRCIO",
      role: "Barbeiro Especialista",
      photo: "/assets/marcio-barber.jpeg"
    },
    {
      name: "LUCAS",
      role: "Barbeiro Especialista",
      photo: "/assets/lucas-barber.jpeg"
    },
    {
      name: "PAULO NETO",
      role: "Barbeiro Especialista",
      photo: "/assets/neto-barber.jpeg"
    }
  ]

  const handleScroll = (id) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: "smooth" })
    }
  }

  return (
    <div className="relative bg-background min-h-screen text-foreground overflow-x-hidden pt-16">
      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden py-16 md:py-24">
        {/* Subtle monochrome radial background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-800/15 via-transparent to-transparent pointer-events-none"></div>

        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
            {/* Logo Oficial CLUB 01 */}
            <div className="mb-8 flex justify-center">
              <Logo size="lg" showText={false} className="" />
            </div>

            {/* Badge de Destaque */}
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-6">
              <span className="w-2 h-2 rounded-full bg-foreground"></span>
              Studio Masculino de Alto Padrão
            </div>

            {/* Heading Oficial */}
            <h1 className="font-display text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight uppercase leading-[1.05] mb-6 text-foreground">
              Estilo, Precisão & <br />
              <span className="text-muted-foreground">Exclusividade</span>
            </h1>

            {/* Subtitle */}
            <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed font-medium">
              O espaço definitivo para o homem contemporâneo. Cortes clássicos e modernos, barboterapia e atendimento personalizado com excelência.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-md sm:max-w-none mb-16">
              <button
                onClick={handleBookingClick}
                className="btn-primary w-full sm:w-auto h-14 px-8 text-base shadow-lg"
              >
                <Calendar className="w-5 h-5 mr-1" />
                Agendar Horário Online
              </button>
              <button
                onClick={() => handleScroll("services")}
                className="btn-secondary w-full sm:w-auto h-14 px-8 text-base"
              >
                Conhecer Serviços
                <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-6 sm:gap-12 w-full max-w-2xl border-t border-border pt-10">
              <div className="text-center">
                <div className="font-display text-3xl sm:text-5xl font-bold text-foreground mb-1">10+</div>
                <div className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-widest font-semibold">Anos de Tradição</div>
              </div>
              <div className="text-center">
                <div className="font-display text-3xl sm:text-5xl font-bold text-foreground mb-1">1000+</div>
                <div className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-widest font-semibold">Clientes Atendidos</div>
              </div>
              <div className="text-center">
                <div className="font-display text-3xl sm:text-5xl font-bold text-foreground mb-1">3</div>
                <div className="text-[11px] sm:text-xs text-muted-foreground uppercase tracking-widest font-semibold">Especialistas</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20 md:py-32 bg-secondary/40 border-y border-border">
        <div className="container mx-auto px-4">
          {/* Header */}
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1 text-xs font-semibold text-foreground uppercase tracking-widest bg-card mb-4">
              Procedimentos
            </div>
            <h2 className="font-display text-3xl sm:text-5xl md:text-6xl font-bold uppercase tracking-tight mb-4 text-foreground">
              Nossos Serviços
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base font-medium max-w-xl mx-auto">
              Cada detalhe é planejado para elevar seu visual com técnica apurada e produtos de primeira linha.
            </p>
          </div>

          {/* Services Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {servicesList.map((svc, i) => {
              const title = (svc.name || svc.title || "SERVIÇO").toUpperCase()
              const desc = svc.description || svc.desc || "Procedimento exclusivo CLUB 01 de alto padrão."
              const durationText = svc.duration_minutes !== undefined 
                ? (svc.duration_minutes === 0 ? "Sob consulta" : `${svc.duration_minutes} min`) 
                : (svc.time || "30 min")
              
              const priceFormatted = typeof svc.price === "number"
                ? `R$ ${svc.price.toFixed(2).replace('.', ',')}`
                : (svc.price ? String(svc.price) : "R$ 0,00")

              const icon = getServiceIcon(svc.name || svc.title, svc.id)
              const isComboPromo = svc.id === "srv-combo"

              return (
                <div
                  key={svc.id || i}
                  className="club-card p-6 sm:p-8 flex flex-col justify-between hover:border-foreground/40 transition-all duration-300"
                >
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-4 mb-6">
                      <div className="w-12 h-12 rounded-xl bg-secondary border border-border flex items-center justify-center text-foreground shrink-0">
                        {icon}
                      </div>
                      {isComboPromo && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-foreground text-background text-[10px] font-bold tracking-widest uppercase">
                          <Sparkles className="w-3 h-3" />
                          Mais Pedido
                        </span>
                      )}
                    </div>

                    <h3 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wide text-foreground mb-3">
                      {title}
                    </h3>
                    <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-relaxed mb-6 flex-1">
                      {desc}
                    </p>

                    <div className="flex items-center justify-between border-t border-border pt-4 mt-auto">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <Clock className="w-4 h-4 text-foreground" />
                        {durationText}
                      </div>
                      <div className="font-display text-xl sm:text-2xl font-bold text-foreground">
                        {priceFormatted}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-center mt-12 sm:mt-16">
            <button 
              onClick={handleBookingClick}
              className="btn-primary h-14 px-10 text-base"
            >
              Agendar Atendimento Online
            </button>
          </div>
        </div>
      </section>

      {/* Barbers / Team Section */}
      <section id="team" className="py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-1 text-xs font-semibold text-foreground uppercase tracking-widest bg-card mb-4">
              Profissionais
            </div>
            <h2 className="font-display text-3xl sm:text-5xl md:text-6xl font-bold uppercase tracking-tight mb-4 text-foreground">
              Nossa Equipe
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base font-medium max-w-xl mx-auto">
              Especialistas em cortes clássicos, fade, barba e estética masculina moderna.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-8 max-w-5xl mx-auto">
            {team.map((barber, i) => (
              <div
                key={i}
                className="w-full sm:w-[260px] club-card overflow-hidden text-center group"
              >
                <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                  <img
                    src={barber.photo}
                    alt={barber.name}
                    className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-4 bg-card">
                  <h3 className="font-display text-xl font-bold uppercase tracking-wide text-foreground">
                    {barber.name}
                  </h3>
                  <p className="text-xs text-muted-foreground font-medium mt-0.5">
                    {barber.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24 bg-secondary/30 border-t border-border">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <h2 className="font-display text-3xl sm:text-5xl font-bold uppercase tracking-tight mb-4 text-foreground">
            Pronto para transformar seu visual?
          </h2>
          <p className="text-muted-foreground text-sm sm:text-base font-medium mb-8 max-w-xl mx-auto">
            Reserve seu horário em menos de 1 minuto pelo celular ou computador.
          </p>
          <button
            onClick={handleBookingClick}
            className="btn-primary h-14 px-10 text-base"
          >
            <Calendar className="w-5 h-5 mr-1" />
            Agendar Agora
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-12 md:py-16">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 border-b border-border pb-8 mb-8">
            <div className="flex items-center gap-3">
              <Logo size="md" showText={true} />
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground font-semibold">
              <button onClick={() => handleScroll("services")} className="hover:text-foreground transition-colors cursor-pointer">
                Serviços
              </button>
              <button onClick={() => handleScroll("team")} className="hover:text-foreground transition-colors cursor-pointer">
                Equipe
              </button>
              <button onClick={handleBookingClick} className="hover:text-foreground transition-colors cursor-pointer">
                Agendar
              </button>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground font-medium">
            <p>© {new Date().getFullYear()} CLUB 01 Barber Studio. Todos os direitos reservados.</p>
            <p>Atendimento: Seg - Sex: 09:00 às 20:00 • Sáb: 08:00 às 19:00</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

