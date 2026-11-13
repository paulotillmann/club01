/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from "react"

const ThemeContext = createContext({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {}
})

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("club01_theme")
      return saved === "light" ? "light" : "dark"
    }
    return "dark"
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("dark", "light")
    root.classList.add(theme)
    root.setAttribute("data-theme", theme)
    localStorage.setItem("club01_theme", theme)
    window.dispatchEvent(new CustomEvent("club01_theme_changed", { detail: { theme } }))
  }, [theme])

  const toggleTheme = () => {
    setThemeState(prev => (prev === "dark" ? "light" : "dark"))
  }

  const setTheme = (newTheme) => {
    if (newTheme === "light" || newTheme === "dark") {
      setThemeState(newTheme)
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, isDark: theme === "dark" }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme deve ser usado dentro de um ThemeProvider")
  }
  return context
}
