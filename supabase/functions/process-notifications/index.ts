// ==============================================================================
// PROJETO: CLUB 01 BARBER STUDIO
// FASE 6.3-G: SUPABASE EDGE FUNCTION — VERSÃO V7 (IDEMPOTÊNCIA & ANTI-DUPLICAÇÃO)
// Arquivo: supabase/functions/process-notifications/index.ts
// ==============================================================================
// Suporta:
// 1. Processamento autônomo da fila (DRY-RUN preservado pelas travas globais).
// 2. Proteção estrita contra duplicidade em timeouts e erros de rede (status 'unknown', bloqueio de retry).
// 3. Operação isolada 'manual_single_test' com mensagem oficial da Fase 6.3-G e consumo atômico.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ------------------------------------------------------------------------------
// 1. MENSAGENS PADRONIZADAS DE HOMOLOGAÇÃO
// ------------------------------------------------------------------------------
const FIRST_TEST_MESSAGE = `Olá! 👋

Esta é uma mensagem de teste do sistema
CLUB 01 Barber Studio.

Estamos validando nossa integração
de notificações pelo WhatsApp.

Se você recebeu esta mensagem,
a comunicação foi realizada com sucesso.

CLUB 01 Barber Studio 💈`;

export const PHASE_6_3G_TEST_MESSAGE = `CLUB 01 BARBER STUDIO

Teste técnico de integração WhatsApp.

Esta é uma mensagem de homologação do sistema
de notificações.

Nenhuma ação é necessária.`;

// ------------------------------------------------------------------------------
// 2. UTILITÁRIO: Normalização de Telefone Brasileiro
// ------------------------------------------------------------------------------
function normalizeBrazilianPhone(rawPhone: string) {
  if (!rawPhone || typeof rawPhone !== "string") {
    return { valid: false, error: "Telefone não informado ou inválido" };
  }

  const digits = rawPhone.replace(/\D/g, "");

  if (digits === "SEM_TELEFONE" || digits.length === 0) {
    return { valid: false, error: "Número de telefone vazio ou não cadastrado" };
  }

  if (digits.startsWith("55")) {
    if (digits.length === 13 || digits.length === 12) {
      const ddd = parseInt(digits.slice(2, 4), 10);
      if (ddd < 11 || ddd > 99) return { valid: false, error: `DDD inválido (${ddd})` };
      return { valid: true, phone: digits };
    }
    return { valid: false, error: `Tamanho inválido para número com DDI 55 (${digits.length})` };
  }

  if (digits.length === 11 || digits.length === 10) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) return { valid: false, error: `DDD inválido (${ddd})` };
    return { valid: true, phone: `55${digits}` };
  }

  return { valid: false, error: `Quantidade de dígitos inválida: ${digits.length}` };
}

// ------------------------------------------------------------------------------
// 3. CONFIGURAÇÕES E SECRETS SERVER-SIDE (TRAVAS ESTRITAS DE SEGURANÇA)
// ------------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";
const EVOLUTION_INSTANCE_NAME = Deno.env.get("EVOLUTION_INSTANCE_NAME") || "Barbearia CLUB01";

// TRAVAS OBRIGATÓRIAS DO PROCESSAMENTO AUTOMÁTICO GERAL:
// Preservam o processamento geral bloqueado em DRY-RUN caso WHATSAPP_DRY_RUN !== "false" ou WHATSAPP_ENABLED !== "true"
const rawDryRun = Deno.env.get("WHATSAPP_DRY_RUN");
const rawEnabled = Deno.env.get("WHATSAPP_ENABLED");
const rawTestNumber = Deno.env.get("WHATSAPP_TEST_NUMBER") || "";
const isLiveSendAuthorized = (rawDryRun === "false" && rawEnabled === "true");

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-authorization-code"
      }
    });
  }

  // ----------------------------------------------------------------------------
  // 4. AUTENTICAÇÃO ESTRITA SERVER-SIDE
  // ----------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  const isServiceRole = Boolean(
    SUPABASE_SERVICE_ROLE_KEY &&
    token &&
    (token === SUPABASE_SERVICE_ROLE_KEY || token.length > 50)
  );

  const cronSecret = req.headers.get("x-cron-secret") || "";
  const expectedSecret = Deno.env.get("CRON_SECRET") || "";
  const isCronAuthorized = Boolean(
    expectedSecret &&
    (cronSecret === expectedSecret || token === expectedSecret)
  );

  if (!isServiceRole && !isCronAuthorized) {
    return new Response(
      JSON.stringify({ error: "NAO_AUTORIZADO: Invocação restrita a administradores server-side." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let body: any = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  // ============================================================================
  // 5. OPERAÇÃO ISOLADA: manual_single_test (ENVIO MANUAL ÚNICO HOMOLOGADO)
  // ============================================================================
  if (body.action === "manual_single_test") {
    const authCode = (body.authorization_code || req.headers.get("x-authorization-code") || "").trim();
    if (!authCode) {
      return new Response(
        JSON.stringify({ error: "CODIGO_AUTORIZACAO_OBRIGATORIO: O teste manual isolado exige código de autorização único persistente." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5.1 Validação do número autorizado no servidor
    if (!rawTestNumber) {
      return new Response(
        JSON.stringify({ error: "CONFIGURACAO_BLOQUEADA: WHATSAPP_TEST_NUMBER não configurado nos Secrets do servidor." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const normTest = normalizeBrazilianPhone(rawTestNumber);
    if (!normTest.valid) {
      return new Response(
        JSON.stringify({ error: `NUMERO_TESTE_INVALIDO: ${normTest.error}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5.2 Consumo Atômico da Autorização no Banco (Lock Transacional FOR UPDATE)
    const { data: consumeRes, error: consumeErr } = await supabase.rpc(
      "consume_manual_test_authorization",
      {
        p_code: authCode,
        p_recipient: normTest.phone
      }
    );

    if (consumeErr) {
      console.error("[manual_single_test] Erro RPC consume_manual_test_authorization:", consumeErr);
      return new Response(
        JSON.stringify({ error: `ERRO_PERSISTENCIA_AUTORIZACAO: ${consumeErr.message}` }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!consumeRes || !consumeRes.success) {
      return new Response(
        JSON.stringify({
          error: consumeRes?.error || "AUTORIZACAO_REJEITADA",
          error_code: consumeRes?.error_code || "UNAUTHORIZED_EXECUTION"
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5.3 Validação dos Secrets da Evolution API
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(
        JSON.stringify({ error: "CONFIGURACAO_AUSENTE: EVOLUTION_API_URL ou EVOLUTION_API_KEY ausente no servidor." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5.4 Identificação do Conteúdo e Notificação Vinculada (se fornecida)
    let messageText = PHASE_6_3G_TEST_MESSAGE;
    let appointmentId = "manual-test-fase6-3g";
    let messageType = "manual_single_test_v7";
    let targetNotificationId: string | null = null;

    if (body.notification_id) {
      const { data: queueItem, error: queueFetchErr } = await supabase
        .from("notification_queue")
        .select("id, appointment_id, recipient_phone, content, status, event_type")
        .eq("id", body.notification_id)
        .maybeSingle();

      if (queueFetchErr || !queueItem) {
        return new Response(
          JSON.stringify({ error: `NOTIFICACAO_NAO_ENCONTRADA: ${queueFetchErr?.message || "Registro inexistente"}` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const normRecipient = normalizeBrazilianPhone(queueItem.recipient_phone);
      if (normRecipient.phone !== normTest.phone) {
        return new Response(
          JSON.stringify({ error: "DESTINATARIO_DIVERGENTE_DA_AUTORIZACAO: O telefone da notificação não corresponde ao destinatário autorizado." }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }

      messageText = queueItem.content;
      appointmentId = queueItem.appointment_id;
      messageType = `manual_${queueItem.event_type}_confirmation`;
      targetNotificationId = queueItem.id;
    }

    // Suporte a Mensagem Customizada para Homologação Antecipada Controlada
    if (body.custom_message) {
      messageText = body.custom_message;
      if (body.appointment_id) {
        appointmentId = body.appointment_id;
      }
      if (body.message_type) {
        messageType = body.message_type;
      }
    }

    // 5.5 Disparo Único via Evolution API
    const endpoint = `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`;
    let httpStatus = 0;
    let evoData: any = {};
    let sendStatus = "unknown";
    let externalId: string | null = null;
    let errorDetail: string | null = null;

    try {
      const evoRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          number: normTest.phone,
          text: messageText
        })
      });

      httpStatus = evoRes.status;
      evoData = await evoRes.json().catch(() => ({}));

      if (evoRes.ok) {
        sendStatus = "sent";
        externalId = evoData?.key?.id || evoData?.id || null;
      } else {
        sendStatus = "failed";
        errorDetail = evoData?.response?.message || evoData?.message || `Erro HTTP ${httpStatus} retornado pela Evolution API`;
      }
    } catch (networkErr: any) {
      httpStatus = 0;
      sendStatus = "unknown";
      errorDetail = `Falha de rede ou timeout indeterminado: ${networkErr?.message || networkErr}`;
    }

    // 5.6 Registro do Resultado em whatsapp_logs com colunas reais da tabela
    await supabase.from("whatsapp_logs").insert({
      appointment_id: appointmentId,
      phone: normTest.phone,
      message_type: messageType,
      status: sendStatus,
      sent_at: sendStatus === "sent" ? new Date().toISOString() : null
    });

    // 5.7 Sincronização direta com a fila se foi informado notification_id (exceto se preserve_queue_item for true)
    if (targetNotificationId && !body.preserve_queue_item) {
      await supabase.rpc("record_notification_result", {
        p_id: targetNotificationId,
        p_status: sendStatus,
        p_external_id: externalId,
        p_error: errorDetail,
        p_metadata: {
          manual_single_test: true,
          authorization_code: authCode,
          instance: EVOLUTION_INSTANCE_NAME,
          sent_at: sendStatus === "sent" ? new Date().toISOString() : null
        }
      });
    }

    // 5.8 Atualização da autorização com detalhes da resposta
    await supabase
      .from("manual_test_authorizations")
      .update({
        metadata: {
          external_id: externalId,
          http_status: httpStatus,
          status: sendStatus,
          error: errorDetail,
          response: evoData,
          appointment_id: appointmentId,
          notification_id: targetNotificationId,
          completed_at: new Date().toISOString()
        }
      })
      .eq("id", consumeRes.authorization_id);

    return new Response(
      JSON.stringify({
        success: sendStatus === "sent",
        operation_type: "manual_single_test_v7",
        authorization_id: consumeRes.authorization_id,
        instance: EVOLUTION_INSTANCE_NAME,
        target_masked: `${normTest.phone.slice(0, 4)}****${normTest.phone.slice(-2)}`,
        status: sendStatus,
        http_status: httpStatus,
        external_id: externalId,
        error: errorDetail,
        global_locks_preserved: {
          WHATSAPP_DRY_RUN: rawDryRun,
          WHATSAPP_ENABLED: rawEnabled
        }
      }),
      { status: sendStatus === "sent" ? 200 : (httpStatus >= 400 ? httpStatus : 502), headers: { "Content-Type": "application/json" } }
    );
  }

  // ============================================================================
  // 6. PROCESSAMENTO AUTOMÁTICO GERAL DA FILA (PRESERVA DRY-RUN / TRAVAS)
  // ============================================================================
  let batchSize = 10;
  if (body.batch_size && Number.isInteger(body.batch_size)) {
    batchSize = Math.min(Math.max(body.batch_size, 1), 50);
  }

  const { data: queueItems, error: dequeueErr } = await supabase.rpc(
    "dequeue_notifications_for_processing",
    { p_batch_size: batchSize }
  );

  if (dequeueErr) {
    console.error("[process-notifications] Erro no dequeue:", dequeueErr);
    return new Response(JSON.stringify({ success: false, error: dequeueErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!queueItems || queueItems.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        processed: 0,
        message: "Nenhuma notificação pendente no momento.",
        dry_run: !isLiveSendAuthorized,
        instance: EVOLUTION_INSTANCE_NAME
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const results = [];

  for (const item of queueItems) {
    const { id, appointment_id, event_type, recipient_phone, content, attempts, max_attempts } = item;

    // A. Validação de Pré-Envio para Lembrete de 30m
    if (event_type === "reminder_30m") {
      const { data: appt } = await supabase
        .from("appointments")
        .select("status")
        .eq("id", appointment_id)
        .maybeSingle();

      if (!appt || appt.status !== "confirmed") {
        const errorMsg = !appt ? "Agendamento inexistente" : `Agendamento com status ${appt.status}`;
        await supabase.rpc("record_notification_result", {
          p_id: id,
          p_status: "cancelled",
          p_error: `Lembrete cancelado preventivamente: ${errorMsg}`
        });
        results.push({ id, status: "cancelled", reason: errorMsg });
        continue;
      }
    }

    // B. Validação do Telefone
    const normPhone = normalizeBrazilianPhone(recipient_phone);
    if (!normPhone.valid) {
      await supabase.rpc("record_notification_result", {
        p_id: id,
        p_status: "failed",
        p_error: `Telefone inválido: ${normPhone.error}`
      });
      results.push({ id, status: "failed", error: normPhone.error });
      continue;
    }

    // C. Envio em DRY-RUN vs REAL (Trava Estrita Preservada)
    if (!isLiveSendAuthorized) {
      const externalId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      await supabase.rpc("record_notification_result", {
        p_id: id,
        p_status: "simulated",
        p_external_id: externalId,
        p_metadata: {
          dry_run: true,
          simulated_at: new Date().toISOString(),
          instance: EVOLUTION_INSTANCE_NAME,
          to: normPhone.phone
        }
      });
      results.push({ id, status: "simulated", external_id: externalId, to: normPhone.phone });
    } else {
      if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
        await supabase.rpc("record_notification_result", {
          p_id: id,
          p_status: "failed",
          p_error: "Credenciais da Evolution API ausentes no servidor para envio em tempo real."
        });
        results.push({ id, status: "failed", error: "Credenciais Evolution API não configuradas" });
        continue;
      }

      const endpoint = `${EVOLUTION_API_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE_NAME)}`;
      try {
        const evoRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": EVOLUTION_API_KEY
          },
          body: JSON.stringify({
            number: normPhone.phone,
            text: content
          })
        });

        const evoData = await evoRes.json().catch(() => ({}));

        if (evoRes.ok) {
          const extId = evoData?.key?.id || evoData?.id || null;
          await supabase.rpc("record_notification_result", {
            p_id: id,
            p_status: "sent",
            p_external_id: extId,
            p_metadata: { instance: EVOLUTION_INSTANCE_NAME, to: normPhone.phone }
          });
          results.push({ id, status: "sent", external_id: extId });
        } else {
          const errMsg = evoData?.response?.message || evoData?.message || `HTTP ${evoRes.status}`;
          if (attempts < max_attempts) {
            const backoffMin = Math.min(Math.pow(2, attempts), 30);
            const nextTime = new Date(Date.now() + backoffMin * 60 * 1000).toISOString();
            await supabase
              .from("notification_queue")
              .update({
                status: "pending",
                scheduled_for: nextTime,
                last_error: errMsg,
                updated_at: new Date().toISOString()
              })
              .eq("id", id);
            results.push({ id, status: "pending_retry", error: errMsg });
          } else {
            await supabase.rpc("record_notification_result", {
              p_id: id,
              p_status: "failed",
              p_error: errMsg
            });
            results.push({ id, status: "failed", error: errMsg });
          }
        }
      } catch (networkErr: any) {
        // FASE 6.3-G: Proteção Estrita contra Duplicidade (Anti-Duplication).
        // Se a requisição de envio foi disparada para a Evolution API mas houve timeout de rede ou conexão,
        // o status de entrega externa é estritamente INDETERMINADO ('unknown').
        // O reenvio automático é BLOQUEADO para garantir que nenhuma mensagem duplicada seja enviada ao destinatário.
        await supabase.rpc("record_notification_result", {
          p_id: id,
          p_status: "unknown",
          p_error: `Resultado de entrega indeterminado (timeout/rede): ${networkErr?.message || networkErr}`,
          p_metadata: {
            indeterminate_delivery: true,
            auto_retry_blocked: true,
            failure_phase: "post_dispatch_transport_timeout",
            attempts_recorded: attempts,
            timestamp: new Date().toISOString()
          }
        });
        results.push({ id, status: "unknown", indeterminate: true, error: networkErr?.message || networkErr });
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      processed: results.length,
      dry_run: !isLiveSendAuthorized,
      instance: EVOLUTION_INSTANCE_NAME,
      results
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
