import React, { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext.jsx"
import { servicesApi, barbersApi, appointmentsApi, settingsApi } from "../lib/api.js"
import { Calendar as CalendarIcon, Clock, User, Scissors, Star, ArrowLeft, CheckCircle2, AlertTriangle, CalendarDays, MessageCircle, Phone, ChevronLeft, ChevronRight } from "lucide-react"

export default function Agendar() {
  const { user, token } = useAuth()

  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [appointments, setAppointments] = useState([])

  // Etapas do fluxo de agendamento (1, 2 ou 3)
  const [bookingStep, setBookingStep] = useState(1)

  // Etapa 1: Dados do Cliente
  const [clientName, setClientName] = useState("")
  const [clientPhone, setClientPhone] = useState("")

  // Etapa 2: Barbeiro e Múltiplos Serviços
  const [selectedBarber, setSelectedBarber] = useState("")
  const [selectedServices, setSelectedServices] = useState([]) // Array de IDs de serviços

  // Etapa 3: Data e Horário
  const [selectedDate, setSelectedDate] = useState("")
  const [selectedTime, setSelectedTime] = useState("")

  // Controle do calendário (Mês e Ano selecionados para navegação)
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth())
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear())

  const [loading, setLoading] = useState(true)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [error, setError] = useState("")
  const [slotWarning, setSlotWarning] = useState("")
  const [successMsg, setSuccessMsg] = useState("")
  const [minLeadTimeMinutes, setMinLeadTimeMinutes] = useState(() => {
    const cached = localStorage.getItem("minLeadTimeMinutes")
    return cached !== null && !isNaN(Number(cached)) ? Number(cached) : 30
  })

  // Sincronizar parâmetro de antecedência se atualizado no localStorage ou evento
  useEffect(() => {
    const handleStorageUpdate = () => {
      const cached = localStorage.getItem("minLeadTimeMinutes")
      if (cached !== null && !isNaN(Number(cached))) {
        setMinLeadTimeMinutes(Number(cached))
      }
    }
    window.addEventListener("storage", handleStorageUpdate)
    window.addEventListener("storage_settings_updated", handleStorageUpdate)
    return () => {
      window.removeEventListener("storage", handleStorageUpdate)
      window.removeEventListener("storage_settings_updated", handleStorageUpdate)
    }
  }, [])

  // Inicializar nome e telefone com dados do usuário logado se houver
  useEffect(() => {
    if (user) {
      setClientName(user.name || "")
      setClientPhone(user.phone || "")
    }
  }, [user])

  // Carregar dados iniciais de serviços, barbeiros e agendamentos existentes
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        const [srvData, barbData, apptData, cfgData] = await Promise.all([
          servicesApi.getPublic().catch(() => []),
          barbersApi.getAll().catch(() => []),
          appointmentsApi.getOccupiedSlots().catch(() => []),
          settingsApi.getAll().catch(() => ({}))
        ])

        setServices(srvData || [])
        setBarbers(barbData || [])
        setAppointments(apptData || [])

        if (cfgData && cfgData.min_lead_time_minutes !== undefined) {
          const minutes = Number(cfgData.min_lead_time_minutes)
          if (!isNaN(minutes)) {
            setMinLeadTimeMinutes(minutes)
            localStorage.setItem("minLeadTimeMinutes", String(minutes))
          }
        }
      } catch (err) {
        console.error("Erro ao carregar dados:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [token])

  // Aplicar máscara no telefone brasileiro: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
  const formatPhoneNumber = (value) => {
    if (!value) return value
    const phoneNumber = value.replace(/[^\d]/g, "")
    const phoneNumberLength = phoneNumber.length

    if (phoneNumberLength < 3) return phoneNumber
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2)}`
    }
    if (phoneNumberLength < 11) {
      return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2, 6)}-${phoneNumber.slice(6)}`
    }
    return `(${phoneNumber.slice(0, 2)}) ${phoneNumber.slice(2, 7)}-${phoneNumber.slice(7, 11)}`
  }

  // Gerar horários dinâmicos com base na data (dia da semana)
  const getTimeSlots = (dateString) => {
    if (!dateString) return []
    const dateParts = dateString.split("-")
    const date = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
    const dayOfWeek = date.getDay() // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

    if (dayOfWeek === 0) return [] // Domingo fechado

    const slots = []
    const startHour = dayOfWeek === 6 ? 8 : 9
    const endHour = dayOfWeek === 6 ? 19 : 20 // Horários: Seg-Sex das 09:00 às 20:00, Sábados das 08:00 às 19:00

    for (let h = startHour; h < endHour; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`)
      slots.push(`${String(h).padStart(2, '0')}:30`)
    }
    return slots
  }

  // Verificar se o horário possui antecedência mínima para agendamentos imediatos
  const isTimeSlotWithinLeadTime = (dateString, timeString) => {
    if (!dateString || !timeString) return false
    const dateParts = dateString.split("-").map(Number)
    const timeParts = timeString.split(":").map(Number)
    if (dateParts.length < 3 || timeParts.length < 2) return false
    const appointmentDateTime = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], 0, 0)
    const now = new Date()
    const leadTime = (typeof minLeadTimeMinutes === "number" && !isNaN(minLeadTimeMinutes)) ? minLeadTimeMinutes : 30
    return (appointmentDateTime.getTime() - now.getTime()) < leadTime * 60 * 1000
  }

  // Cálculo acumulado de duração para os serviços selecionados
  const selectedServicesDetails = services.filter(s => selectedServices.includes(s.id))
  const totalDurationMinutes = selectedServicesDetails.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0)

  // Avaliar e retornar o motivo exato pelo qual um horário não pode ser agendado devido à duração dos serviços ou conflitos
  const getTimeSlotStatusReason = (dateString, timeString, targetBarberId = selectedBarber) => {
    if (!dateString || !timeString) return null

    // 1. Verificar antecedência mínima configurada para agendamentos imediatos
    if (isTimeSlotWithinLeadTime(dateString, timeString)) {
      const leadTime = (typeof minLeadTimeMinutes === "number" && !isNaN(minLeadTimeMinutes)) ? minLeadTimeMinutes : 30
      if (leadTime > 0) {
        return `Horário indisponível: agendamentos online requerem antecedência mínima de ${leadTime} minutos.`
      }
      return "Horário indisponível: este horário já passou."
    }

    if (!targetBarberId) return null

    const barbObj = barbers.find(b => String(b.id) === String(targetBarberId))
    const barbName = barbObj ? barbObj.name : null

    const [slotH, slotM] = timeString.split(':').map(Number)
    if (isNaN(slotH) || isNaN(slotM)) return null

    const slotStartMinutes = slotH * 60 + slotM
    const requestedDuration = selectedServices.length > 0 ? totalDurationMinutes : 30
    const slotEndMinutes = slotStartMinutes + requestedDuration

    let closingHour = 20
    if (dateString) {
      const dateParts = dateString.split("-")
      if (dateParts.length === 3) {
        const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
        if (dateObj.getDay() === 6) closingHour = 19
      }
    }
    const closingMinutes = closingHour * 60
    if (slotEndMinutes > closingMinutes) {
      const endH = String(Math.floor(slotEndMinutes / 60)).padStart(2, '0')
      const endM = String(slotEndMinutes % 60).padStart(2, '0')
      return `O(s) serviço(s) selecionado(s) possuem duração total de ${requestedDuration} min. Iniciando às ${timeString}, o atendimento terminaria às ${endH}:${endM}, ultrapassando o horário de encerramento das ${closingHour}:00.`
    }

    // 2. Verificar conflitos com agendamentos ou bloqueios existentes
    for (const appt of appointments) {
      if (appt.status === 'cancelled' && !appt.cancellation_reason) continue
      if (!appt.appointment_time || !appt.appointment_time.startsWith(dateString)) continue

      const matchesBarberId = appt.barber_id && (
        String(appt.barber_id) === String(targetBarberId) ||
        (barbObj?.user_id && String(appt.barber_id) === String(barbObj.user_id)) ||
        (barbObj?.id && String(appt.barber_id) === String(barbObj.id))
      )
      const matchesBarberName = barbName && appt.barber_name && appt.barber_name.trim().toLowerCase() === barbName.trim().toLowerCase()
      if (!matchesBarberId && !matchesBarberName) continue

      const timePart = appt.appointment_time.split('T')[1] || ""
      const [apptH, apptM] = timePart.split(':').map(Number)
      if (isNaN(apptH) || isNaN(apptM)) continue

      const apptStartMinutes = apptH * 60 + apptM
      const apptDuration = (appt.duration_minutes !== undefined && appt.duration_minutes !== null) ? Number(appt.duration_minutes) : 30
      if (apptDuration === 0) continue

      const apptEndMinutes = apptStartMinutes + apptDuration

      const overlapStart = Math.max(slotStartMinutes, apptStartMinutes)
      const overlapEnd = Math.min(slotEndMinutes, apptEndMinutes)

      if (overlapStart < overlapEnd) {
        const apptStartH = String(Math.floor(apptStartMinutes / 60)).padStart(2, '0')
        const apptStartMStr = String(apptStartMinutes % 60).padStart(2, '0')
        const apptEndH = String(Math.floor(apptEndMinutes / 60)).padStart(2, '0')
        const apptEndMStr = String(apptEndMinutes % 60).padStart(2, '0')

        if (slotStartMinutes === apptStartMinutes) {
          if (appt.cancellation_reason) {
            return `Horário bloqueado na agenda do profissional (${appt.cancellation_reason}).`
          }
          return `Este profissional já possui um agendamento reservado às ${timeString}.`
        }

        return `A duração de ${requestedDuration} min do(s) serviço(s) selecionado(s) não cabe neste intervalo e entra em conflito com outro agendamento existente das ${apptStartH}:${apptStartMStr} às ${apptEndH}:${apptEndMStr}.`
      }
    }

    return null
  }

  // Auto-resetar horário se a alteração de serviço/profissional o tornar indisponível
  useEffect(() => {
    if (selectedTime && selectedDate && selectedBarber) {
      const reason = getTimeSlotStatusReason(selectedDate, selectedTime, selectedBarber)
      if (reason) {
        setSelectedTime("")
        setSlotWarning(reason)
      } else {
        setSlotWarning("")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices, selectedBarber, selectedDate, selectedTime])

  // Renderizador do Calendário
  const renderCalendar = () => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate()
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay()

    const monthNames = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ]

    const days = []
    for (let i = 0; i < firstDayIndex; i++) {
      days.push(<div key={`empty-${i}`} className="w-10 h-10 md:w-11 md:h-11"></div>)
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDate = new Date(calendarYear, calendarMonth, day)
      const dateString = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      const isPast = currentDate < today
      const isSunday = currentDate.getDay() === 0
      const isSelected = selectedDate === dateString

      days.push(
        <button
          key={`day-${day}`}
          type="button"
          disabled={isPast || isSunday}
          onClick={() => {
            setSelectedDate(dateString)
            setSelectedTime("")
          }}
          className={`w-10 h-10 md:w-11 md:h-11 rounded-xl flex items-center justify-center text-sm font-semibold transition-all cursor-pointer ${
            isSelected
              ? "bg-primary text-primary-foreground font-bold shadow-md scale-105"
              : isPast || isSunday
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "hover:bg-muted text-foreground active:scale-95"
          }`}
        >
          {day}
        </button>
      )
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <button
            type="button"
            onClick={() => {
              if (calendarMonth === 0) {
                setCalendarMonth(11)
                setCalendarYear(prev => prev - 1)
              } else {
                setCalendarMonth(prev => prev - 1)
              }
            }}
            className="inline-flex items-center gap-1 min-h-[44px] px-3 py-2 hover:bg-muted rounded-xl text-foreground cursor-pointer text-xs font-semibold transition-colors"
          >
            <ChevronLeft size={16} />
            <span>Mês anterior</span>
          </button>

          <div className="font-display text-base md:text-lg tracking-wide uppercase text-foreground">
            {monthNames[calendarMonth]} <span className="text-muted-foreground">{calendarYear}</span>
          </div>

          <button
            type="button"
            onClick={() => {
              if (calendarMonth === 11) {
                setCalendarMonth(0)
                setCalendarYear(prev => prev + 1)
              } else {
                setCalendarMonth(prev => prev + 1)
              }
            }}
            className="inline-flex items-center gap-1 min-h-[44px] px-3 py-2 hover:bg-muted rounded-xl text-foreground cursor-pointer text-xs font-semibold transition-colors"
          >
            <span>Próximo</span>
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          <div>Dom</div>
          <div>Seg</div>
          <div>Ter</div>
          <div>Qua</div>
          <div>Qui</div>
          <div>Sex</div>
          <div>Sáb</div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center justify-items-center">
          {days}
        </div>
      </div>
    )
  }

  const handleCreateAppointment = async (e) => {
    if (e) e.preventDefault()
    setError("")
    setSuccessMsg("")

    if (!clientName.trim()) {
      setError("Por favor, preencha o seu nome completo na Etapa 1.")
      setBookingStep(1)
      return
    }
    if (!clientPhone.trim()) {
      setError("Por favor, preencha o seu telefone/Whatsapp na Etapa 1.")
      setBookingStep(1)
      return
    }
    if (!selectedBarber) {
      setError("Por favor, selecione um profissional na Etapa 2.")
      setBookingStep(2)
      return
    }
    if (selectedServices.length === 0) {
      setError("Por favor, selecione ao menos um serviço na Etapa 2.")
      setBookingStep(2)
      return
    }
    if (!selectedDate || !selectedTime) {
      setError("Por favor, selecione a data e o horário na Etapa 3.")
      setBookingStep(3)
      return
    }

    const slotReason = getTimeSlotStatusReason(selectedDate, selectedTime, selectedBarber)
    if (slotReason) {
      setError(slotReason)
      setBookingStep(3)
      return
    }

    setSubmitLoading(true)
    const appointmentTime = `${selectedDate}T${selectedTime}`

    try {
      await appointmentsApi.bookOnline({
        name: clientName,
        phone: clientPhone,
        barberId: selectedBarber,
        serviceIds: selectedServices,
        appointmentTime
      })

      setSuccessMsg("Agendamento realizado com sucesso! Você receberá os detalhes de confirmação.")

      // Limpar formulário
      setSelectedServices([])
      setSelectedBarber("")
      setSelectedDate("")
      setSelectedTime("")
      setBookingStep(1)

      // Atualizar lista de horários ocupados
      const updatedOccupied = await appointmentsApi.getOccupiedSlots().catch(() => [])
      setAppointments(updatedOccupied)
    } catch (err) {
      setError(err.message || "Erro de conexão ao realizar agendamento.")
    } finally {
      setSubmitLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground pt-24 pb-16 px-4 md:px-8 flex flex-col items-center justify-start">
      {/* Botão Voltar */}
      <div className="w-full max-w-4xl mb-4 flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-border bg-card/80 backdrop-blur-md text-foreground hover:bg-muted transition-all duration-200"
          title="Voltar para o início"
        >
          <ArrowLeft size={18} />
          <span className="text-sm font-semibold">Voltar</span>
        </Link>
        <span className="font-display text-sm uppercase tracking-widest text-muted-foreground">
          CLUB 01 Barber Studio
        </span>
      </div>

      <div className="w-full max-w-4xl club-card p-6 md:p-10 z-10">
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-8">
          <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight uppercase text-foreground mb-3">
            Agendar Horário
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base font-medium">
            Escolha seu barbeiro, serviços e horário em 3 etapas simples.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-4 mb-6">
            <AlertTriangle size={18} className="shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex flex-col items-center justify-center text-center bg-card border border-border text-foreground text-sm rounded-2xl p-8 mb-6 gap-4 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <CheckCircle2 size={36} />
            </div>
            <h2 className="font-display text-2xl md:text-3xl tracking-wide uppercase font-bold text-foreground">
              Agendamento Confirmado!
            </h2>
            <p className="font-medium text-muted-foreground max-w-md">
              {successMsg}
            </p>
            {user ? (
              <Link to="/dashboard" className="btn-primary mt-2">
                Ir para o Painel de Agendamentos
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setSuccessMsg("")}
                className="btn-primary mt-2"
              >
                Fazer outro agendamento
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col justify-center items-center py-16 gap-3">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm text-muted-foreground font-medium">Carregando horários e serviços...</span>
          </div>
        ) : !successMsg && (
          <>
            {/* Indicador de Etapas */}
            <div className="flex items-center justify-between mb-8 max-w-md mx-auto relative select-none px-4">
              <div className="absolute top-1/2 left-8 right-8 h-0.5 bg-border -translate-y-1/2 z-0"></div>
              <div
                className="absolute top-1/2 left-8 h-0.5 bg-primary -translate-y-1/2 z-0 transition-all duration-300"
                style={{ width: `${((bookingStep - 1) / 2) * 80}%` }}
              ></div>

              {[
                { step: 1, label: "Contato" },
                { step: 2, label: "Serviços" },
                { step: 3, label: "Horário" }
              ].map(({ step: s, label }) => (
                <div key={s} className="flex flex-col items-center gap-1.5 z-10">
                  <button
                    type="button"
                    onClick={() => {
                      if (s < bookingStep) {
                        setBookingStep(s)
                      } else if (s === 2 && clientName.trim() && clientPhone.trim()) {
                        setBookingStep(2)
                      } else if (s === 3 && clientName.trim() && clientPhone.trim() && selectedBarber && selectedServices.length > 0) {
                        setBookingStep(3)
                      }
                    }}
                    className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm transition-all cursor-pointer ${
                      bookingStep === s
                        ? "bg-primary text-primary-foreground ring-4 ring-primary/20 scale-105"
                        : bookingStep > s
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border text-muted-foreground hover:border-foreground"
                    }`}
                  >
                    {s}
                  </button>
                  <span className={`text-xs font-semibold uppercase tracking-wider ${
                    bookingStep === s ? "text-foreground" : "text-muted-foreground"
                  }`}>
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-6">
              {/* ETAPA 1 */}
              {bookingStep === 1 && (
                <div className="space-y-6">
                  <div className="border-b border-border pb-3 text-center">
                    <h3 className="font-display text-2xl tracking-wide uppercase text-foreground">
                      Seus dados de Contato
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-1">
                      Informe seu nome e WhatsApp para localizarmos sua reserva.
                    </p>
                  </div>

                  <div className="space-y-4 max-w-lg mx-auto">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        Nome Completo
                      </label>
                      <input
                        type="text"
                        required
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="Digite seu nome completo"
                        className="club-input w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        WhatsApp / Celular
                      </label>
                      <input
                        type="tel"
                        required
                        value={clientPhone}
                        onChange={(e) => setClientPhone(formatPhoneNumber(e.target.value))}
                        maxLength={15}
                        placeholder="Ex: (34) 99999-9999"
                        className="club-input w-full"
                      />
                    </div>
                  </div>

                  <div className="pt-2 max-w-lg mx-auto">
                    <button
                      type="button"
                      disabled={!clientName.trim() || !clientPhone.trim()}
                      onClick={() => setBookingStep(2)}
                      className="btn-primary w-full text-base h-14"
                    >
                      Avançar para Barbeiro e Serviços
                    </button>
                  </div>
                </div>
              )}

              {/* ETAPA 2 */}
              {bookingStep === 2 && (
                <div className="space-y-8">
                  <div className="border-b border-border pb-3 text-center">
                    <h3 className="font-display text-2xl tracking-wide uppercase text-foreground">
                      Profissional e Serviços
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-1">
                      Escolha o profissional de sua preferência e os serviços desejados.
                    </p>
                  </div>

                  {/* Selecionar Barbeiro */}
                  <div className="space-y-4 text-center">
                    <label className="text-xs md:text-sm font-semibold uppercase tracking-wider text-foreground block">
                      Selecione o Barbeiro
                    </label>
                    <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10 py-2">
                      {barbers.map((barb) => {
                        const isSelected = selectedBarber === barb.id
                        const nameLower = (barb.name || "").toLowerCase()
                        const barberPhoto = barb.photo
                          ? barb.photo
                          : nameLower.includes("marcio") || nameLower.includes("márcio")
                            ? "/assets/marcio-barber.jpeg"
                            : nameLower.includes("lucas")
                              ? "/assets/lucas-barber.jpeg"
                              : "/assets/neto-barber.jpeg"

                        const rawFirst = (barb.name || "").trim().split(/\s+/)[0] || ""
                        const firstName = rawFirst ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1).toLowerCase() : ""

                        return (
                          <button
                            key={barb.id}
                            type="button"
                            onClick={() => setSelectedBarber(barb.id)}
                            className="group flex flex-col items-center gap-2.5 bg-transparent border-none p-2 rounded-2xl cursor-pointer focus:outline-none transition-transform"
                            title={barb.name}
                          >
                            <div className={`relative w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden border-2 transition-all duration-300 ${
                              isSelected
                                ? "border-primary ring-4 ring-primary/20 scale-105"
                                : "border-border hover:border-foreground/60 group-hover:scale-102"
                            }`}>
                              <img
                                src={barberPhoto}
                                alt={barb.name}
                                className="w-full h-full object-cover object-top"
                              />
                            </div>
                            <span className={`font-display text-base tracking-wide uppercase transition-colors ${
                              isSelected ? "text-primary font-bold" : "text-muted-foreground group-hover:text-foreground"
                            }`}>
                              {firstName}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Selecionar Serviços (Múltiplo) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs md:text-sm font-semibold uppercase tracking-wider text-foreground block">
                        Serviços Desejados
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {selectedServices.length > 0 ? `${selectedServices.length} selecionado(s)` : "Selecione um ou mais"}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {services.filter(srv => !srv.restricted_access && !srv.acesso_restrito).map(srv => {
                        const isSelected = selectedServices.includes(srv.id)
                        return (
                          <button
                            key={srv.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setSelectedServices(prev => prev.filter(id => id !== srv.id))
                              } else {
                                setSelectedServices(prev => [...prev, srv.id])
                              }
                            }}
                            className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer min-h-[56px] ${
                              isSelected
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-card text-foreground hover:border-foreground/50"
                            }`}
                          >
                            <div className="flex items-center gap-3.5">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${
                                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                              }`}>
                                {isSelected && <span className="text-[11px] font-bold">✓</span>}
                              </div>
                              <div>
                                <p className="font-semibold text-sm sm:text-base">{srv.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {srv.description || "Procedimento exclusivo CLUB 01 de alto padrão"} • {srv.duration_minutes || 30} min
                                </p>
                              </div>
                            </div>
                            <div className="font-display text-base sm:text-lg font-bold text-foreground">
                              R$ {srv.price.toFixed(2).replace('.', ',')}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setBookingStep(1)}
                      className="btn-secondary sm:w-1/3 min-h-[48px]"
                    >
                      Voltar
                    </button>
                    <button
                      type="button"
                      disabled={!selectedBarber || selectedServices.length === 0}
                      onClick={() => setBookingStep(3)}
                      className="btn-primary sm:w-2/3 min-h-[48px]"
                    >
                      Avançar para Data e Hora
                    </button>
                  </div>
                </div>
              )}

              {/* ETAPA 3 */}
              {bookingStep === 3 && (
                <div className="space-y-6">
                  <div className="border-b border-border pb-3 text-center">
                    <h3 className="font-display text-2xl tracking-wide uppercase text-foreground">
                      Escolha a Data e Horário
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium mt-1">
                      Selecione o melhor dia e horário disponível para seu atendimento.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                    {/* Calendário */}
                    <div className="space-y-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-foreground block text-center md:text-left">
                        Selecione o Dia
                      </label>
                      <div className="p-4 bg-card border border-border rounded-2xl shadow-sm">
                        {renderCalendar()}
                      </div>
                    </div>

                    {/* Horários */}
                    <div className="space-y-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-foreground block text-center md:text-left">
                        Horários Disponíveis
                      </label>

                      {!selectedDate ? (
                        <div className="p-8 text-center border border-dashed border-border rounded-2xl text-muted-foreground text-sm font-medium">
                          Selecione um dia no calendário para visualizar os horários disponíveis.
                        </div>
                      ) : getTimeSlots(selectedDate).length === 0 ? (
                        <div className="p-8 text-center border border-dashed border-border rounded-2xl text-destructive text-sm font-medium">
                          Barbearia fechada neste dia (Domingo). Por favor, selecione outro dia.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedServices.length > 0 && (
                            <div className="text-xs font-semibold text-muted-foreground text-center bg-card p-3 rounded-xl border border-border">
                              ⏱️ Duração total estimada: <span className="text-foreground font-bold">{totalDurationMinutes} minutos</span>
                            </div>
                          )}

                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-y-auto pr-1">
                            {getTimeSlots(selectedDate).map(time => {
                              const reason = getTimeSlotStatusReason(selectedDate, time, selectedBarber)
                              const isBooked = !!reason
                              const isDisabled = isBooked

                              return (
                                <button
                                  key={time}
                                  type="button"
                                  onClick={() => {
                                    if (reason) {
                                      setSlotWarning(reason)
                                      return
                                    }
                                    setSlotWarning("")
                                    setSelectedTime(time)
                                  }}
                                  title={reason || "Horário disponível"}
                                  className={`min-h-[48px] py-2.5 px-1 text-xs font-semibold rounded-xl border transition-all text-center flex flex-col items-center justify-center cursor-pointer ${
                                    selectedTime === time
                                      ? "bg-primary border-primary text-primary-foreground font-bold shadow-md scale-102"
                                      : isBooked
                                        ? "bg-muted/40 border-border/50 text-muted-foreground/60 cursor-not-allowed"
                                        : "bg-card border-border text-foreground hover:border-foreground active:scale-95"
                                  }`}
                                >
                                  <span className={isDisabled ? "line-through text-muted-foreground/60" : ""}>{time}</span>
                                  {isBooked && (
                                    <span className="text-[9px] font-medium text-destructive no-underline">Ocupado</span>
                                  )}
                                </button>
                              )
                            })}
                          </div>

                          {slotWarning && (
                            <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl p-3.5 shadow-sm">
                              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                              <div>
                                <span className="font-bold block">Horário indisponível:</span>
                                <span>{slotWarning}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setBookingStep(2)}
                      className="btn-secondary sm:w-1/3 min-h-[48px]"
                    >
                      Voltar
                    </button>
                    <button
                      type="submit"
                      disabled={submitLoading || !selectedDate || !selectedTime}
                      className="btn-primary sm:w-2/3 min-h-[48px]"
                    >
                      {submitLoading ? (
                        <div className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mx-auto"></div>
                      ) : (
                        "Finalizar e Confirmar Agendamento"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  )
}

