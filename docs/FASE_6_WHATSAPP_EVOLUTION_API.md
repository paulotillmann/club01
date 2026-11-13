# CLUB 01 BARBER STUDIO — RELATÓRIO TÉCNICO FASE 6
## INTEGRAÇÃO WHATSAPP COM EVOLUTION API (ARQUITETURA DIRETA SERVER-SIDE)
**Confirmações, Lembretes (30 min), Cancelamentos e Remarcações**

---

### SUMÁRIO EXECUTIVO

- **Projeto**: CLUB 01 Barber Studio (`C:\club01`)
- **Projeto Supabase Exclusivo**: `mxafltrygwekefewhylh` (`https://mxafltrygwekefewhylh.supabase.co`)
- **Instância Evolution API (Testes)**: `Meu Bolso Digital` (Configurável via Server-Side Environment Variables)
- **Modo Operacional**: **DRY-RUN OBRIGATÓRIO** (`WHATSAPP_DRY_RUN=true`, `WHATSAPP_ENABLED=false`)
- **Status de Segurança**: 
  - ✅ **ZERO** chamadas remotas ou externas executadas durante o desenvolvimento.
  - ✅ **ZERO** mensagens reais de WhatsApp enviadas.
  - ✅ **ZERO** impacto ou contato com a aplicação/infraestrutura da **Barbearia do Vale** (100% intocada).
  - ✅ **52/52 Testes Automatizados APROVADOS** (incluindo os 20 cenários da Fase 6).
  - ✅ `npm run lint` com 0 erros e `npm run build` aprovado.

---

### A. RELATÓRIO DE ARQUITETURA

A Fase 6 implementa uma **arquitetura direta e desacoplada**, sem intermediários externos desnecessários (como n8n, chatbots ou agentes de IA):

```
+-------------------------------------------------------------+
|                 CLUB 01 FRONTEND / ADMIN                     |
|           (Agendamento Público & Gestão Interna)            |
+-------------------------------------------------------------+
                              |
                              v [RPCs Atômicas / Mutations]
+-------------------------------------------------------------+
|             SUPABASE POSTGRESQL (BANCO DE DADOS)            |
| - Tabela: public.appointments                               |
| - Trigger: handle_appointment_notifications()               |
| - Lock Concorrente: FOR UPDATE SKIP LOCKED                  |
+-------------------------------------------------------------+
                              |
                              v [Geração Transacional Imediata]
+-------------------------------------------------------------+
|              FILA PERSISTENTE DE NOTIFICAÇÕES               |
| - Tabela: public.notification_queue                         |
| - Idempotência: UNIQUE idempotency_key                      |
| - Estados: pending, processing, simulated, sent, failed, ...|
+-------------------------------------------------------------+
                              |
                              v [Dequeue Concorrente Atômico]
+-------------------------------------------------------------+
|        SUPABASE EDGE FUNCTION / SERVER-SIDE WORKER          |
| - Função: supabase/functions/process-notifications          |
| - Worker: backend-api/src/workers/notification_processor.js |
| - Validação de Pré-Envio (Status Atual do Agendamento)      |
| - Normalização de Telefones Brasileiros (DDI 55 + DDD + 9D) |
| - Proteção DRY-RUN e Secrets Server-Side                    |
+-------------------------------------------------------------+
                              |
                              v [HTTP Seguro / DRY-RUN]
+-------------------------------------------------------------+
|                     EVOLUTION API                           |
| - Instância configurável: EVOLUTION_INSTANCE_NAME           |
| - Endpoint: /message/sendText/:instance                     |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                        WHATSAPP                             |
|              (Cliente & Barbeiro Responsável)               |
+-------------------------------------------------------------+
```

#### Destaques Arquiteturais:
1. **Geração Transacional de Notificações**:
   As notificações são geradas por triggers PostgreSQL (`handle_appointment_notifications`) dentro da mesma transação que confirma o agendamento. Se a transação do agendamento sofrer rollback, nenhuma notificação é enfileirada.
2. **Reserva Atômica sem Colisão**:
   O dequeue de mensagens pendentes utiliza `SELECT ... FOR UPDATE SKIP LOCKED` através da RPC `dequeue_notifications_for_processing`, garantindo que múltiplos workers ou execuções de Edge Functions nunca processem o mesmo registro simultaneamente.
3. **Idempotência**:
   Cada item possui chave determinística (`idempotency_key`), bloqueando qualquer tentativa de inserção ou envio duplicado.
4. **Isolamento de Falhas**:
   A falha de comunicação com a Evolution API não reverte nem desfaz o agendamento confirmado no banco de dados.

---

### B. RELAÇÃO DE ARQUIVOS CRIADOS E MODIFICADOS

| Arquivo | Status | Descrição |
| :--- | :---: | :--- |
| `backend-api/migrations/0022_notification_queue_and_triggers.sql` | **Criado** | Tabela `notification_queue`, trigger em `appointments`, RPC `dequeue_notifications_for_processing` com `SKIP LOCKED` e sincronizador de logs. |
| `backend-api/migrations/0022_notification_queue_rollback.sql` | **Criado** | Script de rollback completo para a migration 0022. |
| `backend-api/src/evolution_client.js` | **Criado** | Cliente da Evolution API com normalização de números brasileiros, simulação DRY-RUN e verificação de conexão. |
| `backend-api/src/workers/notification_processor.js` | **Criado** | Worker server-side para processamento da fila, validação pré-envio, retentativas com backoff exponencial. |
| `supabase/functions/process-notifications/index.ts` | **Criado** | Supabase Edge Function para processamento assíncrono server-side com autenticação via service_role ou webhook cron. |
| `tests/whatsapp_notification_suite.test.js` | **Criado** | Suíte de testes automatizados com 20 cenários executados em PostgreSQL isolado (PGlite). |
| `src/lib/api.js` | **Modificado** | Atualização de `whatsappLogsApi` para consumir `notification_queue` com fallback resiliente e adição de `whatsappConfigApi`. |
| `src/pages/Configuracoes.jsx` | **Modificado** | Painel visual de WhatsApp com status DRY-RUN, métricas de fila, instância ativa e filtros avançados. |
| `docs/FASE_6_WHATSAPP_EVOLUTION_API.md` | **Criado** | Relatório técnico de engenharia e homologação da Fase 6. |

---

### C. MIGRATIONS SQL PREPARADAS

#### 1. `backend-api/migrations/0022_notification_queue_and_triggers.sql`
- **Tabela**: `public.notification_queue`
  - Campos: `id`, `appointment_id`, `event_type`, `recipient_type`, `recipient_phone`, `recipient_name`, `content`, `scheduled_for`, `status`, `attempts`, `max_attempts`, `last_error`, `processed_at`, `external_id`, `idempotency_key`, `metadata`, `created_at`, `updated_at`.
- **Estados Suportados**: `pending`, `processing`, `sent`, `failed`, `cancelled`, `skipped`, `simulated`.
- **Índices**:
  - `idx_notif_queue_pending_sched` (parcial para `status = 'pending'`).
  - `idx_notif_queue_appointment_id`.
  - `idx_notif_queue_idempotency` (UNIQUE).
- **Segurança / RLS**: RLS ativado; `admin` e `secretario` têm permissão de leitura; `service_role` possui acesso completo.
- **Trigger**: `trigger_appointment_notifications` disparado em INSERT e UPDATE na tabela `public.appointments`.

#### 2. `backend-api/migrations/0022_notification_queue_rollback.sql`
- Remove funções auxiliares, trigger, RPCs e tabela `notification_queue`.

---

### D. EDGE FUNCTIONS IMPLEMENTADAS LOCALMENTE

Arquivo: `supabase/functions/process-notifications/index.ts`
- **Ambiente de Execução**: Deno (Supabase Edge Functions Runtime).
- **Autenticação**: Requer `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` ou segredo `x-cron-secret`.
- **Batching**: Parâmetro configurável `batch_size` (padrão: 10, máx: 50).
- **Segurança**: Nunca registra chaves nem tokens nos logs; valida permissões em nível server-side.

---

### E. INTEGRAÇÃO COM A FILA DE NOTIFICAÇÕES

1. **Agendamento Confirmado (INSERT)**:
   - Enfileira mensagem de confirmação para o **Cliente** (`scheduled_for = now()`).
   - Enfileira aviso de novo atendimento para o **Barbeiro** (`scheduled_for = now()`).
   - Se o atendimento for marcado com 30+ minutos de antecedência: programa lembrete de 30m (`scheduled_for = appointment_time - interval '30 minutes'`).
   - Se o atendimento for marcado com menos de 30 minutos: marca o lembrete como `skipped` (ignorado, não aplicável).
2. **Cancelamento (UPDATE status = 'cancelled')**:
   - Invalida automaticamente lembretes pendentes futuros (`status = 'cancelled'`).
   - Enfileira mensagem de cancelamento para o cliente.
   - Enfileira aviso de cancelamento para o barbeiro.
   - Bloqueios administrativos (`cust-bloqueio-sistema`) são ignorados pelo trigger e não disparam mensagens.
3. **Remarcação (UPDATE appointment_time ou barber_id)**:
   - Invalida lembrete antigo do horário anterior.
   - Agenda novo lembrete 30 minutos antes do novo horário.
   - Envia aviso de alteração de horário ao cliente.
   - Se houve troca de barbeiro:
     - Notifica o barbeiro anterior sobre a transferência.
     - Notifica o novo barbeiro sobre a atribuição do atendimento.

---

### F. TEMPLATES DE MENSAGENS PADRONIZADOS

#### 1. Confirmação ao Cliente (Novo Agendamento)
```
Olá, {cliente}! 💈

Seu agendamento no CLUB 01 Barber Studio foi confirmado!

✂️ Serviço: {servicos}
👤 Profissional: {barbeiro}
📅 Data: {data}
🕒 Horário: {horario}

Esperamos por você!
```

#### 2. Aviso de Novo Agendamento ao Barbeiro
```
Olá, {barbeiro}! 💈

Você recebeu um novo agendamento no CLUB 01 Barber Studio.

👤 Cliente: {cliente}
✂️ Serviço: {servicos}
📅 Data: {data}
🕒 Horário: {horario}
```

#### 3. Lembrete Automático — 30 Minutos (Cliente)
```
Olá, {cliente}! 💈

Passando para lembrar que seu horário no CLUB 01 Barber Studio está chegando!

✂️ Serviço: {servicos}
👤 Profissional: {barbeiro}
📅 Data: {data}
🕒 Horário: {horario}

Faltam aproximadamente 30 minutos para o seu atendimento.

Até já!
```

#### 4. Cancelamento de Agendamento (Cliente)
```
Olá, {cliente}.

Seu agendamento no CLUB 01 Barber Studio foi cancelado.

✂️ Serviço: {servicos}
📅 Data: {data}
🕒 Horário: {horario}

Para marcar um novo horário, acesse nossos canais de atendimento.
```

#### 5. Cancelamento de Agendamento (Barbeiro)
```
Olá, {barbeiro}! 💈

O atendimento do cliente {cliente} agendado para {data} às {horario} foi cancelado.
```

#### 6. Remarcação de Agendamento (Cliente)
```
Olá, {cliente}! 💈

Seu agendamento no CLUB 01 Barber Studio foi remarcado!

✂️ Serviço: {servicos}
👤 Profissional: {barbeiro}
📅 Data: {data}
🕒 Horário: {horario}

Esperamos por você!
```

#### 7. Transferência de Atendimento (Barbeiro Anterior)
```
Olá, {barbeiro}! 💈

O atendimento do cliente {cliente} agendado para {data} às {horario} foi transferido para outro profissional.
```

---

### G. CONFIGURAÇÕES DE AMBIENTE NECESSÁRIAS

Variáveis de ambiente server-side preparadas (devem ser configuradas nos Secrets do Supabase remoto e/ou `.env` de produção):

```bash
# URL da Evolution API
EVOLUTION_API_URL=https://api.whatsapp.exemplo.com

# Chave de API Global da Evolution API
EVOLUTION_API_KEY=sua_api_key_secreta_aqui

# Nome da Instância (Configurável dinamicamente)
# Instância de testes atual: Meu Bolso Digital
EVOLUTION_INSTANCE_NAME="Meu Bolso Digital"

# Controle de Envio Real vs Simulação
# ATENÇÃO: Manter DRY_RUN=true até autorização formal de homologação
WHATSAPP_DRY_RUN=true
WHATSAPP_ENABLED=false

# Segredo para acionamento via cron job externo
CRON_SECRET=chave_secreta_cron_agendador
```

---

### H. TESTES EXECUTADOS E RESULTADOS

Suíte automatizada: `tests/whatsapp_notification_suite.test.js`
Executada via Vitest sobre PostgreSQL isolado (PGlite 18.6).

| Nº | Cenário Testado | Status | Evidência / Validação |
| :---: | :--- | :---: | :--- |
| **01** | Novo agendamento confirmado | **APROVADO** | Gera 3 registros na fila: confirmação cliente, aviso barbeiro e lembrete 30m. |
| **02** | Confirmação ao cliente | **APROVADO** | Template com nome, serviços concatenados, barbeiro, data e horário corretos. |
| **03** | Aviso ao barbeiro | **APROVADO** | Notificação enviada ao WhatsApp do barbeiro com detalhes do cliente e serviços. |
| **04** | Agendamento rejeitado | **APROVADO** | Rollback ou falha de agendamento aborta e nenhuma mensagem é persistida na fila. |
| **05** | Lembrete 30 minutos antes | **APROVADO** | Programado para exatamente 30 minutos antes do horário de início do atendimento. |
| **06** | Cancelamento antes do lembrete | **APROVADO** | Lembrete futuro é marcado como `cancelled`; avisos de cancelamento gerados. |
| **07** | Remarcação para outro horário | **APROVADO** | Lembrete antigo é cancelado; novo lembrete programado; aviso de remarcação enfileirado. |
| **08** | Remarcação para outro barbeiro | **APROVADO** | Barbeiro anterior recebe aviso de transferência; novo barbeiro recebe aviso de atendimento. |
| **09** | Dois processadores concorrentes | **APROVADO** | `FOR UPDATE SKIP LOCKED` impede que dois workers peguem o mesmo item (interseção = 0). |
| **10** | Tentativa de envio duplicado | **APROVADO** | Chave de idempotência única bloqueia duplicações (`ON CONFLICT DO NOTHING`). |
| **11** | Falha temporária da API | **APROVADO** | Item retorna para `pending` com `attempts = 1` e backoff exponencial programado. |
| **12** | Falha definitiva da API | **APROVADO** | Atingindo `max_attempts` (3), status final torna-se `failed` com registro do erro. |
| **13** | Número inválido | **APROVADO** | Número rejeitado preventivamente com status `failed` sem travar a fila de outros envios. |
| **14** | Barbeiro sem telefone | **APROVADO** | Registra aviso com status `failed` sem quebrar a transação de agendamento do cliente. |
| **15** | Instância desconectada | **APROVADO** | Falha de conexão externa é capturada e tratada sem derrubar o worker server-side. |
| **16** | Agendamento criado com &lt; 30 min | **APROVADO** | Confirmação gerada normalmente; lembrete marcado como `skipped` (não aplicável). |
| **17** | Atendimento já concluído | **APROVADO** | Transição para `completed` cancela lembrete pendente para evitar envio tardio. |
| **18** | DRY-RUN sem chamadas externas | **APROVADO** | Simulação registra status `simulated` sem disparar nenhuma chamada HTTP externa. |
| **19** | Proteção contra acesso não autorizado | **APROVADO** | RPCs de fila restritas ao papel `service_role` e RLS ativado para admin/secretário. |
| **20** | Preservação dos módulos existentes | **APROVADO** | Agendamento é salvo com sucesso mesmo com simulação ou falha no provedor de WhatsApp. |

#### Resumo Global dos Testes:
- **`tests/whatsapp_notification_suite.test.js`**: 20/20 passaram.
- **`tests/business_logic.test.js`**: 27/27 passaram.
- **`tests/protected_route.test.jsx`**: 5/5 passaram.
- **Total**: **52 testes aprovados** (100% de sucesso).

---

### I. EVIDÊNCIAS DE FUNCIONAMENTO DO DRY-RUN

1. **Flag Padrão Segura**: `WHATSAPP_DRY_RUN=true` e `WHATSAPP_ENABLED=false` garantem que o cliente (`EvolutionApiClient`) e a Edge Function nunca realizem chamadas de envio real sem alteração explícita de ambiente.
2. **Registro de Simulação**: As mensagens processadas em DRY-RUN recebem status `'simulated'`, gerando ID externo simulado (`sim_timestamp_hash`) e preservando no metadata o payload exato que seria enviado.
3. **Indicador Visual no Painel**:
   - `src/pages/Configuracoes.jsx` exibe o badge **"DRY-RUN ATIVO"** em destaque.
   - Tabela de logs exibe badge azul **"⚡ Simulado (DRY-RUN)"** com o horário previsto e dados do destinatário.

---

### J. PLANO DE IMPLANTAÇÃO (QUANDO AUTORIZADO)

1. **Etapa 1: Aplicação da Migration Remota**
   - Executar `backend-api/migrations/0022_notification_queue_and_triggers.sql` no Supabase remoto do CLUB 01 (`mxafltrygwekefewhylh`).
2. **Etapa 2: Configuração de Secrets**
   - Configurar no Supabase Secrets:
     - `EVOLUTION_API_URL`
     - `EVOLUTION_API_KEY`
     - `EVOLUTION_INSTANCE_NAME` ("Meu Bolso Digital")
     - `WHATSAPP_DRY_RUN` ("true" inicialmente para homologação)
     - `WHATSAPP_ENABLED` ("true" ou "false")
3. **Etapa 3: Deploy da Edge Function**
   - Publicar a função `process-notifications` via Supabase CLI (`supabase functions deploy process-notifications`).
4. **Etapa 4: Configuração do Agendador (Cron Job)**
   - Configurar extensão `pg_cron` no Supabase para invocar `process-notifications` a cada 1 minuto (ou acionamento por webhook agendado).
5. **Etapa 5: Homologação em DRY-RUN no Remoto**
   - Criar agendamento de teste e verificar se as 3 mensagens aparecem na tabela `notification_queue` com status `simulated`.
6. **Etapa 6: Virada para Envio Real (Go-Live)**
   - Alterar `WHATSAPP_DRY_RUN=false` e `WHATSAPP_ENABLED=true` com o número de testes da instância `Meu Bolso Digital`.

---

### K. PLANO DE ROLLBACK

Caso seja necessário reverter a implantação:
1. **Banco de Dados**:
   - Executar `backend-api/migrations/0022_notification_queue_rollback.sql`.
   - O trigger `trigger_appointment_notifications` será removido, cessando a geração de mensagens.
   - A tabela `notification_queue` e as RPCs associadas serão descartadas sem afetar as tabelas principais de agendamentos, clientes ou barbeiros.
2. **Edge Functions**:
   - Desativar o cron job via `pg_cron` (`SELECT cron.unschedule('process-notifications-job');`).
3. **Frontend**:
   - O frontend continuará funcionando normalmente através do fallback resiliente implementado em `whatsappLogsApi`.

---

### L. PENDÊNCIAS QUE EXIGEM AUTORIZAÇÃO EXPRESSA

Em estrito cumprimento das **Regras Absolutas de Segurança**, as seguintes ações **NÃO foram executadas** e permanecem **aguardando autorização expressa do usuário**:

1. **Executar a migration `0022_notification_queue_and_triggers.sql` no Supabase remoto (`mxafltrygwekefewhylh`)**.
2. **Fazer deploy da Edge Function `process-notifications` no Supabase remoto**.
3. **Configurar secrets e variáveis de ambiente no Supabase remoto**.
4. **Ativar cron job server-side (`pg_cron`) no Supabase remoto**.
5. **Realizar disparos reais de mensagens via Evolution API para qualquer número de WhatsApp**.

---
*Relatório elaborado e validado com sucesso pela Engenharia Sênior — CLUB 01 Barber Studio.*
