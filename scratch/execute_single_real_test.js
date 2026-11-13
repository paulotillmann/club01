/* global Buffer */
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

async function apiRequest(apiPath, method = 'GET', bodyData = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = bodyData ? JSON.stringify(bodyData) : null;
    const defaultHeaders = {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      defaultHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: 'api.supabase.com',
      path: apiPath,
      method,
      headers: defaultHeaders
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSql(query) {
  const res = await apiRequest(`/v1/projects/${PROJECT_REF}/database/query`, 'POST', { query });
  return res.data;
}

async function invokeEdgeFunction(functionUrl, serviceKey, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const url = new URL(functionUrl);

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + serviceKey,
        'x-cron-secret': cronSecret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function executeSingleTest() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-C6: HOMOLOGAÇÃO DE ENVIO ÚNICO REAL ===");
  console.log("=== MODO: ALTERNATIVA B (Mensagem padronizada V6 autorizada) ===");
  console.log("=========================================================================\n");

  // 1. Obter Service Key
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.data.find(k => k.name === 'service_role key' || k.name === 'service_role');
  if (!serviceKeyObj) {
    throw new Error("Chave service_role não encontrada");
  }
  const serviceKey = serviceKeyObj.api_key;

  // 2. Gerar código de autorização único persistente
  const authCode = `AUTH-F63C6-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  console.log(`1. Código de Autorização Única Gerado: ${authCode}`);

  // 3. Inserir autorização atômica na tabela manual_test_authorizations
  const insertSql = `
    INSERT INTO public.manual_test_authorizations (
      authorization_code,
      target_recipient,
      status,
      metadata
    ) VALUES (
      '${authCode}',
      'WHATSAPP_TEST_NUMBER',
      'authorized',
      jsonb_build_object(
        'operator_confirmed', true,
        'fase', '6.3-C6',
        'alternativa', 'B',
        'created_by', 'single_real_test_runner_c6',
        'timestamp', timezone('utc', now())
      )
    ) RETURNING id, authorization_code, status, created_at;
  `;
  const insertRes = await runSql(insertSql);
  console.log("2. Autorização persistida no banco DEV:", JSON.stringify(insertRes, null, 2));

  // 4. Invocação Controlada da Edge Function V6 (EXATAMENTE UMA TENTATIVA)
  console.log("\n3. Disparando UMA ÚNICA chamada de teste real à Edge Function V6...");
  const edgeUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;
  
  const payload = {
    action: "manual_single_test",
    authorization_code: authCode,
    confirmed_by_operator: true
  };

  const startTime = Date.now();
  const testResponse = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  const duration = Date.now() - startTime;

  console.log(`\n4. RESPOSTA DA EDGE FUNCTION (Duração: ${duration}ms):`);
  console.log(`Status HTTP: ${testResponse.status}`);
  console.log("Corpo da Resposta:", JSON.stringify(testResponse.data, null, 2));

  // 5. Teste de Proteção Contra Duplicidade (Segunda Chamada com o Mesmo Código)
  console.log("\n5. TESTE DE PROTEÇÃO CONTRA DUPLICIDADE (Segunda Chamada com o Mesmo Código)...");
  const secondAttempt = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  console.log(`Status HTTP da 2ª tentativa: ${secondAttempt.status}`);
  console.log("Resposta da 2ª tentativa:", JSON.stringify(secondAttempt.data, null, 2));

  // 6. Auditoria Pós-Envio em whatsapp_logs e manual_test_authorizations
  console.log("\n6. AUDITORIA EM WHATSAPP_LOGS E MANUAL_TEST_AUTHORIZATIONS:");
  const logAudit = await runSql(`
    SELECT 
      id,
      phone,
      status,
      message_type,
      sent_at,
      created_at
    FROM public.whatsapp_logs 
    ORDER BY created_at DESC 
    LIMIT 2;
  `);
  console.log("Logs registrados em whatsapp_logs:", JSON.stringify(logAudit, null, 2));

  const authAudit = await runSql(`
    SELECT 
      id,
      authorization_code,
      target_recipient,
      status,
      consumed_at,
      metadata
    FROM public.manual_test_authorizations 
    WHERE authorization_code = '${authCode}';
  `);
  console.log("Estado final da autorização em manual_test_authorizations:", JSON.stringify(authAudit, null, 2));
}

executeSingleTest().catch(console.error);
