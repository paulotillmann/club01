import { useTheme } from "../context/ThemeContext.jsx"
import logoLight from "../assets/club01_white_bg.png"
import logoDark from "../assets/club01_black_bg.png"

export default function Logo({ className = "h-10 w-auto" }) {
  let isDark = true
  try {
    const themeContext = useTheme()
    isDark = themeContext ? themeContext.isDark : true
  } catch {
    isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true
  }

  const logoImg = isDark ? logoDark : logoLight

  return (
    <div className="flex items-center select-none">
      <img
        src={logoImg}
        alt="CLUB 01 Barber Studio"
        className={`object-contain ${className}`}
      />
    </div>
  )
}
