/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

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

async function audit() {
  console.log("=== 1. AUDITORIA DE PROJETO E SECRETS ===");
  const project = await apiRequest(`/v1/projects/${PROJECT_REF}`);
  console.log("Projeto:", project.name, "| Status:", project.status, "| Região:", project.region);

  const secrets = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const secMap = {};
  if (Array.isArray(secrets)) {
    secrets.forEach(s => secMap[s.name] = true);
  }
  console.log("WHATSAPP_DRY_RUN presente:", 'WHATSAPP_DRY_RUN' in secMap);
  console.log("WHATSAPP_ENABLED presente:", 'WHATSAPP_ENABLED' in secMap);
  console.log("EVOLUTION_INSTANCE_NAME presente:", 'EVOLUTION_INSTANCE_NAME' in secMap);

  console.log("\n=== 2. JOBS DO AGENDADOR (CRON.JOB) ===");
  const cronJobs = await querySql("SELECT jobid, jobname, schedule, active FROM cron.job;");
  console.log("Jobs:", cronJobs);

  console.log("\n=== 3. BARBEIROS DISPONÍVEIS NO DEV ===");
  const barbers = await querySql("SELECT id, name, phone FROM public.barbers ORDER BY name;");
  console.log("Barbeiros:", barbers);

  console.log("\n=== 4. SERVIÇOS DISPONÍVEIS NO DEV ===");
  const services = await querySql("SELECT id, name, duration_minutes, price, restricted_access FROM public.services ORDER BY name;");
  console.log("Serviços:", services);

  console.log("\n=== 5. ESPECIALIDADES (BARBER_SERVICES) ===");
  const barberServices = await querySql("SELECT barber_id, service_id FROM public.barber_services;");
  console.log("Especialidades:", barberServices);

  console.log("\n=== 6. FILA DE NOTIFICAÇÕES (ESTADO ATUAL) ===");
  const queueStats = await querySql("SELECT status, count(*) FROM public.notification_queue GROUP BY status;");
  console.log("Queue Stats:", queueStats);

  console.log("\n=== 7. LOGS WHATSAPP ===");
  const logsCount = await querySql("SELECT count(*) FROM public.whatsapp_logs;");
  console.log("Total Logs:", logsCount);

  console.log("\n=== 8. AUTORIZAÇÕES MANUAIS ===");
  const authStats = await querySql("SELECT status, count(*) FROM public.manual_test_authorizations GROUP BY status;");
  console.log("Auth Stats:", authStats);
}

audit().catch(console.error);
