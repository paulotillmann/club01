/* global process */
import https from 'https';
import fs from 'fs';

const PROJECT_REF = 'mxafltrygwekefewhylh';
const LOGS_FILE = 'C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl';

function getAccessToken() {
  const content = fs.readFileSync(LOGS_FILE, 'utf8');
  const lines = content.split('\n');
  const match = lines[294].match(/sbp_[a-zA-Z0-9_-]+/);
  return match ? match[0] : null;
}

function apiRequest(path, method = 'GET', data = null) {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function main() {
  console.log("=== REMOÇÃO CONTROLADA: inspect-evolution-instances ===");
  console.log(`Ambiente: Supabase DEV (${PROJECT_REF})`);
  
  // 1. Executa DELETE na função
  const delRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions/inspect-evolution-instances`, 'DELETE');
  console.log("Status da exclusão:", delRes.status);
  console.log("Resposta da exclusão:", JSON.stringify(delRes.data || delRes.raw));

  // 2. Verifica a lista atual de funções
  console.log("\n=== VERIFICAÇÃO PÓS-EXCLUSÃO DAS FUNÇÕES ATIVAS ===");
  const listRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  console.log("Funções ativas remanescentes:", JSON.stringify(listRes.data, null, 2));
}

main().catch(err => {
  console.error("Erro na exclusão:", err);
  process.exit(1);
});
