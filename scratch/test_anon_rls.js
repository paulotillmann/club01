import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testAnonRls() {
  console.log("=== TESTE REAL DE RLS VIA CLIENTE ANÔNIMO (POSTGREST) ===");

  // 1. Tentar ler da notification_queue como anon
  const { data: readData, error: readError } = await supabase
    .from('notification_queue')
    .select('*');

  console.log("Leitura anônima em notification_queue:");
  console.log("- Erro:", readError ? readError.message : "Nenhum (0 linhas retornadas por RLS)");
  console.log("- Quantidade retornada:", readData ? readData.length : "null");

  // 2. Tentar inserir na notification_queue como anon
  const { data: _insertData, error: insertError } = await supabase
    .from('notification_queue')
    .insert([{
      appointment_id: 'dummy',
      recipient_type: 'client',
      recipient_phone: '11999999999',
      recipient_name: 'Hacker',
      content: 'tentativa invasão'
    }]);

  console.log("\nTentativa de inserção anônima em notification_queue:");
  console.log("- Erro esperado de RLS:", insertError ? `${insertError.code} - ${insertError.message}` : "Permitido (falha de segurança!)");

  // 3. Tentar chamar dequeue_notifications_for_processing como anon
  const { data: _rpcData, error: rpcError } = await supabase
    .rpc('dequeue_notifications_for_processing', { p_batch_size: 5 });

  console.log("\nTentativa de chamada de RPC dequeue_notifications_for_processing como anon:");
  console.log("- Erro esperado (permissão revogada):", rpcError ? `${rpcError.code} - ${rpcError.message}` : "Permitido (falha de segurança!)");
}

testAnonRls().catch(console.error);
