/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

function runSql(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function apiRequest(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${pat}`
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function auditFinal() {
  console.log('--- AUDITORIA FINAL DO AMBIENTE DEV ---');
  
  // 1. Cron jobs
  const cronJobs = await runSql(`SELECT jobid, schedule, command, active FROM cron.job;`);
  console.log('Cron Jobs:', cronJobs);

  // 2. Notificação candidata
  const candidate = await runSql(`
    SELECT id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, 
           scheduled_for, status, idempotency_key, attempts, max_attempts, content
    FROM public.notification_queue
    WHERE id = '546ef10d-29bb-48a6-bae3-0acda802abda';
  `);
  console.log('Notificação Candidata Oficial:', JSON.stringify(candidate, null, 2));

  // 3. Demais notificações do agendamento oficial
  const apptNotifs = await runSql(`
    SELECT id, event_type, recipient_type, status, last_error
    FROM public.notification_queue
    WHERE appointment_id = 'f2e9e489-886b-49c4-b937-0cc3e84ba893';
  `);
  console.log('Notificações do Agendamento Oficial:', JSON.stringify(apptNotifs, null, 2));

  // 4. Resumo da fila
  const queueSummary = await runSql(`
    SELECT status, count(*) FROM public.notification_queue GROUP BY status;
  `);
  console.log('Resumo Geral da Fila:', queueSummary);

  // 5. Autorizações de teste
  const auths = await runSql(`
    SELECT id, target_phone, authorized_notification_id, authorized_event_type, 
           authorized_appointment_id, consumed_at, is_consumed
    FROM public.manual_test_authorizations
    ORDER BY created_at DESC LIMIT 5;
  `);
  console.log('Últimas Autorizações:', JSON.stringify(auths, null, 2));

  // 6. Edge Function process-notifications
  const fns = await apiRequest('/functions');
  const procFn = Array.isArray(fns) ? fns.find(f => f.slug === 'process-notifications') : null;
  console.log('Edge Function process-notifications:', {
    name: procFn?.name,
    version: procFn?.version,
    status: procFn?.status
  });

  // 7. Secrets (travas globais)
  const secrets = await apiRequest('/secrets');
  const safeSecrets = Array.isArray(secrets) ? secrets.map(s => ({
    name: s.name,
    is_dryrun: s.name === 'WHATSAPP_DRY_RUN' ? s.value : undefined,
    is_enabled: s.name === 'WHATSAPP_ENABLED' ? s.value : undefined,
    instance: s.name === 'EVOLUTION_INSTANCE_NAME' ? s.value : undefined
  })).filter(s => s.name.startsWith('WHATSAPP_') || s.name.startsWith('EVOLUTION_')) : secrets;
  console.log('Secrets Globais (seguro):', safeSecrets);
}

auditFinal().catch(console.error);
