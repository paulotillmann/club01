import React from "react"

export default function BackgroundGlow() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden select-none bg-background transition-colors duration-300">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-500/5 via-transparent to-transparent pointer-events-none" />
    </div>
  )
}
