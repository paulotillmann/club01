import React from "react"
import { Link } from "react-router-dom"
import { ArrowLeft, Award, Users, ShieldCheck, Heart } from "lucide-react"
import Logo from "../components/Logo.jsx"
import Card from "../components/Card.jsx"

export default function Sobre() {
  return (
    <div className="bg-background min-h-screen text-foreground pt-24 pb-16 relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        {/* Back Link */}
        <div className="max-w-3xl mx-auto mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-border bg-card/80 text-foreground hover:bg-muted transition-colors text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o Início
          </Link>
        </div>

        {/* Content Container */}
        <div className="max-w-3xl mx-auto space-y-10">
          {/* Main Info */}
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <Logo size="lg" showText={false} className="" />
            </div>
            <h1 className="font-display text-4xl sm:text-6xl font-bold uppercase tracking-tight mb-4 text-foreground">
              Sobre o CLUB 01
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-xl mx-auto font-medium">
              O CLUB 01 Barber Studio nasceu para redefinir o conceito de barbearia contemporânea, unindo precisão técnica, atmosfera exclusiva e atendimento premium.
            </p>
          </div>

          {/* Cards Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <Card titulo="Nossa Missão">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <Award className="w-5 h-5 text-primary" />
                  <span className="font-display uppercase tracking-wide text-lg">Qualidade Impecável</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Oferecer mais que um corte de cabelo ou barba: uma pausa estratégica no seu dia com excelência, conforto e renovação de estilo.
                </p>
              </div>
            </Card>

            <Card titulo="Nossos Valores">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-foreground font-semibold">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <span className="font-display uppercase tracking-wide text-lg">Tradição & Inovação</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Respeitamos a arte clássica da navalha e da toalha quente, combinando as mais modernas técnicas e cosméticos masculinos do mercado.
                </p>
              </div>
            </Card>
          </div>

          {/* Text block */}
          <div className="club-card p-6 md:p-10 leading-relaxed text-muted-foreground space-y-4">
            <h3 className="font-display text-2xl font-bold text-foreground uppercase tracking-wide flex items-center gap-2 border-b border-border pb-3">
              <Users className="w-5 h-5 text-primary" /> Espaço Exclusivo
            </h3>
            <p className="text-sm sm:text-base leading-relaxed">
              O CLUB 01 Barber Studio foi planejado em cada detalhe para quem não abre mão de conforto, pontualidade e sofisticação. Desde a recepção até a cadeira de atendimento, tudo foi estruturado para proporcionar a você uma experiência única.
            </p>
            <p className="text-sm sm:text-base leading-relaxed">
              Aproveite um café expresso ou uma bebida gelada em um ambiente climatizado e moderno enquanto nossa equipe cuida da sua imagem com maestria.
            </p>
            <div className="pt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-t border-border mt-4">
              <Heart className="w-4 h-4 text-foreground fill-foreground" />
              <span>CLUB 01 Barber Studio • Excelência em cada detalhe</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

