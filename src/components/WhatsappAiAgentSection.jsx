import React, { useState, useEffect, useCallback } from "react"
import {
  Bot,
  Sparkles,
  RefreshCw,
  Webhook,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Link2,
  Send,
  Mic,
  MessageSquareText,
  RotateCcw,
  Smartphone,
  ShieldCheck
} from "lucide-react"
import { whatsappAiApi } from "../lib/api.js"

const DEFAULT_BOOKING_URL = "https://club01.paulo-tech-nocode.workers.dev"

function formatDateTime(isoStr) {
  if (!isoStr) return "—"
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function formatPhoneDisplay(raw) {
  if (!raw) return "—"
  if (String(raw).startsWith("lid:")) return raw
  const digits = String(raw).replace(/\D/g, "")
  if (digits.startsWith("55") && digits.length === 13) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.startsWith("55") && digits.length === 12) {
    return `(${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return raw
}

export default function WhatsappAiAgentSection() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncingWebhook, setSyncingWebhook] = useState(false)
  const [testingAi, setTestingAi] = useState(false)
  const [resettingPhone, setResettingPhone] = useState("")

  const [errorMsg, setErrorMsg] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  // Config state
  const [enabled, setEnabled] = useState(true)
  const [cooldownHours, setCooldownHours] = useState("12")
  const [bookingUrl, setBookingUrl] = useState(DEFAULT_BOOKING_URL)
  const [systemPrompt, setSystemPrompt] = useState("")
  const [fallbackMessage, setFallbackMessage] = useState("")
  const [webhookConfiguredAt, setWebhookConfiguredAt] = useState(null)

  // Live Edge Function status
  const [runtimeStatus, setRuntimeStatus] = useState(null)

  // Logs
  const [logs, setLogs] = useState([])
  const [statusFilter, setStatusFilter] = useState("")

  // Dry-run simulator
  const [testType, setTestType] = useState("text")
  const [testMessage, setTestMessage] = useState("Olá, gostaria de agendar um corte de cabelo!")
  const [testResult, setTestResult] = useState(null)

  const loadAll = useCallback(async (filter = "") => {
    setLoading(true)
    setErrorMsg("")
    try {
      const [cfg, logsData, statusData] = await Promise.all([
        whatsappAiApi.getConfig(),
        whatsappAiApi.getLogs(filter),
        whatsappAiApi.getStatus().catch((err) => ({
          success: false,
          evolution_error: err.message
        }))
      ])

      if (cfg) {
        setEnabled(cfg.enabled !== false)
        setCooldownHours(String(cfg.cooldown_hours || 12))
        setBookingUrl(cfg.booking_url || DEFAULT_BOOKING_URL)
        setSystemPrompt(cfg.system_prompt || "")
        setFallbackMessage(cfg.fallback_message || "")
        setWebhookConfiguredAt(cfg.webhook_configured_at || null)
      }

      setLogs(logsData || [])
      setRuntimeStatus(statusData || null)
    } catch (err) {
      setErrorMsg(err.message || "Erro ao carregar configurações do Agente de IA.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll("")
  }, [loadAll])

  const handleFilterChange = async (newFilter) => {
    setStatusFilter(newFilter)
    try {
      const data = await whatsappAiApi.getLogs(newFilter)
      setLogs(data || [])
    } catch (err) {
      setErrorMsg(err.message || "Erro ao filtrar histórico do agente.")
    }
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    setSaving(true)
    setErrorMsg("")
    setSuccessMsg("")
    try {
      const saved = await whatsappAiApi.updateConfig({
        enabled,
        cooldown_hours: Number(cooldownHours) || 12,
        booking_url: bookingUrl.trim() || DEFAULT_BOOKING_URL,
        system_prompt: systemPrompt,
        fallback_message: fallbackMessage
      })
      if (saved) {
        setEnabled(saved.enabled !== false)
        setCooldownHours(String(saved.cooldown_hours || 12))
        setBookingUrl(saved.booking_url || DEFAULT_BOOKING_URL)
      }
      setSuccessMsg("Configurações do Agente de IA salvas com sucesso!")
      setTimeout(() => setSuccessMsg(""), 4000)
    } catch (err) {
      setErrorMsg(err.message || "Não foi possível salvar as configurações do agente.")
    } finally {
      setSaving(false)
    }
  }

  const handleSyncWebhook = async () => {
    setSyncingWebhook(true)
    setErrorMsg("")
    setSuccessMsg("")
    try {
      const res = await whatsappAiApi.syncWebhook()
      setWebhookConfiguredAt(res.webhook_configured_at || new Date().toISOString())
      setSuccessMsg(`Webhook sincronizado com sucesso na instância "${res.instance_name}" (evento MESSAGES_UPSERT)!`)
      const updatedStatus = await whatsappAiApi.getStatus().catch(() => null)
      if (updatedStatus) setRuntimeStatus(updatedStatus)
      setTimeout(() => setSuccessMsg(""), 6000)
    } catch (err) {
      setErrorMsg(err.message || "Falha ao sincronizar webhook na Evolution API.")
    } finally {
      setSyncingWebhook(false)
    }
  }

  const handleRunTest = async (e) => {
    e.preventDefault()
    setTestingAi(true)
    setErrorMsg("")
    try {
      const res = await whatsappAiApi.testAgent(testMessage, testType)
      setTestResult(res)
    } catch (err) {
      setErrorMsg(err.message || "Erro ao simular resposta do agente.")
    } finally {
      setTestingAi(false)
    }
  }

  const handleResetCooldown = async (phone) => {
    if (!phone) return
    setResettingPhone(phone)
    setErrorMsg("")
    setSuccessMsg("")
    try {
      await whatsappAiApi.resetCooldown(phone)
      setSuccessMsg(`Cooldown liberado para ${formatPhoneDisplay(phone)}. O próximo contato receberá resposta novamente.`)
      setTimeout(() => setSuccessMsg(""), 4500)
    } catch (err) {
      setErrorMsg(err.message || "Erro ao liberar cooldown.")
    } finally {
      setResettingPhone("")
    }
  }

  const sentCount = logs.filter((l) => l.status === "sent_ai" || l.status === "sent_fallback").length
  const isConnected = runtimeStatus?.connection_state === "open"
  const isWebhookSynced = Boolean(runtimeStatus?.webhook_synced)
  const hasGeminiKey = Boolean(runtimeStatus?.has_gemini_key)

  return (
    <div className="mt-8 pt-8 border-t border-border/60 space-y-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-primary flex items-center gap-2">
              <Bot size={16} /> Agente de IA WhatsApp (Recepção Automática)
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                enabled
                  ? "bg-green-500/15 text-green-400 border-green-500/30"
                  : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
              }`}
            >
              <ShieldCheck size={12} /> {enabled ? "AGENTE ATIVO" : "AGENTE PAUSADO"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Atende automaticamente conversas privadas (texto e áudio) com boas-vindas pela IA Gemini e direciona para o link de agendamento, respeitando cooldown e atendimento humano.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadAll(statusFilter)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 border border-border hover:bg-muted/60 text-foreground rounded-xl px-3 py-2 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Atualizar
          </button>
          <button
            type="button"
            onClick={handleSyncWebhook}
            disabled={syncingWebhook}
            className="btn-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
          >
            <Webhook size={13} className={syncingWebhook ? "animate-spin" : ""} />
            {syncingWebhook ? "Sincronizando..." : "Sincronizar Webhook Evolution"}
          </button>
        </div>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/30 text-destructive text-xs rounded-xl p-3.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2.5 bg-green-500/10 border border-green-500/30 text-green-400 text-xs rounded-xl p-3.5">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {runtimeStatus && !hasGeminiKey && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-xl p-3.5">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            <strong>Chave Gemini pendente:</strong> adicione o secret <code className="bg-black/40 px-1.5 py-0.5 rounded text-amber-200">GEMINI_API_KEY</code> nas Edge Functions do Supabase. Enquanto isso, o agente responderá com a mensagem de fallback configurada abaixo.
          </span>
        </div>
      )}

      {/* Cards de Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-background/40 border border-border/80 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Smartphone size={12} className="text-primary" /> Instância Evolution
          </span>
          <p className="text-sm font-semibold text-foreground truncate">
            {runtimeStatus?.instance_name || "Barbearia CLUB01"}
          </p>
          <span className={`text-[10px] font-medium ${isConnected ? "text-green-400" : "text-amber-400"}`}>
            {isConnected ? "● Conectada (open)" : `● Status: ${runtimeStatus?.connection_state || "verificando"}`}
          </span>
        </div>

        <div className="bg-background/40 border border-border/80 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Sparkles size={12} className="text-primary" /> Motor de IA
          </span>
          <p className="text-sm font-semibold text-foreground truncate">
            {runtimeStatus?.gemini_model || "gemini-3.5-flash-lite"}
          </p>
          <span className={`text-[10px] font-medium ${hasGeminiKey ? "text-green-400" : "text-amber-400"}`}>
            {hasGeminiKey ? "✓ GEMINI_API_KEY ativa" : "⚠ Usando fallback (sem chave)"}
          </span>
        </div>

        <div className="bg-background/40 border border-border/80 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Webhook size={12} className="text-primary" /> Webhook MESSAGES_UPSERT
          </span>
          <p className={`text-sm font-semibold ${isWebhookSynced ? "text-green-400" : "text-amber-400"}`}>
            {isWebhookSynced ? "Sincronizado" : "Pendente"}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {webhookConfiguredAt ? `Último sync: ${formatDateTime(webhookConfiguredAt)}` : "Clique em Sincronizar Webhook"}
          </span>
        </div>

        <div className="bg-background/40 border border-border/80 rounded-xl p-3.5 space-y-1">
          <span className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1.5">
            <Clock size={12} className="text-primary" /> Cooldown / Atendimentos
          </span>
          <p className="text-sm font-semibold text-foreground">
            {cooldownHours}h · {sentCount} enviados
          </p>
          <span className="text-[10px] text-muted-foreground">
            Apenas texto e áudio (privado)
          </span>
        </div>
      </div>

      {/* Formulário de Configuração + Simulador de Teste */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <form onSubmit={handleSaveConfig} className="xl:col-span-2 bg-background/30 border border-border/80 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border/60">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Regras e Personalidade do Agente
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Alterações entram em vigor imediatamente nos próximos atendimentos.
              </p>
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none bg-background border border-border rounded-xl px-3 py-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span className="text-xs font-semibold text-foreground">
                {enabled ? "Agente Ligado" : "Agente Desligado"}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Link2 size={12} className="text-primary" /> Link Oficial de Agendamento
              </label>
              <input
                type="url"
                required
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                placeholder={DEFAULT_BOOKING_URL}
                className="w-full bg-background border border-border focus:border-primary rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock size={12} className="text-primary" /> Cooldown (Horas)
              </label>
              <input
                type="number"
                min="1"
                max="168"
                required
                value={cooldownHours}
                onChange={(e) => setCooldownHours(e.target.value)}
                className="w-full bg-background border border-border focus:border-primary rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Instruções e Tom de Voz da IA (System Prompt)
            </label>
            <textarea
              rows={6}
              required
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Descreva como a IA deve acolher os clientes da CLUB 01 Barber Studio..."
              className="w-full bg-background border border-border focus:border-primary rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground">
              O endereço e o horário de funcionamento das Configurações Gerais são enviados automaticamente como contexto opcional (usados apenas se o cliente perguntar).
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Mensagem Padrão de Fallback (usada se o Gemini estiver indisponível)
            </label>
            <textarea
              rows={4}
              required
              value={fallbackMessage}
              onChange={(e) => setFallbackMessage(e.target.value)}
              placeholder="Mensagem automática de boas-vindas com o link oficial..."
              className="w-full bg-background border border-border focus:border-primary rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all leading-relaxed"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary h-10 px-6 rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar Configurações do Agente"}
            </button>
          </div>
        </form>

        {/* Simulador Dry-Run */}
        <div className="bg-background/30 border border-border/80 rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="pb-3 border-b border-border/60">
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                <Sparkles size={14} className="text-primary" /> Simulador de Resposta (Dry-Run)
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Teste o prompt e a chave Gemini sem enviar mensagem real no WhatsApp.
              </p>
            </div>

            <form onSubmit={handleRunTest} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTestType("text")}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    testType === "text"
                      ? "bg-primary/15 border-primary text-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MessageSquareText size={13} /> Texto
                </button>
                <button
                  type="button"
                  onClick={() => setTestType("audio")}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    testType === "audio"
                      ? "bg-primary/15 border-primary text-primary"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mic size={13} /> Áudio
                </button>
              </div>

              {testType === "text" ? (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Mensagem simulada do cliente
                  </label>
                  <textarea
                    rows={3}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder="Ex: Boa tarde! Vocês abrem sábado? Quero cortar o cabelo."
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-2 px-3 text-xs text-foreground focus:outline-none transition-all"
                  />
                </div>
              ) : (
                <div className="bg-background/60 border border-border/70 rounded-xl p-3 text-[11px] text-muted-foreground">
                  Simula o recebimento de uma mensagem de voz (sem transcrição). O agente reconhece o áudio e direciona para o link.
                </div>
              )}

              <button
                type="submit"
                disabled={testingAi}
                className="w-full inline-flex items-center justify-center gap-2 border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary font-bold h-10 rounded-xl text-xs uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
              >
                <Send size={13} /> {testingAi ? "Gerando resposta..." : "Simular Resposta"}
              </button>
            </form>

            {testResult && (
              <div className="bg-background border border-border/80 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span
                    className={`px-2 py-0.5 rounded-full font-bold ${
                      testResult.used_fallback
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-green-500/15 text-green-400"
                    }`}
                  >
                    {testResult.used_fallback ? "Fallback" : `IA · ${testResult.model_used}`}
                  </span>
                  <span className="text-muted-foreground font-mono">{testResult.latency_ms}ms</span>
                </div>
                <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                  {testResult.reply}
                </p>
                {testResult.error_detail && (
                  <p className="text-[10px] text-amber-400 pt-1 border-t border-border/50">
                    Obs: {testResult.error_detail}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Histórico de Atendimentos do Agente */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
              Histórico de Atendimentos do Agente IA
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Últimos 100 eventos registrados (inclui respostas da IA, fallback, cooldown e pausas por atendimento humano).
            </p>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
            className="bg-background border border-border focus:border-primary rounded-lg py-1.5 px-2.5 text-[11px] focus:outline-none transition-all cursor-pointer"
          >
            <option value="">Todos os status</option>
            <option value="sent_ai">Enviado (IA Gemini)</option>
            <option value="sent_fallback">Enviado (Fallback)</option>
            <option value="skipped_cooldown">Ignorado (Cooldown)</option>
            <option value="paused_human">Pausa Humana</option>
            <option value="skipped_disabled">Agente Desligado</option>
            <option value="failed">Falhou</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/80 bg-background/20 max-h-[380px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/80 text-muted-foreground uppercase font-bold tracking-wider bg-background/45 sticky top-0 z-10">
                <th className="py-3 px-4">Data</th>
                <th className="py-3 px-4">Cliente / Telefone</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4">Mensagem / Resposta</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Cooldown</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                    Carregando histórico do agente...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground text-xs">
                    Nenhum atendimento registrado pelo Agente de IA ainda.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-b border-border/40 hover:bg-muted/5 transition-colors align-top">
                    <td className="py-3 px-4 text-foreground/70 whitespace-nowrap">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-foreground">{log.customer_name || "Cliente"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {formatPhoneDisplay(log.phone)}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted/60 text-foreground/80">
                        {log.message_type === "audio" ? (
                          <>
                            <Mic size={10} /> Áudio
                          </>
                        ) : log.message_type === "human_outbound" ? (
                          "Equipe"
                        ) : (
                          <>
                            <MessageSquareText size={10} /> Texto
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-4 max-w-[340px]">
                      {log.incoming_text && (
                        <p className="text-[11px] text-foreground/85 truncate" title={log.incoming_text}>
                          <strong>Entrada:</strong> {log.incoming_text}
                        </p>
                      )}
                      {log.ai_response && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1" title={log.ai_response}>
                          <strong>Resposta:</strong> {log.ai_response}
                        </p>
                      )}
                      {log.error_detail && (
                        <p className="text-[10px] text-amber-400 mt-1 truncate" title={log.error_detail}>
                          {log.error_detail}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          log.status === "sent_ai"
                            ? "bg-green-500/15 text-green-400"
                            : log.status === "sent_fallback"
                            ? "bg-amber-500/15 text-amber-400"
                            : log.status === "paused_human"
                            ? "bg-purple-500/15 text-purple-400"
                            : log.status === "failed"
                            ? "bg-red-500/15 text-red-400"
                            : "bg-zinc-500/20 text-zinc-400"
                        }`}
                      >
                        {log.status === "sent_ai"
                          ? "✓ IA Enviada"
                          : log.status === "sent_fallback"
                          ? "⚡ Fallback"
                          : log.status === "paused_human"
                          ? "✋ Pausa Humana"
                          : log.status === "skipped_cooldown"
                          ? "⏳ Em Cooldown"
                          : log.status === "skipped_disabled"
                          ? "⊘ Desligado"
                          : log.status === "failed"
                          ? "✗ Falhou"
                          : log.status}
                      </span>
                      {log.latency_ms ? (
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {log.latency_ms}ms
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleResetCooldown(log.phone)}
                        disabled={resettingPhone === log.phone}
                        title="Liberar cooldown deste número para testar novamente"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border hover:border-primary/50 hover:text-primary text-[10px] font-semibold text-muted-foreground transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={11} className={resettingPhone === log.phone ? "animate-spin" : ""} />
                        Liberar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

