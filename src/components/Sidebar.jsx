import React, { useState, useEffect } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  CalendarRange,
  Users,
  Scissors,
  Package,
  User,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Wallet,
  FileText
} from "lucide-react"
import { useAuth } from "../context/AuthContext.jsx"
import { useTheme } from "../context/ThemeContext.jsx"
import ThemeToggle from "./ThemeToggle.jsx"
import logoLight from "../assets/club01_white_bg.png"
import logoDark from "../assets/club01_black_bg.png"

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { isDark } = useTheme()
  const logoImg = isDark ? logoDark : logoLight
  const location = useLocation()
  const navigate = useNavigate()

  // Inicia recolhido por padrão no desktop para otimizar espaço de tela
  const [isCollapsed, setIsCollapsed] = useState(true)

  useEffect(() => {
    if (isCollapsed) {
      document.body.setAttribute("data-sidebar-collapsed", "true")
    } else {
      document.body.removeAttribute("data-sidebar-collapsed")
    }
  }, [isCollapsed])

  if (!user || user.role === "client") return null

  const baseSidebarOptions = [
    { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: <LayoutDashboard size={20} /> },
    { id: "agenda-barbeiros", label: "Agenda Barbeiros", path: "/agenda-barbeiros", icon: <CalendarRange size={20} /> },
    { id: "caixa", label: "Fluxo de Caixa", path: "/caixa", icon: <Wallet size={20} /> },
    { id: "clientes", label: "Clientes", path: "/clientes", icon: <Users size={20} /> },
    { id: "servicos", label: "Serviços", path: "/servicos", icon: <Scissors size={20} /> },
    { id: "produtos", label: "Produtos", path: "/produtos", icon: <Package size={20} /> },
    { id: "equipe", label: "Profissionais", path: "/profissionais", icon: <User size={20} /> },
    { id: "relatorios", label: "Relatórios", path: "/relatorios", icon: <FileText size={20} /> }
  ]

  let sidebarOptions = baseSidebarOptions
  if (user.role === "admin") {
    sidebarOptions = [
      ...baseSidebarOptions,
      { id: "configuracoes", label: "Configurações", path: "/configuracoes", icon: <Settings size={20} /> }
    ]
  } else if (user.role === "barber") {
    sidebarOptions = [
      { id: "agenda-barbeiros", label: "Agenda Barbeiros", path: "/agenda-barbeiros", icon: <CalendarRange size={20} /> },
      { id: "meu-caixa", label: "Meu Caixa", path: "/meu-caixa", icon: <Wallet size={20} /> },
      { id: "clientes", label: "Clientes", path: "/clientes", icon: <Users size={20} /> }
    ]
  }

  const currentPath = location.pathname

  const mobileOptions = user?.role === "barber"
    ? [
        { id: "agenda-barbeiros", label: "Agenda", path: "/agenda-barbeiros", icon: <CalendarRange size={20} /> },
        { id: "meu-caixa", label: "Meu Caixa", path: "/meu-caixa", icon: <Wallet size={20} /> },
        { id: "clientes", label: "Clientes", path: "/clientes", icon: <Users size={20} /> },
        {
          id: "logout",
          label: "Sair",
          action: () => {
            logout()
            navigate("/login")
          },
          icon: <LogOut size={20} />
        }
      ]
    : [
        { id: "dashboard", label: "Painel", path: "/dashboard", icon: <LayoutDashboard size={20} /> },
        { id: "agenda-barbeiros", label: "Agenda", path: "/agenda-barbeiros", icon: <CalendarRange size={20} /> },
        { id: "caixa", label: "Caixa", path: "/caixa", icon: <Wallet size={20} /> },
        { id: "clientes", label: "Clientes", path: "/clientes", icon: <Users size={20} /> },
        {
          id: "logout",
          label: "Sair",
          action: () => {
            logout()
            navigate("/login")
          },
          icon: <LogOut size={20} />
        }
      ]

  return (
    <>
      {/* Sidebar Vertical para Telas Grandes (Desktop) */}
      <aside
        className={`hidden lg:flex fixed left-5 top-1/2 -translate-y-1/2 h-[calc(100vh-60px)] bg-card text-card-foreground border border-border shadow-2xl rounded-3xl flex-col justify-between py-5 z-50 transition-all duration-300 ${
          isCollapsed ? "w-[76px] px-2" : "w-[220px] px-4"
        }`}
      >
        <div className="space-y-4">
          {/* Cabeçalho do Sidebar com Logo CLUB 01 e Botão Toggle Abaixo da Logo */}
          <div className="flex flex-col items-center border-b border-border/70 pb-3 relative">
            <Link
              to={user.role === "barber" ? "/agenda-barbeiros" : "/dashboard"}
              className="transition-transform duration-200 hover:opacity-90 mt-1 flex flex-col items-center w-full"
              title="CLUB 01 Barber Studio"
            >
              <img
                src={logoImg}
                alt="CLUB 01 Barber Studio"
                className={`object-contain transition-all duration-300 ${
                  isCollapsed ? "w-[60px] h-auto py-1" : "w-[170px] h-auto max-h-[80px]"
                }`}
              />
            </Link>

            {/* Botão de expansão/recolhimento posicionado na borda direita, ABAIXO da logo sobre a linha divisória */}
            <button
              type="button"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="absolute -right-5 -bottom-3.5 w-7 h-7 rounded-full bg-card text-foreground border border-border hover:bg-secondary transition-all shadow-md flex items-center justify-center cursor-pointer z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={isCollapsed ? "Expandir menu" : "Recolher menu"}
              aria-label={isCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            >
              {isCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </div>

          {/* Opções de Navegação */}
          <nav className="space-y-1.5">
            {sidebarOptions.filter(opt => opt.id !== "configuracoes").map((opt) => {
              const isSelected = currentPath === opt.path
              return (
                <Link
                  key={opt.id}
                  to={opt.path}
                  title={opt.label}
                  className={`flex items-center rounded-xl transition-all duration-200 ${
                    isCollapsed
                      ? "w-11 h-11 justify-center mx-auto"
                      : "w-full px-3.5 py-2.5 gap-3 text-xs font-semibold uppercase tracking-wider"
                  } ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  <span className="shrink-0 flex items-center justify-center">{opt.icon}</span>
                  {!isCollapsed && <span className="truncate">{opt.label}</span>}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Rodapé do Sidebar */}
        <div className="border-t border-border/70 pt-3 flex flex-col gap-2">
          {/* Alternador de Tema */}
          <div className="flex justify-center pb-1">
            <ThemeToggle compact={isCollapsed} className="w-full justify-center" />
          </div>

          {/* Perfil do Usuário */}
          {!isCollapsed && (
            <Link
              to="/meu-perfil"
              title="Editar Perfil"
              className="text-center block p-1.5 rounded-lg hover:bg-secondary transition-colors"
            >
              <div className="text-xs font-semibold text-foreground truncate max-w-[180px] mx-auto">
                {user.name}
              </div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mt-0.5">
                {user.role === "admin"
                  ? "Administrador"
                  : user.role === "barber"
                  ? "Barbeiro"
                  : "Secretário(a)"}
              </div>
            </Link>
          )}

          {/* Ações Inferiores (Configurações e Logout) */}
          {user.role === "admin" && (
            <Link
              to="/configuracoes"
              title="Configurações do Sistema"
              className={`flex items-center rounded-xl transition-all duration-200 ${
                isCollapsed
                  ? "w-11 h-11 justify-center mx-auto"
                  : "w-full px-3.5 py-2 gap-2 text-xs font-semibold uppercase tracking-wider"
              } ${
                currentPath === "/configuracoes"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              <Settings size={18} />
              {!isCollapsed && <span>Configurações</span>}
            </Link>
          )}

          <button
            type="button"
            onClick={() => {
              logout()
              navigate("/login")
            }}
            title="Sair do Sistema"
            className={`flex items-center rounded-xl text-destructive hover:bg-destructive/10 transition-all duration-200 cursor-pointer ${
              isCollapsed
                ? "w-11 h-11 justify-center mx-auto"
                : "w-full px-3.5 py-2 gap-2 text-xs font-semibold uppercase tracking-wider"
            }`}
          >
            <LogOut size={18} />
            {!isCollapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>

      {/* Barra de Navegação Inferior para Mobile (Telas < 1024px) */}
      <aside className="lg:hidden fixed bottom-3 left-3 right-3 h-16 bg-card/95 backdrop-blur-xl border border-border shadow-2xl rounded-2xl flex items-center justify-around px-3 z-50">
        {mobileOptions.map((opt) => {
          const isSelected = opt.path && currentPath === opt.path
          if (opt.action) {
            return (
              <button
                key={opt.id}
                type="button"
                onClick={opt.action}
                className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer transition-colors"
                title={opt.label}
                aria-label={opt.label}
              >
                {opt.icon}
              </button>
            )
          }
          return (
            <Link
              key={opt.id}
              to={opt.path}
              className={`min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-all ${
                isSelected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
              title={opt.label}
              aria-label={opt.label}
            >
              {opt.icon}
            </Link>
          )
        })}
      </aside>
    </>
  )
}
