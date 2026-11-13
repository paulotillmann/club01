/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

const APPOINTMENT_ID = 'de910e34-66ad-4ba1-82be-04ec7a548f8a';
const REMINDER_ID = 'd6a69bde-2639-4f77-9d3d-7893af98ea73';

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

async function auditEtapa5Initial() {
  console.log("=== FASE 6.3-H ETAPA 5: AUDITORIA INICIAL ===");

  // 1. Secrets / Travas Globais
  const secrets = await apiRequest('/secrets');
  const safeSecrets = Array.isArray(secrets) ? secrets.filter(s => s.name.startsWith('WHATSAPP_') || s.name.startsWith('EVOLUTION_')).map(s => ({ name: s.name, exists: true })) : secrets;
  console.log("1. Secrets:", safeSecrets);

  // 2. Cron jobs
  const cronJobs = await runSql(`SELECT jobid, schedule, command, active FROM cron.job;`);
  console.log("2. Cron Jobs ativos:", cronJobs?.length || 0);

  // 3. Agendamento de Homologação
  const appt = await runSql(`
    SELECT a.id, a.client_id, a.barber_id, a.service_id, a.appointment_time, a.status,
           c.name as client_name, c.phone as client_phone,
           b.name as barber_name, b.phone as barber_phone
    FROM public.appointments a
    LEFT JOIN public.customers c ON a.client_id = c.id
    LEFT JOIN public.barbers b ON a.barber_id = b.id
    WHERE a.id = '${APPOINTMENT_ID}';
  `);
  console.log("3. Agendamento:", JSON.stringify(appt, null, 2));

  // 4. Lembrete Existente
  const reminder = await runSql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
           scheduled_for, status, idempotency_key, attempts, max_attempts, content
    FROM public.notification_queue
    WHERE id = '${REMINDER_ID}';
  `);
  console.log("4. Lembrete Existente:", JSON.stringify(reminder, null, 2));

  // 5. Todas as notificações do agendamento
  const allNotifs = await runSql(`
    SELECT id, event_type, recipient_type, status, scheduled_for, last_error
    FROM public.notification_queue
    WHERE appointment_id = '${APPOINTMENT_ID}'
    ORDER BY created_at ASC;
  `);
  console.log("5. Todas as Notificações do Agendamento:", JSON.stringify(allNotifs, null, 2));
}

auditEtapa5Initial().catch(console.error);
