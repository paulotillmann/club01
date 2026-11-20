// ==============================================================================
// PROJETO: CLUB 01 BARBER STUDIO
// AGENTE DE IA WHATSAPP — HELPERS PUROS (PARSER EVOLUTION API + GEMINI)
// Arquivo: supabase/functions/whatsapp-ai-webhook/helpers.ts
// ==============================================================================

export interface ParsedEvolutionEvent {
  validEvent: boolean;
  eventName: string;
  instance: string | null;
  messageId: string | null;
  fromMe: boolean;
  isPrivateChat: boolean;
  ignoreReason: string | null;
  remoteJid: string | null;
  phone: string | null;
  replyTarget: string | null;
  customerName: string | null;
  kind: "text" | "audio" | "ignored";
  rawMessageType: string | null;
  incomingText: string | null;
}

export interface GeminiPromptParams {
  systemPrompt: string;
  bookingUrl: string;
  shopName?: string | null;
  shopAddress?: string | null;
  shopOpenHours?: string | null;
  customerName?: string | null;
  messageKind: "text" | "audio";
  incomingText?: string | null;
  thinkingLevel?: "minimal" | "low";
}

export const DEFAULT_BOOKING_URL = "https://club01.paulo-tech-nocode.workers.dev";
export const DEFAULT_SHOP_NAME = "CLUB 01 Barber Studio";

/**
 * Normaliza nome de evento da Evolution API (v2.0/v2.1/v2.2/v2.3).
 * Ex: "messages.upsert" -> "MESSAGES_UPSERT"
 */
export function normalizeEvolutionEvent(rawEvent: unknown): string {
  if (typeof rawEvent !== "string") return "";
  return rawEvent.trim().toUpperCase().replace(/[.-]+/g, "_");
}

/**
 * Comparação em tempo constante para segredos de webhook.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
}

/**
 * Desembrulha mensagens encapsuladas pelo WhatsApp/Baileys
 * (ephemeralMessage, viewOnceMessage, viewOnceMessageV2, documentWithCaptionMessage, editedMessage).
 */
export function unwrapWhatsAppMessage(message: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!message || typeof message !== "object") return null;

  let current: Record<string, any> = message;
  for (let depth = 0; depth < 5; depth++) {
    if (current.ephemeralMessage?.message && typeof current.ephemeralMessage.message === "object") {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.viewOnceMessage?.message && typeof current.viewOnceMessage.message === "object") {
      current = current.viewOnceMessage.message;
      continue;
    }
    if (current.viewOnceMessageV2?.message && typeof current.viewOnceMessageV2.message === "object") {
      current = current.viewOnceMessageV2.message;
      continue;
    }
    if (current.viewOnceMessageV2Extension?.message && typeof current.viewOnceMessageV2Extension.message === "object") {
      current = current.viewOnceMessageV2Extension.message;
      continue;
    }
    if (current.editedMessage?.message && typeof current.editedMessage.message === "object") {
      current = current.editedMessage.message;
      continue;
    }
    break;
  }

  return current;
}

/**
 * Extrai telefone normalizado e destino de resposta a partir do remoteJid / remoteJidAlt.
 */
export function extractContactIdentifiers(key: Record<string, any> | null | undefined): {
  isPrivateChat: boolean;
  ignoreReason: string | null;
  remoteJid: string | null;
  phone: string | null;
  replyTarget: string | null;
} {
  const rawJid = typeof key?.remoteJid === "string" ? key.remoteJid.trim() : "";
  const rawAlt = typeof key?.remoteJidAlt === "string" ? key.remoteJidAlt.trim() : "";

  if (!rawJid) {
    return {
      isPrivateChat: false,
      ignoreReason: "missing_remote_jid",
      remoteJid: null,
      phone: null,
      replyTarget: null
    };
  }

  const lowerJid = rawJid.toLowerCase();

  if (lowerJid.endsWith("@g.us")) {
    return {
      isPrivateChat: false,
      ignoreReason: "group_chat",
      remoteJid: rawJid,
      phone: null,
      replyTarget: null
    };
  }

  if (lowerJid === "status@broadcast" || lowerJid.endsWith("@broadcast")) {
    return {
      isPrivateChat: false,
      ignoreReason: "broadcast_or_status",
      remoteJid: rawJid,
      phone: null,
      replyTarget: null
    };
  }

  if (lowerJid.endsWith("@newsletter")) {
    return {
      isPrivateChat: false,
      ignoreReason: "newsletter_channel",
      remoteJid: rawJid,
      phone: null,
      replyTarget: null
    };
  }

  // Se for @s.whatsapp.net ou @c.us, extraímos os dígitos do número
  if (lowerJid.endsWith("@s.whatsapp.net") || lowerJid.endsWith("@c.us")) {
    const digits = rawJid.split("@")[0].split(":")[0].replace(/\D/g, "");
    if (!digits) {
      return {
        isPrivateChat: false,
        ignoreReason: "invalid_phone_jid",
        remoteJid: rawJid,
        phone: null,
        replyTarget: null
      };
    }
    return {
      isPrivateChat: true,
      ignoreReason: null,
      remoteJid: rawJid,
      phone: digits,
      replyTarget: digits
    };
  }

  // Suporte a contas LID (@lid) do WhatsApp moderno: usa remoteJidAlt se disponível
  if (lowerJid.endsWith("@lid")) {
    if (rawAlt && (rawAlt.toLowerCase().endsWith("@s.whatsapp.net") || rawAlt.toLowerCase().endsWith("@c.us"))) {
      const altDigits = rawAlt.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (altDigits) {
        return {
          isPrivateChat: true,
          ignoreReason: null,
          remoteJid: rawAlt,
          phone: altDigits,
          replyTarget: altDigits
        };
      }
    }
    const lidCore = rawJid.split("@")[0].split(":")[0].trim();
    if (!lidCore) {
      return {
        isPrivateChat: false,
        ignoreReason: "invalid_lid_jid",
        remoteJid: rawJid,
        phone: null,
        replyTarget: null
      };
    }
    return {
      isPrivateChat: true,
      ignoreReason: null,
      remoteJid: rawJid,
      phone: `lid:${lidCore}`,
      replyTarget: rawJid
    };
  }

  return {
    isPrivateChat: false,
    ignoreReason: "unsupported_jid_type",
    remoteJid: rawJid,
    phone: null,
    replyTarget: null
  };
}

/**
 * Classifica estritamente a mensagem: aceita SOMENTE texto e áudio.
 * Ignora imagens, vídeos, figurinhas, documentos, reações, protocolo, etc.
 */
export function classifyWhatsAppMessage(
  rawMessage: Record<string, any> | null | undefined,
  explicitMessageType?: string | null
): {
  kind: "text" | "audio" | "ignored";
  rawMessageType: string | null;
  incomingText: string | null;
} {
  const msg = unwrapWhatsAppMessage(rawMessage);

  // Sem objeto message: se explicitMessageType indicar áudio, trata; caso contrário ignora
  if (!msg) {
    if (explicitMessageType === "audioMessage") {
      return {
        kind: "audio",
        rawMessageType: "audioMessage",
        incomingText: "[Mensagem de áudio]"
      };
    }
    return {
      kind: "ignored",
      rawMessageType: explicitMessageType || "empty_message",
      incomingText: null
    };
  }

  // 1. Mensagens explicitamente ignoradas (protocolo, reações, mídias não suportadas)
  const ignoredKeys = [
    "protocolMessage",
    "reactionMessage",
    "senderKeyDistributionMessage",
    "imageMessage",
    "videoMessage",
    "stickerMessage",
    "documentMessage",
    "documentWithCaptionMessage",
    "contactMessage",
    "contactsArrayMessage",
    "locationMessage",
    "liveLocationMessage",
    "pollCreationMessage",
    "pollCreationMessageV2",
    "pollCreationMessageV3",
    "pollUpdateMessage",
    "ptvMessage",
    "orderMessage",
    "productMessage",
    "call",
    "bcallMessage"
  ];

  // Verifica primeiro texto puro (pode coexistir com messageContextInfo)
  if (typeof msg.conversation === "string" && msg.conversation.trim().length > 0) {
    return {
      kind: "text",
      rawMessageType: "conversation",
      incomingText: msg.conversation.trim().slice(0, 1000)
    };
  }

  if (
    msg.extendedTextMessage &&
    typeof msg.extendedTextMessage.text === "string" &&
    msg.extendedTextMessage.text.trim().length > 0
  ) {
    return {
      kind: "text",
      rawMessageType: "extendedTextMessage",
      incomingText: msg.extendedTextMessage.text.trim().slice(0, 1000)
    };
  }

  // Verifica áudio (sem transcrição)
  if (msg.audioMessage && typeof msg.audioMessage === "object") {
    return {
      kind: "audio",
      rawMessageType: "audioMessage",
      incomingText: "[Mensagem de áudio]"
    };
  }

  for (const key of ignoredKeys) {
    if (msg[key] !== undefined && msg[key] !== null) {
      return {
        kind: "ignored",
        rawMessageType: key,
        incomingText: null
      };
    }
  }

  const fallbackKey = Object.keys(msg).find((k) => k !== "messageContextInfo") || explicitMessageType || "unknown";
  return {
    kind: "ignored",
    rawMessageType: fallbackKey,
    incomingText: null
  };
}

/**
 * Faz o parse completo do payload de webhook da Evolution API v2.
 */
export function parseEvolutionWebhook(payload: Record<string, any> | null | undefined): ParsedEvolutionEvent {
  if (!payload || typeof payload !== "object") {
    return {
      validEvent: false,
      eventName: "",
      instance: null,
      messageId: null,
      fromMe: false,
      isPrivateChat: false,
      ignoreReason: "invalid_payload",
      remoteJid: null,
      phone: null,
      replyTarget: null,
      customerName: null,
      kind: "ignored",
      rawMessageType: null,
      incomingText: null
    };
  }

  const eventName = normalizeEvolutionEvent(payload.event);
  const instance = typeof payload.instance === "string" ? payload.instance.trim() : null;

  if (eventName !== "MESSAGES_UPSERT") {
    return {
      validEvent: false,
      eventName,
      instance,
      messageId: null,
      fromMe: false,
      isPrivateChat: false,
      ignoreReason: "not_messages_upsert",
      remoteJid: null,
      phone: null,
      replyTarget: null,
      customerName: null,
      kind: "ignored",
      rawMessageType: null,
      incomingText: null
    };
  }

  // Evolution API pode enviar data como objeto único ou array
  const rawData = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const key = rawData?.key || {};
  const fromMe = Boolean(key?.fromMe);
  const messageId = typeof key?.id === "string" && key.id.trim() ? key.id.trim() : null;
  const customerName = typeof rawData?.pushName === "string" && rawData.pushName.trim()
    ? rawData.pushName.trim().slice(0, 120)
    : null;

  const contact = extractContactIdentifiers(key);
  if (!contact.isPrivateChat) {
    return {
      validEvent: true,
      eventName,
      instance,
      messageId,
      fromMe,
      isPrivateChat: false,
      ignoreReason: contact.ignoreReason,
      remoteJid: contact.remoteJid,
      phone: null,
      replyTarget: null,
      customerName,
      kind: "ignored",
      rawMessageType: null,
      incomingText: null
    };
  }

  const explicitType = typeof rawData?.messageType === "string" ? rawData.messageType : null;
  const classified = classifyWhatsAppMessage(rawData?.message, explicitType);

  return {
    validEvent: true,
    eventName,
    instance,
    messageId,
    fromMe,
    isPrivateChat: true,
    ignoreReason: classified.kind === "ignored" ? "ignored_message_type" : null,
    remoteJid: contact.remoteJid,
    phone: contact.phone,
    replyTarget: contact.replyTarget,
    customerName,
    kind: classified.kind,
    rawMessageType: classified.rawMessageType,
    incomingText: classified.incomingText
  };
}

/**
 * Normaliza o nome oficial da barbearia (corrige eventual typo legado no banco).
 */
export function resolveOfficialShopName(rawName?: string | null): string {
  const trimmed = (rawName || "").trim();
  if (!trimmed || /^club\s*0?1\s+baber\s+studio$/i.test(trimmed)) {
    return DEFAULT_SHOP_NAME;
  }
  return trimmed;
}

/**
 * Monta o payload REST para a API do Google Gemini (gemini-3.5-flash-lite / gemini-3.8-flash).
 */
export function buildGeminiRequest(params: GeminiPromptParams) {
  const bookingUrl = (params.bookingUrl || DEFAULT_BOOKING_URL).trim() || DEFAULT_BOOKING_URL;
  const shopName = resolveOfficialShopName(params.shopName);
  const shopAddress = (params.shopAddress || "").trim();
  const shopOpenHours = (params.shopOpenHours || "").trim();

  const contextLines = [
    `Nome oficial da barbearia: ${shopName}`,
    `Link oficial de agendamento (OBRIGATÓRIO incluir exatamente assim): ${bookingUrl}`
  ];

  if (shopOpenHours) {
    contextLines.push(`Horário de funcionamento (use APENAS se o cliente perguntar): ${shopOpenHours}`);
  }
  if (shopAddress) {
    contextLines.push(`Endereço (use APENAS se o cliente perguntar): ${shopAddress}`);
  }

  const fullSystemInstruction = [
    params.systemPrompt.trim(),
    "",
    "=== DADOS OFICIAIS DO ATENDIMENTO ===",
    ...contextLines,
    "",
    "=== FORMATAÇÃO ===",
    "- Escreva apenas a mensagem pronta para enviar no WhatsApp, sem aspas externas e sem explicações.",
    "- O link oficial DEVE aparecer completo e clicável na resposta."
  ].join("\n");

  const greetingSubject = params.customerName
    ? `Cliente (nome no WhatsApp: ${params.customerName})`
    : "Cliente";

  const userPrompt = params.messageKind === "audio"
    ? `${greetingSubject} acabou de enviar uma mensagem de áudio no WhatsApp (não transcrita). Dê boas-vindas à ${shopName}, reconheça educadamente que recebeu o áudio, informe que os agendamentos são feitos pelo link oficial (${bookingUrl}) e diga que se for alguma dúvida específica nossa equipe retornará em breve.`
    : `${greetingSubject} enviou a seguinte mensagem no WhatsApp:\n"""\n${(params.incomingText || "").trim()}\n"""\nResponda dando boas-vindas à ${shopName} de forma natural e acolhedora, informando o link oficial de agendamento (${bookingUrl}).`;

  return {
    system_instruction: {
      parts: [{ text: fullSystemInstruction }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature: 0.65,
      maxOutputTokens: 1024,
      thinkingConfig: {
        thinkingLevel: params.thinkingLevel || "minimal"
      }
    }
  };
}

/**
 * Garante que o link oficial de agendamento sempre esteja presente na resposta enviada.
 */
export function ensureBookingUrlInReply(replyText: string, bookingUrl: string): string {
  const safeUrl = (bookingUrl || DEFAULT_BOOKING_URL).trim() || DEFAULT_BOOKING_URL;
  let cleaned = (replyText || "").trim();

  // Remove cercas de código eventuais caso o modelo devolva markdown block
  cleaned = cleaned.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();

  if (!cleaned) {
    return "";
  }

  if (!cleaned.includes(safeUrl)) {
    cleaned = `${cleaned}\n\n🔗 Agende seu horário aqui:\n${safeUrl}`;
  }

  return cleaned;
}

/**
 * Monta a mensagem de fallback garantindo o link oficial.
 */
export function buildFallbackMessage(fallbackTemplate: string | null | undefined, bookingUrl: string): string {
  const safeUrl = (bookingUrl || DEFAULT_BOOKING_URL).trim() || DEFAULT_BOOKING_URL;
  const template = (fallbackTemplate || "").trim();

  if (!template) {
    return `Olá! 👋 Seja muito bem-vindo(a) à *${DEFAULT_SHOP_NAME}*! 💈\n\nPara agendar seu horário com praticidade, acesse nosso site oficial:\n${safeUrl}\n\nEsperamos você! ✂️`;
  }

  const withReplacement = template.replace(/\{\{\s*booking_url\s*\}\}/gi, safeUrl);
  return ensureBookingUrlInReply(withReplacement, safeUrl);
}

