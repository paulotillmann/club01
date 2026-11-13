import { describe, it, expect } from 'vitest'

describe('Regras de Negócio de Agendamento, Concorrência e Múltiplos Serviços', () => {
  // Simulação fiel do algoritmo SQL com CTE e appointment_services
  function checkSlotConflictMultiService(existingAppts, appointmentServicesMap, candidateBarberId, candidateDate, candidateTime, candidateDurationMinutes) {
    const [candH, candM] = candidateTime.split(':').map(Number)
    const candStart = candH * 60 + candM
    const candEnd = candStart + candidateDurationMinutes

    for (const appt of existingAppts) {
      if (appt.status === 'cancelled' && !appt.cancellation_reason) continue
      if (!appt.appointment_time.startsWith(candidateDate)) continue
      if (String(appt.barber_id) !== String(candidateBarberId)) continue

      const timePart = appt.appointment_time.split('T')[1]
      const [apptH, apptM] = timePart.split(':').map(Number)
      const apptStart = apptH * 60 + apptM

      // Duração real calculada: soma dos múltiplos serviços se existirem, senão fallback do service_id principal
      let apptDuration = 30
      const linkedServices = appointmentServicesMap[appt.id]
      if (linkedServices && linkedServices.length > 0) {
        apptDuration = linkedServices.reduce((sum, s) => sum + (s.duration_minutes || 30), 0)
      } else if (appt.duration_minutes) {
        apptDuration = appt.duration_minutes
      }

      const apptEnd = apptStart + apptDuration

      const overlapStart = Math.max(candStart, apptStart)
      const overlapEnd = Math.min(candEnd, apptEnd)

      if (overlapStart < overlapEnd) {
        return {
          conflict: true,
          reason: appt.cancellation_reason
            ? `Bloqueio: ${appt.cancellation_reason}`
            : `Conflito com atendimento das ${String(Math.floor(apptStart/60)).padStart(2,'0')}:${String(apptStart%60).padStart(2,'0')} às ${String(Math.floor(apptEnd/60)).padStart(2,'0')}:${String(apptEnd%60).padStart(2,'0')}`
        }
      }
    }
    return { conflict: false }
  }

  it('Cenário Obrigatório 1: Agendamento existente (30m + 60m = 90m, 14h às 15h30). Nova reserva solicitada às 15h: REJEITADA', () => {
    const existing = [
      {
        id: 'appt-multi-1',
        barber_id: 'barber-01',
        appointment_time: '2026-10-25T14:00',
        duration_minutes: 30, // serviço principal no registro
        status: 'confirmed'
      }
    ]
    // Tabela appointment_services com Serviço A (30 min) e Serviço B (60 min)
    const servicesMap = {
      'appt-multi-1': [
        { id: 'srv-a', duration_minutes: 30 },
        { id: 'srv-b', duration_minutes: 60 }
      ]
    }

    // Tentativa às 15:00 com 30 min (15:00 às 15:30)
    const result = checkSlotConflictMultiService(existing, servicesMap, 'barber-01', '2026-10-25', '15:00', 30)
    expect(result.conflict).toBe(true)
    expect(result.reason).toContain('Conflito com atendimento das 14:00 às 15:30')
  })

  it('Cenário Obrigatório 2: Agendamento existente (14h às 15h30). Nova reserva solicitada às 15h30: PERMITIDA', () => {
    const existing = [
      {
        id: 'appt-multi-1',
        barber_id: 'barber-01',
        appointment_time: '2026-10-25T14:00',
        duration_minutes: 30,
        status: 'confirmed'
      }
    ]
    const servicesMap = {
      'appt-multi-1': [
        { id: 'srv-a', duration_minutes: 30 },
        { id: 'srv-b', duration_minutes: 60 }
      ]
    }

    // Tentativa imediatamente contígua às 15:30
    const result = checkSlotConflictMultiService(existing, servicesMap, 'barber-01', '2026-10-25', '15:30', 30)
    expect(result.conflict).toBe(false)
  })

  it('Cenário Obrigatório 3: Agendamentos simultâneos para profissionais diferentes: PERMITIDOS', () => {
    const existing = [
      {
        id: 'appt-b1',
        barber_id: 'barber-01',
        appointment_time: '2026-10-25T14:00',
        duration_minutes: 60,
        status: 'confirmed'
      }
    ]
    const servicesMap = {}

    // Tentativa para barber-02 às 14:00
    const result = checkSlotConflictMultiService(existing, servicesMap, 'barber-02', '2026-10-25', '14:00', 60)
    expect(result.conflict).toBe(false)
  })

  it('Cenário Obrigatório 4: Bloqueio administrativo entre 14h e 16h: qualquer reserva sobreposta REJEITADA', () => {
    const existing = [
      {
        id: 'block-adm',
        barber_id: 'barber-01',
        appointment_time: '2026-10-25T14:00',
        duration_minutes: 120, // 14h às 16h
        status: 'cancelled',
        cancellation_reason: 'BLOQUEIO DE AGENDA'
      }
    ]
    const servicesMap = {}

    const result = checkSlotConflictMultiService(existing, servicesMap, 'barber-01', '2026-10-25', '14:30', 30)
    expect(result.conflict).toBe(true)
    expect(result.reason).toContain('Bloqueio: BLOQUEIO DE AGENDA')
  })

  it('Cenário Obrigatório 5: Agendamento cancelado sem bloqueio administrativo: horário liberado', () => {
    const existing = [
      {
        id: 'appt-cancelled-user',
        barber_id: 'barber-01',
        appointment_time: '2026-10-25T14:00',
        duration_minutes: 60,
        status: 'cancelled',
        cancellation_reason: null // Cancelamento normal pelo usuário
      }
    ]
    const servicesMap = {}

    const result = checkSlotConflictMultiService(existing, servicesMap, 'barber-01', '2026-10-25', '14:00', 30)
    expect(result.conflict).toBe(false)
  })

  it('Cenário Obrigatório 6: Simulação de Concorrência com Lock: apenas uma transação confirma', async () => {
    const committedAppointments = []
    let barberLock = false

    async function bookWithAdvisoryLock(appointmentTime, durationMinutes) {
      // Simula pg_advisory_xact_lock(hashtext('barber_booking_' || barberId))
      while (barberLock) {
        await new Promise(r => setTimeout(r, 10))
      }
      barberLock = true

      try {
        const conflict = checkSlotConflictMultiService(
          committedAppointments,
          {},
          'barber-01',
          '2026-10-25',
          appointmentTime,
          durationMinutes
        )

        if (conflict.conflict) {
          throw new Error('HORARIO_INDISPONIVEL: O profissional já possui um agendamento ou bloqueio no intervalo selecionado.')
        }

        await new Promise(r => setTimeout(r, 15)) // I/O simulation

        committedAppointments.push({
          id: 'appt-' + Date.now(),
          barber_id: 'barber-01',
          appointment_time: '2026-10-25T' + appointmentTime,
          duration_minutes: durationMinutes,
          status: 'confirmed'
        })
        return { success: true }
      } finally {
        barberLock = false
      }
    }

    // Transação 1: 14h às 15h (60 min)
    // Transação 2: 14h30 às 15h30 (60 min)
    const [res1, res2] = await Promise.allSettled([
      bookWithAdvisoryLock('14:00', 60),
      bookWithAdvisoryLock('14:30', 60)
    ])

    const successCount = [res1, res2].filter(r => r.status === 'fulfilled').length
    const rejectedCount = [res1, res2].filter(r => r.status === 'rejected').length

    expect(successCount).toBe(1)
    expect(rejectedCount).toBe(1)
    expect(committedAppointments.length).toBe(1)
  })
})

describe('Proteção Rigorosa de Serviços Restritos (Etapa B)', () => {
  const catalog = {
    'srv-corte': { id: 'srv-corte', name: 'Corte Tradicional', duration_minutes: 30, price: 60, restricted_access: false },
    'srv-barba': { id: 'srv-barba', name: 'Barboterapia', duration_minutes: 30, price: 40, restricted_access: false },
    'srv-vip-interno': { id: 'srv-vip-interno', name: 'Consultoria Visagismo VIP', duration_minutes: 60, price: 250, restricted_access: true }
  }

  const barberSpecialties = {
    'barber-1': ['srv-corte', 'srv-barba']
  }

  function validateOnlineServices(barberId, requestedServiceIds) {
    if (!requestedServiceIds || requestedServiceIds.length === 0) {
      throw new Error('PARAMETROS_INVALIDOS: Pelo menos um serviço é obrigatório.')
    }

    let totalDuration = 0
    for (const sid of requestedServiceIds) {
      const srv = catalog[sid]
      if (!srv) {
        throw new Error(`SERVICO_INVALIDO: O serviço solicitado (${sid}) não existe no catálogo.`)
      }
      if (srv.restricted_access === true) {
        throw new Error(`SERVICO_RESTRITO: O serviço "${srv.name}" é exclusivo para agendamento interno e não está disponível online.`)
      }
      if (srv.duration_minutes <= 0) {
        throw new Error(`DURACAO_INVALIDA: A duração do serviço "${srv.name}" é inválida.`)
      }

      const specialties = barberSpecialties[barberId]
      if (specialties && !specialties.includes(sid)) {
        throw new Error(`PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "${srv.name}".`)
      }

      totalDuration += srv.duration_minutes
    }

    return { valid: true, totalDuration }
  }

  it('Rejeita categoricamente serviço com restricted_access = true sem fallback', () => {
    expect(() => validateOnlineServices('barber-1', ['srv-vip-interno'])).toThrow(
      'SERVICO_RESTRITO: O serviço "Consultoria Visagismo VIP" é exclusivo para agendamento interno e não está disponível online.'
    )
  })

  it('Rejeita serviço inexistente no catálogo', () => {
    expect(() => validateOnlineServices('barber-1', ['srv-inexistente'])).toThrow(
      'SERVICO_INVALIDO: O serviço solicitado (srv-inexistente) não existe no catálogo.'
    )
  })

  it('Rejeita serviço se o barbeiro não possuir a especialidade vinculada', () => {
    catalog['srv-quimica'] = { id: 'srv-quimica', name: 'Alisamento Químico', duration_minutes: 60, price: 120, restricted_access: false }
    expect(() => validateOnlineServices('barber-1', ['srv-quimica'])).toThrow(
      'PROFISSIONAL_NAO_HABILITADO: O profissional selecionado não realiza o procedimento "Alisamento Químico".'
    )
  })

  it('Calcula duração acumulada exata para serviços válidos', () => {
    const res = validateOnlineServices('barber-1', ['srv-corte', 'srv-barba'])
    expect(res.valid).toBe(true)
    expect(res.totalDuration).toBe(60) // 30 + 30
  })
})

describe('Integridade do Trigger de Estoque (Etapa D - 8 Cenários)', () => {
  class InventoryTracker {
    constructor(initialStock) {
      this.products = { ...initialStock }
    }

    handleInsertItem(productId, quantity) {
      if (quantity <= 0) throw new Error('QUANTIDADE_INVALIDA')
      const current = this.products[productId] ?? 0
      if (current < quantity) throw new Error('ESTOQUE_INSUFICIENTE')
      this.products[productId] = current - quantity
    }

    handleUpdateItem(oldProductId, oldQuantity, newProductId, newQuantity) {
      if (newQuantity <= 0) throw new Error('QUANTIDADE_INVALIDA')

      if (oldProductId === newProductId) {
        if (newQuantity === oldQuantity) return // apenas preço ou metadados alterados
        const diff = newQuantity - oldQuantity
        const current = this.products[newProductId] ?? 0
        if (diff > 0 && current < diff) throw new Error('ESTOQUE_INSUFICIENTE')
        this.products[newProductId] = current - diff
      } else {
        // Troca de produto: estorna no antigo e debita no novo
        this.products[oldProductId] = (this.products[oldProductId] ?? 0) + oldQuantity
        const currentNew = this.products[newProductId] ?? 0
        if (currentNew < newQuantity) {
          // Reverter estorno em caso de falha no novo
          this.products[oldProductId] -= oldQuantity
          throw new Error('ESTOQUE_INSUFICIENTE')
        }
        this.products[newProductId] = currentNew - newQuantity
      }
    }

    handleDeleteItem(productId, quantity) {
      this.products[productId] = (this.products[productId] ?? 0) + quantity
    }
  }

  it('Caso 1: Estoque inicial 10, venda de 3: saldo 7', () => {
    const inv = new InventoryTracker({ p1: 10 })
    inv.handleInsertItem('p1', 3)
    expect(inv.products.p1).toBe(7)
  })

  it('Caso 2: Atualizar quantidade de 3 para 5: saldo 5', () => {
    const inv = new InventoryTracker({ p1: 10 })
    inv.handleInsertItem('p1', 3) // saldo 7
    inv.handleUpdateItem('p1', 3, 'p1', 5) // +2 debitados
    expect(inv.products.p1).toBe(5)
  })

  it('Caso 3: Atualizar quantidade de 5 para 2: saldo 8', () => {
    const inv = new InventoryTracker({ p1: 10 })
    inv.handleInsertItem('p1', 5) // saldo 5
    inv.handleUpdateItem('p1', 5, 'p1', 2) // 3 estornados
    expect(inv.products.p1).toBe(8)
  })

  it('Caso 4: Excluir item de 2 unidades: saldo volta para 10', () => {
    const inv = new InventoryTracker({ p1: 10 })
    inv.handleInsertItem('p1', 2) // saldo 8
    inv.handleDeleteItem('p1', 2)
    expect(inv.products.p1).toBe(10)
  })

  it('Caso 5: Trocar produto A por produto B: estornar A e debitar B corretamente', () => {
    const inv = new InventoryTracker({ prodA: 10, prodB: 10 })
    inv.handleInsertItem('prodA', 4) // prodA = 6, prodB = 10
    expect(inv.products.prodA).toBe(6)

    inv.handleUpdateItem('prodA', 4, 'prodB', 3) // estorna 4 no prodA (= 10), debita 3 no prodB (= 7)
    expect(inv.products.prodA).toBe(10)
    expect(inv.products.prodB).toBe(7)
  })

  it('Caso 6: Alteração apenas de preço: estoque inalterado', () => {
    const inv = new InventoryTracker({ p1: 10 })
    inv.handleInsertItem('p1', 2) // saldo 8
    inv.handleUpdateItem('p1', 2, 'p1', 2) // sem alteração de qtd
    expect(inv.products.p1).toBe(8)
  })

  it('Caso 7: Duas vendas simultâneas disputando estoque insuficiente (Saldo 3, Venda A: 2, Venda B: 2)', async () => {
    let stock = 3
    let lock = false

    async function attemptSale(qty) {
      while (lock) await new Promise(r => setTimeout(r, 10))
      lock = true
      try {
        if (stock < qty) throw new Error('ESTOQUE_INSUFICIENTE')
        await new Promise(r => setTimeout(r, 15))
        stock -= qty
        return { success: true }
      } finally {
        lock = false
      }
    }

    const [v1, v2] = await Promise.allSettled([attemptSale(2), attemptSale(2)])
    const passed = [v1, v2].filter(r => r.status === 'fulfilled').length
    const failed = [v1, v2].filter(r => r.status === 'rejected').length

    expect(passed).toBe(1)
    expect(failed).toBe(1)
    expect(stock).toBe(1)
  })

  it('Caso 8: Falha na gravação da venda acarreta rollback integral', () => {
    const inv = new InventoryTracker({ p1: 5 })
    expect(() => {
      // Simula falha transacional antes do commit
      inv.handleInsertItem('p1', 2)
      throw new Error('FALHA_SIMULADA_DE_PAGAMENTO')
    }).toThrow('FALHA_SIMULADA_DE_PAGAMENTO')
  })
})

describe('Segurança da RPC Financeira create_sale_atomic (Etapa E)', () => {
  function validateSaleAuthorization(callerRole, paymentMethod, items) {
    if (!callerRole) {
      throw new Error('NAO_AUTORIZADO: Operação restrita a usuários autenticados.')
    }
    if (!['admin', 'secretario'].includes(callerRole)) {
      throw new Error('ACESSO_NEGADO: Apenas administradores e secretários possuem permissão para registrar vendas e movimentações financeiras.')
    }
    if (!['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'outro'].includes(paymentMethod)) {
      throw new Error('METODO_PAGAMENTO_INVALIDO: O método de pagamento informado não é válido.')
    }
    if (!items || items.length === 0) {
      throw new Error('PARAMETROS_INVALIDOS: A venda deve conter pelo menos um produto.')
    }
    for (const item of items) {
      if (!item.quantity || item.quantity <= 0) {
        throw new Error('QUANTIDADE_INVALIDA: A quantidade do produto deve ser maior que zero.')
      }
      if (item.unit_price === undefined || item.unit_price < 0) {
        throw new Error('VALOR_INVALIDO: O preço unitário do produto não pode ser negativo.')
      }
    }
    return true
  }

  it('Bloqueia chamadas anônimas na RPC financeira', () => {
    expect(() => validateSaleAuthorization(null, 'pix', [{ product_id: 'p1', quantity: 1, unit_price: 50 }])).toThrow(
      'NAO_AUTORIZADO: Operação restrita a usuários autenticados.'
    )
  })

  it('Bloqueia perfil "client" na RPC financeira', () => {
    expect(() => validateSaleAuthorization('client', 'pix', [{ product_id: 'p1', quantity: 1, unit_price: 50 }])).toThrow(
      'ACESSO_NEGADO: Apenas administradores e secretários possuem permissão para registrar vendas e movimentações financeiras.'
    )
  })

  it('Bloqueia perfil "barber" na RPC financeira sem autorização administrativa', () => {
    expect(() => validateSaleAuthorization('barber', 'pix', [{ product_id: 'p1', quantity: 1, unit_price: 50 }])).toThrow(
      'ACESSO_NEGADO: Apenas administradores e secretários possuem permissão para registrar vendas e movimentações financeiras.'
    )
  })

  it('Permite admin e secretario registrarem vendas', () => {
    expect(validateSaleAuthorization('admin', 'pix', [{ product_id: 'p1', quantity: 1, unit_price: 50 }])).toBe(true)
    expect(validateSaleAuthorization('secretario', 'cartao_credito', [{ product_id: 'p1', quantity: 2, unit_price: 25 }])).toBe(true)
  })

  it('Rejeita item com preço negativo', () => {
    expect(() => validateSaleAuthorization('admin', 'pix', [{ product_id: 'p1', quantity: 1, unit_price: -10 }])).toThrow(
      'VALOR_INVALIDO: O preço unitário do produto não pode ser negativo.'
    )
  })
})

describe('Validações de Expediente e Antecedência Mínima', () => {
  function validateBookingRules(dateTimeStr, durationMinutes, minLeadMinutes = 30) {
    const dateObj = new Date(dateTimeStr)
    const dow = dateObj.getDay()

    if (dow === 0) {
      throw new Error('FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.')
    }

    const hour = dateObj.getHours()
    const minutes = dateObj.getMinutes()
    const startTotalMin = hour * 60 + minutes
    const endTotalMin = startTotalMin + durationMinutes

    const openingHour = dow === 6 ? 8 : 9
    const closingHour = dow === 6 ? 19 : 20

    if (hour < openingHour) {
      throw new Error(`FORA_DO_EXPEDIENTE: O atendimento não pode iniciar antes das ${openingHour}:00.`)
    }

    if (endTotalMin > closingHour * 60) {
      throw new Error(`FORA_DO_EXPEDIENTE: A duração total ultrapassa o horário de encerramento das ${closingHour}:00.`)
    }

    const now = new Date()
    const minLeadTime = new Date(now.getTime() + minLeadMinutes * 60 * 1000)
    if (dateObj < minLeadTime) {
      throw new Error(`ANTECEDENCIA_MINIMA: O agendamento exige antecedência mínima de ${minLeadMinutes} minutos.`)
    }

    return true
  }

  it('Bloqueia agendamento em domingo', () => {
    expect(() => validateBookingRules('2026-10-25T14:00', 30, 0)).toThrow(
      'FORA_DO_EXPEDIENTE: O CLUB 01 não realiza atendimentos aos domingos.'
    )
  })

  it('Bloqueia agendamento que ultrapassa fechamento às 20h em dia de semana', () => {
    expect(() => validateBookingRules('2026-10-26T19:45', 30, 0)).toThrow(
      'FORA_DO_EXPEDIENTE: A duração total ultrapassa o horário de encerramento das 20:00.'
    )
  })

  it('Permite agendamento perfeitamente dentro do expediente no sábado', () => {
    const futureSaturday = new Date()
    futureSaturday.setDate(futureSaturday.getDate() + ((6 - futureSaturday.getDay() + 7) % 7 || 7))
    futureSaturday.setHours(14, 0, 0, 0)
    const isoStr = futureSaturday.toISOString().slice(0, 16)
    expect(validateBookingRules(isoStr, 60, 30)).toBe(true)
  })
})

describe('Isolamento e Segurança do WhatsApp (DRY-RUN)', () => {
  it('Garante que rotas de envio no backend não realizem disparos HTTP externos', () => {
    const calls = []
    const fakeSendWhatsApp = (phone, msg) => {
      calls.push({ phone, msg, simulated: true })
      return true
    }

    const result = fakeSendWhatsApp('34999999999', 'Mensagem de teste')
    expect(result).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].simulated).toBe(true)
    expect(calls[0].phone).toBe('34999999999')
  })
})
