import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testResilientBooking() {
  console.log("Testing fallback capability...");
  // 1. Check if public can insert a customer
  const tempCustomerId = 'test-qa-' + Date.now();
  const { data: cust, error: custErr } = await supabase
    .from('customers')
    .insert({
      id: tempCustomerId,
      name: 'TEST QA AGENT',
      phone: '00000000000'
    })
    .select()
    .single();

  console.log("Customer insert result:", { cust, custErr });

  if (cust) {
    // Clean up immediately so we leave no synthetic record
    const { error: delErr } = await supabase.from('customers').delete().eq('id', tempCustomerId);
    console.log("Cleanup result (RLS delete on customers):", delErr ? delErr.message : "Deleted successfully");
  }
}

testResilientBooking().catch(console.error);
