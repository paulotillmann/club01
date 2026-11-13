/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6: PROCESSADOR DE FILA DE NOTIFICAÇÕES (SERVER-SIDE WORKER)
 * ==============================================================================
 * Executa o processamento assíncrono e concorrente da fila de notificações.
 * Compatível tanto com Node.js (testes e background worker) quanto com
 * Deno / Supabase Edge Functions.
 */

import { EvolutionApiClient, normalizeBrazilianPhone } from '../evolution_client.js';

export class NotificationProcessor {
  /**
   * @param {Object} options
   * @param {Object} options.db - Cliente de banco de dados (PGlite, pg.Pool ou Supabase client)
   * @param {EvolutionApiClient} [options.evolutionClient]
   * @param {Object} [options.logger]
   */
  constructor({ db, evolutionClient, logger = console }) {
    this.db = db;
    this.client = evolutionClient || new EvolutionApiClient();
    this.logger = logger;
  }

  /**
   * Executa um ciclo de processamento de notificações pendentes.
   * @param {number} batchSize - Quantidade máxima de itens por lote
   * @returns {Promise<{ processed: number, success: number, failed: number, skipped: number, results: Array }>}
   */
  async processBatch(batchSize = 10) {
    const results = [];
    let items = [];

    // 1. DEQUEUE ATÔMICO COM "FOR UPDATE SKIP LOCKED"
    // Suporta PGlite / node-pg (com .query) ou Supabase client (com .rpc)
    try {
      if (typeof this.db.query === 'function') {
        const queryRes = await this.db.query(
          `SELECT * FROM public.dequeue_notifications_for_processing($1);`,
          [batchSize]
        );
        items = queryRes.rows || [];
      } else if (typeof this.db.rpc === 'function') {
        const { data, error } = await this.db.rpc('dequeue_notifications_for_processing', {
          p_batch_size: batchSize
        });
        if (error) throw error;
        items = data || [];
      } else {
        throw new Error('Instância de banco de dados não suportada');
      }
    } catch (err) {
      this.logger.error?.('[NotificationProcessor] Erro ao desenfileirar itens:', err.message);
      return { processed: 0, success: 0, failed: 0, skipped: 0, error: err.message, results: [] };
    }

    if (items.length === 0) {
      return { processed: 0, success: 0, failed: 0, skipped: 0, results: [] };
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const itemResult = await this.processSingleItem(item);
      results.push(itemResult);

      if (itemResult.finalStatus === 'sent' || itemResult.finalStatus === 'simulated') {
        successCount++;
      } else if (itemResult.finalStatus === 'skipped' || itemResult.finalStatus === 'cancelled') {
        skippedCount++;
      } else {
        failedCount++;
      }
    }

    return {
      processed: items.length,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
      results
    };
  }

  /**
   * Processa um único registro de notificação retirado da fila.
   */
  async processSingleItem(item) {
    const { id, appointment_id, event_type, recipient_phone, content, attempts, max_attempts } = item;

    // 1. VALIDAÇÃO DE PRÉ-ENVIO: Para lembretes de 30m, verificar se o agendamento ainda está confirmado
    if (event_type === 'reminder_30m') {
      const appt = await this.getAppointmentStatus(appointment_id);

      if (!appt || appt.status !== 'confirmed') {
        const reason = !appt ? 'Agendamento não localizado' : `Agendamento em estado ${appt.status}`;
        await this.recordResult({
          id,
          status: 'cancelled',
          error: `Lembrete não enviado: ${reason}`,
          metadata: { invalidated_at: new Date().toISOString() }
        });

        return { id, finalStatus: 'cancelled', reason };
      }
    }

    // 2. VALIDAÇÃO DE NÚMERO DE TELEFONE
    const phoneNorm = normalizeBrazilianPhone(recipient_phone);
    if (!phoneNorm.valid) {
      await this.recordResult({
        id,
        status: 'failed',
        error: `Validação de número falhou: ${phoneNorm.error}`,
        metadata: { phone_validation_error: phoneNorm.error }
      });

      return { id, finalStatus: 'failed', error: phoneNorm.error };
    }

    // 3. ENVIO VIA CLIENTE EVOLUTION API (OU SIMULAÇÃO EM DRY-RUN)
    const sendResult = await this.client.sendTextMessage({
      phone: phoneNorm.phone,
      text: content,
      metadata: {
        appointment_id,
        event_type,
        recipient_type: item.recipient_type,
        attempt: attempts
      }
    });

    if (sendResult.success) {
      const finalStatus = sendResult.simulated ? 'simulated' : 'sent';
      await this.recordResult({
        id,
        status: finalStatus,
        externalId: sendResult.externalId,
        metadata: {
          simulated: Boolean(sendResult.simulated),
          to: sendResult.to,
          external_id: sendResult.externalId
        }
      });

      return { id, finalStatus, simulated: Boolean(sendResult.simulated), externalId: sendResult.externalId };
    } else {
      // 4. TRATAMENTO DE FALHA E RETRY / BACKOFF
      // FASE 6.3-G: Proteção Estrita contra Duplicidade.
      // Se for timeout ou entrega incerta após o início do envio, o estado de entrega é INDETERMINADO!
      // Para evitar entrega duplicada ao destinatário, o reenvio automático é ESTRITAMENTE BLOQUEADO.
      if (sendResult.indeterminate || sendResult.errorCode === 'INDETERMINATE_DELIVERY') {
        await this.recordResult({
          id,
          status: 'unknown',
          error: `Resultado de entrega indeterminado (timeout/rede): ${sendResult.error}`,
          metadata: {
            errorCode: 'INDETERMINATE_DELIVERY',
            indeterminate_delivery: true,
            auto_retry_blocked: true,
            timestamp: new Date().toISOString()
          }
        });
        return { id, finalStatus: 'unknown', indeterminate: true, error: sendResult.error };
      }

      const isRetryable = (attempts < max_attempts) && (sendResult.errorCode !== 'INVALID_PHONE_NUMBER');

      if (isRetryable) {
        // Re-enfileirar como pending para próxima tentativa após intervalo de backoff
        await this.updateForRetry({
          id,
          attempts,
          error: sendResult.error
        });

        return { id, finalStatus: 'pending_retry', error: sendResult.error, attempts };
      } else {
        const finalStatus = (sendResult.errorCode === 'NETWORK_OR_TIMEOUT_ERROR') ? 'unknown' : 'failed';
        await this.recordResult({
          id,
          status: finalStatus,
          error: sendResult.error,
          metadata: {
            errorCode: sendResult.errorCode,
            httpStatus: sendResult.httpStatus,
            max_attempts_exceeded: attempts >= max_attempts,
            indeterminate_delivery: finalStatus === 'unknown'
          }
        });

        return { id, finalStatus, error: sendResult.error };
      }
    }
  }

  /**
   * Consulta o estado atual do agendamento para validação preventiva.
   */
  async getAppointmentStatus(appointmentId) {
    try {
      if (typeof this.db.query === 'function') {
        const res = await this.db.query(
          `SELECT id, status, appointment_time FROM public.appointments WHERE id = $1;`,
          [appointmentId]
        );
        return res.rows?.[0] || null;
      } else if (typeof this.db.from === 'function') {
        const { data } = await this.db
          .from('appointments')
          .select('id, status, appointment_time')
          .eq('id', appointmentId)
          .maybeSingle();
        return data || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * Registra o resultado definitivo de processamento via RPC ou SQL.
   */
  async recordResult({ id, status, externalId = null, error = null, metadata = {} }) {
    if (typeof this.db.query === 'function') {
      await this.db.query(
        `SELECT public.record_notification_result($1, $2, $3, $4, $5);`,
        [id, status, externalId, error, JSON.stringify(metadata)]
      );
    } else if (typeof this.db.rpc === 'function') {
      await this.db.rpc('record_notification_result', {
        p_id: id,
        p_status: status,
        p_external_id: externalId,
        p_error: error,
        p_metadata: metadata
      });
    }
  }

  /**
   * Atualiza registro para retry caso falha seja temporária.
   */
  async updateForRetry({ id, attempts, error }) {
    // Backoff exponencial simples: 2 ^ attempts minutos
    const backoffMinutes = Math.min(Math.pow(2, attempts || 1), 30);

    if (typeof this.db.query === 'function') {
      await this.db.query(
        `UPDATE public.notification_queue
         SET status = 'pending',
             scheduled_for = now() + ($1 || ' minutes')::interval,
             last_error = $2,
             updated_at = now()
         WHERE id = $3;`,
        [backoffMinutes, error, id]
      );
    } else if (typeof this.db.from === 'function') {
      const nextTime = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      await this.db
        .from('notification_queue')
        .update({
          status: 'pending',
          scheduled_for: nextTime,
          last_error: error,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
    }
  }

  /**
   * Reconcilia uma notificação em estado indeterminado ('unknown').
   * @param {Object} params
   * @param {string} params.id - ID da notificação
   * @param {'delivered'|'not_delivered'} params.resolution - Decisão da reconciliação
   * @param {string} [params.externalId] - Identificador externo retornado pelo provedor se entregue
   * @param {string} [params.operatorNotes] - Justificativa / notas do operador
   */
  async reconcileIndeterminateNotification({ id, resolution, externalId = null, operatorNotes = '' }) {
    if (resolution === 'delivered') {
      await this.recordResult({
        id,
        status: 'sent',
        externalId,
        metadata: {
          reconciled: true,
          reconciled_at: new Date().toISOString(),
          resolution: 'confirmed_delivered',
          operator_notes: operatorNotes
        }
      });
      return { id, status: 'sent', reconciled: true };
    } else if (resolution === 'not_delivered') {
      if (typeof this.db.query === 'function') {
        await this.db.query(
          `UPDATE public.notification_queue
           SET status = 'pending',
               last_error = $2,
               metadata = metadata || jsonb_build_object('reconciled_not_delivered', true, 'reconciled_at', now(), 'operator_notes', $3::text),
               updated_at = now()
           WHERE id = $1;`,
          [id, `Reconciliado pelo operador: rearmado para pending (${operatorNotes})`, operatorNotes]
        );
      } else if (typeof this.db.from === 'function') {
        await this.db
          .from('notification_queue')
          .update({
            status: 'pending',
            last_error: `Reconciliado pelo operador: rearmado para pending (${operatorNotes})`,
            updated_at: new Date().toISOString()
          })
          .eq('id', id);
      }
      return { id, status: 'pending', reconciled: true };
    }
    throw new Error('Resolução inválida para reconciliação');
  }
}
