import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runAudit() {
  console.log("=== INICIANDO AUDITORIA SEGURA DE SUPABASE ===");
  console.log("URL:", SUPABASE_URL);

  const tables = [
    'services',
    'barbers',
    'barber_services',
    'customers',
    'appointments',
    'appointment_services',
    'products',
    'sales',
    'sale_items',
    'caixa',
    'settings',
    'users',
    'whatsapp_logs'
  ];

  console.log("\n--- TESTE 1: Acesso Anônimo a Tabelas (RLS Read Test) ---");
  for (const table of tables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: false })
        .limit(2);

      if (error) {
        console.log(`[BLOQUEADO/ERRO] ${table}: ${error.code} - ${error.message}`);
      } else {
        console.log(`[LEITURA PERMITIDA] ${table}: Retornou ${data ? data.length : 0} registros (Total: ${count})`);
        if (data && data.length > 0) {
          const keys = Object.keys(data[0]);
          console.log(`   Colunas retornadas: ${keys.join(', ')}`);
        }
      }
    } catch (e) {
      console.log(`[EXCEÇÃO] ${table}:`, e.message);
    }
  }

  console.log("\n--- TESTE 2: Auditoria das RPCs Críticas ---");
  // 1. get_occupied_slots
  try {
    const { data, error } = await supabase.rpc('get_occupied_slots');
    if (error) {
      console.log("[FALHA] RPC get_occupied_slots:", error.message);
    } else {
      console.log(`[OK] RPC get_occupied_slots executável publicamente. Retornou ${data?.length || 0} slots.`);
      if (data && data.length > 0) {
        console.log("   Estrutura do retorno:", Object.keys(data[0]).join(', '));
      }
    }
  } catch (e) {
    console.log("[EXCEÇÃO] RPC get_occupied_slots:", e.message);
  }

  // 2. get_email_by_phone
  try {
    const { data, error } = await supabase.rpc('get_email_by_phone', { p_phone: '11999999999' });
    if (error) {
      console.log("[FALHA/ESPERADO] RPC get_email_by_phone:", error.message);
    } else {
      console.log("[OK] RPC get_email_by_phone resposta para telefone inexistente:", data);
    }
  } catch (e) {
    console.log("[EXCEÇÃO] RPC get_email_by_phone:", e.message);
  }

  // 3. book_appointment_online (com parâmetros inválidos para testar validação de input)
  try {
    const { data, error } = await supabase.rpc('book_appointment_online', {
      p_name: '',
      p_phone: '',
      p_barber_id: null,
      p_service_ids: [],
      p_appointment_time: null
    });
    if (error) {
      console.log("[VALIDAÇÃO OK] RPC book_appointment_online rejeitou parâmetros vazios:", error.message);
    } else {
      console.log("[ALERTA] RPC book_appointment_online aceitou parâmetros vazios:", data);
    }
  } catch (e) {
    console.log("[EXCEÇÃO] RPC book_appointment_online:", e.message);
  }

  // 4. book_appointment_atomic (com parâmetros nulos/inválidos)
  try {
    const { data, error } = await supabase.rpc('book_appointment_atomic', {
      p_client_id: null,
      p_barber_id: null,
      p_service_id: null,
      p_appointment_time: null
    });
    if (error) {
      console.log("[VALIDAÇÃO OK] RPC book_appointment_atomic rejeitou parâmetros nulos:", error.message);
    } else {
      console.log("[ALERTA] RPC book_appointment_atomic:", data);
    }
  } catch (e) {
    console.log("[EXCEÇÃO] RPC book_appointment_atomic:", e.message);
  }

  // 5. create_sale_atomic (com items vazios)
  try {
    const { data, error } = await supabase.rpc('create_sale_atomic', {
      p_appointment_id: null,
      p_customer_id: null,
      p_payment_method: 'dinheiro',
      p_items: []
    });
    if (error) {
      console.log("[RESPOSTA] RPC create_sale_atomic:", error.message);
    } else {
      console.log("[RESPOSTA] RPC create_sale_atomic retorno:", data);
    }
  } catch (e) {
    console.log("[EXCEÇÃO] RPC create_sale_atomic:", e.message);
  }

  console.log("\n=== FIM DA AUDITORIA ===");
}

runAudit().catch(console.error);
