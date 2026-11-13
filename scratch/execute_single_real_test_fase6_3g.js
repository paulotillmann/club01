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

async function executePhase63GRealTest() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-G: PRIMEIRO ENVIO REAL CONTROLADO WHATSAPP ===");
  console.log("=========================================================================\n");

  // 1. Verificações Prévias Obrigatórias
  console.log("1. Pré-checagens de Segurança no Supabase DEV...");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const dryRunSec = secretsRes.data.find(s => s.name === 'WHATSAPP_DRY_RUN');
  const enabledSec = secretsRes.data.find(s => s.name === 'WHATSAPP_ENABLED');
  const instanceSec = secretsRes.data.find(s => s.name === 'EVOLUTION_INSTANCE_NAME');
  const testNumSec = secretsRes.data.find(s => s.name === 'WHATSAPP_TEST_NUMBER');

  console.log("   - WHATSAPP_DRY_RUN:", dryRunSec?.value);
  console.log("   - WHATSAPP_ENABLED:", enabledSec?.value);
  console.log("   - EVOLUTION_INSTANCE_NAME:", instanceSec?.value);
  console.log("   - WHATSAPP_TEST_NUMBER:", testNumSec?.value);

  const jobsCheck = await runSql(`SELECT jobid, jobname, active FROM cron.job;`);
  console.log("   - Jobs ativos em cron.job:", jobsCheck?.length || 0);
  if (jobsCheck && jobsCheck.length > 0) {
    throw new Error("ABORTANDO: Existem jobs ativos em cron.job!");
  }

  const queueCheck = await runSql(`SELECT count(*) FROM public.notification_queue WHERE status = 'pending';`);
  console.log("   - Notificações pendentes na fila:", queueCheck[0]?.count || 0);

  // 2. Obter Service Role Key
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.data.find(k => k.name === 'service_role key' || k.name === 'service_role');
  if (!serviceKeyObj) {
    throw new Error("Chave service_role não encontrada");
  }
  const serviceKey = serviceKeyObj.api_key;

  // 3. Gerar código de autorização único persistente
  const authCode = `AUTH-F63G-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  console.log(`\n2. Código de Autorização Única Gerado: ${authCode}`);

  // 4. Inserir autorização atômica na tabela manual_test_authorizations
  const insertSql = `
    INSERT INTO public.manual_test_authorizations (
      authorization_code,
      target_recipient,
      status,
      metadata
    ) VALUES (
      '${authCode}',
      '5534988322462',
      'authorized',
      jsonb_build_object(
        'operator_confirmed', true,
        'fase', '6.3-G',
        'authorized_at', timezone('utc', now()),
        'target_recipient', '5534988322462',
        'message_preview', 'CLUB 01 BARBER STUDIO\\n\\nTeste técnico de integração WhatsApp.'
      )
    ) RETURNING id, authorization_code, target_recipient, status, created_at;
  `;
  const insertRes = await runSql(insertSql);
  console.log("3. Autorização persistida no banco DEV:", JSON.stringify(insertRes, null, 2));

  // 5. Invocação Controlada da Edge Function V7 (EXATAMENTE UMA TENTATIVA)
  console.log("\n4. Disparando UMA ÚNICA chamada de teste real à Edge Function V7...");
  const edgeUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;

  const payload = {
    action: "manual_single_test",
    authorization_code: authCode,
    confirmed_by_operator: true
  };

  const startTime = Date.now();
  const testResponse = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  const duration = Date.now() - startTime;

  console.log(`\n5. RESPOSTA DA EDGE FUNCTION (Duração: ${duration}ms):`);
  console.log(`Status HTTP: ${testResponse.status}`);
  console.log("Corpo da Resposta:", JSON.stringify(testResponse.data, null, 2));

  // 6. Teste de Proteção Contra Duplicidade (Segunda Chamada Imediata com o Mesmo Código)
  console.log("\n6. TESTE DE PROTEÇÃO CONTRA DUPLICIDADE (Reutilização com o Mesmo Código)...");
  const secondAttempt = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  console.log(`Status HTTP da 2ª tentativa: ${secondAttempt.status}`);
  console.log("Resposta da 2ª tentativa:", JSON.stringify(secondAttempt.data, null, 2));

  // 7. Auditoria Pós-Envio em whatsapp_logs e manual_test_authorizations
  console.log("\n7. AUDITORIA EM WHATSAPP_LOGS E MANUAL_TEST_AUTHORIZATIONS:");
  const logAudit = await runSql(`
    SELECT 
      id,
      appointment_id,
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

  // 8. Confirmação das Travas Globais Pós-Envio
  console.log("\n8. VERIFICAÇÃO FINAL DAS TRAVAS GLOBAIS:");
  const postSecretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const postDryRun = postSecretsRes.data.find(s => s.name === 'WHATSAPP_DRY_RUN');
  const postEnabled = postSecretsRes.data.find(s => s.name === 'WHATSAPP_ENABLED');
  console.log("   - WHATSAPP_DRY_RUN pós-teste:", postDryRun?.value);
  console.log("   - WHATSAPP_ENABLED pós-teste:", postEnabled?.value);
}

executePhase63GRealTest().catch(console.error);
