# Validação de Concorrência Real Multi-Conexão (PostgreSQL TCP)
## CLUB 01 Barber Studio — Guia de Execução Técnica

Este documento descreve o procedimento operacional padrão para executar testes de concorrência transacional real entre **múltiplas sessões/conexões simultâneas independentes via socket TCP** em PostgreSQL, superando a limitação de motores embutidos em memória (como PGlite/WASM), que operam em fila de eventos com thread única serializada.

---

### 1. Limitações Técnicas do PGlite / `Promise.all`
- **PGlite (WASM)**: É uma compilação do núcleo PostgreSQL para WebAssembly. Embora execute o motor PostgreSQL 18 real com suporte completo a PL/pgSQL, triggers, constraints e RLS, a biblioteca em JavaScript opera em thread única com enfileiramento sequencial assíncrono de queries (`queue-based async execution`).
- **`Promise.all` em PGlite**: Não gera interleaving de instruções em nível de CPU nem disputa simultânea de soquetes de rede TCP. Ele testa a atomicidade sequencial, mas **não comprova contenção transacional multi-sessão**.

---

### 2. Arquitetura para Concorrência Real Multi-Conexão
Para comprovar cientificamente os cenários de concorrência C1 a C5 sob condições reais de tráfego simultâneo:

1. **Instância PostgreSQL Isolada Servidora**:
   - Um servidor PostgreSQL (v15, v16 ou v17) escutando em porta TCP local (ex: `localhost:5433` descartável).
2. **Duas Conexões TCP Distintas (Pool / Clients independentes)**:
   - Conexão 1: `PID A` (Sessão cliente 1 - PostgREST/Backend)
   - Conexão 2: `PID B` (Sessão cliente 2 - PostgREST/Backend)
3. **Barreiras de Sincronização**:
   - As duas sessões devem iniciar simultaneamente transações explícitas (`BEGIN`) e executar comandos conflitantes com bloqueio `FOR UPDATE` ou `pg_advisory_xact_lock`.

---

### 3. Procedimento de Teste com Dois Clientes `psql` (Manual e Auditável)

#### Pré-condição
Banco de testes descartável criado e populado com a Migration 0021.

#### Cenário C1: Disputa Simultânea de Estoque (Estoque = 5 unidades; duas vendas pedindo 3 cada)
- **Terminal 1 (Conexão 1 - PID 101)**:
  ```sql
  BEGIN;
  -- Trava produto determinístico
  SELECT stock_quantity FROM public.products WHERE id = 'prod-pomada' FOR UPDATE;
  -- Pausa proposital de 3 segundos para criar contenção real
  SELECT pg_sleep(3);
  -- Tenta debitar 3 unidades
  UPDATE public.products SET stock_quantity = stock_quantity - 3 WHERE id = 'prod-pomada';
  COMMIT;
  ```
- **Terminal 2 (Conexão 2 - PID 102 - Executado 500ms após o Terminal 1)**:
  ```sql
  BEGIN;
  -- Ficará BLOQUEADO aguardando a liberação do lock da linha no Terminal 1
  SELECT stock_quantity FROM public.products WHERE id = 'prod-pomada' FOR UPDATE;
  -- Quando o Terminal 1 der COMMIT, esta sessão é liberada e vê stock_quantity = 2.
  -- Tentativa de debitar 3 unidades dispara EXCEPTION de estoque insuficiente:
  -- CHECK (stock_quantity >= 0) ou trigger handle_sale_item_stock.
  ROLLBACK;
  ```
- **Resultado Esperado**:
  - Terminal 1: Sucesso total (saldo reduzido para 2).
  - Terminal 2: Erro `ESTOQUE_INSUFICIENTE` / violação de constraint.
  - Saldo final no catálogo: exatamente 2.

#### Cenário C2: Disputa Simultânea de Agendamento no Mesmo Slot
- **Terminal 1 (PID 201)**:
  ```sql
  BEGIN;
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_barber-thiago'));
  SELECT pg_sleep(2);
  INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
  VALUES ('appt-01', 'client-01', 'barber-thiago', 'srv-corte', '2026-10-27T10:00', 'confirmed');
  COMMIT;
  ```
- **Terminal 2 (PID 202 - Disparado simultaneamente)**:
  ```sql
  BEGIN;
  -- Bloqueado pelo advisory lock do barbeiro
  PERFORM pg_advisory_xact_lock(hashtext('barber_booking_barber-thiago'));
  -- Quando liberado, a verificação de sobreposição encontra appt-01
  -- Dispara EXCEPTION: HORARIO_INDISPONIVEL
  ROLLBACK;
  ```
- **Resultado Esperado**:
  - Exatamente 1 agendamento gravado. A 2ª transação é abortada com integridade total.

---

### 4. Script Automatizado em Node.js (`pg` oficial multi-conexão)
Quando um PostgreSQL local com porta TCP estiver autorizado:

```javascript
import { Client } from 'pg';

async function testRealMultiConnectionConcurrency() {
  const c1 = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5433/testdb' });
  const c2 = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5433/testdb' });

  await c1.connect();
  await c2.connect();

  const pid1 = (await c1.query('SELECT pg_backend_pid();')).rows[0].pg_backend_pid;
  const pid2 = (await c2.query('SELECT pg_backend_pid();')).rows[0].pg_backend_pid;

  console.log(`Conexão 1 (PID: ${pid1}) | Conexão 2 (PID: ${pid2})`);

  // Disparo simultâneo via TCP real com sockets independentes
  const p1 = c1.query("SELECT public.create_sale_atomic(...)");
  const p2 = c2.query("SELECT public.create_sale_atomic(...)");

  const [r1, r2] = await Promise.allSettled([p1, p2]);
  // Verificação de resultados e auditoria de locks
  await c1.end();
  await c2.end();
}
```
