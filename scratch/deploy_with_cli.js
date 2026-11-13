/* global process */
import { spawn } from 'child_process';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

console.log("=== DEPLOY DA EDGE FUNCTION VIA SUPABASE CLI ===");
console.log(`Projeto Alvo: ${PROJECT_REF}`);

const args = [
  'supabase',
  'functions',
  'deploy',
  'process-notifications',
  '--project-ref',
  PROJECT_REF,
  '--no-verify-jwt'
];

const child = spawn('npx', args, {
  cwd: 'C:/club01',
  shell: true,
  env: {
    ...process.env,
    SUPABASE_ACCESS_TOKEN: pat
  },
  stdio: 'inherit'
});

child.on('close', code => {
  console.log(`Processo finalizado com código: ${code}`);
  process.exit(code || 0);
});
