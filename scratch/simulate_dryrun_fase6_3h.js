/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

async function querySql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/' + PROJECT_REF + '/database/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function apiRequest(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.supabase.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + pat
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
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

async function simulateDryRunProcessing() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-H ETAPA 2: HOMOLOGAÇÃO CONTROLADA EM DRY-RUN ===");
  console.log("=========================================================================\n");

  // 1. Obter Service Key
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.find(k => k.name === 'service_role key' || k.name === 'service_role');
  if (!serviceKeyObj) throw new Error("Chave service_role não encontrada");
  const serviceKey = serviceKeyObj.api_key;

  // 2. Inserir uma notificação temporária EXCLUSIVA para a simulação DRY-RUN
  // para preservar a notificação candidata oficial (856fb499-c66e-4ed7-8350-a4e3e38952be)
  console.log("1. Inserindo notificação temporária para simulação DRY-RUN...");
  const tempNotifId = 'notif-dryrun-sim-' + Date.now();
  await querySql(`
    INSERT INTO public.notification_queue (
      id,
      appointment_id,
      event_type,
      recipient_type,
      recipient_name,
      recipient_phone,
      scheduled_for,
      status,
      idempotency_key,
      content
    ) VALUES (
      '${tempNotifId}',
      'dc794e74-19e7-4f2f-b095-7fabdca54cae',
      'new_appointment',
      'client',
      'CLIENTE TESTE CLUB 01',
      '5534988322462',
      now() - interval '1 minute',
      'pending',
      'dryrun_sim_${Date.now()}',
      'Mensagem de teste simulada em DRY-RUN'
    );
  `);

  // 3. Invocar a Edge Function process-notifications V7 (modo normal, que roda em DRY-RUN)
  console.log("2. Invocando Edge Function process-notifications em modo DRY-RUN...");
  const edgeUrl = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;
  const res = await invokeEdgeFunction(edgeUrl, serviceKey, { batch_size: 5 });
  console.log("   - Status HTTP:", res.status);
  console.log("   - Resposta da Edge Function:", JSON.stringify(res.data, null, 2));

  // 4. Inspecionar o resultado do item na notification_queue e whatsapp_logs
  console.log("\n3. Auditoria do item simulado:");
  const simItem = await querySql(`SELECT id, status, external_id, processed_at FROM public.notification_queue WHERE id = '${tempNotifId}';`);
  console.log("   - notification_queue:", simItem);

  const logItem = await querySql(`SELECT id, appointment_id, status, sent_at FROM public.whatsapp_logs WHERE id = '${tempNotifId}';`);
  console.log("   - whatsapp_logs:", logItem);

  // 5. Limpeza do item temporário de simulação
  console.log("\n4. Limpando registro temporário de simulação...");
  await querySql(`DELETE FROM public.notification_queue WHERE id = '${tempNotifId}';`);
  await querySql(`DELETE FROM public.whatsapp_logs WHERE id = '${tempNotifId}';`);
  console.log("   - Registro temporário removido. Fila preservada.");

  // 6. Confirmar estado da notificação candidata oficial
  console.log("\n5. Confirmando estado da notificação candidata oficial:");
  const candidateCheck = await querySql(`
    SELECT id, appointment_id, recipient_phone, status, idempotency_key 
    FROM public.notification_queue 
    WHERE id = '856fb499-c66e-4ed7-8350-a4e3e38952be';
  `);
  console.log("   - Notificação Candidata:", candidateCheck);
}

simulateDryRunProcessing().catch(console.error);
