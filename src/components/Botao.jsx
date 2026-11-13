import React from "react"

export default function Botao({
  children,
  onClick,
  tipo = "primario",
  className = "",
  disabled = false,
  type = "button",
  ...props
}) {
  const estilos = {
    primario: "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] shadow-sm",
    secundario: "border border-border bg-card text-foreground hover:bg-secondary active:scale-[0.98]",
    destrutivo: "bg-destructive text-destructive-foreground hover:opacity-90 active:scale-[0.98]",
    outline: "border border-border bg-transparent text-foreground hover:bg-foreground/5 active:scale-[0.98]"
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] px-6 py-3 rounded-xl font-semibold text-sm md:text-base inline-flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none select-none ${estilos[tipo] || estilos.primario} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
