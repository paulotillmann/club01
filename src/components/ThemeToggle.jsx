import React from "react"
import { Sun, Moon } from "lucide-react"
import { useTheme } from "../context/ThemeContext.jsx"

export default function ThemeToggle({ className = "", compact = false }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === "dark"

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Alternar para tema claro" : "Alternar para tema escuro"}
      title={isDark ? "Modo Claro" : "Modo Escuro"}
      className={`relative inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl border border-border bg-card text-foreground hover:bg-secondary transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <div className="relative flex items-center justify-center w-5 h-5">
        <Sun
          className={`w-5 h-5 transition-transform duration-300 absolute ${
            isDark
              ? "rotate-90 scale-0 opacity-0"
              : "rotate-0 scale-100 opacity-100 text-neutral-800"
          }`}
        />
        <Moon
          className={`w-5 h-5 transition-transform duration-300 absolute ${
            isDark
              ? "rotate-0 scale-100 opacity-100 text-white"
              : "-rotate-90 scale-0 opacity-0"
          }`}
        />
      </div>
      {!compact && (
        <span className="sr-only">
          {isDark ? "Ativar Modo Claro" : "Ativar Modo Escuro"}
        </span>
      )}
    </button>
  )
}
