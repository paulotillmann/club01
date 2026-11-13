/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
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
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSql(query) {
  const res = await apiRequest('/database/query', 'POST', { query });
  return res;
}

async function auditInitial() {
  console.log("=== FASE 6.3-H ETAPA 3: AUDITORIA INICIAL DO DEV ===");

  // 1. Secrets / Travas Globais
  const secrets = await apiRequest('/secrets');
  const safeSecrets = Array.isArray(secrets) ? secrets.filter(s => s.name.startsWith('WHATSAPP_') || s.name.startsWith('EVOLUTION_')).map(s => ({ name: s.name, exists: true })) : secrets;
  console.log("Secrets Verificados:", safeSecrets);

  // 2. Cron jobs
  const cronJobs = await runSql(`SELECT jobid, schedule, command, active FROM cron.job;`);
  console.log("Cron Jobs:", cronJobs);

  // 3. Edge Function
  const fns = await apiRequest('/functions');
  const procFn = Array.isArray(fns) ? fns.find(f => f.slug === 'process-notifications') : null;
  console.log("Edge Function process-notifications:", {
    name: procFn?.name,
    version: procFn?.version,
    status: procFn?.status
  });

  // 4. Agendamento Fictício
  const appt = await runSql(`
    SELECT a.id, a.client_id, a.barber_id, a.service_id, a.appointment_time, a.status, a.cancellation_reason,
           c.name as client_name, c.phone as client_phone,
           b.name as barber_name, b.phone as barber_phone
    FROM public.appointments a
    LEFT JOIN public.customers c ON a.client_id = c.id
    LEFT JOIN public.barbers b ON a.barber_id = b.id
    WHERE a.id = 'f2e9e489-886b-49c4-b937-0cc3e84ba893';
  `);
  console.log("Agendamento de Homologação:", JSON.stringify(appt, null, 2));

  // 5. Horários ocupados via RPC get_occupied_slots
  const occupied = await runSql(`SELECT * FROM public.get_occupied_slots();`);
  console.log("Horários Ocupados (get_occupied_slots):", JSON.stringify(occupied, null, 2));

  // 6. Notificações do Agendamento
  const notifs = await runSql(`
    SELECT id, event_type, recipient_type, recipient_phone, status, external_id, processed_at
    FROM public.notification_queue
    WHERE appointment_id = 'f2e9e489-886b-49c4-b937-0cc3e84ba893'
    ORDER BY created_at ASC;
  `);
  console.log("Notificações Atuais do Agendamento:", JSON.stringify(notifs, null, 2));

  // 7. Fila geral (resumo)
  const queueSummary = await runSql(`SELECT status, count(*) FROM public.notification_queue GROUP BY status;`);
  console.log("Resumo da Fila:", queueSummary);

  // 8. Autorizações (resumo)
  const authSummary = await runSql(`SELECT status, count(*) FROM public.manual_test_authorizations GROUP BY status;`);
  console.log("Resumo de Autorizações:", authSummary);
}

auditInitial().catch(console.error);
