import React, { useState } from "react"
import { createPortal } from "react-dom"
import { MoreVertical, Scissors, ShoppingBag, X, Maximize2 } from "lucide-react"
import { useTheme } from "../context/ThemeContext.jsx"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList
} from "recharts"

const formatCurrency = (val) => {
  return (Number(val) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  })
}

// Tooltip customizado para o gráfico de faturamento empilhado por barbeiro por dia
const FinancialTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const dayData = payload[0]?.payload
    const detailsMap = dayData?.details || {}
    const total = dayData?.total || 0

    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/80 rounded-xl p-3.5 shadow-2xl text-xs space-y-2.5 min-w-[240px] z-50">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <span className="font-bold text-foreground font-mono text-sm">{label}</span>
          <span className="font-extrabold text-primary font-mono text-sm">{formatCurrency(total)}</span>
        </div>
        {payload.map((entry, idx) => {
          if (!entry.value || entry.dataKey === "total" || entry.dataKey === "details") return null
          const bName = entry.dataKey
          const det = detailsMap[bName] || {
            faturamento: entry.value,
            atendimentoValor: entry.value,
            atendimentoQtd: 0,
            produtosValor: 0,
            produtosQtd: 0
          }

          return (
            <div key={idx} className="border-t border-border/30 pt-2 space-y-1">
              <div className="flex items-center justify-between font-bold gap-2" style={{ color: entry.color }}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></span>
                  <span className="truncate">{bName}</span>
                </span>
                <span className="font-mono shrink-0 ml-2">{formatCurrency(det.faturamento)}</span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-3">
                <span>Atendimento:</span>
                <span className="font-semibold font-mono text-foreground">
                  {formatCurrency(det.atendimentoValor)} ({det.atendimentoQtd} {det.atendimentoQtd === 1 ? 'serviço' : 'serviços'})
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-3">
                <span>Produtos:</span>
                <span className="font-semibold font-mono text-foreground">
                  {formatCurrency(det.produtosValor)} ({det.produtosQtd} {det.produtosQtd === 1 ? 'item' : 'itens'})
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return null
}

// Tooltip customizado para o gráfico de barbeiros
const BarberTooltip = ({ active, payload, label }) => {
  const { isDark } = useTheme()

  if (active && payload && payload.length) {
    const data = payload[0]?.payload || {}
    const servicesDotColor = isDark ? "#FFFFFF" : "#18181B"
    const productsDotColor = isDark ? "#9CA3AF" : "#52525B"

    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/80 rounded-xl p-3.5 shadow-2xl text-xs space-y-2.5 min-w-[260px] z-50">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <p className="font-bold text-foreground font-mono text-sm">{label}</p>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Desempenho</span>
        </div>

        <div className="flex items-center justify-between font-bold text-foreground bg-primary/10 p-2 rounded-lg border border-primary/20">
          <span className="text-xs">Faturamento Bruto:</span>
          <span className="text-primary font-mono font-black text-sm">{formatCurrency(data.faturamento)}</span>
        </div>

        <div className="space-y-2 pt-0.5">
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span
                  className="w-2 h-2 rounded-full shrink-0 border border-border/40"
                  style={{ backgroundColor: servicesDotColor }}
                />
                Serviços ({data.serviceCommissionPct || 0}% comissão):
              </span>
              <span className="font-bold text-foreground font-mono">
                {formatCurrency(data.atendimentoValor || 0)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground pl-3.5 flex justify-between">
              <span>{data.atendimentoQtd || 0} {data.atendimentoQtd === 1 ? 'atendimento' : 'atendimentos'}</span>
              <span>Comissão: <strong className="text-foreground font-mono">{formatCurrency(data.comissaoServicos || 0)}</strong></span>
            </div>
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-muted-foreground text-[11px]">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span
                  className="w-2 h-2 rounded-full shrink-0 border border-border/40"
                  style={{ backgroundColor: productsDotColor }}
                />
                Produtos ({data.productCommissionPct || 0}% comissão):
              </span>
              <span className="font-bold text-foreground font-mono">
                {formatCurrency(data.produtosValor || 0)}
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground pl-3.5 flex justify-between">
              <span>{data.produtosQtd || 0} {data.produtosQtd === 1 ? 'item' : 'itens'}</span>
              <span>Comissão: <strong className="text-foreground font-mono">{formatCurrency(data.comissaoProdutos || 0)}</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between font-bold border-t border-border/40 pt-2 text-emerald-600 dark:text-emerald-400">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
            Comissão Total a Receber:
          </span>
          <span className="font-mono font-black text-sm">{formatCurrency(data.comissaoTotal || 0)}</span>
        </div>
      </div>
    )
  }
  return null
}

// Tooltip customizado para os gráficos Donut
const PieTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0]
    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/80 rounded-xl p-3 shadow-xl text-xs space-y-1 z-50">
        <p className="font-bold text-foreground flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color || data.payload.color }}></span>
          {data.name}
        </p>
        <p className="text-muted-foreground font-mono">
          <span className="font-bold text-foreground">{data.value}</span> ({data.payload.percent ? `${(data.payload.percent * 100).toFixed(0)}%` : ""})
        </p>
      </div>
    )
  }
  return null
}

export function FinancialTrendChart({ data = [], viewMode = "simplificado" }) {
  const { isDark } = useTheme()

  if (!data || data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10">
        Nenhum dado financeiro no período selecionado
      </div>
    )
  }

  // Extrair chaves dos barbeiros (excluindo 'date', 'total' e 'details')
  const barberKeys = Object.keys(data[0] || {}).filter(
    (k) => k !== "date" && k !== "total" && k !== "details"
  )

  const BARBER_PALETTE = isDark
    ? ["#FFFFFF", "#D1D5DB", "#9CA3AF", "#6B7280", "#4B5563", "#374151"]
    : ["#18181B", "#3F3F46", "#52525B", "#71717A", "#A1A1AA", "#D4D4D8"]
  const primaryBarColor = isDark ? "#FFFFFF" : "#18181B"
  const labelTextColor = isDark ? "#FFFFFF" : "#18181B"
  const gridStrokeColor = isDark ? "#27272a" : "#e4e4e7"
  const isSimplificado = viewMode === "simplificado"

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap="-100%" margin={{ top: 35, right: 10, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val}`} />
          <Tooltip content={<FinancialTooltip />} />

          {!isSimplificado && (
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }}
              formatter={(value) => {
                if (value === "total" || value === "Faturamento Total") return null
                return <span className="text-muted-foreground capitalize font-medium">{value}</span>
              }}
            />
          )}

          {isSimplificado ? (
            <Bar dataKey="total" name="Faturamento do Dia" fill={primaryBarColor} radius={[8, 8, 0, 0]}>
              <LabelList
                dataKey="total"
                position="top"
                formatter={(val) =>
                  Number(val) > 0
                    ? `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    : ""
                }
                style={{ fill: labelTextColor, fontSize: "18pt", fontWeight: "900", fontFamily: "monospace" }}
              />
            </Bar>
          ) : (
            <>
              {barberKeys.map((barberName, idx) => (
                <Bar
                  key={barberName}
                  dataKey={barberName}
                  name={barberName}
                  stackId="faturamento"
                  fill={BARBER_PALETTE[idx % BARBER_PALETTE.length]}
                  radius={idx === barberKeys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
              {/* Barra transparente de sobreposição para exibir com 100% de garantia o valor total no topo de TODOS os dias */}
              <Bar dataKey="total" name="Faturamento Total" fill="transparent" stroke="none" legendType="none">
                <LabelList
                  dataKey="total"
                  position="top"
                  formatter={(val) =>
                    Number(val) > 0
                      ? `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                      : ""
                  }
                  style={{ fill: labelTextColor, fontSize: "18pt", fontWeight: "900", fontFamily: "monospace" }}
                />
              </Bar>
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Tooltip customizado para o gráfico de Ticket Médio Diário (Serviços x Produtos)
const DailyTicketTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const dayData = payload[0]?.payload || {}
    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/80 rounded-xl p-3.5 shadow-2xl text-xs space-y-2.5 min-w-[240px] z-50">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <span className="font-bold text-foreground font-mono text-sm">{label}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ticket Médio</span>
        </div>
        {payload.map((entry, idx) => {
          if (entry.value === undefined || entry.value === null) return null
          const isServicos = entry.dataKey === "ticketServicos"
          const count = isServicos ? dayData.atendimentoQtd : dayData.produtosVendasQtd
          const unitLabel = isServicos ? (count === 1 ? 'atendimento' : 'atendimentos') : (count === 1 ? 'venda' : 'vendas')
          const totalVal = isServicos ? dayData.atendimentoValor : dayData.produtosValor

          return (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between font-bold gap-2" style={{ color: entry.color }}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></span>
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="font-mono text-sm shrink-0 font-black">{formatCurrency(entry.value)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-4">
                <span>Total acumulado:</span>
                <span className="font-semibold font-mono text-foreground">{formatCurrency(totalVal)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pl-4">
                <span>Volume de registros:</span>
                <span className="font-semibold font-mono text-foreground">{count || 0} {unitLabel}</span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return null
}

export function DailyTicketTrendChart({ data = [] }) {
  const { isDark } = useTheme()

  if (!data || data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10">
        Nenhum registro de ticket médio no período selecionado
      </div>
    )
  }

  const servicosLineColor = isDark ? "#FFFFFF" : "#18181B"
  const servicosDotStroke = isDark ? "#18181b" : "#FFFFFF"
  const gridStrokeColor = isDark ? "#27272a" : "#e4e4e7"

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 35, right: 15, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" fontSize="10pt" tickLine={false} axisLine={false} />
          <YAxis stroke="#71717a" fontSize="10pt" tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val}`} />
          <Tooltip content={<DailyTicketTooltip />} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: "12pt", paddingTop: "12px" }}
            formatter={(value) => <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[12pt]">{value}</span>}
          />
          <Line
            type="monotone"
            dataKey="ticketServicos"
            name="Ticket Serviços"
            stroke={servicosLineColor}
            strokeWidth={3}
            dot={{ r: 4, fill: servicosLineColor, stroke: servicosDotStroke, strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: servicosLineColor, strokeWidth: 2 }}
          >
            <LabelList
              dataKey="ticketServicos"
              position="top"
              formatter={(val) => Number(val) > 0 ? `R$${Math.round(val)}` : ""}
              style={{ fill: servicosLineColor, fontSize: "9pt", fontWeight: "800", fontFamily: "monospace" }}
            />
          </Line>
          <Line
            type="monotone"
            dataKey="ticketProdutos"
            name="Ticket Produtos"
            stroke="#9CA3AF"
            strokeWidth={3}
            dot={{ r: 4, fill: "#9CA3AF", stroke: servicosDotStroke, strokeWidth: 2 }}
            activeDot={{ r: 6, stroke: "#FFFFFF", strokeWidth: 2 }}
          >
            <LabelList
              dataKey="ticketProdutos"
              position="top"
              formatter={(val) => Number(val) > 0 ? `R$${Math.round(val)}` : ""}
              style={{ fill: "#9CA3AF", fontSize: "9pt", fontWeight: "800", fontFamily: "monospace" }}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function BarberPerformanceChart({ data = [] }) {
  const { isDark } = useTheme()

  if (!data || data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10">
        Nenhum atendimento ou venda registrado por barbeiro no período
      </div>
    )
  }

  const servicesColor = isDark ? "#FFFFFF" : "#18181B"
  const productsColor = isDark ? "#9CA3AF" : "#52525B"
  const commissionColor = isDark ? "#52525B" : "#A1A1AA"
  const commissionLabelColor = isDark ? "#A1A1AA" : "#52525B"
  const gridStrokeColor = isDark ? "#27272a" : "#e4e4e7"

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 35, right: 15, left: -15, bottom: 0 }}
          barGap={3}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridStrokeColor} vertical={false} />
          <XAxis dataKey="name" stroke="#71717a" fontSize="10pt" tickLine={false} axisLine={false} />
          <YAxis stroke="#71717a" fontSize="10pt" tickLine={false} axisLine={false} tickFormatter={(val) => `R$${val}`} />
          <Tooltip content={<BarberTooltip />} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: "12pt", paddingTop: "12px" }}
            formatter={(value) => (
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[12pt] mr-2">
                {value}
              </span>
            )}
          />
          <Bar
            dataKey="atendimentoValor"
            name="Total em Serviços"
            fill={servicesColor}
            radius={[6, 6, 0, 0]}
            minPointSize={2}
          >
            <LabelList
              dataKey="atendimentoValor"
              position="top"
              formatter={(val) =>
                Number(val) > 0
                  ? `R$${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : ""
              }
              style={{ fill: servicesColor, fontSize: "9pt", fontWeight: "800", fontFamily: "monospace" }}
            />
          </Bar>
          <Bar
            dataKey="produtosValor"
            name="Total em Produtos"
            fill={productsColor}
            radius={[6, 6, 0, 0]}
            minPointSize={2}
          >
            <LabelList
              dataKey="produtosValor"
              position="top"
              formatter={(val) =>
                Number(val) > 0
                  ? `R$${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : ""
              }
              style={{ fill: productsColor, fontSize: "9pt", fontWeight: "800", fontFamily: "monospace" }}
            />
          </Bar>
          <Bar
            dataKey="comissaoTotal"
            name="Comissão do Barbeiro"
            fill={commissionColor}
            radius={[6, 6, 0, 0]}
            minPointSize={2}
          >
            <LabelList
              dataKey="comissaoTotal"
              position="top"
              formatter={(val) =>
                Number(val) > 0
                  ? `R$${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : ""
              }
              style={{ fill: commissionLabelColor, fontSize: "9pt", fontWeight: "800", fontFamily: "monospace" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ServicesDistributionChart({ data = [] }) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { isDark } = useTheme()

  if (!data || data.length === 0) {
    return (
      <div className="h-72 w-full flex flex-col items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10 p-6 space-y-2 text-center animate-fade-in">
        <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
          <Scissors size={20} />
        </div>
        <span className="font-bold text-foreground text-sm">Nenhum serviço registrado no período</span>
        <span className="text-[11px] text-muted-foreground max-w-xs">
          Não foram encontrados agendamentos para calcular a distribuição dos serviços com os filtros atuais.
        </span>
      </div>
    )
  }

  const DEFAULT_COLORS = isDark
    ? ["#FFFFFF", "#E5E7EB", "#D1D5DB", "#9CA3AF", "#6B7280", "#4B5563", "#374151", "#27272A"]
    : ["#18181B", "#27272A", "#374151", "#4B5563", "#52525B", "#6B7280", "#9CA3AF", "#D1D5DB"]

  // Ordenar serviços pelo número de execuções decrescente
  const sortedData = [...data].sort((a, b) => b.value - a.value)
  const totalServices = sortedData.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0)
  const maxVal = sortedData[0]?.value || 1

  // No card da dashboard exibe até os TOP 6
  const top6Data = sortedData.slice(0, 6)

  const processItems = (items) => {
    return items.map((item, idx) => {
      const barWidth = Math.max(16, Math.min(100, Math.round((item.value / maxVal) * 92)))
      const realPct = totalServices > 0 ? Math.round((item.value / totalServices) * 100) : 0
      const color = item.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
      const isLightColor = ["#FFFFFF", "#E5E7EB", "#D1D5DB", "#9CA3AF"].includes(color)
      return {
        ...item,
        rank: idx + 1,
        barWidth,
        realPct,
        color,
        isLightColor
      }
    })
  }

  const processedTop6 = processItems(top6Data)
  const processedAll = processItems(sortedData)

  const col1 = processedTop6.filter((_, idx) => idx % 2 === 0)
  const col2 = processedTop6.filter((_, idx) => idx % 2 === 1)

  return (
    <div className="w-full flex flex-col justify-between h-full pt-1 space-y-4">
      {/* Cabeçalho de Ações: Identificação do Ranking e Botão "Ver todos" */}
      <div className="flex items-center justify-between -mt-2">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          Top {top6Data.length} Serviços
        </span>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 hover:border-primary/40 transition-all cursor-pointer"
        >
          <Maximize2 size={13} />
          <span>Ver todos ({sortedData.length})</span>
        </button>
      </div>

      {/* Grade Principal: Esquerda (Gráfico) x Direita (Legenda de % em 2 colunas) */}
      <div className="flex flex-col 2xl:flex-row items-stretch justify-between gap-5 flex-1 min-h-0">
        {/* Lado Esquerdo: Gráfico de Barras Horizontais com Eixo X e Guias Pontilhadas */}
        <div className="flex-1 flex flex-col justify-between relative min-h-[220px]">
          {/* Linhas pontilhadas verticais de guia (0%, 25%, 50%, 75%, 100%) */}
          <div className="absolute inset-0 left-6 right-0 bottom-6 pointer-events-none flex justify-between z-0">
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
          </div>

          {/* Lista de Barras de Serviços com Números de Ranking 1 a 6 */}
          <div className="space-y-2.5 relative z-10 flex-1 flex flex-col justify-between py-1">
            {processedTop6.map((item) => (
              <div key={item.name} className="flex items-center gap-2 h-6.5">
                <span className="w-4 text-xs font-mono font-bold text-muted-foreground text-center shrink-0">
                  {item.rank}
                </span>
                <div className="flex-1 h-full relative flex items-center">
                  <div
                    style={{ width: `${item.barWidth}%`, backgroundColor: item.color }}
                    className="h-full rounded-r-full transition-all duration-500 flex items-center justify-start px-3 shadow-sm border border-black/10 shrink-0 min-w-[70px]"
                  >
                    <span
                      className={`text-[9.5pt] font-bold truncate max-w-full tracking-wide uppercase ${
                        item.isLightColor ? "text-black" : "text-white"
                      }`}
                    >
                      {item.name}
                    </span>
                  </div>
                  {/* Quantidade exibida FORA DA BARRA */}
                  <div className="flex items-center gap-1.5 ml-1.5 shrink-0">
                    <span className="text-[9.5pt] font-black font-mono text-foreground bg-background/80 border border-border/60 px-1.5 py-0.5 rounded-md shadow-xs">
                      {item.value} {item.value === 1 ? 'srv' : 'srv'}
                    </span>
                    {item.totalRevenue > 0 && (
                      <span className="text-[9pt] font-bold font-mono text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-md hidden sm:inline-block">
                        {formatCurrency(item.totalRevenue)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Eixo X com Porcentagens (0%, 25%, 50%, 75%, 100%) */}
          <div className="flex justify-between pl-6 text-[10px] font-mono text-muted-foreground pt-2 z-10 border-t border-border/20">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Lado Direito / Inferior: Estatísticas de Porcentagem em 2 Colunas */}
        <div className="w-full 2xl:w-56 shrink-0 grid grid-cols-2 gap-x-3 gap-y-2.5 items-center pl-0 2xl:pl-3 border-t 2xl:border-t-0 2xl:border-l border-border/40 pt-3 2xl:pt-0">
          {/* Coluna 1 (Ímpares: 1, 3, 5) */}
          <div className="space-y-2.5">
            {col1.map((item) => (
              <div key={item.name} className="space-y-0.5">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px] font-semibold text-muted-foreground leading-tight break-words uppercase">{item.name}</span>
                </div>
                <div className="text-xs font-extrabold font-mono text-foreground pl-3.5 flex items-center gap-1">
                  <span>{item.realPct}%</span>
                  <span className="text-[9px] font-normal text-muted-foreground font-sans">({item.value})</span>
                </div>
              </div>
            ))}
          </div>

          {/* Coluna 2 (Pares: 2, 4, 6) */}
          <div className="space-y-2.5">
            {col2.map((item) => (
              <div key={item.name} className="space-y-0.5">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px] font-semibold text-muted-foreground leading-tight break-words uppercase">{item.name}</span>
                </div>
                <div className="text-xs font-extrabold font-mono text-foreground pl-3.5 flex items-center gap-1">
                  <span>{item.realPct}%</span>
                  <span className="text-[9px] font-normal text-muted-foreground font-sans">({item.value})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL COMPLETO DE SERVIÇOS MAIS VENDIDOS */}
      {isModalOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[99999] p-4 md:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl p-6 md:p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl space-y-6 relative animate-scale-in my-auto">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <Scissors size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
                    Serviços Mais Vendidos (Visão Completa)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Ranking consolidado de procedimentos realizados no período ({sortedData.length} {sortedData.length === 1 ? 'tipo' : 'tipos'} • {totalServices} atendimentos totais).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Conteúdo do Gráfico Completo */}
            <div className="flex flex-col lg:flex-row items-stretch justify-between gap-8 pt-2">
              {/* Barras em lista vertical */}
              <div className="flex-1 space-y-3.5 relative min-h-[300px]">
                <div className="space-y-3.5 relative z-10">
                  {processedAll.map((item) => (
                    <div key={item.name} className="flex items-center gap-3 h-9">
                      <span className="w-6 text-xs font-mono font-bold text-muted-foreground text-center shrink-0">
                        #{item.rank}
                      </span>
                      <div className="flex-1 h-full relative flex items-center">
                        <div
                          style={{ width: `${item.barWidth}%`, backgroundColor: item.color }}
                          className="h-full rounded-r-full transition-all duration-500 flex items-center justify-between px-4 shadow-sm border border-black/10 min-w-[140px]"
                        >
                          <span
                            className={`text-xs font-bold truncate max-w-[65%] tracking-wide uppercase ${
                              item.isLightColor ? "text-black" : "text-white"
                            }`}
                          >
                            {item.name}
                          </span>
                          <span
                            className={`text-xs font-mono font-extrabold shrink-0 ml-2 ${
                              item.isLightColor ? "text-black" : "text-white"
                            }`}
                          >
                            {item.value} srv ({item.realPct}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabela Resumo com Percentuais e Totais */}
              <div className="w-full lg:w-80 shrink-0 bg-background/50 border border-border/50 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider block border-b border-border/40 pb-2">
                  Detalhamento de Serviços
                </span>
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {processedAll.map((item) => (
                    <div key={item.name} className="flex items-center justify-between text-xs py-1.5 border-b border-border/20 last:border-0">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="font-semibold text-foreground truncate uppercase">{item.name}</span>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div>
                          <span className="font-bold text-primary">{item.value} srv</span>
                          <span className="text-muted-foreground text-[10px] ml-1">({item.realPct}%)</span>
                        </div>
                        {item.totalRevenue > 0 && (
                          <div className="text-[10px] text-muted-foreground font-bold">
                            {formatCurrency(item.totalRevenue)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="flex justify-end pt-4 border-t border-border/40">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="py-2.5 px-6 bg-primary text-background font-black text-xs uppercase tracking-wider rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function StatusDistributionChart({ data = [] }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10">
        Sem agendamentos registrados
      </div>
    )
  }

  const DEFAULT_STATUS_COLORS = ["#FFFFFF", "#D1D5DB", "#9CA3AF", "#6B7280", "#4B5563", "#374151"]

  return (
    <div className="h-72 w-full flex flex-col items-center justify-between gap-2">
      <div className="w-full h-44 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={68}
              paddingAngle={4}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-st-${index}`} fill={entry.color || DEFAULT_STATUS_COLORS[index % DEFAULT_STATUS_COLORS.length]} stroke="#18181b" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legenda posicionada abaixo do gráfico */}
      <div className="w-full flex flex-col justify-center gap-1.5 text-xs text-muted-foreground border-t border-border/30 pt-2 px-1">
        {data.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-1 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color || DEFAULT_STATUS_COLORS[idx % DEFAULT_STATUS_COLORS.length] }}></span>
              <span className="truncate text-foreground font-medium">{entry.name}</span>
            </div>
            <span className="font-bold text-foreground font-mono shrink-0">({entry.value})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProductsDistributionChart({ data = [] }) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { isDark } = useTheme()

  if (!data || data.length === 0) {
    return (
      <div className="h-72 w-full flex flex-col items-center justify-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-2xl bg-muted/10 p-6 space-y-2 text-center animate-fade-in">
        <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1">
          <ShoppingBag size={20} />
        </div>
        <span className="font-bold text-foreground text-sm">Nenhum produto vendido no período</span>
        <span className="text-[11px] text-muted-foreground max-w-xs">
          Não foram encontradas vendas de produtos para calcular a distribuição com os filtros atuais.
        </span>
      </div>
    )
  }

  const DEFAULT_COLORS = isDark
    ? ["#FFFFFF", "#E5E7EB", "#D1D5DB", "#9CA3AF", "#6B7280", "#4B5563", "#374151", "#27272A"]
    : ["#18181B", "#27272A", "#374151", "#4B5563", "#52525B", "#6B7280", "#9CA3AF", "#D1D5DB"]

  // Ordenar produtos pela quantidade sold decrescente
  const sortedData = [...data].sort((a, b) => b.value - a.value)
  const totalProducts = sortedData.reduce((acc, curr) => acc + (Number(curr.value) || 0), 0)
  const maxVal = sortedData[0]?.value || 1

  // No card do dashboard exibe apenas os TOP 5
  const top5Data = sortedData.slice(0, 5)

  const processItems = (items) => {
    return items.map((item, idx) => {
      const barWidth = Math.max(16, Math.min(100, Math.round((item.value / maxVal) * 92)))
      const realPct = totalProducts > 0 ? Math.round((item.value / totalProducts) * 100) : 0
      const color = DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
      const isLightColor = ["#FFFFFF", "#E5E7EB", "#D1D5DB", "#9CA3AF"].includes(color)
      return {
        ...item,
        rank: idx + 1,
        barWidth,
        realPct,
        color,
        isLightColor
      }
    })
  }

  const processedTop5 = processItems(top5Data)
  const processedAll = processItems(sortedData)

  const col1Top5 = processedTop5.filter((_, idx) => idx % 2 === 0)
  const col2Top5 = processedTop5.filter((_, idx) => idx % 2 === 1)

  return (
    <div className="w-full flex flex-col justify-between h-full pt-1 space-y-4">
      {/* Cabeçalho de Ações: Botão "Ver todos" e ícone */}
      <div className="flex items-center justify-between -mt-2">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          Top 5 Produtos
        </span>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="text-xs font-bold text-primary hover:text-primary/80 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 hover:border-primary/40 transition-all cursor-pointer"
        >
          <Maximize2 size={13} />
          <span>Ver todos ({sortedData.length})</span>
        </button>
      </div>

      {/* Grade Principal: Esquerda (Gráfico Top 5) x Direita (Legenda em 2 colunas) */}
      <div className="flex flex-col 2xl:flex-row items-stretch justify-between gap-6 flex-1 min-h-0">
        {/* Lado Esquerdo: Gráfico de Barras Horizontais com Eixo X e Guias Pontilhadas */}
        <div className="flex-1 flex flex-col justify-between relative min-h-[210px]">
          {/* Linhas pontilhadas verticais de guia (0%, 25%, 50%, 75%, 100%) */}
          <div className="absolute inset-0 left-6 right-0 bottom-6 pointer-events-none flex justify-between z-0">
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
            <div className="border-r border-dashed border-border/25 h-full"></div>
          </div>

          {/* Lista de Barras de Produtos com Números de Ranking 1 a 5 */}
          <div className="space-y-2.5 relative z-10 flex-1 flex flex-col justify-between py-1">
            {processedTop5.map((item) => (
              <div key={item.name} className="flex items-center gap-2.5 h-7">
                <span className="w-4 text-xs font-mono font-bold text-muted-foreground text-center shrink-0">
                  {item.rank}
                </span>
                <div className="flex-1 h-full relative flex items-center">
                  <div
                    style={{ width: `${item.barWidth}%`, backgroundColor: item.color }}
                    className="h-full rounded-r-full transition-all duration-500 flex items-center justify-start px-3 shadow-sm border border-black/10 shrink-0"
                  >
                    <span
                      className={`text-[10pt] font-bold truncate max-w-full tracking-wide uppercase ${
                        item.isLightColor ? "text-black" : "text-white"
                      }`}
                    >
                      {item.name}
                    </span>
                  </div>
                  {/* Quantidade exibida FORA DA BARRA (10pt) */}
                  <span className="text-[10pt] font-black font-mono text-foreground shrink-0 ml-2 bg-background/80 border border-border/60 px-2 py-0.5 rounded-md shadow-xs">
                    {item.value} un
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Eixo X com Porcentagens (0%, 25%, 50%, 75%, 100%) */}
          <div className="flex justify-between pl-6 text-[10px] font-mono text-muted-foreground pt-2 z-10 border-t border-border/20">
            <span>0%</span>
            <span>25%</span>
            <span>50%</span>
            <span>75%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Lado Direito: Estatísticas de Porcentagem em 2 Colunas (Top 5) */}
        <div className="w-full 2xl:w-56 shrink-0 grid grid-cols-2 gap-x-4 gap-y-3 items-center pl-0 2xl:pl-4 border-t 2xl:border-t-0 2xl:border-l border-border/40 pt-3 2xl:pt-0">
          <div className="space-y-3">
            {col1Top5.map((item) => (
              <div key={item.name} className="space-y-0.5">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: item.color }} />
                  <span className="text-[10.5px] font-semibold text-muted-foreground leading-tight break-words uppercase">{item.name}</span>
                </div>
                <div className="text-sm font-extrabold font-mono text-foreground pl-4 flex items-center gap-1.5">
                  <span>{item.realPct}%</span>
                  <span className="text-[10px] font-normal text-muted-foreground font-sans">({item.value} un)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {col2Top5.map((item) => (
              <div key={item.name} className="space-y-0.5">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: item.color }} />
                  <span className="text-[10.5px] font-semibold text-muted-foreground leading-tight break-words uppercase">{item.name}</span>
                </div>
                <div className="text-sm font-extrabold font-mono text-foreground pl-4 flex items-center gap-1.5">
                  <span>{item.realPct}%</span>
                  <span className="text-[10px] font-normal text-muted-foreground font-sans">({item.value} un)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL COMPLETO DE PRODUTOS VENDIDOS (RENDERIZADO VIA PORTAL NO DOCUMENT.BODY) */}
      {isModalOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[99999] p-4 md:p-6 animate-fade-in overflow-y-auto">
          <div className="bg-card border border-border rounded-2xl p-6 md:p-8 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl space-y-6 relative animate-scale-in my-auto">
            {/* Cabeçalho do Modal */}
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <ShoppingBag size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
                    Produtos Mais Vendidos (Visão Completa)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Ranking total de produtos vendidos no período selecionado ({sortedData.length} {sortedData.length === 1 ? 'item' : 'itens'}).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-xl hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Conteúdo do Gráfico Completo */}
            <div className="flex flex-col lg:flex-row items-stretch justify-between gap-8 pt-2">
              {/* Barras em lista vertical */}
              <div className="flex-1 space-y-3.5 relative min-h-[300px]">
                <div className="space-y-3.5 relative z-10">
                  {processedAll.map((item) => (
                    <div key={item.name} className="flex items-center gap-3 h-9">
                      <span className="w-6 text-xs font-mono font-bold text-muted-foreground text-center shrink-0">
                        #{item.rank}
                      </span>
                      <div className="flex-1 h-full relative flex items-center">
                        <div
                          style={{ width: `${item.barWidth}%`, backgroundColor: item.color }}
                          className="h-full rounded-r-full transition-all duration-500 flex items-center justify-between px-4 shadow-sm border border-black/10 min-w-[140px]"
                        >
                          <span
                            className={`text-xs font-bold truncate max-w-[65%] tracking-wide uppercase ${
                              item.isLightColor ? "text-black" : "text-white"
                            }`}
                          >
                            {item.name}
                          </span>
                          <span
                            className={`text-xs font-mono font-extrabold shrink-0 ml-2 ${
                              item.isLightColor ? "text-black" : "text-white"
                            }`}
                          >
                            {item.value} un ({item.realPct}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabela Resumo com Percentuais e Totais */}
              <div className="w-full lg:w-80 shrink-0 bg-background/50 border border-border/50 rounded-xl p-4 space-y-3">
                <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider block border-b border-border/40 pb-2">
                  Detalhamento de Vendas
                </span>
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {processedAll.map((item) => (
                    <div key={item.name} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-0">
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="font-semibold text-foreground truncate uppercase">{item.name}</span>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <span className="font-bold text-primary">{item.value} un</span>
                        <span className="text-muted-foreground text-[10px] ml-1">({item.realPct}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="flex justify-end pt-4 border-t border-border/40">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="py-2.5 px-6 bg-primary text-background font-black text-xs uppercase tracking-wider rounded-xl hover:bg-primary/90 transition-all cursor-pointer shadow-md"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// Tooltip customizado para o gráfico de Serviços vs Produtos (Donut)
const ServicesVsProductsTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    if (!data.name || data.name === "Sem vendas") return null

    return (
      <div className="bg-card/95 backdrop-blur-md border border-border/80 rounded-xl p-3 shadow-xl text-xs space-y-1 z-50">
        <p className="font-bold text-foreground flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
          {data.name}
        </p>
        <p className="text-muted-foreground font-mono">
          Valor: <span className="font-bold text-foreground">{formatCurrency(data.rawValue)}</span>
        </p>
        <p className="text-muted-foreground font-mono">
          Participação: <span className="font-bold text-primary">{data.pct}%</span>
        </p>
        {data.count > 0 && (
          <p className="text-muted-foreground text-[10px]">
            Quantidade: <span className="font-semibold text-foreground">{data.count} {data.name === "Serviços" ? "serviço(s)" : "item(ns)"}</span>
          </p>
        )}
      </div>
    )
  }
  return null
}

export function ServicesVsProductsChart({
  servicesTotal = 0,
  productsTotal = 0,
  servicesCount = 0,
  productsCount = 0
}) {
  const { isDark } = useTheme()
  const sTotal = Number(servicesTotal) || 0
  const pTotal = Number(productsTotal) || 0
  const totalValue = sTotal + pTotal

  const pctServicos = totalValue > 0 ? ((sTotal / totalValue) * 100).toFixed(1) : "0.0"
  const pctProdutos = totalValue > 0 ? ((pTotal / totalValue) * 100).toFixed(1) : "0.0"

  const servicesColor = isDark ? "#FFFFFF" : "#18181B"
  const productsColor = isDark ? "#71717A" : "#9CA3AF"
  const emptyColor = isDark ? "#3f3f46" : "#e4e4e7"

  const itemsList = [
    {
      name: "Serviços",
      value: sTotal > 0 ? sTotal : (totalValue === 0 ? 1 : 0.0001),
      rawValue: sTotal,
      count: servicesCount,
      pct: pctServicos,
      color: servicesColor
    },
    {
      name: "Produtos",
      value: pTotal > 0 ? pTotal : (totalValue === 0 ? 0 : 0.0001),
      rawValue: pTotal,
      count: productsCount,
      pct: pctProdutos,
      color: productsColor
    }
  ]


  const chartSlices = totalValue === 0
    ? [{ name: "Sem vendas", value: 1, color: emptyColor }]
    : itemsList.filter((it) => it.rawValue > 0)

  return (
    <div className="w-full flex flex-col justify-between items-center h-full space-y-4 pt-1">
      {/* Container do Gráfico Donut com Valor Total Central */}
      <div className="relative w-full h-[236px] flex items-center justify-center min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartSlices}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={totalValue > 0 && sTotal > 0 && pTotal > 0 ? 4 : 0}
              dataKey="value"
              stroke="none"
            >
              {chartSlices.map((entry, index) => (
                <Cell key={`cell-svp-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<ServicesVsProductsTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Texto do Centro do Donut */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
          <span className="text-lg md:text-xl font-black font-mono text-foreground tracking-tight leading-tight drop-shadow-sm">
            {formatCurrency(totalValue)}
          </span>
          <span className="text-[10px] md:text-[11px] text-muted-foreground uppercase font-bold tracking-wider mt-0.5">
            total geral
          </span>
        </div>
      </div>


      {/* Legenda em Formato de Tabela (Modelo em Anexo) */}
      <div className="w-full space-y-2 pt-1 border-t border-border/30">
        {/* Cabeçalho da Tabela */}
        <div className="flex items-center justify-between text-[11pt] font-bold uppercase tracking-wider text-muted-foreground pb-2 px-1">
          <span>ITEM</span>
          <span>VALOR / PERCENTUAL</span>
        </div>

        {/* Linhas de Itens */}
        <div className="space-y-2">
          {itemsList.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between py-2 border-b border-border/20 px-1 text-[12pt]"
            >
              {/* Lado Esquerdo: Barra de Cor + Nome */}
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-1.5 h-4.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="font-bold text-foreground text-[12pt]">{item.name}</span>
              </div>

              {/* Lado Direito: Valor Total + Pill de Percentual */}
              <div className="flex items-center gap-2.5 font-mono shrink-0">
                <span className="font-extrabold text-foreground text-[12pt]">
                  {formatCurrency(item.rawValue)}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[12pt] font-black bg-primary/20 text-primary border border-primary/40 shadow-xs">
                  {item.pct}%
                </span>
              </div>
            </div>
          ))}

          {/* Linha de Soma Total */}
          <div className="flex items-center justify-between py-2.5 px-2.5 mt-1 rounded-xl bg-primary/10 border border-primary/30 text-[12pt] font-bold">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-1.5 h-4.5 rounded-full shrink-0 bg-primary" />
              <span className="font-extrabold text-foreground text-[12pt]">Soma Total</span>
            </div>
            <div className="flex items-center gap-2.5 font-mono shrink-0">
              <span className="font-black text-primary text-[13pt]">
                {formatCurrency(totalValue)}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[12pt] font-black bg-primary/30 text-primary border border-primary/50 shadow-xs">
                100%
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}


