import { describe, it, expect } from "vitest"
import {
  DEFAULT_BOOKING_URL,
  DEFAULT_SHOP_NAME,
  normalizeEvolutionEvent,
  timingSafeEqual,
  parseEvolutionWebhook,
  resolveOfficialShopName,
  buildGeminiRequest,
  ensureBookingUrlInReply,
  buildFallbackMessage
} from "../supabase/functions/whatsapp-ai-webhook/helpers.ts"

describe("Agente de IA WhatsApp — Parser Evolution API & Filtros", () => {
  it("normaliza eventos MESSAGES_UPSERT em diferentes formatos da Evolution API", () => {
    expect(normalizeEvolutionEvent("messages.upsert")).toBe("MESSAGES_UPSERT")
    expect(normalizeEvolutionEvent("MESSAGES_UPSERT")).toBe("MESSAGES_UPSERT")
    expect(normalizeEvolutionEvent("connection.update")).toBe("CONNECTION_UPDATE")
  })

  it("valida segredos em tempo constante com timingSafeEqual", () => {
    expect(timingSafeEqual("segredo-123", "segredo-123")).toBe(true)
    expect(timingSafeEqual("segredo-123", "segredo-124")).toBe(false)
    expect(timingSafeEqual("segredo-123", "curto")).toBe(false)
    expect(timingSafeEqual("", "")).toBe(false)
  })

  it("aceita mensagem de texto simples em conversa privada (@s.whatsapp.net)", () => {
    const parsed = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "5534991234567@s.whatsapp.net",
          fromMe: false,
          id: "MSG-TEXT-001"
        },
        pushName: "João Silva",
        messageType: "conversation",
        message: {
          conversation: "Oi, quero agendar um corte!"
        }
      }
    })

    expect(parsed.validEvent).toBe(true)
    expect(parsed.isPrivateChat).toBe(true)
    expect(parsed.fromMe).toBe(false)
    expect(parsed.phone).toBe("5534991234567")
    expect(parsed.replyTarget).toBe("5534991234567")
    expect(parsed.kind).toBe("text")
    expect(parsed.incomingText).toBe("Oi, quero agendar um corte!")
    expect(parsed.customerName).toBe("João Silva")
  })

  it("aceita extendedTextMessage e mensagens efêmeras (ephemeralMessage)", () => {
    const parsed = parseEvolutionWebhook({
      event: "MESSAGES_UPSERT",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "5534991234567@s.whatsapp.net",
          fromMe: false,
          id: "MSG-EXT-002"
        },
        message: {
          ephemeralMessage: {
            message: {
              extendedTextMessage: {
                text: "Qual o horário de sábado?"
              }
            }
          }
        }
      }
    })

    expect(parsed.kind).toBe("text")
    expect(parsed.incomingText).toBe("Qual o horário de sábado?")
  })

  it("aceita mensagem de áudio sem transcrição (kind = audio)", () => {
    const parsed = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "5534991234567@s.whatsapp.net",
          fromMe: false,
          id: "MSG-AUDIO-003"
        },
        pushName: "Carlos",
        messageType: "audioMessage",
        message: {
          audioMessage: {
            mimetype: "audio/ogg; codecs=opus",
            seconds: 8,
            ptt: true
          }
        }
      }
    })

    expect(parsed.isPrivateChat).toBe(true)
    expect(parsed.kind).toBe("audio")
    expect(parsed.incomingText).toBe("[Mensagem de áudio]")
  })

  it("ignora imagens, vídeos, figurinhas, documentos, reações e mensagens de protocolo", () => {
    const mediaCases = [
      { imageMessage: { caption: "olha esse corte" } },
      { videoMessage: { caption: "video" } },
      { stickerMessage: { isAnimated: false } },
      { documentMessage: { fileName: "doc.pdf" } },
      { reactionMessage: { text: "👍" } },
      { protocolMessage: { type: 0 } },
      { contactMessage: { displayName: "Contato" } },
      { locationMessage: { degreesLatitude: -18.6 } }
    ]

    for (const msg of mediaCases) {
      const parsed = parseEvolutionWebhook({
        event: "messages.upsert",
        instance: "Barbearia CLUB01",
        data: {
          key: {
            remoteJid: "5534991234567@s.whatsapp.net",
            fromMe: false,
            id: "MSG-IGNORED"
          },
          message: msg
        }
      })

      expect(parsed.kind).toBe("ignored")
      expect(parsed.ignoreReason).toBe("ignored_message_type")
    }
  })

  it("ignora grupos (@g.us), status (@broadcast) e canais (@newsletter)", () => {
    const jids = [
      "120363042123456789@g.us",
      "status@broadcast",
      "123456789@newsletter"
    ]

    for (const remoteJid of jids) {
      const parsed = parseEvolutionWebhook({
        event: "messages.upsert",
        instance: "Barbearia CLUB01",
        data: {
          key: { remoteJid, fromMe: false, id: "MSG-CHAT-IGNORED" },
          message: { conversation: "Oi pessoal" }
        }
      })

      expect(parsed.isPrivateChat).toBe(false)
      expect(parsed.phone).toBeNull()
    }
  })

  it("suporta contatos @lid usando remoteJidAlt quando disponível", () => {
    const parsedWithAlt = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "24891234567890@lid",
          remoteJidAlt: "5534998765432@s.whatsapp.net",
          fromMe: false,
          id: "MSG-LID-1"
        },
        message: { conversation: "Boa tarde" }
      }
    })

    expect(parsedWithAlt.isPrivateChat).toBe(true)
    expect(parsedWithAlt.phone).toBe("5534998765432")
    expect(parsedWithAlt.replyTarget).toBe("5534998765432")

    const parsedOnlyLid = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "24891234567890@lid",
          fromMe: false,
          id: "MSG-LID-2"
        },
        message: { conversation: "Boa tarde" }
      }
    })

    expect(parsedOnlyLid.isPrivateChat).toBe(true)
    expect(parsedOnlyLid.phone).toBe("lid:24891234567890")
    expect(parsedOnlyLid.replyTarget).toBe("24891234567890@lid")
  })

  it("identifica mensagens enviadas pela barbearia (fromMe = true)", () => {
    const parsed = parseEvolutionWebhook({
      event: "messages.upsert",
      instance: "Barbearia CLUB01",
      data: {
        key: {
          remoteJid: "5534991234567@s.whatsapp.net",
          fromMe: true,
          id: "MSG-HUMAN-01"
        },
        message: { conversation: "Pode vir às 15h!" }
      }
    })

    expect(parsed.fromMe).toBe(true)
    expect(parsed.isPrivateChat).toBe(true)
    expect(parsed.phone).toBe("5534991234567")
  })
})

describe("Agente de IA WhatsApp — Prompt Gemini, Marca & Garantia de Link", () => {
  it("corrige o typo legado CLUB01 Baber Studio para CLUB 01 Barber Studio", () => {
    expect(resolveOfficialShopName("CLUB01 Baber Studio")).toBe(DEFAULT_SHOP_NAME)
    expect(resolveOfficialShopName("")).toBe(DEFAULT_SHOP_NAME)
    expect(resolveOfficialShopName("CLUB 01 Barber Studio")).toBe("CLUB 01 Barber Studio")
  })

  it("garante que o link oficial sempre apareça na resposta mesmo se a IA omitir", () => {
    const replyWithoutLink = "Olá! Seja muito bem-vindo à CLUB 01 Barber Studio!"
    const secured = ensureBookingUrlInReply(replyWithoutLink, DEFAULT_BOOKING_URL)
    expect(secured).toContain(DEFAULT_BOOKING_URL)

    const replyWithLink = `Olá! Agende em ${DEFAULT_BOOKING_URL} 💈`
    expect(ensureBookingUrlInReply(replyWithLink, DEFAULT_BOOKING_URL)).toBe(replyWithLink)
  })

  it("monta fallback sempre contendo o link oficial", () => {
    const fallback = buildFallbackMessage("Bem-vindo! Acesse {{booking_url}}", DEFAULT_BOOKING_URL)
    expect(fallback).toContain(DEFAULT_BOOKING_URL)
    expect(fallback).not.toContain("{{booking_url}}")

    const emptyFallback = buildFallbackMessage("", DEFAULT_BOOKING_URL)
    expect(emptyFallback).toContain(DEFAULT_SHOP_NAME)
    expect(emptyFallback).toContain(DEFAULT_BOOKING_URL)
  })

  it("monta requisição Gemini com instrução adequada para texto e áudio", () => {
    const reqText = buildGeminiRequest({
      systemPrompt: "Prompt base",
      bookingUrl: DEFAULT_BOOKING_URL,
      shopName: "CLUB01 Baber Studio",
      shopAddress: "Rua Hermogênio Dorázio, 60",
      shopOpenHours: "Seg - Sex: 09:00 - 20:00",
      customerName: "Lucas",
      messageKind: "text",
      incomingText: "Vocês atendem hoje?"
    })

    expect(reqText.system_instruction.parts[0].text).toContain("CLUB 01 Barber Studio")
    expect(reqText.system_instruction.parts[0].text).toContain(DEFAULT_BOOKING_URL)
    expect(reqText.contents[0].parts[0].text).toContain("Vocês atendem hoje?")

    const reqAudio = buildGeminiRequest({
      systemPrompt: "Prompt base",
      bookingUrl: DEFAULT_BOOKING_URL,
      messageKind: "audio",
      customerName: "Lucas"
    })

    expect(reqAudio.contents[0].parts[0].text).toContain("mensagem de áudio")
    expect(reqAudio.contents[0].parts[0].text).toContain(DEFAULT_BOOKING_URL)
  })
})

