import { supabase } from "./supabase.js"

// ==============================================================================
// 1. SERVIÇOS
// ==============================================================================
export const servicesApi = {
  async getPublic() {
    const { data, error } = await supabase
      .from("services")
      .select("*, barber_services(barber_id)")
      .eq("restricted_access", false)
      .order("name")
    if (error) throw new Error(error.message)
    return (data || []).map(s => ({
      ...s,
      price: Number(s.price) || 0,
      duration_minutes: Number(s.duration_minutes ?? 30),
      barber_ids: (s.barber_services || []).map(bs => bs.barber_id)
    }))
  },

  async getAll() {
    const { data, error } = await supabase
      .from("services")
      .select("*, barber_services(barber_id)")
      .order("name")
    if (error) throw new Error(error.message)
    return (data || []).map(s => ({
      ...s,
      price: Number(s.price) || 0,
      duration_minutes: Number(s.duration_minutes ?? 30),
      barber_ids: (s.barber_services || []).map(bs => bs.barber_id)
    }))
  },

  async create(service) {
    const { data, error } = await supabase
      .from("services")
      .insert({
        name: service.name,
        description: service.description || null,
        duration_minutes: Number(service.duration_minutes) || 30,
        price: Number(service.price) || 0,
        restricted_access: Boolean(service.restricted_access)
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    let targetBarberIds = Array.isArray(service.barber_ids) ? service.barber_ids.filter(Boolean) : []
    if (targetBarberIds.length === 0) {
      const { data: allBarbers } = await supabase.from("barbers").select("id")
      targetBarberIds = (allBarbers || []).map(b => b.id)
    }
    if (targetBarberIds.length > 0) {
      await supabase
        .from("barber_services")
        .insert(targetBarberIds.map(bid => ({ barber_id: bid, service_id: data.id })))
    }

    return {
      ...data,
      price: Number(data.price) || 0,
      duration_minutes: Number(data.duration_minutes ?? 30),
      barber_ids: targetBarberIds
    }
  },

  async update(id, service) {
    const { data, error } = await supabase
      .from("services")
      .update({
        name: service.name,
        description: service.description || null,
        duration_minutes: Number(service.duration_minutes) || 30,
        price: Number(service.price) || 0,
        restricted_access: Boolean(service.restricted_access)
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("services").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 2. PROFISSIONAIS / BARBEIROS
// ==============================================================================
export const barbersApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("barbers")
      .select("*, barber_services(service_id)")
      .order("name")
    if (error) throw new Error(error.message)

    return (data || []).map(b => ({
      ...b,
      services: (b.barber_services || []).map(bs => bs.service_id)
    }))
  },

  async getMe(authUserId) {
    if (!authUserId) return null
    const { data, error } = await supabase
      .from("barbers")
      .select("*, barber_services(service_id)")
      .eq("user_id", authUserId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      ...data,
      services: (data.barber_services || []).map(bs => bs.service_id)
    }
  },

  async create(barber, serviceIds = []) {
    const { data, error } = await supabase
      .from("barbers")
      .insert({
        name: barber.name,
        phone: barber.phone,
        photo: barber.photo || null,
        birth_date: barber.birth_date || null,
        specialty: barber.specialty || null,
        hired_at: barber.hired_at || null,
        service_commission: Number(barber.service_commission) || 0,
        product_commission: Number(barber.product_commission) || 0,
        user_id: barber.user_id || null
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    let linksToInsert = Array.isArray(serviceIds) ? serviceIds.filter(Boolean) : []
    if (linksToInsert.length === 0) {
      const { data: allServices } = await supabase.from("services").select("id")
      linksToInsert = (allServices || []).map(s => s.id)
    }
    if (linksToInsert.length > 0) {
      const links = linksToInsert.map(sid => ({ barber_id: data.id, service_id: sid }))
      await supabase.from("barber_services").insert(links)
    }
    return {
      ...data,
      services: linksToInsert
    }
  },

  async update(id, barber, serviceIds = null) {
    const { data, error } = await supabase
      .from("barbers")
      .update({
        name: barber.name,
        phone: barber.phone,
        photo: barber.photo || null,
        birth_date: barber.birth_date || null,
        specialty: barber.specialty || null,
        hired_at: barber.hired_at || null,
        service_commission: Number(barber.service_commission) || 0,
        product_commission: Number(barber.product_commission) || 0,
        user_id: barber.user_id || null
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)

    if (serviceIds !== null) {
      await supabase.from("barber_services").delete().eq("barber_id", id)
      if (serviceIds.length > 0) {
        const links = serviceIds.map(sid => ({ barber_id: id, service_id: sid }))
        await supabase.from("barber_services").insert(links)
      }
    }
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("barbers").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 3. CLIENTES
// ==============================================================================
export const customersApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("name")
    if (error) throw new Error(error.message)
    return data || []
  },

  async get(id) {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async create(customer) {
    const { data, error } = await supabase
      .from("customers")
      .insert({
        name: customer.name.trim().toUpperCase(),
        phone: customer.phone.replace(/\D/g, ""),
        address: customer.address || null,
        birth_date: customer.birth_date || null,
        photo: customer.photo || null
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async update(id, customer) {
    const { data, error } = await supabase
      .from("customers")
      .update({
        name: customer.name.trim().toUpperCase(),
        phone: customer.phone ? customer.phone.replace(/\D/g, "") : undefined,
        address: customer.address,
        birth_date: customer.birth_date,
        photo: customer.photo
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("customers").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  },

  async getHistory(customerId) {
    const [custRes, apptsRes, salesRes] = await Promise.all([
      supabase.from("customers").select("*").eq("id", customerId).single(),
      supabase
        .from("appointments")
        .select(`
          id, client_id, barber_id, appointment_time, status, cancellation_reason, created_at,
          barbers (name, photo),
          services!appointments_service_id_fkey (name, price),
          appointment_services (services (name, price))
        `)
        .eq("client_id", customerId)
        .order("appointment_time", { ascending: false }),
      supabase
        .from("sales")
        .select(`
          id, customer_id, sale_date, payment_method, total_amount, created_at,
          sale_items (id, product_id, quantity, unit_price, total_price, products (name, photo))
        `)
        .eq("customer_id", customerId)
        .order("sale_date", { ascending: false })
    ])

    const appointments = (apptsRes.data || []).map(a => {
      let serviceNames = []
      let servicePrice = 0
      if (a.appointment_services && a.appointment_services.length > 0) {
        serviceNames = a.appointment_services.map(aps => aps.services?.name).filter(Boolean)
        servicePrice = a.appointment_services.reduce((sum, aps) => sum + Number(aps.services?.price || 0), 0)
      } else if (a.services) {
        serviceNames = [a.services.name]
        servicePrice = Number(a.services.price || 0)
      }

      return {
        id: a.id,
        client_id: a.client_id,
        barber_id: a.barber_id,
        appointment_time: a.appointment_time,
        status: a.status,
        cancellation_reason: a.cancellation_reason,
        created_at: a.created_at,
        barber_name: a.barbers?.name || null,
        barber_photo: a.barbers?.photo || null,
        service_name: serviceNames.join(", ") || "Serviço",
        service_price: servicePrice,
        payment_method: null
      }
    })

    const productSales = []
    const sales = salesRes.data || []
    for (const sale of sales) {
      if (sale.sale_items && sale.sale_items.length > 0) {
        for (const item of sale.sale_items) {
          productSales.push({
            sale_id: sale.id,
            sale_date: sale.sale_date || sale.created_at,
            payment_method: sale.payment_method,
            product_id: item.product_id,
            product_name: item.products?.name || "Produto",
            product_photo: item.products?.photo || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.total_price,
            barber_name: null
          })
        }
      }
    }

    const completedServices = appointments.filter(a => a.status === "completed" || a.status === "confirmed")
    const totalServicesPaid = completedServices.reduce((acc, curr) => acc + (Number(curr.service_price) || 0), 0)
    const totalProductsPaid = sales.reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0)
    const lastService = completedServices.length > 0 ? completedServices[0] : (appointments[0] || null)
    const lastProduct = productSales.length > 0 ? productSales[0] : null

    return {
      customer: custRes.data || null,
      summary: {
        total_services_paid: totalServicesPaid,
        total_products_paid: totalProductsPaid,
        total_services_count: appointments.length,
        total_completed_services_count: completedServices.length,
        total_products_count: productSales.reduce((acc, curr) => acc + (curr.quantity || 1), 0),
        last_service: lastService ? {
          appointment_time: lastService.appointment_time,
          service_name: lastService.service_name,
          service_price: lastService.service_price,
          barber_name: lastService.barber_name,
          status: lastService.status
        } : null,
        last_product: lastProduct ? {
          sale_date: lastProduct.sale_date,
          product_name: lastProduct.product_name,
          quantity: lastProduct.quantity,
          total_price: lastProduct.total_price,
          payment_method: lastProduct.payment_method
        } : null
      },
      services: appointments,
      products: productSales,
      sales
    }
  }
}

// ==============================================================================
// 4. AGENDAMENTOS
// ==============================================================================
export const appointmentsApi = {
  async getOccupiedSlots() {
    const { data, error } = await supabase.rpc("get_occupied_slots")
    if (error) throw new Error(error.message)
    return data || []
  },

  async getAll() {
    const { data, error } = await supabase
      .from("appointments")
      .select(`
        *,
        customers (id, name, phone, photo),
        barbers (id, name, photo),
        services!appointments_service_id_fkey (id, name, price, duration_minutes),
        appointment_services (services (*))
      `)
      .order("appointment_time", { ascending: false })
    if (error) throw new Error(error.message)

    return (data || []).map(a => {
      const multipleServices = (a.appointment_services || []).map(as => as.services).filter(Boolean)
      const hasMultiple = multipleServices.length > 0
      const serviceIdsList = hasMultiple
        ? multipleServices.map(s => s.id).filter(Boolean)
        : (a.service_id ? [a.service_id] : [])
      const totalPrice = hasMultiple
        ? multipleServices.reduce((sum, s) => sum + Number(s.price || 0), 0)
        : (Number(a.services?.price) || 0)
      const totalDuration = hasMultiple
        ? multipleServices.reduce((sum, s) => sum + Number(s.duration_minutes || 30), 0)
        : (Number(a.services?.duration_minutes) || 30)
      const clientPhone = a.customers?.phone || ""

      return {
        ...a,
        client_name: a.customers?.name || "Cliente",
        phone: clientPhone,
        client_phone: clientPhone,
        client_photo: a.customers?.photo || null,
        barber_name: a.barbers?.name || "Profissional",
        service_ids: serviceIdsList.join(","),
        service_ids_list: serviceIdsList,
        service_name: hasMultiple
          ? multipleServices.map(s => s.name).join(" + ")
          : (a.services?.name || "Procedimento"),
        price: totalPrice,
        service_price: totalPrice,
        duration_minutes: totalDuration,
        multiple_services: multipleServices
      }
    })
  },

  async bookAtomic({ clientId, barberId, serviceId, appointmentTime, serviceIds = null }) {
    const { data, error } = await supabase.rpc("book_appointment_atomic", {
      p_client_id: clientId,
      p_barber_id: barberId,
      p_service_id: serviceId,
      p_appointment_time: appointmentTime,
      p_service_ids: serviceIds
    })
    if (error) throw new Error(error.message)
    return data
  },

  async bookOnline({ name, phone, barberId, serviceIds, appointmentTime }) {
    const { data, error } = await supabase.rpc("book_appointment_online", {
      p_name: name,
      p_phone: phone,
      p_barber_id: barberId,
      p_service_ids: serviceIds,
      p_appointment_time: appointmentTime
    })
    if (error) throw new Error(error.message)
    return data
  },

  async create(payload) {
    const serviceIds = Array.isArray(payload.service_id)
      ? payload.service_id
      : (payload.service_ids || [payload.service_id].filter(Boolean))

    return this.bookOnline({
      name: payload.name || payload.client_name || "Cliente",
      phone: payload.phone || payload.client_phone || "",
      barberId: payload.barber_id || payload.barberId,
      serviceIds: serviceIds,
      appointmentTime: payload.appointment_time || payload.appointmentTime
    })
  },

  async rescheduleOnline({ appointmentId, newAppointmentTime, newBarberId = null, serviceIds = null }) {
    const { data, error } = await supabase.rpc('reschedule_appointment_online', {
      p_appointment_id: appointmentId,
      p_new_appointment_time: newAppointmentTime,
      p_new_barber_id: newBarberId,
      p_service_ids: serviceIds
    })
    if (error) {
      let msg = error.message
      if (msg.includes('HORARIO_INDISPONIVEL')) {
        msg = 'O horário selecionado já está ocupado ou reservado para este profissional.'
      } else if (msg.includes('FORA_DO_EXPEDIENTE')) {
        msg = 'O horário selecionado está fora do expediente de funcionamento do CLUB 01.'
      } else if (msg.includes('ANTECEDENCIA_MINIMA')) {
        msg = 'O horário selecionado não atende à antecedência mínima exigida para remarcação.'
      } else if (msg.includes('PROFISSIONAL_NAO_HABILITADO')) {
        msg = 'O profissional selecionado não realiza um ou mais dos procedimentos escolhidos.'
      } else if (msg.includes('AGENDAMENTO_CANCELADO')) {
        msg = 'Este agendamento já se encontra cancelado e não pode ser remarcado.'
      } else if (msg.includes('AGENDAMENTO_CONCLUIDO')) {
        msg = 'Este agendamento já foi concluído e não pode ser remarcado.'
      } else if (msg.includes('ACESSO_NEGADO')) {
        msg = 'Você não possui permissão para remarcar este agendamento.'
      } else if (msg.includes('AGENDAMENTO_NAO_ENCONTRADO')) {
        msg = 'O agendamento solicitado não foi encontrado.'
      }
      throw new Error(msg)
    }
    return data
  },

  async deleteServiceCaixa(appointmentId) {
    if (!appointmentId) return
    try {
      await supabase
        .from("caixa")
        .delete()
        .eq("appointment_id", appointmentId)
        .not("category", "in", '("Venda de Produtos","Produto")')
        .not("id", "like", "caixa-sale-%")
      await supabase
        .from("caixa")
        .delete()
        .eq("id", `cx-srv-${appointmentId}`)
    } catch (err) {
      console.warn("Aviso ao limpar lançamento de serviço no caixa:", err)
    }
  },

  async update(id, fields) {
    const validKeys = ['barber_id', 'service_id', 'client_id', 'appointment_time', 'status', 'cancellation_reason']
    const cleanFields = {}
    for (const key of Object.keys(fields || {})) {
      if (validKeys.includes(key)) {
        cleanFields[key] = fields[key]
      }
    }

    const { data, error } = await supabase
      .from("appointments")
      .update(cleanFields)
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)

    if (cleanFields.status === "cancelled" || cleanFields.status === "absent") {
      await this.deleteServiceCaixa(id)
    }

    return data
  },

  async cancel(id, reason = null) {
    const { data, error } = await supabase
      .from("appointments")
      .update({
        status: "cancelled",
        cancellation_reason: reason || null
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)

    await this.deleteServiceCaixa(id)

    return data
  },

  async cancelRange(params = {}) {
    const barberId = params.barberId || params.barber_id
    const date = params.date
    const startTime = params.startTime || params.start_time
    const endTime = params.endTime || params.end_time
    const reason = params.reason

    if (!barberId || !date || !startTime || !endTime) {
      throw new Error("Parâmetros obrigatórios ausentes para o bloqueio de horário.")
    }

    const cancelReason = (reason && reason.trim()) ? reason.trim().toUpperCase() : "BLOQUEIO DE AGENDA"
    const [startH, startM] = String(startTime).split(":").map(Number)
    const [endH, endM] = String(endTime).split(":").map(Number)
    const startTotalMin = startH * 60 + startM
    const endTotalMin = endH * 60 + endM

    const { data: custExists } = await supabase.from("customers").select("id").eq("id", "cust-bloqueio-sistema").maybeSingle()
    if (!custExists) {
      await supabase.from("customers").insert({
        id: "cust-bloqueio-sistema",
        name: "BLOQUEIO DE AGENDA",
        phone: "00000000000"
      })
    }

    const { data: srvs } = await supabase.from("services").select("id").limit(1)
    const defaultServiceId = srvs?.[0]?.id || "srv-corte"

    const { data: existingAppts } = await supabase
      .from("appointments")
      .select("id, appointment_time, status, client_id")
      .eq("barber_id", barberId)
      .like("appointment_time", `${date}%`)

    let createdCount = 0
    for (let currentMin = startTotalMin; currentMin < endTotalMin; currentMin += 30) {
      const h = String(Math.floor(currentMin / 60)).padStart(2, "0")
      const m = String(currentMin % 60).padStart(2, "0")
      const slotTimeStr = `${date}T${h}:${m}`

      const existingAtSlot = existingAppts ? existingAppts.find(a => a.appointment_time === slotTimeStr) : null
      if (existingAtSlot) {
        if (existingAtSlot.status === "confirmed" || existingAtSlot.status === "completed") {
          continue
        }
        if (existingAtSlot.status === "cancelled" && existingAtSlot.client_id === "cust-bloqueio-sistema") {
          await supabase.from("appointments").update({ cancellation_reason: cancelReason }).eq("id", existingAtSlot.id)
          createdCount++
          continue
        }
      }

      await supabase.from("appointments").insert({
        id: crypto.randomUUID(),
        client_id: "cust-bloqueio-sistema",
        barber_id: barberId,
        service_id: defaultServiceId,
        appointment_time: slotTimeStr,
        status: "cancelled",
        cancellation_reason: cancelReason
      })
      createdCount++
    }

    return { count: createdCount }
  },

  async removeBloqueio(appointment) {
    if (!appointment) return true
    if (appointment.cancellation_reason) {
      const dateStr = appointment.appointment_time?.split("T")[0]
      const { error } = await supabase
        .from("appointments")
        .delete()
        .eq("barber_id", appointment.barber_id)
        .eq("status", "cancelled")
        .eq("cancellation_reason", appointment.cancellation_reason)
        .like("appointment_time", `${dateStr}%`)
      if (error) throw new Error(error.message)
      return true
    }
    const { error } = await supabase.from("appointments").delete().eq("id", appointment.id)
    if (error) throw new Error(error.message)
    return true
  },

  async delete(id) {
    await this.deleteServiceCaixa(id)
    const { error } = await supabase.from("appointments").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 5. PRODUTOS E ESTOQUE
// ==============================================================================
export const productsApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name")
    if (error) throw new Error(error.message)
    return data || []
  },

  async create(product) {
    const { data, error } = await supabase
      .from("products")
      .insert({
        name: product.name,
        description: product.description || null,
        supplier: product.supplier || null,
        supplier_contact_name: product.supplier_contact_name || null,
        supplier_contact_phone: product.supplier_contact_phone || null,
        cost_price: Number(product.cost_price) || 0,
        sale_price: Number(product.sale_price) || 0,
        stock_quantity: Number(product.stock_quantity) || 0,
        photo: product.photo || null
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async update(id, product) {
    const { data, error } = await supabase
      .from("products")
      .update({
        name: product.name,
        description: product.description || null,
        supplier: product.supplier || null,
        supplier_contact_name: product.supplier_contact_name || null,
        supplier_contact_phone: product.supplier_contact_phone || null,
        cost_price: Number(product.cost_price) || 0,
        sale_price: Number(product.sale_price) || 0,
        stock_quantity: Number(product.stock_quantity) || 0,
        photo: product.photo || null
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("products").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 6. VENDAS
// ==============================================================================
export const salesApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("sales")
      .select(`
        *,
        customers (id, name, phone),
        appointments (id, appointment_time, barber_id),
        sale_items (*, products (id, name, photo))
      `)
      .order("sale_date", { ascending: false })
    if (error) throw new Error(error.message)

    return (data || []).map(s => ({
      ...s,
      customer_name: s.customers?.name || "Cliente Balcão",
      customer_phone: s.customers?.phone || "",
      items: s.sale_items || []
    }))
  },

  async get(id) {
    const { data, error } = await supabase
      .from("sales")
      .select(`
        *,
        customers (id, name, phone),
        appointments (id, appointment_time, barber_id),
        sale_items (*, products (id, name, photo))
      `)
      .eq("id", id)
      .single()
    if (error) throw new Error(error.message)
    return {
      ...data,
      customer_name: data.customers?.name || "Cliente Balcão",
      items: data.sale_items || []
    }
  },

  async getByAppointment(appointmentId) {
    const { data, error } = await supabase
      .from("sales")
      .select(`
        *,
        customers (id, name, phone),
        sale_items (*, products (id, name, photo))
      `)
      .eq("appointment_id", appointmentId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      ...data,
      items: data.sale_items || []
    }
  },

  async createAtomic({ appointmentId = null, customerId = null, paymentMethod, items, registerInCaixa = true }) {
    const formattedItems = (items || []).map(item => ({
      product_id: item.product_id || item.id,
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price || item.sale_price) || 0
    }))

    const { data, error } = await supabase.rpc("create_sale_atomic", {
      p_appointment_id: appointmentId,
      p_customer_id: customerId,
      p_payment_method: paymentMethod,
      p_items: formattedItems,
      p_register_in_caixa: registerInCaixa
    })
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("sales").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 7. CAIXA E FLUXO FINANCEIRO
// ==============================================================================
export const caixaApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("caixa")
      .select("*, barbers(id, name), appointments(*)")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
    if (error) throw new Error(error.message)

    return (data || []).map(c => ({
      ...c,
      barber_name: c.barbers?.name || null
    }))
  },

  async create(entry) {
    const { data, error } = await supabase
      .from("caixa")
      .insert({
        type: entry.type,
        description: entry.description,
        amount: Number(entry.amount) || 0,
        category: entry.category,
        payment_method: entry.payment_method || null,
        appointment_id: entry.appointment_id || null,
        barber_id: entry.barber_id || null,
        date: entry.date || new Date().toISOString().split("T")[0]
      })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async update(id, entry) {
    const { data, error } = await supabase
      .from("caixa")
      .update({
        type: entry.type,
        description: entry.description,
        amount: Number(entry.amount) || 0,
        category: entry.category,
        payment_method: entry.payment_method,
        barber_id: entry.barber_id,
        date: entry.date
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("caixa").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  },

  async sync() {
    const [appointments, existingCaixaRes] = await Promise.all([
      appointmentsApi.getAll(),
      supabase.from("caixa").select("id, appointment_id, category")
    ])
    if (existingCaixaRes.error) throw new Error(existingCaixaRes.error.message)

    const cancelledOrAbsentIds = new Set(
      (appointments || [])
        .filter(a => a.status === "cancelled" || a.status === "absent")
        .map(a => a.id)
    )

    const staleCaixaIds = (existingCaixaRes.data || [])
      .filter(c => {
        const isProduct = c.category === "Venda de Produtos" || c.category === "Produto" || c.id?.startsWith("caixa-sale-")
        if (isProduct) return false
        const linkedId = c.appointment_id || (c.id?.startsWith("cx-srv-") ? c.id.replace("cx-srv-", "") : null)
        return linkedId && cancelledOrAbsentIds.has(linkedId)
      })
      .map(c => c.id)

    if (staleCaixaIds.length > 0) {
      await supabase.from("caixa").delete().in("id", staleCaixaIds)
    }

    const syncedAppointmentIds = new Set(
      (existingCaixaRes.data || [])
        .filter(c => !staleCaixaIds.includes(c.id) && c.appointment_id && c.category !== "Venda de Produtos" && c.category !== "Produto" && !c.id?.startsWith("caixa-sale-"))
        .map(c => c.appointment_id)
    )

    const toSync = (appointments || []).filter(a => {
      const isRealized = a.status === "completed" || a.status === "confirmed"
      return isRealized && !syncedAppointmentIds.has(a.id) && Number(a.price || 0) > 0
    })

    if (toSync.length === 0) {
      return { synced_count: 0 }
    }

    const fallbackDate = new Date().toISOString().split("T")[0]
    const rows = toSync.map(a => ({
      type: "receita",
      description: `Atendimento - ${a.client_name || "Cliente"} (${a.service_name || "Serviço"})`,
      amount: Number(a.price) || 0,
      category: "Serviços",
      payment_method: null,
      appointment_id: a.id,
      barber_id: a.barber_id || null,
      date: a.appointment_time ? String(a.appointment_time).replace(" ", "T").split("T")[0] : fallbackDate
    }))

    const { data, error } = await supabase.from("caixa").insert(rows).select("id")
    if (error) throw new Error(error.message)

    return { synced_count: (data || []).length }
  }
}

// ==============================================================================
// 8. CONFIGURAÇÕES
// ==============================================================================
export const settingsApi = {
  async getAll() {
    const { data, error } = await supabase.from("settings").select("*")
    if (error) throw new Error(error.message)
    const map = {}
    ;(data || []).forEach(item => {
      map[item.key] = item.value
    })
    return map
  },

  async update(key, value) {
    const { data, error } = await supabase
      .from("settings")
      .upsert({ key, value: String(value) }, { onConflict: "key" })
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async updateMany(settingsMap) {
    const rows = Object.entries(settingsMap).map(([key, value]) => ({
      key,
      value: String(value)
    }))
    const { data, error } = await supabase
      .from("settings")
      .upsert(rows, { onConflict: "key" })
      .select()
    if (error) throw new Error(error.message)
    return data
  }
}

// ==============================================================================
// 9. USUÁRIOS DO SISTEMA
// ==============================================================================
export const usersApi = {
  async getAll() {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("name")
    if (error) throw new Error(error.message)
    return data || []
  },

  async updateRole(id, role) {
    const { data, error } = await supabase
      .from("users")
      .update({ role })
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async update(id, fields) {
    const { data, error } = await supabase
      .from("users")
      .update(fields)
      .eq("id", id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data
  },

  async delete(id) {
    const { error } = await supabase.from("users").delete().eq("id", id)
    if (error) throw new Error(error.message)
    return true
  }
}

// ==============================================================================
// 10. WHATSAPP LOGS & CONFIGURAÇÕES (FASE 6)
// ==============================================================================
export const whatsappLogsApi = {
  async getAll(statusFilter, typeFilter) {
    try {
      // 1. Tenta buscar da nova fila rica de notificações (Fase 6)
      let queueQuery = supabase
        .from("notification_queue")
        .select("*, appointments(id, appointment_time)")
        .order("created_at", { ascending: false })
        .limit(200)

      if (statusFilter) {
        queueQuery = queueQuery.eq("status", statusFilter)
      }
      if (typeFilter) {
        // Mapeia filtro legado para novos tipos de eventos
        const mappedType = typeFilter === "confirmation" ? "new_appointment"
          : typeFilter === "reminder" ? "reminder_30m"
          : typeFilter === "cancellation" ? "cancellation"
          : typeFilter
        queueQuery = queueQuery.eq("event_type", mappedType)
      }

      const { data: queueData, error: queueError } = await queueQuery

      if (!queueError && queueData) {
        return queueData.map(item => ({
          id: item.id,
          appointment_id: item.appointment_id,
          message_type: item.event_type === "new_appointment" ? "confirmation"
            : item.event_type === "reminder_30m" ? "reminder"
            : item.event_type === "cancellation" ? "cancellation"
            : "reschedule",
          event_type: item.event_type,
          recipient_type: item.recipient_type,
          customer_name: item.recipient_name,
          phone: item.recipient_phone,
          status: item.status,
          attempts: item.attempts,
          last_error: item.last_error,
          sent_at: item.processed_at,
          created_at: item.created_at,
          scheduled_for: item.scheduled_for,
          appointments: item.appointments,
          metadata: item.metadata
        }))
      }
    } catch {
      // Continua para fallback legado
    }

    // 2. Fallback resiliente para tabela legado whatsapp_logs
    let query = supabase
      .from("whatsapp_logs")
      .select("*, appointments(id, appointment_time)")
      .order("created_at", { ascending: false })
      .limit(200)

    if (statusFilter) query = query.eq("status", statusFilter)
    if (typeFilter) query = query.eq("message_type", typeFilter)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return (data || []).map(item => ({
      id: item.id,
      appointment_id: item.appointment_id,
      message_type: item.message_type,
      event_type: item.message_type === "confirmation" ? "new_appointment"
        : item.message_type === "reminder" ? "reminder_30m"
        : item.message_type === "cancellation" ? "cancellation"
        : "reschedule",
      recipient_type: "client",
      customer_name: "Cliente",
      phone: item.phone,
      status: item.status,
      attempts: 1,
      last_error: null,
      sent_at: item.sent_at,
      created_at: item.created_at,
      scheduled_for: item.scheduled_time,
      appointments: item.appointments
    }))
  }
}

export const whatsappConfigApi = {
  async getStatus() {
    try {
      const { data, error } = await supabase
        .from("notification_queue")
        .select("status")

      if (!error && data) {
        const counts = { pending: 0, sent: 0, simulated: 0, failed: 0, cancelled: 0, skipped: 0, unknown: 0 }
        for (const r of data) {
          if (counts[r.status] !== undefined) counts[r.status]++
        }
        return {
          instance_name: "Meu Bolso Digital",
          dry_run: true,
          enabled: false,
          reminder_lead_minutes: 30,
          counts
        }
      }
    } catch {
      // Ignora erro
    }

    return {
      instance_name: "Meu Bolso Digital",
      dry_run: true,
      enabled: false,
      reminder_lead_minutes: 30,
      counts: { pending: 0, sent: 0, simulated: 0, failed: 0, cancelled: 0, skipped: 0, unknown: 0 }
    }
  }
}

