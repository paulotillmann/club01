/* global Buffer */
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

const ORIGINAL_REMINDER_ID = 'd6a69bde-2639-4f77-9d3d-7893af98ea73';
const APPOINTMENT_ID = 'de910e34-66ad-4ba1-82be-04ec7a548f8a';
const TARGET_PHONE = '5534988322462';

const EARLY_REMINDER_MESSAGE = `Olá, CLIENTE TESTE CLUB 01! 💈

Passando para lembrar do seu agendamento no CLUB 01 Barber Studio!

✂️ Serviço: Corte Homologação
👤 Profissional: Barbeiro Homologação
📅 Data: 29/10/2026
🕒 Horário: 16:00

Esta é uma homologação antecipada do sistema de lembretes.
Esperamos por você!`;

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

async function executePhase63HEarlyReminderRealTest() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-H ETAPA 5: ENVIO REAL CONTROLADO DO LEMBRETE ===");
  console.log("=========================================================================\n");

  // 1. Pré-checagens de Segurança no Supabase DEV
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

  // 2. Verificar Lembrete Original na Fila (Deve estar pending e com scheduled_for futuro)
  const originalCheck = await runSql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, scheduled_for, status, idempotency_key
    FROM public.notification_queue
    WHERE id = '${ORIGINAL_REMINDER_ID}';
  `);
  console.log("   - Lembrete original verificado:", originalCheck);
  if (!originalCheck || originalCheck.length === 0 || originalCheck[0].status !== 'pending') {
    throw new Error("ABORTANDO: Lembrete original não está em status pending!");
  }

  // 3. Obter Service Role Key
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.data.find(k => k.name === 'service_role key' || k.name === 'service_role');
  if (!serviceKeyObj) {
    throw new Error("Chave service_role não encontrada");
  }
  const serviceKey = serviceKeyObj.api_key;

  // 4. Gerar código de autorização único persistente
  const authCode = `AUTH-F63H-REMINDER-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
  console.log(`\n2. Código de Autorização Única Gerado: ${authCode}`);

  // 5. Inserir autorização atômica na tabela manual_test_authorizations
  const insertSql = `
    INSERT INTO public.manual_test_authorizations (
      authorization_code,
      target_recipient,
      status,
      metadata
    ) VALUES (
      '${authCode}',
      '${TARGET_PHONE}',
      'authorized',
      jsonb_build_object(
        'operator_confirmed', true,
        'fase', '6.3-H-ETAPA-5',
        'authorized_at', timezone('utc', now()),
        'target_recipient', '${TARGET_PHONE}',
        'original_reminder_id', '${ORIGINAL_REMINDER_ID}',
        'appointment_id', '${APPOINTMENT_ID}',
        'test_type', 'early_reminder_homologation',
        'message_preview', 'Lembrete Antecipado Homologação'
      )
    ) RETURNING id, authorization_code, target_recipient, status, created_at;
  `;
  const insertRes = await runSql(insertSql);
  console.log("3. Autorização persistida no banco DEV:", JSON.stringify(insertRes, null, 2));

  // 6. Invocação Controlada da Edge Function V7 (EXATAMENTE UMA TENTATIVA)
  console.log("\n4. Disparando UMA ÚNICA chamada de envio real antecipado à Edge Function V7...");
  const edgeUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;

  const payload = {
    action: "manual_single_test",
    authorization_code: authCode,
    notification_id: ORIGINAL_REMINDER_ID,
    preserve_queue_item: true, // PRESERVA O REGISTRO ORIGINAL DA FILA INTACTO!
    custom_message: EARLY_REMINDER_MESSAGE,
    appointment_id: APPOINTMENT_ID,
    message_type: "reminder_early_homologation",
    confirmed_by_operator: true
  };

  const startTime = Date.now();
  const testResponse = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  const duration = Date.now() - startTime;

  console.log(`\n5. RESPOSTA DA EDGE FUNCTION (Duração: ${duration}ms):`);
  console.log(`Status HTTP: ${testResponse.status}`);
  console.log("Corpo da Resposta:", JSON.stringify(testResponse.data, null, 2));

  // 7. Teste de Proteção Contra Duplicidade (Segunda Chamada Imediata com o Mesmo Código)
  console.log("\n6. TESTE DE PROTEÇÃO CONTRA DUPLICIDADE (Reutilização com o Mesmo Código)...");
  const secondAttempt = await invokeEdgeFunction(edgeUrl, serviceKey, payload);
  console.log(`Status HTTP da 2ª tentativa: ${secondAttempt.status}`);
  console.log("Resposta da 2ª tentativa:", JSON.stringify(secondAttempt.data, null, 2));

  // 8. Auditoria Pós-Envio em notification_queue, whatsapp_logs e manual_test_authorizations
  console.log("\n7. AUDITORIA EM NOTIFICATION_QUEUE, WHATSAPP_LOGS E MANUAL_TEST_AUTHORIZATIONS:");
  
  const originalQueueAudit = await runSql(`
    SELECT id, appointment_id, event_type, status, scheduled_for, external_id, processed_at, attempts
    FROM public.notification_queue
    WHERE id = '${ORIGINAL_REMINDER_ID}';
  `);
  console.log("Status do Lembrete Original na Fila (DEVE PERMANECER pending):", JSON.stringify(originalQueueAudit, null, 2));

  const logAudit = await runSql(`
    SELECT id, appointment_id, phone, status, message_type, sent_at, created_at
    FROM public.whatsapp_logs 
    ORDER BY created_at DESC 
    LIMIT 4;
  `);
  console.log("Logs registrados em whatsapp_logs:", JSON.stringify(logAudit, null, 2));

  const authAudit = await runSql(`
    SELECT id, authorization_code, target_recipient, status, consumed_at, metadata
    FROM public.manual_test_authorizations 
    WHERE authorization_code = '${authCode}';
  `);
  console.log("Estado final da autorização em manual_test_authorizations:", JSON.stringify(authAudit, null, 2));

  // 9. Confirmação das Travas Globais Pós-Envio
  console.log("\n8. VERIFICAÇÃO FINAL DAS TRAVAS GLOBAIS:");
  const postSecretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const postDryRun = postSecretsRes.data.find(s => s.name === 'WHATSAPP_DRY_RUN');
  const postEnabled = postSecretsRes.data.find(s => s.name === 'WHATSAPP_ENABLED');
  console.log("   - WHATSAPP_DRY_RUN pós-teste:", postDryRun?.value);
  console.log("   - WHATSAPP_ENABLED pós-teste:", postEnabled?.value);
}

executePhase63HEarlyReminderRealTest().catch(console.error);
