import React from "react"

export default function Card({ titulo, children, className = "", headerAction = null }) {
  return (
    <div className={`bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm transition-all duration-200 ${className}`}>
      {titulo && (
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-border/60 pb-3">
          <h2 className="text-xl md:text-2xl font-bold font-display tracking-wide text-foreground">
            {titulo}
          </h2>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="text-muted-foreground leading-relaxed text-sm md:text-base">
        {children}
      </div>
    </div>
  )
}
