import { useTheme } from "../context/ThemeContext.jsx"
import logoLight from "../assets/club01_white_bg.png"
import logoDark from "../assets/club01_black_bg.png"

export default function Logo({ className = "h-10 w-auto", showText = true, textClassName = "" }) {
  let isDark = true
  try {
    const themeContext = useTheme()
    isDark = themeContext ? themeContext.isDark : true
  } catch {
    isDark = typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : true
  }

  const logoImg = isDark ? logoDark : logoLight

  return (
    <div className="flex items-center gap-3 select-none">
      <img
        src={logoImg}
        alt="CLUB 01 Barber Studio"
        className={`object-contain ${className}`}
      />
      {showText && (
        <div className={`flex flex-col ${textClassName}`}>
          <span className="font-display text-xl md:text-2xl font-bold tracking-wider leading-none text-foreground">
            CLUB 01
          </span>
          <span className="text-[10px] uppercase font-semibold tracking-widest text-muted-foreground leading-tight">
            Barber Studio
          </span>
        </div>
      )}
    </div>
  )
}
