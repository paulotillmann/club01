// ==============================================================================
// PROJETO: CLUB 01 BARBER STUDIO
// SUPABASE EDGE FUNCTION: AGENTE DE IA DE ATENDIMENTO WHATSAPP
// Arquivo: supabase/functions/whatsapp-ai-webhook/index.ts
// ==============================================================================
// Responsabilidades:
// 1. Receber webhooks MESSAGES_UPSERT da Evolution API (com validacao de segredo).
// 2. Filtrar estritamente conversas privadas + mensagens de TEXTO e AUDIO.
// 3. Garantir cooldown atomico (padrao 12h) e respeito a atendimento humano (fromMe).
// 4. Gerar resposta natural com Google Gemini (gemini-2.5-flash) e fallback seguro.
// 5. Expor acoes administrativas autenticadas (status, sync_webhook, test_ai, reset_cooldown).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  DEFAULT_BOOKING_URL,
  DEFAULT_SHOP_NAME,
  buildFallbackMessage,
  buildGeminiRequest,
  ensureBookingUrlInReply,
  parseEvolutionWebhook,
  resolveOfficialShopName,
  timingSafeEqual
} from "./helpers.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret"
};

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const EVOLUTION_INSTANCE_NAME = (Deno.env.get("EVOLUTION_INSTANCE_NAME") || "Barbearia CLUB01").trim();
const GEMINI_API_KEY = (Deno.env.get("GEMINI_API_KEY") || "").trim();
const GEMINI_MODEL = (Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite").trim();
const GEMINI_TIMEOUT_MS = 25000;
const ENV_WEBHOOK_SECRET = (Deno.env.get("WHATSAPP_WEBHOOK_SECRET") || "").trim();

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getEffectiveWebhookSecret(supabase: any): Promise<string> {
  if (ENV_WEBHOOK_SECRET) return ENV_WEBHOOK_SECRET;

  const { data } = await supabase
    .from("whatsapp_ai_internal")
    .select("webhook_secret")
    .eq("id", "default")
    .maybeSingle();

  return typeof data?.webhook_secret === "string" ? data.webhook_secret.trim() : "";
}

async function loadAiConfig(supabase: any) {
  const { data } = await supabase
    .from("whatsapp_ai_config")
    .select("*")
    .eq("id", "default")
    .maybeSingle();

  return {
    enabled: data?.enabled !== false,
    cooldown_hours: Number(data?.cooldown_hours) || 12,
    booking_url: (data?.booking_url || DEFAULT_BOOKING_URL).trim(),
    system_prompt: data?.system_prompt || "",
    fallback_message: data?.fallback_message || "",
    webhook_url: data?.webhook_url || null,
    webhook_configured_at: data?.webhook_configured_at || null
  };
}

async function loadShopSettings(supabase: any) {
  const { data } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["shop_name", "shop_address", "shop_open_hours"]);

  const map: Record<string, string> = {};
  for (const row of data || []) {
    if (row?.key) map[row.key] = String(row.value ?? "");
  }

  return {
    shopName: resolveOfficialShopName(map.shop_name),
    shopAddress: map.shop_address || "",
    shopOpenHours: map.shop_open_hours || ""
  };
}

async function generateAiReply(params: {
  config: Awaited<ReturnType<typeof loadAiConfig>>;
  shopSettings: Awaited<ReturnType<typeof loadShopSettings>>;
  customerName: string | null;
  messageKind: "text" | "audio";
  incomingText: string | null;
}): Promise<{
  text: string;
  modelUsed: string;
  usedFallback: boolean;
  errorDetail: string | null;
  latencyMs: number;
}> {
  const startedAt = Date.now();
  const fallbackText = buildFallbackMessage(params.config.fallback_message, params.config.booking_url);

  if (!GEMINI_API_KEY) {
    return {
      text: fallbackText,
      modelUsed: "fallback",
      usedFallback: true,
      errorDetail: "GEMINI_API_KEY não configurada nos Secrets do Supabase",
      latencyMs: Date.now() - startedAt
    };
  }

  const modelsToTry = GEMINI_MODEL === "gemini-3.8-flash"
    ? [{ model: GEMINI_MODEL, thinkingLevel: "low" as const }]
    : [
        { model: GEMINI_MODEL, thinkingLevel: (GEMINI_MODEL.includes("3.8") ? "low" : "minimal") as "minimal" | "low" },
        { model: "gemini-3.8-flash", thinkingLevel: "low" as const }
      ];

  let lastErrorDetail: string | null = null;

  for (const candidate of modelsToTry) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate.model)}:generateContent`;
    const requestBody = buildGeminiRequest({
      systemPrompt: params.config.system_prompt,
      bookingUrl: params.config.booking_url,
      shopName: params.shopSettings.shopName,
      shopAddress: params.shopSettings.shopAddress,
      shopOpenHours: params.shopSettings.shopOpenHours,
      customerName: params.customerName,
      messageKind: params.messageKind,
      incomingText: params.incomingText,
      thinkingLevel: candidate.thinkingLevel
    });

    try {
      let res = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
          },
          body: JSON.stringify(requestBody)
        },
        GEMINI_TIMEOUT_MS
      );

      // Compatibilidade caso o modelo rejeite thinkingConfig
      if (res.status === 400) {
        const errBodyText = await res.text().catch(() => "");
        if (errBodyText.toLowerCase().includes("thinkingconfig") || errBodyText.toLowerCase().includes("thinking")) {
          const retryBody = {
            ...requestBody,
            generationConfig: {
              temperature: requestBody.generationConfig.temperature,
              maxOutputTokens: requestBody.generationConfig.maxOutputTokens
            }
          };
          res = await fetchWithTimeout(
            endpoint,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": GEMINI_API_KEY
              },
              body: JSON.stringify(retryBody)
            },
            GEMINI_TIMEOUT_MS
          );
        } else {
          lastErrorDetail = `Gemini (${candidate.model}) HTTP 400: ${errBodyText.slice(0, 240)}`;
          break;
        }
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        lastErrorDetail = `Gemini (${candidate.model}) erro (${res.status}): ${String(msg).slice(0, 240)}`;
        // Se for 404 (modelo indisponível para a conta), tenta próximo modelo da lista
        if (res.status === 404) {
          continue;
        }
        break;
      }

      const parts = data?.candidates?.[0]?.content?.parts;
      const rawReply = Array.isArray(parts)
        ? parts
          .filter((p: any) => !p?.thought && typeof p?.text === "string")
          .map((p: any) => p.text)
          .join("")
          .trim()
        : "";

      const finalReply = ensureBookingUrlInReply(rawReply, params.config.booking_url);
      if (!finalReply) {
        lastErrorDetail = `Gemini (${candidate.model}) retornou resposta vazia`;
        continue;
      }

      return {
        text: finalReply,
        modelUsed: candidate.model,
        usedFallback: false,
        errorDetail: null,
        latencyMs: Date.now() - startedAt
      };
    } catch (err: any) {
      const isAbort = err?.name === "AbortError";
      lastErrorDetail = isAbort
        ? `Timeout (${GEMINI_TIMEOUT_MS / 1000}s) na chamada ao Gemini (${candidate.model})`
        : `Falha Gemini (${candidate.model}): ${String(err?.message || err).slice(0, 200)}`;
      break;
    }
  }

  return {
    text: fallbackText,
    modelUsed: "fallback",
    usedFallback: true,
    errorDetail: lastErrorDetail || "Falha desconhecida ao consultar Gemini",
    latencyMs: Date.now() - startedAt
  };
}

async function sendEvolutionText(replyTarget: string, text: string): Promise<{
  ok: boolean;
  httpStatus: number;
  externalId: string | null;
  errorDetail: string | null;
}> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return {
      ok: false,
      httpStatus: 0,
      externalId: null,
      errorDetail: "EVOLUTION_API_URL ou EVOLUTION_API_KEY ausente nos Secrets"
    };
  }

  const endpoint = `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`;
  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          number: replyTarget,
          text,
          delay: 1200
        })
      },
      15000
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.response?.message || data?.message || `Erro HTTP ${res.status} na Evolution API`;
      return {
        ok: false,
        httpStatus: res.status,
        externalId: null,
        errorDetail: typeof errMsg === "string" ? errMsg.slice(0, 300) : JSON.stringify(errMsg).slice(0, 300)
      };
    }

    return {
      ok: true,
      httpStatus: res.status,
      externalId: data?.key?.id || data?.id || null,
      errorDetail: null
    };
  } catch (err: any) {
    return {
      ok: false,
      httpStatus: 0,
      externalId: null,
      errorDetail: `Falha de rede na Evolution API: ${String(err?.message || err).slice(0, 200)}`
    };
  }
}

async function verifyAdminAuth(req: Request, supabase: any): Promise<{ ok: boolean; error?: string; status?: number }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return { ok: false, error: "Autenticação obrigatória para ações administrativas.", status: 401 };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, error: "Token de autenticação ausente.", status: 401 };
  }

  // Permite service_role diretamente para testes técnicos server-side
  if (SUPABASE_SERVICE_ROLE_KEY && token === SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: true };
  }

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user) {
    return { ok: false, error: "Sessão inválida ou expirada.", status: 401 };
  }

  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (userErr || userRow?.role !== "admin") {
    return { ok: false, error: "Acesso restrito a administradores.", status: 403 };
  }

  return { ok: true };
}

async function handleAdminAction(body: Record<string, any>, req: Request, supabase: any): Promise<Response> {
  const authCheck = await verifyAdminAuth(req, supabase);
  if (!authCheck.ok) {
    return jsonResponse({ success: false, error: authCheck.error }, authCheck.status || 403);
  }

  const action = String(body.admin_action || "");
  const expectedBaseUrl = `${SUPABASE_URL}/functions/v1/whatsapp-ai-webhook`;

  if (action === "status") {
    let connectionState = "unknown";
    let remoteWebhook: Record<string, any> | null = null;
    let webhookSynced = false;
    let evolutionError: string | null = null;

    if (EVOLUTION_API_URL && EVOLUTION_API_KEY) {
      try {
        const [connRes, hookRes] = await Promise.all([
          fetchWithTimeout(
            `${EVOLUTION_API_URL}/instance/connectionState/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
            { method: "GET", headers: { apikey: EVOLUTION_API_KEY } },
            10000
          ),
          fetchWithTimeout(
            `${EVOLUTION_API_URL}/webhook/find/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`,
            { method: "GET", headers: { apikey: EVOLUTION_API_KEY } },
            10000
          )
        ]);

        const connData = await connRes.json().catch(() => ({}));
        connectionState = connData?.instance?.state || connData?.state || (connRes.ok ? "open" : "disconnected");

        if (hookRes.ok) {
          const hookData = await hookRes.json().catch(() => null);
          const wh = hookData?.webhook || hookData || null;
          if (wh && typeof wh === "object") {
            const rawUrl = typeof wh.url === "string" ? wh.url : "";
            const sanitizedUrl = rawUrl ? rawUrl.split("?")[0] : "";
            const events = Array.isArray(wh.events) ? wh.events : [];
            const hasUpsert = events.some((ev: any) => String(ev).toUpperCase().replace(/[.-]+/g, "_") === "MESSAGES_UPSERT");
            remoteWebhook = {
              enabled: Boolean(wh.enabled),
              url: sanitizedUrl,
              events,
              by_events: Boolean(wh.webhookByEvents ?? wh.byEvents)
            };
            webhookSynced = Boolean(wh.enabled) && sanitizedUrl === expectedBaseUrl && hasUpsert;
          }
        }
      } catch (err: any) {
        evolutionError = `Não foi possível consultar a Evolution API: ${String(err?.message || err).slice(0, 180)}`;
      }
    }

    return jsonResponse({
      success: true,
      instance_name: EVOLUTION_INSTANCE_NAME,
      gemini_model: GEMINI_MODEL,
      has_gemini_key: Boolean(GEMINI_API_KEY),
      has_evolution_config: Boolean(EVOLUTION_API_URL && EVOLUTION_API_KEY),
      connection_state: connectionState,
      webhook_expected_url: expectedBaseUrl,
      webhook_remote: remoteWebhook,
      webhook_synced: webhookSynced,
      evolution_error: evolutionError
    });
  }

  if (action === "sync_webhook") {
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return jsonResponse(
        { success: false, error: "Secrets EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados no Supabase." },
        500
      );
    }

    const secret = await getEffectiveWebhookSecret(supabase);
    if (!secret) {
      return jsonResponse({ success: false, error: "Segredo interno de webhook indisponível." }, 500);
    }

    const webhookUrlWithSecret = `${expectedBaseUrl}?secret=${encodeURIComponent(secret)}`;
    const setEndpoint = `${EVOLUTION_API_URL}/webhook/set/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`;

    try {
      // Formato Evolution API v2.2+/v2.3+ (objeto aninhado webhook)
      let evoRes = await fetchWithTimeout(
        setEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: EVOLUTION_API_KEY
          },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: webhookUrlWithSecret,
              headers: {
                "x-webhook-secret": secret
              },
              byEvents: false,
              base64: false,
              events: ["MESSAGES_UPSERT"]
            }
          })
        },
        15000
      );

      // Fallback automático para Evolution API v2.0/v2.1 (payload plano)
      if (evoRes.status === 400) {
        evoRes = await fetchWithTimeout(
          setEndpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: EVOLUTION_API_KEY
            },
            body: JSON.stringify({
              enabled: true,
              url: webhookUrlWithSecret,
              webhookByEvents: false,
              webhookBase64: false,
              events: ["MESSAGES_UPSERT"]
            })
          },
          15000
        );
      }

      const evoData = await evoRes.json().catch(() => ({}));
      if (!evoRes.ok) {
        const msg = evoData?.response?.message || evoData?.message || `Erro HTTP ${evoRes.status}`;
        return jsonResponse(
          {
            success: false,
            error: `Evolution API rejeitou a configuração do webhook: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`
          },
          502
        );
      }

      const configuredAt = new Date().toISOString();
      await supabase
        .from("whatsapp_ai_config")
        .update({
          webhook_url: expectedBaseUrl,
          webhook_configured_at: configuredAt,
          updated_at: configuredAt
        })
        .eq("id", "default");

      return jsonResponse({
        success: true,
        instance_name: EVOLUTION_INSTANCE_NAME,
        webhook_url: expectedBaseUrl,
        webhook_configured_at: configuredAt,
        events: ["MESSAGES_UPSERT"]
      });
    } catch (err: any) {
      return jsonResponse(
        { success: false, error: `Falha ao sincronizar webhook na Evolution API: ${String(err?.message || err)}` },
        502
      );
    }
  }

  if (action === "test_ai") {
    const messageType = body.message_type === "audio" ? "audio" : "text";
    const sampleMessage = messageType === "audio"
      ? "[Mensagem de áudio]"
      : String(body.sample_message || "Olá, gostaria de agendar um corte de cabelo!").trim();

    const [config, shopSettings] = await Promise.all([
      loadAiConfig(supabase),
      loadShopSettings(supabase)
    ]);

    const result = await generateAiReply({
      config,
      shopSettings,
      customerName: typeof body.customer_name === "string" ? body.customer_name.trim() : "Cliente Teste",
      messageKind: messageType,
      incomingText: sampleMessage
    });

    return jsonResponse({
      success: true,
      reply: result.text,
      model_used: result.modelUsed,
      used_fallback: result.usedFallback,
      error_detail: result.errorDetail,
      latency_ms: result.latencyMs,
      has_gemini_key: Boolean(GEMINI_API_KEY)
    });
  }

  if (action === "reset_cooldown") {
    const rawPhone = String(body.phone || "").trim();
    if (!rawPhone) {
      return jsonResponse({ success: false, error: "Informe o telefone/sessão para liberar o cooldown." }, 400);
    }

    const candidates = [rawPhone];
    const digits = rawPhone.replace(/\D/g, "");
    if (digits && !candidates.includes(digits)) candidates.push(digits);

    const { error: delErr } = await supabase
      .from("whatsapp_ai_sessions")
      .delete()
      .in("phone", candidates);

    if (delErr) {
      return jsonResponse({ success: false, error: delErr.message }, 500);
    }

    return jsonResponse({ success: true, cleared: rawPhone });
  }

  return jsonResponse({ success: false, error: `Ação administrativa desconhecida: ${action}` }, 400);
}

async function insertLogSafe(supabase: any, row: Record<string, any>) {
  const { error } = await supabase.from("whatsapp_ai_logs").insert(row);
  if (error && String(error.code) !== "23505") {
    console.error("[whatsapp-ai-webhook] Erro ao gravar log:", error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "club01-whatsapp-ai-webhook",
      shop: DEFAULT_SHOP_NAME
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ error: "Configuração Supabase ausente no runtime." }, 500);
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Payload JSON inválido." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ----------------------------------------------------------------------------
  // ROTA 1: AÇÕES ADMINISTRATIVAS DO PAINEL CONFIGURAÇÕES
  // ----------------------------------------------------------------------------
  if (body && typeof body.admin_action === "string" && body.admin_action.trim()) {
    return handleAdminAction(body, req, supabase);
  }

  // ----------------------------------------------------------------------------
  // ROTA 2: WEBHOOK DA EVOLUTION API (MESSAGES_UPSERT)
  // ----------------------------------------------------------------------------
  const expectedSecret = await getEffectiveWebhookSecret(supabase);
  if (!expectedSecret) {
    console.error("[whatsapp-ai-webhook] Segredo de webhook não disponível.");
    return jsonResponse({ error: "Webhook não inicializado." }, 500);
  }

  const reqUrl = new URL(req.url);
  const providedSecret = (
    req.headers.get("x-webhook-secret") ||
    reqUrl.searchParams.get("secret") ||
    ""
  ).trim();

  if (!timingSafeEqual(providedSecret, expectedSecret)) {
    return jsonResponse({ error: "Webhook não autorizado." }, 401);
  }

  const parsed = parseEvolutionWebhook(body);

  // Ignora eventos que não sejam MESSAGES_UPSERT
  if (!parsed.validEvent) {
    return jsonResponse({ ok: true, ignored: true, reason: parsed.ignoreReason || "unsupported_event" });
  }

  // Valida instância esperada (evita atender eventos de outra instância)
  if (
    parsed.instance &&
    EVOLUTION_INSTANCE_NAME &&
    parsed.instance.toLowerCase() !== EVOLUTION_INSTANCE_NAME.toLowerCase()
  ) {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: "instance_mismatch",
      received_instance: parsed.instance
    });
  }

  // Ignora grupos, status/broadcasts, newsletters e JIDs inválidos
  if (!parsed.isPrivateChat || !parsed.phone || !parsed.replyTarget) {
    return jsonResponse({ ok: true, ignored: true, reason: parsed.ignoreReason || "non_private_chat" });
  }

  const config = await loadAiConfig(supabase);

  // ----------------------------------------------------------------------------
  // TRATAMENTO DE MENSAGENS ENVIADAS PELA BARBEARIA (fromMe = true)
  // Pausa o agente por cooldown_hours se for resposta humana manual
  // ----------------------------------------------------------------------------
  if (parsed.fromMe) {
    if (parsed.messageId) {
      const [aiLogMatch, queueMatch] = await Promise.all([
        supabase
          .from("whatsapp_ai_logs")
          .select("id")
          .eq("external_message_id", parsed.messageId)
          .maybeSingle(),
        supabase
          .from("notification_queue")
          .select("id")
          .eq("external_id", parsed.messageId)
          .maybeSingle()
      ]);

      if (aiLogMatch?.data?.id || queueMatch?.data?.id) {
        return jsonResponse({ ok: true, ignored: true, reason: "automated_outbound_echo" });
      }
    }

    const { data: humanRes } = await supabase.rpc("record_whatsapp_human_reply", {
      p_phone: parsed.phone,
      p_remote_jid: parsed.remoteJid,
      p_cooldown_hours: config.cooldown_hours
    });

    if (humanRes?.updated) {
      await insertLogSafe(supabase, {
        message_id: parsed.messageId ? `human:${parsed.messageId}` : null,
        phone: parsed.phone,
        remote_jid: parsed.remoteJid,
        customer_name: parsed.customerName,
        message_type: "human_outbound",
        incoming_text: parsed.incomingText ? `[Equipe] ${parsed.incomingText}` : "[Atendimento humano manual]",
        ai_response: null,
        status: "paused_human",
        model_used: null,
        error_detail: null,
        external_message_id: parsed.messageId,
        latency_ms: null
      });
    }

    return jsonResponse({
      ok: true,
      handled: true,
      action: humanRes?.updated ? "paused_human" : "ignored_recent_ai_echo"
    });
  }

  // ----------------------------------------------------------------------------
  // FILTRO ESTRITO DE TIPO: ACEITA APENAS TEXTO E ÁUDIO
  // Ignora imagens, vídeos, figurinhas, documentos, reações e protocolo
  // ----------------------------------------------------------------------------
  if (parsed.kind !== "text" && parsed.kind !== "audio") {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: "ignored_message_type",
      raw_type: parsed.rawMessageType
    });
  }

  // Verifica se o agente está ativado no painel Configurações
  if (!config.enabled) {
    await insertLogSafe(supabase, {
      message_id: parsed.messageId,
      phone: parsed.phone,
      remote_jid: parsed.remoteJid,
      customer_name: parsed.customerName,
      message_type: parsed.kind,
      incoming_text: parsed.incomingText,
      ai_response: null,
      status: "skipped_disabled",
      model_used: null,
      error_detail: "Agente desativado no painel de Configurações",
      external_message_id: null,
      latency_ms: null
    });
    return jsonResponse({ ok: true, ignored: true, reason: "agent_disabled" });
  }

  // ----------------------------------------------------------------------------
  // RESERVA ATÔMICA DE COOLDOWN + IDEMPOTÊNCIA POR message_id
  // ----------------------------------------------------------------------------
  const { data: claim, error: claimErr } = await supabase.rpc("claim_whatsapp_ai_cooldown", {
    p_phone: parsed.phone,
    p_remote_jid: parsed.remoteJid,
    p_customer_name: parsed.customerName,
    p_message_id: parsed.messageId,
    p_cooldown_hours: config.cooldown_hours
  });

  if (claimErr) {
    console.error("[whatsapp-ai-webhook] Erro no claim_whatsapp_ai_cooldown:", claimErr.message);
    return jsonResponse({ ok: false, error: claimErr.message }, 500);
  }

  if (!claim?.allowed) {
    if (claim?.reason === "cooldown_active") {
      await insertLogSafe(supabase, {
        message_id: parsed.messageId,
        phone: parsed.phone,
        remote_jid: parsed.remoteJid,
        customer_name: parsed.customerName,
        message_type: parsed.kind,
        incoming_text: parsed.incomingText,
        ai_response: null,
        status: "skipped_cooldown",
        model_used: null,
        error_detail: claim?.cooldown_until ? `Cooldown ativo até ${claim.cooldown_until}` : "Cooldown ativo",
        external_message_id: null,
        latency_ms: null
      });
    }
    return jsonResponse({ ok: true, ignored: true, reason: claim?.reason || "blocked" });
  }

  // ----------------------------------------------------------------------------
  // GERAÇÃO DA RESPOSTA VIA GEMINI 2.5 FLASH (+ FALLBACK DETERMINÍSTICO)
  // ----------------------------------------------------------------------------
  const shopSettings = await loadShopSettings(supabase);
  const aiResult = await generateAiReply({
    config,
    shopSettings,
    customerName: parsed.customerName,
    messageKind: parsed.kind,
    incomingText: parsed.incomingText
  });

  // ----------------------------------------------------------------------------
  // ENVIO DA RESPOSTA VIA EVOLUTION API
  // ----------------------------------------------------------------------------
  const sendRes = await sendEvolutionText(parsed.replyTarget, aiResult.text);

  if (!sendRes.ok) {
    // Libera o cooldown para o cliente não ficar silenciado quando o envio falhou
    await supabase.rpc("release_whatsapp_ai_cooldown", {
      p_phone: parsed.phone,
      p_previous_cooldown_until: claim.previous_cooldown_until || null
    });

    await insertLogSafe(supabase, {
      message_id: parsed.messageId,
      phone: parsed.phone,
      remote_jid: parsed.remoteJid,
      customer_name: parsed.customerName,
      message_type: parsed.kind,
      incoming_text: parsed.incomingText,
      ai_response: aiResult.text,
      status: "failed",
      model_used: aiResult.modelUsed,
      error_detail: sendRes.errorDetail || aiResult.errorDetail,
      external_message_id: null,
      latency_ms: aiResult.latencyMs
    });

    return jsonResponse({
      ok: false,
      status: "failed",
      error: sendRes.errorDetail
    }, 200);
  }

  await insertLogSafe(supabase, {
    message_id: parsed.messageId,
    phone: parsed.phone,
    remote_jid: parsed.remoteJid,
    customer_name: parsed.customerName,
    message_type: parsed.kind,
    incoming_text: parsed.incomingText,
    ai_response: aiResult.text,
    status: aiResult.usedFallback ? "sent_fallback" : "sent_ai",
    model_used: aiResult.modelUsed,
    error_detail: aiResult.errorDetail,
    external_message_id: sendRes.externalId,
    latency_ms: aiResult.latencyMs
  });

  return jsonResponse({
    ok: true,
    status: aiResult.usedFallback ? "sent_fallback" : "sent_ai",
    model_used: aiResult.modelUsed,
    external_message_id: sendRes.externalId,
    latency_ms: aiResult.latencyMs
  });
});
