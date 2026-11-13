// ==============================================================================
// PROJETO: CLUB 01 BARBER STUDIO
// FASE 6.3-C5: EDGE FUNCTION TEMPORÁRIA — LEITURA SEGURA DE INSTÂNCIAS EVOLUTION
// Arquivo: supabase/functions/inspect-evolution-instances/index.ts
// ==============================================================================
// Finalidade exclusiva:
// Consultar GET /instance/fetchInstances na Evolution API via runtime seguro.
// Exige autenticação estrita de service_role (JWT assinado com role=service_role).
// Não executa escritas, não envia mensagens, não altera banco ou webhooks.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Utilitário para decodificar e validar payload JWT no Deno sem dependências externas
function parseAndValidateJwtClaims(token: string): { valid: boolean; role?: string; error?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "TOKEN_AUSENTE" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "ESTRUTURA_JWT_INVALIDA" };
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const claims = JSON.parse(jsonStr);

    // Validação de emissor
    if (claims.iss && claims.iss !== "supabase") {
      return { valid: false, error: "EMISSOR_INVALIDO" };
    }

    // Validação de expiração temporal
    if (claims.exp && typeof claims.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (now > claims.exp) {
        return { valid: false, error: "TOKEN_EXPIRADO" };
      }
    }

    // Validação restrita da role administrativa
    if (claims.role !== "service_role") {
      return { valid: false, error: "ROLE_NAO_AUTORIZADA: Exige role service_role" };
    }

    return { valid: true, role: claims.role };
  } catch {
    return { valid: false, error: "DECODIFICACAO_JWT_FALHOU" };
  }
}

Deno.serve(async (req: Request) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
      }
    });
  }

  // 1. Restrição estrita de método HTTP: Aceita exclusivamente GET
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: "METODO_NAO_PERMITIDO: Esta funcao aceita exclusivamente o metodo GET."
      }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2. Autenticação Administrativa Severa
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return new Response(
      JSON.stringify({
        error: "NAO_AUTORIZADO: Cabecalho Authorization com Bearer JWT obrigatorio."
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const validation = parseAndValidateJwtClaims(token);

  if (!validation.valid || validation.role !== "service_role") {
    return new Response(
      JSON.stringify({
        error: `ACESSO_NEGADO: Autenticacao administrativa invalida (${validation.error}).`
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Obtenção de Secrets do Ambiente Seguro do Deno
  const EVOLUTION_API_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "CONFIGURACAO_AUSENTE: Secrets EVOLUTION_API_URL ou EVOLUTION_API_KEY ausentes no runtime."
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // 4. Execução Controlada de Leitura à Evolution API (Timeout de 15 segundos)
  const targetEndpoint = `${EVOLUTION_API_URL}/instance/fetchInstances`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let httpStatus = 0;
  let rawData: any = null;

  try {
    const evoRes = await fetch(targetEndpoint, {
      method: "GET",
      headers: {
        "apikey": EVOLUTION_API_KEY,
        "Accept": "application/json"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    httpStatus = evoRes.status;
    rawData = await evoRes.json().catch(() => null);

    if (!evoRes.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          http_status: httpStatus,
          error_type: "EVOLUTION_API_ERROR_RESPONSE",
          description: `A Evolution API retornou status HTTP ${httpStatus}.`
        }),
        { status: httpStatus, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === "AbortError";
    return new Response(
      JSON.stringify({
        success: false,
        http_status: 0,
        error_type: isTimeout ? "TIMEOUT_15S_EXCEDIDO" : "FALHA_CONEXAO_REDE",
        description: isTimeout
          ? "A consulta excedeu o tempo limite maximo de 15 segundos."
          : `Falha de comunicacao com a Evolution API: ${err?.message || "erro desconhecido"}`
      }),
      { status: 504, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5. Sanitização Rigorosa dos Resultados
  let instancesArray: any[] = [];
  if (Array.isArray(rawData)) {
    instancesArray = rawData;
  } else if (rawData && typeof rawData === "object") {
    if (Array.isArray(rawData.instances)) {
      instancesArray = rawData.instances;
    } else if (rawData.instance) {
      instancesArray = [rawData.instance];
    } else {
      instancesArray = [rawData];
    }
  }

  const sanitizedInstances = instancesArray.map((inst: any) => {
    const technicalName =
      inst.name ||
      inst.instanceName ||
      inst.instance?.instanceName ||
      inst.instance?.name ||
      null;

    const internalId =
      inst.id ||
      inst.instanceId ||
      inst.instance?.instanceId ||
      inst.instance?.id ||
      null;

    const connectionStatus =
      inst.connectionStatus ||
      inst.status ||
      inst.instance?.status ||
      inst.instance?.state ||
      inst.state ||
      "unknown";

    return {
      technical_name: technicalName,
      internal_id: internalId,
      connection_status: connectionStatus,
      matches_candidate_MeuBolso_digital: technicalName === "MeuBolso digital",
      matches_previous_Meu_Bolso_Digital: technicalName === "Meu Bolso Digital",
      matches_slug_meubolsodigital: technicalName === "meubolsodigital",
      matches_slug_meu_bolso_digital: technicalName === "meu-bolso-digital"
    };
  });

  return new Response(
    JSON.stringify({
      success: true,
      operation: "inspect-evolution-instances",
      http_status: httpStatus,
      total_instances_found: sanitizedInstances.length,
      instances: sanitizedInstances
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
