import React, { useState } from "react"
import { Link, useNavigate, useLocation } from "react-router-dom"
import { Menu, X, LayoutDashboard, LogOut, Calendar } from "lucide-react"
import Logo from "./Logo.jsx"
import ThemeToggle from "./ThemeToggle.jsx"
import { useAuth } from "../context/AuthContext.jsx"

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()

  const handleNavClick = (anchor) => {
    setIsOpen(false)
    if (location.pathname !== "/") {
      navigate("/" + anchor)
    } else {
      const element = document.querySelector(anchor)
      if (element) {
        element.scrollIntoView({ behavior: "smooth" })
      }
    }
  }

  const handleLogoClick = (e) => {
    setIsOpen(false)
    if (location.pathname === "/") {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  // Se o usuário está logado e é admin/secretário/barber na área restrita, a Sidebar cuida da navegação
  if (user && user.role !== "client") return null

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-md border-b border-border transition-colors duration-200">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-20">
          {/* Logo Oficial CLUB 01 */}
          <Link
            to="/"
            onClick={handleLogoClick}
            className="flex items-center gap-3 transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg p-1"
          >
            <Logo className="h-11 w-auto" showText={true} />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <button
              type="button"
              onClick={() => handleNavClick("#services")}
              className="text-muted-foreground hover:text-foreground text-sm font-semibold transition-colors duration-200 cursor-pointer tracking-wide py-2"
            >
              Serviços
            </button>

            <button
              type="button"
              onClick={() => handleNavClick("#team")}
              className="text-muted-foreground hover:text-foreground text-sm font-semibold transition-colors duration-200 cursor-pointer tracking-wide py-2"
            >
              Equipe
            </button>

            <button
              type="button"
              onClick={() => handleNavClick("#about")}
              className="text-muted-foreground hover:text-foreground text-sm font-semibold transition-colors duration-200 cursor-pointer tracking-wide py-2"
            >
              Sobre
            </button>

            <Link
              to="/agendar"
              className="btn-primary text-sm px-5 py-2.5 shadow-sm inline-flex items-center gap-2"
            >
              <Calendar size={16} /> Agendar
            </Link>
          </nav>

          {/* Desktop Actions & Theme Toggle */}
          <div className="hidden md:flex items-center gap-3">
            <ThemeToggle />

            {user ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className="btn-secondary text-sm px-4 py-2.5 inline-flex items-center gap-2"
                >
                  <LayoutDashboard size={16} /> Painel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    navigate("/")
                  }}
                  className="btn-secondary text-sm px-4 py-2.5 inline-flex items-center gap-2 text-destructive hover:bg-destructive/10"
                >
                  <LogOut size={16} /> Sair
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="btn-secondary text-sm px-5 py-2.5 font-semibold"
              >
                Entrar
              </button>
            )}
          </div>

          {/* Mobile Right Controls */}
          <div className="flex items-center gap-2 md:hidden">
            <ThemeToggle compact={true} />

            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-foreground hover:bg-secondary transition-colors duration-200 cursor-pointer rounded-xl border border-border"
              aria-label={isOpen ? "Fechar Menu" : "Abrir Menu"}
              aria-expanded={isOpen}
            >
              {isOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Dropdown */}
      {isOpen && (
        <div className="md:hidden border-b border-border bg-background/98 backdrop-blur-xl animate-fade-in py-6 px-6 flex flex-col gap-4 shadow-xl">
          <button
            type="button"
            onClick={() => handleNavClick("#services")}
            className="text-left text-foreground hover:text-foreground/80 text-base font-semibold py-3 border-b border-border/50 transition-colors"
          >
            Serviços
          </button>

          <button
            type="button"
            onClick={() => handleNavClick("#team")}
            className="text-left text-foreground hover:text-foreground/80 text-base font-semibold py-3 border-b border-border/50 transition-colors"
          >
            Equipe
          </button>

          <button
            type="button"
            onClick={() => handleNavClick("#about")}
            className="text-left text-foreground hover:text-foreground/80 text-base font-semibold py-3 border-b border-border/50 transition-colors"
          >
            Sobre o Studio
          </button>

          <Link
            to="/agendar"
            onClick={() => setIsOpen(false)}
            className="btn-primary text-base py-3 justify-center w-full"
          >
            <Calendar size={18} /> Agendar Horário Online
          </Link>

          <div className="flex flex-col gap-3 pt-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    navigate("/dashboard")
                  }}
                  className="btn-secondary text-base py-3 justify-center w-full"
                >
                  <LayoutDashboard size={18} /> Acessar Painel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    logout()
                    navigate("/")
                  }}
                  className="btn-secondary text-base py-3 justify-center w-full text-destructive border-destructive/40"
                >
                  <LogOut size={18} /> Sair da Conta
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  navigate("/login")
                }}
                className="btn-secondary text-base py-3 justify-center w-full"
              >
                Entrar no Sistema
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
