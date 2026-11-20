import React, { useState, useEffect, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext.jsx"
import {
  appointmentsApi,
  servicesApi,
  barbersApi,
  customersApi,
  productsApi,
  salesApi,
  caixaApi
} from "../lib/api.js"
import { formatPhoneNumber } from "../lib/phone.js"
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Plus,
  Search,
  UserPlus,
  X,
  Trash2,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Check,
  UserX,
  Repeat
} from "lucide-react"
import Sidebar from "../components/Sidebar.jsx"
import CEventCalendar2 from "../components/CEventCalendar2.jsx"
import CCalendar24 from "../components/CCalendar24.jsx"
import SaleModal from "../components/SaleModal.jsx"
import CaixaEntryModal from "../components/CaixaEntryModal.jsx"

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" }
]

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Semanal" },
  { value: "biweekly", label: "Quinzenal" },
  { value: "monthly", label: "Mensal" }
]

const MAX_RECURRENCE_OCCURRENCES = 60

const parseYMD = (ymd) => {
  if (!ymd) return null
  const parts = String(ymd).split("-").map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

const formatYMD = (dateObj) => {
  const yyyy = dateObj.getFullYear()
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0")
  const dd = String(dateObj.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

const addDaysYMD = (ymd, days) => {
  const d = parseYMD(ymd)
  if (!d) return ymd
  d.setDate(d.getDate() + days)
  return formatYMD(d)
}

const generateRecurrenceDates = (startDateStr, endDateStr, frequency, weekdays) => {
  const start = parseYMD(startDateStr)
  const end = parseYMD(endDateStr)
  if (!start || !end || end < start || !Array.isArray(weekdays) || weekdays.length === 0) {
    return { dates: [], truncated: false }
  }

  const validWeekdays = [...new Set(weekdays.map(Number).filter((w) => w >= 1 && w <= 6))].sort((a, b) => a - b)
  if (validWeekdays.length === 0) {
    return { dates: [], truncated: false }
  }

  const results = []
  let truncated = false

  if (frequency === "weekly" || frequency === "biweekly") {
    const startSunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay())
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

    while (cursor <= end) {
      const curSunday = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - cursor.getDay())
      const weeksDiff = Math.round((curSunday.getTime() - startSunday.getTime()) / (7 * 86400000))
      const matchesWeek = frequency === "weekly" || weeksDiff % 2 === 0

      if (matchesWeek && validWeekdays.includes(cursor.getDay())) {
        if (results.length >= MAX_RECURRENCE_OCCURRENCES) {
          truncated = true
          break
        }
        results.push(formatYMD(cursor))
      }
      cursor.setDate(cursor.getDate() + 1)
    }
  } else if (frequency === "monthly") {
    const targetOccurrence = Math.ceil(start.getDate() / 7)
    let year = start.getFullYear()
    let month = start.getMonth()
    const endYear = end.getFullYear()
    const endMonth = end.getMonth()

    while (year < endYear || (year === endYear && month <= endMonth)) {
      const monthCandidates = []
      validWeekdays.forEach((dow) => {
        const firstOfMonth = new Date(year, month, 1)
        const firstDowOffset = (dow - firstOfMonth.getDay() + 7) % 7
        const firstMatchDay = 1 + firstDowOffset
        let targetDay = firstMatchDay + (targetOccurrence - 1) * 7
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        while (targetDay > daysInMonth) {
          targetDay -= 7
        }
        const candidate = new Date(year, month, targetDay)
        if (candidate >= start && candidate <= end) {
          monthCandidates.push(candidate)
        }
      })

      monthCandidates.sort((a, b) => a.getTime() - b.getTime())
      for (const c of monthCandidates) {
        if (results.length >= MAX_RECURRENCE_OCCURRENCES) {
          truncated = true
          break
        }
        results.push(formatYMD(c))
      }
      if (truncated) break

      month += 1
      if (month > 11) {
        month = 0
        year += 1
      }
    }
  }

  return { dates: results, truncated }
}

export default function AgendaGrid() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [appointments, setAppointments] = useState([])
  const [services, setServices] = useState([])
  const [barbers, setBarbers] = useState([])
  const [customers, setCustomers] = useState([])
  const [isRealtimeEnabled] = useState(true)

  // Estados para Vendas de Produtos
  const [isSaleModalOpen, setIsSaleModalOpen] = useState(false)
  const [selectedSaleAppt, setSelectedSaleAppt] = useState(null)
  const [existingSaleData, setExistingSaleData] = useState(null)
  const [productsList, setProductsList] = useState([])
  const [salesList, setSalesList] = useState([])

  // Estados para Modal de Lançamento do Caixa
  const [isCaixaModalOpen, setIsCaixaModalOpen] = useState(false)
  const [selectedCaixaAppt, setSelectedCaixaAppt] = useState(null)
  const [caixaList, setCaixaList] = useState([])

  // Detecção de Dispositivo Móvel (tela < 768px) e Seleção de Barbeiro no Mobile
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false)
  const [selectedMobileBarberId, setSelectedMobileBarberId] = useState("")

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Helper para obter a data local no formato YYYY-MM-DD
  const getTodayStr = () => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }

  // Data selecionada (formato YYYY-MM-DD)
  const todayStr = getTodayStr()
  const [selectedDate, setSelectedDate] = useState(todayStr)

  // Modal State
  const [isAppointmentModalOpen, setIsAppointmentModalOpen] = useState(false)
  const [editingAppointmentId, setEditingAppointmentId] = useState(null)

  // State do Modal de Visualizar / Desfazer Bloqueio de Agenda
  const [isBloqueioModalOpen, setIsBloqueioModalOpen] = useState(false)
  const [selectedBloqueio, setSelectedBloqueio] = useState(null)

  // State do Modal de Cancelar / Bloquear Intervalo de Horários
  const [isCancelRangeModalOpen, setIsCancelRangeModalOpen] = useState(false)
  const [cancelBarberId, setCancelBarberId] = useState("")
  const [cancelStartTime, setCancelStartTime] = useState("")
  const [cancelEndTime, setCancelEndTime] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [cancelSubmitting, setCancelSubmitting] = useState(false)
  const [cancelError, setCancelError] = useState("")

  const getAvailableCancelTimeSlots = (dateString, isEnd = false) => {
    const slots = getTimeSlots(dateString)
    const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")

    let closingTime = isStaff ? "23:00" : "20:00"
    if (dateString) {
      const dateParts = dateString.split("-")
      if (dateParts.length === 3) {
        const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
        if (dateObj.getDay() === 6) closingTime = isStaff ? "21:00" : "19:00"
      }
    }

    if (!dateString) return isEnd ? [...slots, closingTime] : slots

    const todayString = getTodayStr()
    if (dateString === todayString) {
      const now = new Date()
      const currentMin = now.getHours() * 60 + now.getMinutes()

      const baseSlots = isEnd ? [...slots, closingTime] : slots
      return baseSlots.filter((timeStr) => {
        const [h, m] = timeStr.split(":").map(Number)
        if (isNaN(h) || isNaN(m)) return true
        const slotStartMin = h * 60 + m
        if (isEnd) {
          return slotStartMin > currentMin
        }
        return slotStartMin + 30 > currentMin
      })
    }

    return isEnd ? [...slots, closingTime] : slots
  }

  const handleOpenCancelRangeModal = (barberId, slotTime) => {
    setCancelBarberId(barberId)

    const availableStartSlots = getAvailableCancelTimeSlots(selectedDate, false)
    const initialStart = availableStartSlots.includes(slotTime)
      ? slotTime
      : (availableStartSlots.length > 0 ? availableStartSlots[0] : slotTime)

    const safeStart = initialStart || "08:00"
    setCancelStartTime(safeStart)

    // Calcular o próximo slot (30 min a mais) como término padrão
    const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")
    const [h, m] = String(safeStart).split(":").map(Number)
    let endMin = h * 60 + m + 30
    let maxClosingMin = isStaff ? 23 * 60 : 20 * 60
    if (selectedDate) {
      const dateParts = selectedDate.split("-")
      if (dateParts.length === 3) {
        const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
        if (dateObj.getDay() === 6) maxClosingMin = isStaff ? 21 * 60 : 19 * 60
      }
    }
    if (endMin > maxClosingMin) endMin = maxClosingMin
    const endH = String(Math.floor(endMin / 60)).padStart(2, "0")
    const endM = String(endMin % 60).padStart(2, "0")
    setCancelEndTime(`${endH}:${endM}`)
    setCancelReason("")
    setCancelError("")
    setIsCancelRangeModalOpen(true)
  }

  const handleSaveCancelRange = async (e) => {
    if (e) e.preventDefault()
    setCancelError("")

    if (!cancelBarberId) {
      setCancelError("Selecione um profissional.")
      return
    }
    if (!cancelStartTime || !cancelEndTime) {
      setCancelError("Selecione os horários de início e término.")
      return
    }
    if (!cancelReason.trim()) {
      setCancelError("Informe o motivo do cancelamento / bloqueio.")
      return
    }

    setCancelSubmitting(true)

    try {
      const data = await appointmentsApi.cancelRange({
        barberId: cancelBarberId,
        barber_id: cancelBarberId,
        date: selectedDate,
        startTime: cancelStartTime,
        start_time: cancelStartTime,
        endTime: cancelEndTime,
        end_time: cancelEndTime,
        reason: cancelReason.trim()
      })

      setSuccessMsg(`Bloqueio efetuado com sucesso para ${data.count} horário(s)!`)
      setTimeout(() => setSuccessMsg(""), 4000)
      setIsCancelRangeModalOpen(false)

      // Recarregar agendamentos
      const appts = await appointmentsApi.getAll()
      setAppointments(appts || [])
    } catch (err) {
      setCancelError(err.message)
    } finally {
      setCancelSubmitting(false)
    }
  }

  // Campos do formulário de agendamento
  const [clientName, setClientName] = useState("")
  const [clientPhone, setClientPhone] = useState("")
  const [selectedBarber, setSelectedBarber] = useState("")
  const [selectedServices, setSelectedServices] = useState([])
  const [selectedTime, setSelectedTime] = useState("")

  // Recorrência de agendamento
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceFrequency, setRecurrenceFrequency] = useState("weekly")
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState([1])
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("")
  const [cancelScopePromptOpen, setCancelScopePromptOpen] = useState(false)

  // Autocomplete e Modal de Cliente
  const [isCustomerDropdownOpen, setIsCustomerDropdownOpen] = useState(false)
  const customerDropdownRef = useRef(null)
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerSubmitting, setNewCustomerSubmitting] = useState(false)
  const [newCustomerError, setNewCustomerError] = useState("")

  // Status de envio
  const [submitLoading, setSubmitLoading] = useState(false)
  const [error, setError] = useState("")
  const [successMsg, setSuccessMsg] = useState("")

  useEffect(() => {
    if (!user) {
      navigate("/login")
      return
    }

    async function fetchData() {
      try {
        const [appts, srvs, loadedBarbers, custs, prodsData, sales, cData] = await Promise.all([
          appointmentsApi.getAll(),
          servicesApi.getAll(),
          barbersApi.getAll(),
          customersApi.getAll(),
          productsApi.getAll(),
          salesApi.getAll(),
          caixaApi.getAll()
        ])

        setAppointments(appts || [])
        setServices(srvs || [])
        if (loadedBarbers) {
          setBarbers(loadedBarbers)

          // Selecionar por padrão o barbeiro do usuário logado se existir, ou o primeiro barbeiro ativo
          const activeList = loadedBarbers.filter(b => b.is_active !== false)
          const candidates = activeList.length > 0 ? activeList : loadedBarbers
          if (candidates.length > 0) {
            const userBarber = candidates.find(
              (b) => String(b.id) === String(user?.id) || (b.user_id && String(b.user_id) === String(user?.id))
            )
            if (userBarber) {
              setSelectedMobileBarberId(String(userBarber.id))
            } else {
              setSelectedMobileBarberId(String(candidates[0].id))
            }
          }
        }
        setCustomers(custs || [])
        if (Array.isArray(prodsData)) setProductsList(prodsData)
        setSalesList(sales || [])
        setCaixaList(cData?.transactions || cData || [])
      } catch (err) {
        console.error("Erro ao carregar dados da agenda grid:", err)
      }
    }

    fetchData()
  }, [user, navigate])

  // Handlers para o Modal de Lançamento do Caixa
  const handleOpenCaixaModal = (appt) => {
    setSelectedCaixaAppt(appt)
    setIsCaixaModalOpen(true)
  }

  const handleCaixaSaveSuccess = (updatedInfo) => {
    setAppointments(prev => prev.map(a => {
      if (a.id === updatedInfo.appointmentId) {
        return {
          ...a,
          caixa_id: updatedInfo.caixa_id,
          caixa_amount: updatedInfo.amount,
          caixa_payment_method: updatedInfo.payment_method
        }
      }
      return a
    }))
    setCaixaList(prev => prev.map(c => {
      if (c.id === updatedInfo.caixa_id || (c.appointment_id === updatedInfo.appointmentId && !c.id?.startsWith('caixa-sale-') && (c.id?.startsWith('cx-srv-') || c.category === 'Serviço' || c.category === 'Serviços'))) {
        return {
          ...c,
          amount: updatedInfo.amount,
          payment_method: updatedInfo.payment_method
        }
      }
      return c
    }))
  }

  // Handlers para o Modal de Vendas
  const handleOpenSaleModal = async (appt) => {
    setSelectedSaleAppt(appt)
    setExistingSaleData(null)
    setIsSaleModalOpen(true)
    try {
      const [prodsData, saleData] = await Promise.all([
        productsApi.getAll(),
        salesApi.getByAppointment(appt.id)
      ])
      if (Array.isArray(prodsData) && prodsData.length > 0) {
        setProductsList(prodsData)
      }
      if (saleData && saleData.id) {
        setExistingSaleData(saleData)
      }
    } catch (err) {
      console.error("Erro ao buscar venda do agendamento:", err)
    }
  }

  const handleSaveSale = async (salePayload) => {
    if (salePayload.id) {
      await salesApi.delete(salePayload.id).catch(() => { })
    }

    await salesApi.createAtomic({
      appointmentId: salePayload.appointment_id,
      customerId: salePayload.customer_id,
      paymentMethod: salePayload.payment_method,
      items: salePayload.items,
      registerInCaixa: salePayload.sync_caixa !== false
    })

    // Recarregar lista de vendas e produtos
    const [sales, prods] = await Promise.all([
      salesApi.getAll(),
      productsApi.getAll()
    ])
    setSalesList(sales || [])
    setProductsList(prods || [])
  }

  const handleDeleteSale = async (saleId) => {
    await salesApi.delete(saleId)

    // Recarregar lista de vendas e produtos
    const [sales, prods] = await Promise.all([
      salesApi.getAll(),
      productsApi.getAll()
    ])
    setSalesList(sales || [])
    setProductsList(prods || [])
  }

  // Polling em tempo real
  useEffect(() => {
    if (!user || !isRealtimeEnabled) return

    const interval = setInterval(async () => {
      try {
        const appts = await appointmentsApi.getAll()
        setAppointments(appts || [])
      } catch (err) {
        console.error("Erro no polling realtime da agenda grid:", err)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [user, isRealtimeEnabled])

  // Fechar dropdown de clientes ao clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target)) {
        setIsCustomerDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const formatBirthDate = (dateStr) => {
    if (!dateStr) return ""
    const parts = dateStr.split("-")
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return dateStr
  }

  const normalizeText = (str) => {
    if (!str) return ""
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  }

  const filteredCustomers = customers.filter((c) => {
    if (!clientName.trim()) return false
    const searchNorm = normalizeText(clientName)
    const nameNorm = normalizeText(c.name)
    const phoneClean = c.phone ? c.phone.replace(/\D/g, "") : ""
    const searchClean = clientName.replace(/\D/g, "")
    return nameNorm.includes(searchNorm) || (searchClean.length > 0 && phoneClean.includes(searchClean))
  })

  const handleSelectCustomer = (cust) => {
    setClientName(cust.name)
    setClientPhone(formatPhoneNumber(cust.phone || ""))
    setIsCustomerDropdownOpen(false)
  }

  // Obter horários disponíveis do dia
  const getTimeSlots = (dateString) => {
    if (!dateString) return []
    const dateParts = dateString.split("-")
    const date = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
    const dayOfWeek = date.getDay()

    if (dayOfWeek === 0) return []

    const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")
    const slots = []
    let startHour = dayOfWeek === 6 ? 8 : 9
    let endHour = isStaff ? (dayOfWeek === 6 ? 21 : 23) : (dayOfWeek === 6 ? 19 : 20)

    for (let h = startHour; h < endHour; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`)
      slots.push(`${String(h).padStart(2, "0")}:30`)
    }
    return slots
  }

  const isTimeSlotPast = (dateString, timeString) => {
    if (!dateString || !timeString) return false
    const [h, m] = timeString.split(":").map(Number)
    if (isNaN(h) || isNaN(m)) return false
    const appointmentDateTime = new Date(`${dateString}T${timeString}`)
    const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")
    const extraMinutes = isStaff ? 30 : 0
    const slotExpiration = new Date(appointmentDateTime.getTime() + extraMinutes * 60000)
    const now = new Date()
    return slotExpiration <= now
  }

  // Cálculo acumulado de duração e preço para múltiplos serviços
  const selectedServicesDetails = services.filter((s) => selectedServices.includes(s.id))
  const totalDurationMinutes = selectedServicesDetails.reduce((sum, s) => sum + Number(s.duration_minutes ?? 30), 0)
  const totalPriceCalculated = selectedServicesDetails.reduce((sum, s) => sum + Number(s.price || 0), 0)

  let calculatedEndTime = ""
  if (selectedTime && totalDurationMinutes >= 0 && selectedServicesDetails.length > 0) {
    const [hours, minutes] = selectedTime.split(":").map(Number)
    if (!isNaN(hours) && !isNaN(minutes)) {
      const startDate = new Date()
      startDate.setHours(hours, minutes, 0, 0)
      const endDate = new Date(startDate.getTime() + totalDurationMinutes * 60000)
      const endH = String(endDate.getHours()).padStart(2, "0")
      const endM = String(endDate.getMinutes()).padStart(2, "0")
      calculatedEndTime = `${endH}:${endM}`
    }
  }

  const isTimeSlotBooked = (dateString, timeString, targetBarberId = selectedBarber) => {
    if (!targetBarberId || !dateString || !timeString) return false

    const barbObj = barbers.find((b) => String(b.id) === String(targetBarberId))
    const barbName = barbObj ? barbObj.name : null

    const [slotH, slotM] = timeString.split(":").map(Number)
    if (isNaN(slotH) || isNaN(slotM)) return false

    if (selectedServices.length > 0 && totalDurationMinutes === 0) return false

    const slotStartMinutes = slotH * 60 + slotM
    const requestedDuration = selectedServices.length > 0 ? totalDurationMinutes : 30
    const slotEndMinutes = slotStartMinutes + requestedDuration

    // Verificar se ultrapassa o horário de funcionamento da barbearia
    const dateParts = dateString.split("-")
    if (dateParts.length === 3) {
      const dateObj = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
      const dayOfWeek = dateObj.getDay()
      if (dayOfWeek === 0) return true // Domingo fechado
      const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")
      const closingHour = isStaff ? (dayOfWeek === 6 ? 21 : 23) : (dayOfWeek === 6 ? 19 : 20)
      const closingMinutes = closingHour * 60
      if (slotEndMinutes > closingMinutes) return true
    }

    return appointments.some((appt) => {
      // Ignorar cancelamentos comuns de clientes, mas CONSIDERAR bloqueios de agenda
      const isBloqueio = appt.client_id === "cust-bloqueio-sistema" || (appt.client_name && appt.client_name.toUpperCase() === "BLOQUEIO DE AGENDA")
      if (appt.status === "cancelled" && (!appt.cancellation_reason || !isBloqueio)) return false
      if (editingAppointmentId && String(appt.id) === String(editingAppointmentId)) return false
      if (!appt.appointment_time || !appt.appointment_time.startsWith(dateString)) return false

      const matchesBarberId = appt.barber_id && String(appt.barber_id) === String(targetBarberId)
      const matchesBarberName = barbName && appt.barber_name && appt.barber_name.toLowerCase() === barbName.toLowerCase()
      if (!matchesBarberId && !matchesBarberName) return false

      const timePart = appt.appointment_time.split("T")[1] || ""
      if (!timePart) return false

      const [apptH, apptM] = timePart.split(":").map(Number)
      if (isNaN(apptH) || isNaN(apptM)) return false

      const apptStartMinutes = apptH * 60 + apptM
      const apptDuration = appt.duration_minutes !== undefined && appt.duration_minutes !== null ? appt.duration_minutes : 30
      if (apptDuration === 0) return false

      const apptEndMinutes = apptStartMinutes + apptDuration

      const overlapStart = Math.max(slotStartMinutes, apptStartMinutes)
      const overlapEnd = Math.min(slotEndMinutes, apptEndMinutes)

      return overlapStart < overlapEnd
    })
  }

  // Efeito para resetar o horário se o serviço/profissional mudar e o horário pré-selecionado se tornar indisponível
  useEffect(() => {
    if (isAppointmentModalOpen && selectedTime && selectedDate && selectedBarber) {
      if (isTimeSlotBooked(selectedDate, selectedTime, selectedBarber)) {
        setSelectedTime("")
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices, selectedBarber, selectedDate, selectedTime, isAppointmentModalOpen])

  // Navegação de Datas
  const handleDateChange = (daysToAdd) => {
    const current = new Date(`${selectedDate}T00:00:00`)
    current.setDate(current.getDate() + daysToAdd)
    const yyyy = current.getFullYear()
    const mm = String(current.getMonth() + 1).padStart(2, "0")
    const dd = String(current.getDate()).padStart(2, "0")
    setSelectedDate(`${yyyy}-${mm}-${dd}`)
  }

  // Ações de Modal
  const handleSelectSlot = (barberId, slotTime) => {
    setSelectedBarber(barberId)
    setSelectedTime(slotTime)
    setEditingAppointmentId(null)
    setClientName("")
    setClientPhone("")
    setSelectedServices([])
    const baseDate = parseYMD(selectedDate)
    const baseDow = baseDate ? baseDate.getDay() : new Date().getDay()
    setIsRecurring(false)
    setRecurrenceFrequency("weekly")
    setRecurrenceWeekdays(baseDow >= 1 && baseDow <= 6 ? [baseDow] : [1])
    setRecurrenceEndDate(addDaysYMD(selectedDate, 28))
    setCancelScopePromptOpen(false)
    setError("")
    setSuccessMsg("")
    setIsAppointmentModalOpen(true)
  }

  // Helper para obter detalhes do bloqueio (horário de início, fim, número de slots e motivo)
  const getBloqueioDetails = (bloqueioAppt) => {
    if (!bloqueioAppt) return { startTime: "", endTime: "", count: 1, reason: "Bloqueio de Agenda" }

    const barbId = bloqueioAppt.barber_id
    const reason = bloqueioAppt.cancellation_reason || "Bloqueio de Agenda"
    const apptTime = (bloqueioAppt.appointment_time || "").split("T")[1] || ""
    const datePart = (bloqueioAppt.appointment_time || "").split("T")[0] || selectedDate

    const relatedSlots = appointments.filter(a => {
      if (!a.appointment_time || a.status !== "cancelled") return false
      const isBloqueio = a.client_id === "cust-bloqueio-sistema" || (a.client_name && a.client_name.toUpperCase() === "BLOQUEIO DE AGENDA")
      if (!isBloqueio) return false
      const aDate = a.appointment_time.split("T")[0]
      const aReason = a.cancellation_reason || "Bloqueio de Agenda"
      return aDate === datePart && String(a.barber_id) === String(barbId) && aReason === reason
    })

    if (relatedSlots.length === 0) {
      return { startTime: apptTime.slice(0, 5), endTime: "", count: 1, reason }
    }

    const times = relatedSlots.map(a => (a.appointment_time.split("T")[1] || "").slice(0, 5)).filter(Boolean).sort()
    const startTime = times[0] || apptTime.slice(0, 5)

    const lastTime = times[times.length - 1] || startTime
    const [h, m] = lastTime.split(":").map(Number)
    const endMin = (h || 0) * 60 + (m || 0) + 30
    const endH = String(Math.floor(endMin / 60)).padStart(2, "0")
    const endM = String(endMin % 60).padStart(2, "0")
    const endTime = `${endH}:${endM}`

    return {
      startTime,
      endTime,
      count: relatedSlots.length,
      reason
    }
  }

  const handleRemoveBloqueio = async () => {
    if (!selectedBloqueio) return
    setSubmitLoading(true)
    setError("")
    try {
      await appointmentsApi.removeBloqueio(selectedBloqueio)

      setSuccessMsg("Bloqueio de agenda removido com sucesso! Horários liberados.")
      setTimeout(() => setSuccessMsg(""), 4000)
      setIsBloqueioModalOpen(false)
      setSelectedBloqueio(null)

      const appts = await appointmentsApi.getAll()
      setAppointments(appts || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  const handleSelectAppointment = (appt) => {
    // Apenas registros de bloqueio com status 'cancelled' abrem o modal de Bloqueio de Agenda.
    // Qualquer agendamento de cliente (confirmed, completed, etc.) abre a edição padrão do agendamento.
    const isBloqueio = appt && (appt.client_id === "cust-bloqueio-sistema" || (appt.client_name && appt.client_name.toUpperCase() === "BLOQUEIO DE AGENDA"))
    if (appt && appt.status === "cancelled" && isBloqueio) {
      setSelectedBloqueio(appt)
      setError("")
      setSuccessMsg("")
      setIsBloqueioModalOpen(true)
      return
    }

    setEditingAppointmentId(appt.id)
    setClientName(appt.client_name || "")
    setClientPhone(formatPhoneNumber(appt.client_phone || appt.phone || ""))
    setSelectedBarber(appt.barber_id || "")

    let sIds = []
    if (Array.isArray(appt.service_ids_list) && appt.service_ids_list.length > 0) {
      sIds = appt.service_ids_list
    } else if (Array.isArray(appt.service_ids) && appt.service_ids.length > 0) {
      sIds = appt.service_ids
    } else if (typeof appt.service_ids === "string" && appt.service_ids.trim()) {
      sIds = appt.service_ids.split(",").map(s => s.trim()).filter(Boolean)
    } else if (Array.isArray(appt.multiple_services) && appt.multiple_services.length > 0) {
      sIds = appt.multiple_services.map(s => s.id).filter(Boolean)
    } else if (appt.service_id) {
      sIds = [appt.service_id]
    }
    setSelectedServices(sIds)

    if (appt.appointment_time) {
      const parts = appt.appointment_time.split("T")
      setSelectedDate(parts[0])
      if (parts[1]) {
        setSelectedTime(parts[1].slice(0, 5))
      }
    }

    setError("")
    setSuccessMsg("")
    setIsRecurring(false)
    setCancelScopePromptOpen(false)
    setIsAppointmentModalOpen(true)
  }

  // Prévia das datas do agendamento recorrente
  const recurrencePreview = useMemo(() => {
    if (!isRecurring || editingAppointmentId || !selectedDate || !selectedTime || !recurrenceEndDate) {
      return { allDates: [], availableDates: [], skippedDates: [], truncated: false }
    }

    const { dates, truncated } = generateRecurrenceDates(
      selectedDate,
      recurrenceEndDate,
      recurrenceFrequency,
      recurrenceWeekdays
    )

    const allDates = dates.map((d) => {
      const conflict = selectedBarber ? isTimeSlotBooked(d, selectedTime, selectedBarber) : false
      const past = isTimeSlotPast(d, selectedTime)
      return {
        date: d,
        hasConflict: conflict || past,
        reason: past ? "Horário passado" : conflict ? "Horário ocupado" : null
      }
    })

    return {
      allDates,
      availableDates: allDates.filter((item) => !item.hasConflict),
      skippedDates: allDates.filter((item) => item.hasConflict),
      truncated
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isRecurring,
    editingAppointmentId,
    selectedDate,
    selectedTime,
    selectedBarber,
    selectedServices,
    recurrenceFrequency,
    recurrenceWeekdays,
    recurrenceEndDate,
    appointments
  ])

  const handleToggleRecurrence = () => {
    setIsRecurring((prev) => {
      const next = !prev
      if (next) {
        const baseDate = parseYMD(selectedDate)
        const baseDow = baseDate ? baseDate.getDay() : 1
        if (recurrenceWeekdays.length === 0) {
          setRecurrenceWeekdays(baseDow >= 1 && baseDow <= 6 ? [baseDow] : [1])
        }
        if (!recurrenceEndDate || recurrenceEndDate < selectedDate) {
          setRecurrenceEndDate(addDaysYMD(selectedDate, 28))
        }
      }
      return next
    })
  }

  const handleToggleRecurrenceWeekday = (dayVal) => {
    setRecurrenceWeekdays((prev) =>
      prev.includes(dayVal)
        ? prev.filter((d) => d !== dayVal)
        : [...prev, dayVal].sort((a, b) => a - b)
    )
  }

  // Submeter Agendamento
  const handleSaveAppointment = async (e) => {
    if (e) e.preventDefault()
    setError("")
    setSuccessMsg("")

    if (!clientName.trim()) {
      setError("Por favor, preencha o seu nome completo.")
      return
    }
    if (!clientPhone.trim()) {
      setError("Por favor, preencha o seu telefone/Whatsapp.")
      return
    }
    if (!selectedBarber) {
      setError("Por favor, selecione um profissional.")
      return
    }
    if (selectedServices.length === 0) {
      setError("Por favor, selecione ao menos um serviço.")
      return
    }
    if (!selectedDate || !selectedTime) {
      setError("Por favor, selecione o horário do agendamento.")
      return
    }

    if (!isRecurring && isTimeSlotBooked(selectedDate, selectedTime)) {
      setError("O horário selecionado já está agendado para este profissional.")
      return
    }

    if (!editingAppointmentId && isRecurring) {
      if (recurrenceWeekdays.length === 0) {
        setError("Selecione ao menos um dia da semana para o agendamento recorrente.")
        return
      }
      if (!recurrenceEndDate) {
        setError("Selecione a data final da recorrência.")
        return
      }
      if (recurrenceEndDate < selectedDate) {
        setError("A data final da recorrência deve ser igual ou posterior à data inicial.")
        return
      }
      if (recurrencePreview.allDates.length === 0) {
        setError("Nenhuma data encontrada para os critérios de recorrência selecionados.")
        return
      }
      if (recurrencePreview.availableDates.length === 0) {
        setError("Todas as datas geradas na recorrência estão ocupadas ou indisponíveis.")
        return
      }
    }

    setSubmitLoading(true)
    const appointmentTime = `${selectedDate}T${selectedTime}`

    try {
      const serviceIdsList = Array.isArray(selectedServices) ? selectedServices : [selectedServices].filter(Boolean)
      let feedbackMessage = editingAppointmentId ? "Agendamento atualizado com sucesso!" : "Agendamento realizado com sucesso!"

      if (editingAppointmentId) {
        const currentAppt = appointments.find(a => String(a.id) === String(editingAppointmentId))
        if (currentAppt?.client_id && currentAppt.client_id !== "cust-bloqueio-sistema") {
          const prevName = (currentAppt.client_name || "").trim().toUpperCase()
          const nextName = clientName.trim().toUpperCase()
          const prevPhone = (currentAppt.client_phone || currentAppt.phone || "").replace(/\D/g, "")
          const nextPhone = clientPhone.replace(/\D/g, "")
          if (prevName !== nextName || (nextPhone && prevPhone !== nextPhone)) {
            await customersApi.update(currentAppt.client_id, {
              name: clientName,
              phone: clientPhone
            })
          }
        }
        await appointmentsApi.rescheduleOnline({
          appointmentId: editingAppointmentId,
          newAppointmentTime: appointmentTime,
          newBarberId: selectedBarber,
          serviceIds: serviceIdsList
        })
      } else if (isRecurring) {
        const appointmentTimes = recurrencePreview.availableDates.map(
          (item) => `${item.date}T${selectedTime}`
        )
        const recResult = await appointmentsApi.bookRecurring({
          name: clientName,
          phone: clientPhone,
          barberId: selectedBarber,
          serviceIds: serviceIdsList,
          appointmentTimes
        })
        const createdCount = recResult?.created_count || appointmentTimes.length
        const skippedTotal = (recurrencePreview.skippedDates.length || 0) + (recResult?.skipped_count || 0)
        feedbackMessage = skippedTotal > 0
          ? `Recorrência criada: ${createdCount} agendamento(s) confirmado(s) e ${skippedTotal} pulado(s) por conflito.`
          : `Recorrência criada com ${createdCount} agendamento(s) confirmado(s)!`
      } else {
        await appointmentsApi.bookOnline({
          name: clientName,
          phone: clientPhone,
          barberId: selectedBarber,
          serviceIds: serviceIdsList,
          appointmentTime
        })
      }

      setSuccessMsg(feedbackMessage)
      setTimeout(() => setSuccessMsg(""), 6000)

      setIsAppointmentModalOpen(false)
      setEditingAppointmentId(null)
      setIsRecurring(false)

      // Atualizar lista
      const appts = await appointmentsApi.getAll()
      setAppointments(appts || [])
    } catch (err) {
      setError(err.message || "Erro de conexão ao salvar agendamento.")
    } finally {
      setSubmitLoading(false)
    }
  }

  // Cancelar Agendamento
  const handleCancelAppointment = async (scope = null) => {
    if (!editingAppointmentId) return
    const currentEditingAppt = appointments.find((a) => String(a.id) === String(editingAppointmentId))
    if (currentEditingAppt?.recurrence_id && !scope) {
      setCancelScopePromptOpen(true)
      return
    }

    setSubmitLoading(true)
    try {
      let cancelMsg = "Agendamento cancelado com sucesso!"
      if (currentEditingAppt?.recurrence_id) {
        const res = await appointmentsApi.cancelRecurring({
          appointmentId: editingAppointmentId,
          scope: scope || "single"
        })
        if (scope === "future" && res?.cancelled_count > 1) {
          cancelMsg = `${res.cancelled_count} agendamentos da recorrência cancelados com sucesso!`
        }
      } else {
        await appointmentsApi.cancel(editingAppointmentId)
      }

      setSuccessMsg(cancelMsg)
      setTimeout(() => setSuccessMsg(""), 4000)
      setCancelScopePromptOpen(false)
      setIsAppointmentModalOpen(false)
      setEditingAppointmentId(null)

      const [appts, updatedCaixa] = await Promise.all([
        appointmentsApi.getAll(),
        caixaApi.getAll()
      ])
      setAppointments(appts || [])
      setCaixaList(updatedCaixa || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  // Reativar Cancelado
  const handleUncancelAppointment = async () => {
    if (!editingAppointmentId) return
    setSubmitLoading(true)
    try {
      await appointmentsApi.update(editingAppointmentId, { status: "confirmed" })

      setSuccessMsg("Cancelamento desfeito com sucesso!")
      setTimeout(() => setSuccessMsg(""), 4000)
      setIsAppointmentModalOpen(false)
      setEditingAppointmentId(null)

      const appts = await appointmentsApi.getAll()
      setAppointments(appts || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitLoading(false)
    }
  }

  // Marcar Ausente
  const handleToggleAbsentModal = async () => {
    if (!editingAppointmentId) return
    const currentEditingAppt = appointments.find((a) => String(a.id) === String(editingAppointmentId))
    if (!currentEditingAppt) return

    const newStatus = currentEditingAppt.status === "absent" ? "confirmed" : "absent"

    setAppointments((prev) =>
      prev.map((a) => (a.id === editingAppointmentId ? { ...a, status: newStatus } : a))
    )

    try {
      await appointmentsApi.update(editingAppointmentId, { status: newStatus })
      if (newStatus === "absent") {
        setCaixaList((prev) =>
          prev.filter(
            (c) =>
              c.id !== `cx-srv-${editingAppointmentId}` &&
              !(
                String(c.appointment_id) === String(editingAppointmentId) &&
                !c.id?.startsWith("caixa-sale-") &&
                c.category !== "Venda de Produtos" &&
                c.category !== "Produto"
              )
          )
        )
      }
      setIsAppointmentModalOpen(false)
      setEditingAppointmentId(null)
    } catch (err) {
      setAppointments((prev) =>
        prev.map((a) => (a.id === editingAppointmentId ? { ...a, status: currentEditingAppt.status } : a))
      )
      console.error("Erro ao alterar status ausente:", err)
    }
  }

  // Criar Novo Cliente Rápido
  const handleCreateNewCustomer = async (e) => {
    e.preventDefault()
    setNewCustomerSubmitting(true)
    setNewCustomerError("")

    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      setNewCustomerError("Nome e Telefone são obrigatórios.")
      setNewCustomerSubmitting(false)
      return
    }

    try {
      const newCust = await customersApi.create({
        name: newCustomerName.trim().toUpperCase(),
        phone: newCustomerPhone.trim()
      })

      if (newCust) {
        setCustomers((prev) => [...prev, newCust])
        setClientName(newCust.name)
        setClientPhone(formatPhoneNumber(newCust.phone || ""))
      }
      setIsNewCustomerModalOpen(false)
      setNewCustomerName("")
      setNewCustomerPhone("")
    } catch (err) {
      setNewCustomerError(err.message)
    } finally {
      setNewCustomerSubmitting(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden bg-transparent text-foreground pt-24 pb-28 lg:pt-0 lg:pb-0 px-2 md:px-4 relative lg:pl-[260px] sidebar-page-container flex flex-col justify-center">
      <Sidebar />

      <div className="container mx-auto px-4 max-w-[1312px] lg:h-[calc(100vh-100px)] relative z-10 animate-scale-in flex flex-col gap-4 justify-between">
        {/* Cabeçalho da Tela com Seletor de Data */}
        <div className="bg-card/45 backdrop-blur-md border border-border/80 rounded-3xl p-6 shadow-elevated flex flex-col md:flex-row items-center justify-between gap-4 relative z-30">
          <div>
            <h2 className="text-[18pt] font-bold font-display flex items-center gap-2.5">
              <CalendarIcon className="text-primary w-6 h-6" /> Agenda por Barbeiro
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {(() => {
                if (!selectedDate) return "Visão em grade de horários organizados por colunas de barbeiro."
                const dateParts = selectedDate.split("-")
                const d = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]))
                const day = d.getDay()
                if (day === 0) return "Barbearia fechada aos domingos."
                const isStaff = user && (user.role === "admin" || user.role === "barber" || user.role === "secretario")
                if (day === 6) {
                  const closingSabText = isStaff ? "21h" : "19h"
                  return `Visão em grade de horários de sábado (08h às ${closingSabText}) organizados por colunas de barbeiro.`
                }
                const closingText = isStaff ? "23h" : "20h"
                return `Visão em grade de horários (09h às ${closingText}) organizados por colunas de barbeiro.`
              })()}
            </p>
          </div>

          {/* Navegação de Datas */}
          <div className="flex items-center gap-3 bg-card p-2 rounded-2xl border border-border shadow-xs">
            <button
              type="button"
              onClick={() => handleDateChange(-1)}
              className="p-2 bg-card hover:bg-muted border border-border rounded-xl text-foreground transition-all cursor-pointer hover:scale-105"
              title="Dia Anterior"
            >
              <ChevronLeft size={20} />
            </button>

            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className={`px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider border transition-all cursor-pointer ${selectedDate === todayStr
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
                }`}
            >
              Hoje
            </button>

            <CCalendar24 value={selectedDate} onChange={setSelectedDate} />

            <button
              type="button"
              onClick={() => handleDateChange(1)}
              className="p-2 bg-card hover:bg-muted border border-border rounded-xl text-foreground transition-all cursor-pointer hover:scale-105"
              title="Próximo Dia"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Notificação de Sucesso */}
        {successMsg && (
          <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 text-sm font-bold flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 size={18} /> {successMsg}
          </div>
        )}

        {/* Barbeiros visíveis: ativos na agenda + inativos apenas se possuírem agendamento no dia */}
        {(() => {
          const visibleBarbers = barbers.filter(
            b => b.is_active !== false || appointments.some(a => a.barber_id === b.id && a.appointment_time?.startsWith(selectedDate))
          )

          let displayedBarbers = visibleBarbers
          if (user?.role === 'barber') {
            displayedBarbers = barbers.filter(
              b => String(b.id) === String(user.id) || String(b.user_id) === String(user.id)
            )
          } else if (isMobile) {
            if (selectedMobileBarberId) {
              const matched = visibleBarbers.filter(
                b => String(b.id) === String(selectedMobileBarberId) || (b.user_id && String(b.user_id) === String(selectedMobileBarberId))
              )
              if (matched.length > 0) displayedBarbers = matched
              else if (visibleBarbers.length > 0) displayedBarbers = [visibleBarbers[0]]
            } else if (visibleBarbers.length > 0) {
              displayedBarbers = [visibleBarbers[0]]
            }
          }

          return (
            <>
              {/* Seletor Rápido de Barbeiro no Mobile */}
              {isMobile && user?.role !== 'barber' && visibleBarbers.length > 1 && (
                <div className="bg-card border border-border rounded-2xl p-3 shadow-xs flex items-center gap-2 overflow-x-auto custom-scrollbar mb-4">
                  <span className="text-xs font-bold text-muted-foreground whitespace-nowrap">Profissional:</span>
                  <div className="flex items-center gap-2">
                    {visibleBarbers.map((b, idx) => {
                      const isSel = String(b.id) === String(selectedMobileBarberId) || (b.user_id && String(b.user_id) === String(selectedMobileBarberId))
                      const photo = b.photo || (idx === 0 ? "/assets/marcio-barber.jpeg" : idx === 1 ? "/assets/lucas-barber.jpeg" : "/assets/neto-barber.jpeg")
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelectedMobileBarberId(String(b.id))}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${isSel
                              ? "bg-foreground text-background border-foreground shadow-sm"
                              : "bg-card text-muted-foreground border-border hover:text-foreground"
                            }`}
                        >
                          <img src={photo} alt={b.name} className="w-5 h-5 rounded-full object-cover border border-border" />
                          <span>{b.name.split(" ")[0]}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Componente CEventCalendar2 */}
              <CEventCalendar2
                barbers={displayedBarbers}
                appointments={appointments}
                sales={salesList}
                caixaTransactions={caixaList}
                selectedDate={selectedDate}
                isMobile={isMobile}
                userRole={user?.role}
                onSelectSlot={handleSelectSlot}
                onCancelSlot={handleOpenCancelRangeModal}
                onSelectAppointment={handleSelectAppointment}
                onOpenSaleModal={handleOpenSaleModal}
                onOpenCaixaModal={handleOpenCaixaModal}
              />
            </>
          )
        })()}
      </div>

      {/* MODAL DE CANCELAR / BLOQUEAR INTERVALO DE HORÁRIOS */}
      {isCancelRangeModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in">
          <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-md border border-rose-500/30 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold font-display text-rose-400 flex items-center gap-2">
                <X size={20} /> Cancelar / Bloquear Horários
              </h3>
              <button
                type="button"
                onClick={() => setIsCancelRangeModalOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Para o dia <span className="font-bold text-foreground font-mono">{formatBirthDate(selectedDate)}</span>. Agendamentos existentes de clientes <span className="text-primary font-bold">serão mantidos intactos</span>.
            </p>

            {cancelError && (
              <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl p-3 mb-4">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{cancelError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCancelRange} className="space-y-4">
              {/* Selecionar Barbeiro */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profissional / Barbeiro *</label>
                <select
                  value={cancelBarberId}
                  onChange={(e) => setCancelBarberId(e.target.value)}
                  className="w-full bg-background border border-border focus:border-rose-500 rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none transition-all"
                >
                  <option value="">Selecione um profissional</option>
                  {barbers.filter(b => b.is_active !== false).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              {/* Intervalo de Horários (Início e Fim) */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Horário Início *</label>
                  <select
                    value={cancelStartTime}
                    onChange={(e) => setCancelStartTime(e.target.value)}
                    className="w-full bg-background border border-border focus:border-rose-500 rounded-xl py-2.5 px-3 text-xs text-foreground font-mono focus:outline-none transition-all"
                  >
                    {getAvailableCancelTimeSlots(selectedDate, false).map(t => (
                      <option key={`start-${t}`} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Horário Fim *</label>
                  <select
                    value={cancelEndTime}
                    onChange={(e) => setCancelEndTime(e.target.value)}
                    className="w-full bg-background border border-border focus:border-rose-500 rounded-xl py-2.5 px-3 text-xs text-foreground font-mono focus:outline-none transition-all"
                  >
                    {getAvailableCancelTimeSlots(selectedDate, true).map(t => (
                      <option key={`end-${t}`} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Motivo do Cancelamento */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Motivo do Cancelamento / Bloqueio *</label>
                <input
                  type="text"
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ex: Almoço, Folga, Reunião, Imprevisto"
                  className="w-full bg-background border border-border focus:border-rose-500 rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-border/40 mt-4">
                <button
                  type="button"
                  onClick={() => setIsCancelRangeModalOpen(false)}
                  className="flex-1 py-2.5 bg-muted/40 hover:bg-muted/60 text-foreground text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={cancelSubmitting}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs uppercase tracking-wider font-bold rounded-xl shadow-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {cancelSubmitting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"></div>
                  ) : (
                    "Confirmar Bloqueio"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE VISUALIZAR / DESFAZER BLOQUEIO DE AGENDA */}
      {isBloqueioModalOpen && selectedBloqueio && (() => {
        const details = getBloqueioDetails(selectedBloqueio)
        const barb = barbers.find(b => String(b.id) === String(selectedBloqueio.barber_id))
        const barberName = barb ? barb.name : (selectedBloqueio.barber_name || "Profissional")

        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in">
            <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-md border border-rose-500/40 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in">
              <div className="flex items-center justify-between mb-4 border-b border-border/40 pb-4">
                <h3 className="text-lg font-bold font-display text-rose-400 flex items-center gap-2">
                  <AlertTriangle size={22} className="text-rose-400 shrink-0" />
                  Bloqueio de Agenda
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsBloqueioModalOpen(false)
                    setSelectedBloqueio(null)
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl p-3 mb-4">
                  <AlertTriangle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-semibold">Profissional / Barbeiro:</span>
                    <span className="font-bold text-foreground text-sm">{barberName}</span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-semibold">Data:</span>
                    <span className="font-bold text-foreground font-mono">{formatBirthDate(selectedDate)}</span>
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-semibold">Horário Bloqueado:</span>
                    <span className="font-mono font-bold text-rose-300 bg-rose-500/20 px-2 py-0.5 rounded border border-rose-500/30">
                      {details.startTime} às {details.endTime} ({details.count} {details.count === 1 ? 'horário' : 'horários'})
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs pt-1 border-t border-rose-500/20">
                    <span className="text-muted-foreground font-semibold">Motivo do Bloqueio:</span>
                    <span className="font-extrabold text-rose-300">{details.reason}</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Clique em <span className="text-emerald-400 font-bold">Desfazer Bloqueio</span> para remover a restrição e liberar estes horários para novos agendamentos.
                </p>
              </div>

              <div className="flex gap-3 pt-3 border-t border-border/40">
                <button
                  type="button"
                  onClick={handleRemoveBloqueio}
                  disabled={submitLoading}
                  className="flex-1 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 text-xs uppercase tracking-wider font-extrabold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitLoading ? (
                    <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <RotateCcw size={15} />
                      <span>DESFAZER BLOQUEIO</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsBloqueioModalOpen(false)
                    setSelectedBloqueio(null)
                  }}
                  className="py-3 px-5 bg-muted/40 hover:bg-muted/60 text-foreground text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer border border-border/40"
                >
                  FECHAR
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE AGENDAMENTO (MODELO ORIGINAL IGUAL À AGENDA) */}
      {isAppointmentModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-3xl md:max-w-4xl border border-primary/30 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-xl font-bold font-display text-primary flex items-center gap-2">
                  {editingAppointmentId ? <Edit3 size={20} /> : <Plus size={20} />}
                  {editingAppointmentId ? "Editar Agendamento" : "Novo Agendamento"}
                </h3>

                {editingAppointmentId && appointments.find((a) => String(a.id) === String(editingAppointmentId))?.recurrence_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-wider">
                    <Repeat size={11} /> Recorrente
                  </span>
                )}
              </div>

              {selectedDate && (
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-primary/10 border border-primary/30 text-primary shrink-0">
                  <CalendarIcon size={15} className="shrink-0" />
                  <span className="text-xs font-medium text-muted-foreground hidden sm:inline">Para o dia</span>
                  <span className="font-bold text-sm font-mono tracking-wide text-primary">
                    {formatBirthDate(selectedDate)}
                  </span>
                </div>
              )}
            </div>

            <form onSubmit={handleSaveAppointment} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* CAMPO DE CLIENTE COM AUTOCOMPLETE DE BUSCA E OPÇÃO DE NOVO CLIENTE */}
                <div className="space-y-1 relative sm:col-span-1" ref={customerDropdownRef}>
                  <div className="flex items-center justify-between h-5 mb-0.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nome do Cliente *</label>
                    <button
                      type="button"
                      onClick={() => setIsNewCustomerModalOpen(true)}
                      className="text-[10px] text-primary hover:underline font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <UserPlus size={11} /> + Novo Cliente
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => {
                        const val = e.target.value
                        setClientName(val)
                        setIsCustomerDropdownOpen(val.trim().length > 0)
                      }}
                      onFocus={() => {
                        if (clientName.trim().length > 0) {
                          setIsCustomerDropdownOpen(true)
                        }
                      }}
                      placeholder="Digite o nome para buscar"
                      className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 pl-10 pr-4 text-sm text-foreground focus:outline-none transition-all"
                    />
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
                  </div>

                  {/* Dropdown Autocomplete de Clientes */}
                  {isCustomerDropdownOpen && clientName.trim().length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-elevated z-50 max-h-48 overflow-y-auto animate-scale-in">
                      {filteredCustomers.length > 0 ? (
                        filteredCustomers.map((cust) => (
                          <button
                            key={cust.id}
                            type="button"
                            onClick={() => handleSelectCustomer(cust)}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-muted/40 border-b border-border/30 last:border-0 flex flex-col cursor-pointer transition-colors"
                          >
                            <span className="font-bold text-xs text-foreground">{cust.name}</span>
                            {cust.phone && (
                              <span className="text-[10px] text-primary font-mono">{formatPhoneNumber(cust.phone)}</span>
                            )}
                          </button>
                        ))
                      ) : (
                        <div className="p-3 text-center text-xs text-muted-foreground">
                          <p className="mb-2 text-[11px]">Nenhum cliente encontrado com este nome.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomerDropdownOpen(false)
                              setNewCustomerName(clientName)
                              setIsNewCustomerModalOpen(true)
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-all cursor-pointer"
                          >
                            <UserPlus size={12} /> Cadastrar "{clientName}"
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1 sm:col-span-1">
                  <div className="flex items-center justify-between h-5 mb-0.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Telefone / WhatsApp *</label>
                  </div>
                  <input
                    type="text"
                    required
                    value={clientPhone}
                    onChange={(e) => setClientPhone(formatPhoneNumber(e.target.value))}
                    maxLength={15}
                    placeholder="Ex: (34) 98821-8498"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Selecionar Barbeiro */}
              <div className="space-y-2 mt-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Profissional / Barbeiro *</label>
                <div className="flex flex-wrap gap-2.5">
                  {barbers.filter(b => b.is_active !== false || b.id === selectedBarber).map((barb, index) => {
                    const isSelected = selectedBarber === barb.id
                    const barberPhoto = barb.photo || (
                      index === 0 ? "/assets/marcio-barber.jpeg" :
                        index === 1 ? "/assets/lucas-barber.jpeg" :
                          "/assets/neto-barber.jpeg"
                    )
                    return (
                      <button
                        type="button"
                        key={barb.id}
                        onClick={() => {
                          const newBarberId = barb.id
                          setSelectedBarber(newBarberId)
                          if (selectedTime && isTimeSlotBooked(selectedDate, selectedTime, newBarberId)) {
                            setSelectedTime("")
                          }
                        }}
                        className={`flex items-center gap-2.5 p-2 rounded-xl border text-left transition-all cursor-pointer ${isSelected
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border/60 bg-background/30 text-muted-foreground hover:border-border"
                          }`}
                      >
                        <div className="w-7 h-7 rounded-full overflow-hidden border border-border/80 shrink-0 bg-background">
                          <img src={barberPhoto} alt={barb.name} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-xs truncate">{barb.name.split(" ")[0]}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Selecionar Serviços e Horário lado a lado em duas colunas */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* Selecionar Serviços (Múltiplos) */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Serviços Desejados *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 h-44 overflow-y-auto content-start p-1.5 bg-background/25 border border-border/40 rounded-xl">
                    {services.map((srv) => {
                      const isSelected = selectedServices.includes(srv.id)
                      return (
                        <button
                          type="button"
                          key={srv.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedServices((prev) => prev.filter((id) => id !== srv.id))
                            } else {
                              setSelectedServices((prev) => [...prev, srv.id])
                            }
                          }}
                          className={`flex items-center justify-between p-2.5 rounded-xl border text-left transition-all cursor-pointer ${isSelected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/60 bg-background/30 text-muted-foreground hover:border-border"
                            }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all ${isSelected ? "border-primary bg-primary text-background" : "border-muted-foreground/35"
                                }`}
                            >
                              {isSelected && <Check size={12} strokeWidth={3} />}
                            </div>
                            <span className="text-xs truncate font-medium">{srv.name}</span>
                          </div>
                          <span className="text-[10px] font-mono pl-2 shrink-0 text-muted-foreground">R$ {srv.price.toFixed(0)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Selecionar Horário */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">Horário Disponível *</label>
                  {!selectedDate ? (
                    <div className="h-44 flex items-center justify-center p-3 bg-background/25 border border-border/40 rounded-xl">
                      <p className="text-xs text-muted-foreground">Selecione um dia primeiro.</p>
                    </div>
                  ) : getTimeSlots(selectedDate).length === 0 ? (
                    <div className="h-44 flex items-center justify-center p-3 bg-destructive/5 border border-destructive/20 rounded-xl">
                      <p className="text-xs text-destructive font-bold text-center">
                        Barbearia fechada neste dia (Domingo).
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 h-44 overflow-y-auto content-start p-1.5 bg-background/25 border border-border/40 rounded-xl">
                      {getTimeSlots(selectedDate).map((time) => {
                        const isPast = isTimeSlotPast(selectedDate, time)
                        const isBooked = isTimeSlotBooked(selectedDate, time)
                        const isDisabled = isPast || isBooked
                        const isSelected = selectedTime === time
                        return (
                          <button
                            key={time}
                            type="button"
                            disabled={isDisabled}
                            onClick={() => setSelectedTime(time)}
                            className={`py-2 text-xs font-bold rounded-xl border transition-all text-center ${isSelected
                                ? "bg-foreground border-foreground text-background shadow-sm scale-102 cursor-pointer"
                                : isBooked
                                  ? "bg-destructive/10 border-destructive/20 text-destructive/60 line-through cursor-not-allowed"
                                  : isPast
                                    ? "bg-background/20 border-border/10 text-muted-foreground/30 cursor-not-allowed"
                                    : "bg-background border-border text-foreground hover:border-foreground/50 cursor-pointer"
                              }`}
                            title={
                              isBooked
                                ? "Horário já agendado para este profissional"
                                : isPast
                                  ? "Horário já passou"
                                  : `Selecionar ${time}`
                            }
                          >
                            {time}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* PAINEL INFORMATIVO DE DURAÇÃO SOMADA E HORÁRIO CALCULADO */}
              {selectedServices.length > 0 && (
                <div className="bg-primary/10 border border-primary/30 rounded-xl p-3.5 flex items-center justify-between text-xs animate-fade-in">
                  <div>
                    <span className="font-bold text-primary block text-[10px] uppercase tracking-wider">Resumo Combinado</span>
                    <span className="text-foreground font-semibold text-xs truncate max-w-[450px] block">
                      {selectedServicesDetails.map((s) => s.name).join(" + ")}
                    </span>
                  </div>
                  <div className="text-right shrink-0 pl-2">
                    <div className="font-bold text-primary text-[12pt] font-mono tracking-wide">
                      R$ {totalPriceCalculated.toFixed(2).replace(".", ",")}
                    </div>
                    <div className="text-[10pt] text-muted-foreground font-mono font-bold">
                      ⏱️ {totalDurationMinutes === 0 ? "Livre" : `${totalDurationMinutes} min`} {selectedTime && calculatedEndTime ? `(${selectedTime} - ${calculatedEndTime})` : ""}
                    </div>
                  </div>
                </div>
              )}

              {/* OPÇÃO DE AGENDAMENTO RECORRENTE (EXCLUSIVO NA CRIAÇÃO DE NOVO AGENDAMENTO) */}
              {!editingAppointmentId && (
                <div className="border border-border/70 bg-background/30 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={handleToggleRecurrence}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                        isRecurring
                          ? "bg-primary text-background border-primary shadow-sm"
                          : "bg-background border-border text-foreground hover:border-primary/60"
                      }`}
                    >
                      <Repeat size={14} />
                      <span>Agendamento Recorrente</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                        isRecurring ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                      }`}>
                        {isRecurring ? "ATIVO" : "ATIVAR"}
                      </span>
                    </button>

                    <span className="text-[11px] text-muted-foreground">
                      {isRecurring
                        ? "Datas com conflito de horário serão puladas automaticamente."
                        : "Clique para repetir este agendamento semanalmente, quinzenalmente ou mensalmente."}
                    </span>
                  </div>

                  {isRecurring && (
                    <div className="pt-3 border-t border-border/40 space-y-3 animate-fade-in">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Frequência */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Frequência *
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {FREQUENCY_OPTIONS.map((opt) => {
                              const active = recurrenceFrequency === opt.value
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setRecurrenceFrequency(opt.value)}
                                  className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                    active
                                      ? "bg-primary/15 border-primary text-primary"
                                      : "bg-background border-border/70 text-muted-foreground hover:border-border"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Data Final */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Repetir até o dia *
                          </label>
                          <input
                            type="date"
                            value={recurrenceEndDate}
                            min={selectedDate || todayStr}
                            onChange={(e) => setRecurrenceEndDate(e.target.value)}
                            className="w-full bg-background border border-border focus:border-primary rounded-xl py-2 px-3 text-xs text-foreground font-mono focus:outline-none transition-all"
                          />
                        </div>
                      </div>

                      {/* Dias da Semana */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                          Dia(s) da Semana *
                        </label>
                        <div className="grid grid-cols-6 gap-1.5">
                          {WEEKDAY_OPTIONS.map((dayOpt) => {
                            const active = recurrenceWeekdays.includes(dayOpt.value)
                            return (
                              <button
                                key={dayOpt.value}
                                type="button"
                                onClick={() => handleToggleRecurrenceWeekday(dayOpt.value)}
                                className={`py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                                  active
                                    ? "bg-foreground text-background border-foreground shadow-xs"
                                    : "bg-background border-border/70 text-muted-foreground hover:border-border"
                                }`}
                              >
                                {dayOpt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Prévia das Datas Geradas */}
                      {selectedTime && recurrenceEndDate && (
                        <div className="bg-muted/25 border border-border/50 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between text-[11px] flex-wrap gap-2">
                            <span className="font-bold text-foreground">
                              Prévia: {recurrencePreview.availableDates.length} agendamento(s) será(ão) criado(s)
                            </span>
                            {recurrencePreview.skippedDates.length > 0 && (
                              <span className="text-amber-400 font-semibold">
                                {recurrencePreview.skippedDates.length} dia(s) pulado(s) por conflito
                              </span>
                            )}
                          </div>

                          {recurrencePreview.truncated && (
                            <p className="text-[10px] text-amber-400">
                              Limite máximo de {MAX_RECURRENCE_OCCURRENCES} ocorrências atingido. Datas posteriores foram ignoradas.
                            </p>
                          )}

                          {recurrencePreview.allDates.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                              {recurrencePreview.allDates.map((item) => {
                                const parts = item.date.split("-")
                                const labelDate = parts.length === 3 ? `${parts[2]}/${parts[1]}` : item.date
                                return (
                                  <span
                                    key={item.date}
                                    title={item.hasConflict ? `${labelDate} às ${selectedTime}: ${item.reason} (será pulado)` : `${labelDate} às ${selectedTime}: disponível`}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold border transition-colors ${
                                      item.hasConflict
                                        ? "bg-black border-red-500/30 text-red-400/70 line-through"
                                        : "bg-black border-yellow-400/50 text-yellow-400 shadow-xs"
                                    }`}
                                  >
                                    {labelDate}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              Nenhuma data encontrada entre a data inicial e a data final para os dias selecionados.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Mensagens de Aviso / Erro / Sucesso Posicionadas Abaixo do Seletor de Horários */}
              {error && (
                <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-4 mt-3 animate-fade-in">
                  <AlertTriangle size={18} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {successMsg && (
                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl p-4 mt-3 animate-fade-in">
                  <CheckCircle2 size={18} className="shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {cancelScopePromptOpen && editingAppointmentId && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 space-y-3 animate-fade-in">
                  <p className="text-xs font-bold text-destructive flex items-center gap-2">
                    <Repeat size={14} /> Este agendamento faz parte de uma recorrência. Como deseja cancelar?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={submitLoading}
                      onClick={() => handleCancelAppointment("single")}
                      className="py-2 px-3 bg-destructive text-white text-xs font-bold rounded-xl hover:opacity-90 transition-all cursor-pointer"
                    >
                      Cancelar apenas este
                    </button>
                    <button
                      type="button"
                      disabled={submitLoading}
                      onClick={() => handleCancelAppointment("future")}
                      className="py-2 px-3 bg-destructive/20 border border-destructive/40 text-destructive text-xs font-bold rounded-xl hover:bg-destructive/30 transition-all cursor-pointer"
                    >
                      Cancelar este e os próximos
                    </button>
                    <button
                      type="button"
                      disabled={submitLoading}
                      onClick={() => setCancelScopePromptOpen(false)}
                      className="py-2 px-3 bg-background border border-border text-foreground text-xs font-bold rounded-xl hover:bg-muted transition-all cursor-pointer"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-border/40 mt-6 flex-wrap">
                {editingAppointmentId && (() => {
                  const currentEditingAppt = appointments.find((a) => String(a.id) === String(editingAppointmentId))
                  const isCurrentApptAbsent = currentEditingAppt ? currentEditingAppt.status === "absent" : false
                  const isCurrentApptCancelled = currentEditingAppt ? currentEditingAppt.status === "cancelled" : false

                  return (
                    <>
                      {!isCurrentApptCancelled && (
                        <button
                          type="button"
                          onClick={handleToggleAbsentModal}
                          disabled={submitLoading}
                          className={`py-3 px-4 text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 border ${isCurrentApptAbsent
                              ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
                              : "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
                            }`}
                          title={isCurrentApptAbsent ? "Remover status Ausente" : "Marcar como Ausente"}
                        >
                          <UserX size={14} />
                          <span>{isCurrentApptAbsent ? "REMOVER AUSENTE" : "MARCAR AUSENTE"}</span>
                        </button>
                      )}

                      {isCurrentApptCancelled ? (
                        <button
                          type="button"
                          onClick={handleUncancelAppointment}
                          disabled={submitLoading}
                          className="py-3 px-4 bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-emerald-400 text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          title="Desfazer cancelamento e reativar agendamento"
                        >
                          <RotateCcw size={14} />
                          <span>DESFAZER CANCELAMENTO</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCancelAppointment()}
                          disabled={submitLoading}
                          className="py-3 px-4 bg-destructive/10 border border-destructive/30 hover:bg-destructive/20 text-destructive text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <Trash2 size={14} />
                          <span>CANCELAR</span>
                        </button>
                      )}
                    </>
                  )
                })()}

                <button
                  type="button"
                  onClick={() => {
                    setIsAppointmentModalOpen(false)
                    setEditingAppointmentId(null)
                    setCancelScopePromptOpen(false)
                  }}
                  className="flex-1 py-3 bg-muted/40 hover:bg-muted/60 text-foreground text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer border border-border/40"
                >
                  FECHAR
                </button>
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="btn-primary flex-1 py-3 cursor-pointer disabled:opacity-50"
                >
                  {submitLoading ? (
                    <div className="w-5 h-5 border-2 border-background border-t-transparent rounded-full animate-spin mx-auto"></div>
                  ) : editingAppointmentId ? (
                    "SALVAR ALTERAÇÕES"
                  ) : isRecurring ? (
                    `CONFIRMAR RECORRÊNCIA (${recurrencePreview.availableDates.length})`
                  ) : (
                    "CONFIRMAR AGENDAMENTO"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sub-modal: Novo Cliente Rápido */}
      {isNewCustomerModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
          <div className="bg-card w-full max-w-md border border-border rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold font-display text-foreground flex items-center gap-2">
                <UserPlus size={20} /> Cadastrar Novo Cliente
              </h3>
              <button
                type="button"
                onClick={() => setIsNewCustomerModalOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {newCustomerError && (
              <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl p-3 mb-4">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{newCustomerError}</span>
              </div>
            )}

            <form onSubmit={handleCreateNewCustomer} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  placeholder="Ex: João da Silva"
                  className="w-full bg-background border border-border focus:border-foreground rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">WhatsApp / Celular *</label>
                <input
                  type="text"
                  required
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(formatPhoneNumber(e.target.value))}
                  placeholder="Ex: (34) 99999-8888"
                  className="w-full bg-background border border-border focus:border-foreground rounded-xl py-2.5 px-3 text-xs text-foreground focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-border/40 mt-4">
                <button
                  type="button"
                  onClick={() => setIsNewCustomerModalOpen(false)}
                  className="flex-1 py-2.5 bg-muted/40 hover:bg-muted/60 text-foreground text-xs uppercase tracking-wider font-bold rounded-xl transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={newCustomerSubmitting}
                  className="btn-primary flex-1 py-2.5 cursor-pointer disabled:opacity-50"
                >
                  {newCustomerSubmitting ? (
                    <div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin mx-auto"></div>
                  ) : (
                    "Salvar e Selecionar"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE INCLUSÃO E EDIÇÃO DE VENDA */}
      <SaleModal
        isOpen={isSaleModalOpen}
        onClose={() => {
          setIsSaleModalOpen(false)
          setSelectedSaleAppt(null)
          setExistingSaleData(null)
        }}
        appointment={selectedSaleAppt}
        existingSale={existingSaleData}
        products={productsList}
        onSaveSale={handleSaveSale}
        onDeleteSale={handleDeleteSale}
      />

      {/* MODAL DE LANÇAMENTO DO CAIXA */}
      <CaixaEntryModal
        isOpen={isCaixaModalOpen}
        onClose={() => {
          setIsCaixaModalOpen(false)
          setSelectedCaixaAppt(null)
        }}
        appointment={selectedCaixaAppt}
        onSaveSuccess={handleCaixaSaveSuccess}
      />
    </div>
  )
}
