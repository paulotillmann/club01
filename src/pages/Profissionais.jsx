import React, { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext.jsx"
import { barbersApi, usersApi, appointmentsApi } from "../lib/api.js"
import { User, Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, Upload } from "lucide-react"
import Sidebar from "../components/Sidebar.jsx"

export default function Profissionais() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [barbers, setBarbers] = useState([])
  const [systemUsers, setSystemUsers] = useState([])
  const [loadingBarbers, setLoadingBarbers] = useState(true)
  const [filterTab, setFilterTab] = useState("todos") // "todos" | "ativos" | "inativos"
  const [isBarberModalOpen, setIsBarberModalOpen] = useState(false)
  const [editingBarberId, setEditingBarberId] = useState(null)
  const [barberName, setBarberName] = useState("")
  const [barberPhone, setBarberPhone] = useState("")
  const [barberPhoto, setBarberPhoto] = useState("")
  const [barberBirthDate, setBarberBirthDate] = useState("")
  const [barberSpecialty, setBarberSpecialty] = useState("")
  const [barberHiredAt, setBarberHiredAt] = useState("")
  const [barberServiceCommission, setBarberServiceCommission] = useState(0)
  const [barberProductCommission, setBarberProductCommission] = useState(0)
  const [barberUserId, setBarberUserId] = useState("")
  const [barberIsActive, setBarberIsActive] = useState(true)
  const [barberSubmitting, setBarberSubmitting] = useState(false)
  const [barberError, setBarberError] = useState("")
  const [barberSuccess, setBarberSuccess] = useState("")

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null
  })

  const [pendingWarningModal, setPendingWarningModal] = useState({
    isOpen: false,
    barber: null,
    pendingAppts: []
  })

  useEffect(() => {
    if (!user) {
      navigate("/login")
      return
    }

    async function loadData() {
      setLoadingBarbers(true)
      try {
        const [bData, uData] = await Promise.all([
          barbersApi.getAll(),
          usersApi.getAll().catch(() => [])
        ])
        setBarbers(bData || [])
        setSystemUsers(uData || [])
      } catch (err) {
        console.error("Erro ao carregar dados dos profissionais:", err)
      } finally {
        setLoadingBarbers(false)
      }
    }

    loadData()
  }, [user, navigate])

  const showConfirm = (title, message, onConfirm) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm()
        setConfirmModal(prev => ({ ...prev, isOpen: false }))
      }
    })
  }

  const formatBirthDate = (dateStr) => {
    if (!dateStr) return ""
    const parts = dateStr.split("-")
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`
    }
    return dateStr
  }

  const resetBarberForm = () => {
    setEditingBarberId(null)
    setBarberName("")
    setBarberPhone("")
    setBarberPhoto("")
    setBarberBirthDate("")
    setBarberSpecialty("")
    setBarberHiredAt("")
    setBarberServiceCommission(0)
    setBarberProductCommission(0)
    setBarberUserId("")
    setBarberIsActive(true)
  }

  const handleEditBarberClick = (barb) => {
    setEditingBarberId(barb.id)
    setBarberName(barb.name || "")
    setBarberPhone(barb.phone || "")
    setBarberPhoto(barb.photo || "")
    setBarberBirthDate(barb.birth_date || "")
    setBarberSpecialty(barb.specialty || "")
    setBarberHiredAt(barb.hired_at || "")
    setBarberServiceCommission(barb.service_commission ?? 0)
    setBarberProductCommission(barb.product_commission ?? 0)
    setBarberUserId(barb.user_id || "")
    setBarberIsActive(barb.is_active !== false)
    setIsBarberModalOpen(true)
  }

  const handleBarberPhoneChange = (e) => {
    let value = e.target.value.replace(/\D/g, "")
    if (value.length > 11) value = value.slice(0, 11)
    
    if (value.length > 10) {
      value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`
    } else if (value.length > 5) {
      value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`
    } else if (value.length > 2) {
      value = `(${value.slice(0, 2)}) ${value.slice(2)}`
    } else if (value.length > 0) {
      value = `(${value}`
    }
    setBarberPhone(value)
  }

  const compressAndSetImage = (file, callback, onError) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        let width = img.width
        let height = img.height
        
        const MAX_WIDTH = 400
        const MAX_HEIGHT = 400
        
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width
            width = MAX_WIDTH
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height
            height = MAX_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext("2d")
        ctx.drawImage(img, 0, 0, width, height)
        
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7)
        callback(compressedBase64)
      }
      img.onerror = () => {
        onError("Erro ao processar imagem.")
      }
      img.src = event.target.result
    }
    reader.onerror = () => {
      onError("Erro ao ler o arquivo.")
    }
    reader.readAsDataURL(file)
  }

  const handleBarberPhotoUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    compressAndSetImage(
      file,
      (compressedBase64) => setBarberPhoto(compressedBase64),
      (errMsg) => setBarberError(errMsg)
    )
  }

  const handleSaveBarber = async (e) => {
    e.preventDefault()
    setBarberSubmitting(true)
    setBarberError("")
    setBarberSuccess("")

    const payload = {
      name: barberName.trim(),
      phone: barberPhone.trim(),
      photo: barberPhoto.trim(),
      birth_date: barberBirthDate.trim(),
      specialty: barberSpecialty.trim(),
      hired_at: barberHiredAt.trim(),
      service_commission: Number(barberServiceCommission) || 0,
      product_commission: Number(barberProductCommission) || 0,
      user_id: barberUserId.trim() || null,
      is_active: barberIsActive
    }

    try {
      let savedBarber
      if (editingBarberId) {
        savedBarber = await barbersApi.update(editingBarberId, payload)
      } else {
        savedBarber = await barbersApi.create(payload)
      }

      setBarberSuccess(editingBarberId ? "Profissional atualizado com sucesso!" : "Profissional cadastrado com sucesso!")
      setTimeout(() => {
        setBarberSuccess("")
      }, 5000)

      if (editingBarberId) {
        setBarbers(prev => prev.map(b => b.id === editingBarberId ? { ...b, ...savedBarber, is_active: barberIsActive } : b))
      } else {
        setBarbers(prev => [...prev, { ...savedBarber, is_active: barberIsActive }])
      }

      setIsBarberModalOpen(false)
      resetBarberForm()
    } catch (err) {
      setBarberError(err.message)
    } finally {
      setBarberSubmitting(false)
    }
  }

  const handleToggleActiveBarber = async (barb) => {
    const willDeactivate = barb.is_active !== false

    if (willDeactivate) {
      try {
        const pending = await appointmentsApi.getFuturePendingByBarber(barb.id)
        if (pending && pending.length > 0) {
          setPendingWarningModal({
            isOpen: true,
            barber: barb,
            pendingAppts: pending
          })
          return
        }
      } catch (err) {
        console.warn("Aviso ao verificar agendamentos futuros:", err)
      }
    }

    await executeToggleActive(barb.id, !willDeactivate)
  }

  const executeToggleActive = async (barberId, newActiveStatus) => {
    setBarberError("")
    try {
      await barbersApi.toggleActive(barberId, newActiveStatus)
      setBarbers(prev =>
        prev.map(b => (b.id === barberId ? { ...b, is_active: newActiveStatus } : b))
      )
      setBarberSuccess(
        newActiveStatus
          ? "Profissional ativado na agenda com sucesso!"
          : "Profissional desativado da agenda com sucesso!"
      )
      setTimeout(() => setBarberSuccess(""), 4000)
    } catch (err) {
      setBarberError(err.message || "Erro ao alterar status do profissional.")
    } finally {
      setPendingWarningModal({ isOpen: false, barber: null, pendingAppts: [] })
    }
  }

  const handleDeleteBarber = (id) => {
    showConfirm(
      "Excluir Profissional",
      "Tem certeza que deseja excluir este profissional? Esta ação não poderá ser desfeita.",
      () => executeDeleteBarber(id)
    )
  }

  const executeDeleteBarber = async (id) => {
    setBarberError("")
    setBarberSuccess("")

    try {
      await barbersApi.delete(id)
      setBarberSuccess("Profissional excluído com sucesso!")
      setTimeout(() => {
        setBarberSuccess("")
      }, 5000)
      setBarbers(prev => prev.filter(b => b.id !== id))
    } catch (err) {
      setBarberError(err.message || "Erro ao excluir profissional.")
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-transparent text-foreground pt-24 pb-28 lg:pt-8 lg:pb-12 pr-[40px] pl-4 md:pl-8 relative lg:pl-[274px] sidebar-page-container flex flex-col justify-start">
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
        `}
      </style>

      {/* Sidebar de Navegação */}
      <Sidebar />

      <div className="w-full relative z-10 animate-fade-in">
        <div className="space-y-6 mt-[40px]">
          {barberSuccess && (
            <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl p-4 shadow-sm animate-fade-in">
              <CheckCircle2 size={18} className="shrink-0" />
              <span>{barberSuccess}</span>
            </div>
          )}

          {barberError && (
            <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-4 shadow-sm animate-fade-in">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{barberError}</span>
            </div>
          )}

          <div className="bg-card/40 backdrop-blur-sm border border-border/80 rounded-2xl p-6 md:p-8 shadow-elevated">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <div>
                <h2 className="text-[18pt] font-bold font-display mb-2 flex items-center gap-2">
                  <User className="text-primary w-6 h-6" /> Profissionais
                </h2>
                <p className="text-sm text-muted-foreground">
                  Profissionais qualificados com ampla experiência no mercado, prontos para entregar o melhor visual para você.
                </p>
              </div>
              {user.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => {
                    resetBarberForm()
                    setIsBarberModalOpen(true)
                  }}
                  className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-wider cursor-pointer"
                >
                  <Plus size={14} /> Novo Profissional
                </button>
              )}
            </div>

            {/* Abas de Filtro: Todos, Ativos, Inativos */}
            {!loadingBarbers && barbers.length > 0 && (
              <div className="flex items-center gap-2 mb-6 border-b border-border/40 pb-4 flex-wrap">
                <button
                  type="button"
                  onClick={() => setFilterTab("todos")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                    filterTab === "todos"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Todos <span className="text-[10px] opacity-80 font-mono">({barbers.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("ativos")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                    filterTab === "ativos"
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Ativos na Agenda <span className="text-[10px] opacity-80 font-mono">({barbers.filter(b => b.is_active !== false).length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab("inativos")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-2 ${
                    filterTab === "inativos"
                      ? "bg-zinc-600 text-white shadow-sm"
                      : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Inativos na Agenda <span className="text-[10px] opacity-80 font-mono">({barbers.filter(b => b.is_active === false).length})</span>
                </button>
              </div>
            )}
            
            {loadingBarbers ? (
              <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,280px)] gap-5 justify-items-start">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="w-full max-w-[280px] bg-muted/20 border border-border/50 rounded-2xl p-6 animate-pulse flex flex-col items-center">
                    <div className="w-28 h-28 rounded-full bg-muted mb-4" />
                    <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                    <div className="h-3 bg-muted rounded w-1/2 mb-6" />
                    <div className="w-full space-y-2 border-t border-border/40 pt-4">
                      <div className="h-3 bg-muted rounded w-full" />
                      <div className="h-3 bg-muted rounded w-4/5" />
                    </div>
                    <div className="h-8 bg-muted rounded-xl w-full mt-6" />
                  </div>
                ))}
              </div>
            ) : barbers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                <User size={40} className="stroke-1 mb-3 text-muted-foreground/30" />
                <p className="text-sm font-medium">Nenhum profissional cadastrado.</p>
                {user.role === 'admin' && (
                  <p className="text-xs mt-1 text-muted-foreground/60">Clique em "Novo Profissional" para adicionar.</p>
                )}
              </div>
            ) : barbers.filter(b => {
                if (filterTab === "ativos") return b.is_active !== false
                if (filterTab === "inativos") return b.is_active === false
                return true
              }).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground border border-dashed border-border rounded-xl">
                <User size={36} className="stroke-1 mb-2 text-muted-foreground/30" />
                <p className="text-xs font-medium">Nenhum profissional encontrado com o filtro "{filterTab}".</p>
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,280px)] gap-5 justify-items-start">
              {barbers
                .filter(b => {
                  if (filterTab === "ativos") return b.is_active !== false
                  if (filterTab === "inativos") return b.is_active === false
                  return true
                })
                .map((barb, index) => {
                const photo = barb.photo || (
                  index === 0 ? "/assets/marcio-barber.jpeg" :
                  index === 1 ? "/assets/lucas-barber.jpeg" :
                  "/assets/neto-barber.jpeg"
                )
                const isActive = barb.is_active !== false

                return (
                  <div
                    key={barb.id}
                    className={`w-full max-w-[280px] bg-muted/20 border border-border/85 rounded-2xl p-5 shadow-md hover:border-primary/40 transition-all duration-300 text-center flex flex-col items-center group relative ${
                      !isActive ? "opacity-75 grayscale-[20%]" : ""
                    }`}
                  >
                    {/* Badge de Status e Quick Toggle */}
                    <div className="w-full flex items-center justify-between gap-2 mb-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-400"}`} />
                        {isActive ? "Atende como Barbeiro" : "Inativo na Agenda"}
                      </span>

                      {user.role === 'admin' && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isActive}
                          onClick={() => handleToggleActiveBarber(barb)}
                          title={isActive ? "Clique para desativar da agenda" : "Clique para ativar na agenda"}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            isActive ? "bg-emerald-500" : "bg-zinc-600"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                              isActive ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    <div className="relative w-28 h-28 rounded-full overflow-hidden border-2 border-border/80 group-hover:border-primary/50 transition-colors duration-300 shadow-md mb-4 bg-background">
                      <img src={photo} alt={barb.name} className="w-full h-full object-cover object-top scale-102 group-hover:scale-108 transition-transform duration-500" />
                    </div>
                    <h4 className="font-bold text-[12pt] uppercase tracking-wide text-foreground mt-1">{barb.name}</h4>
                    <span className="text-[10pt] font-bold uppercase tracking-widest text-primary mt-1">{barb.specialty || "Especialista CLUB 01"}</span>
                    
                    <div className="space-y-1.5 text-left w-full text-[10pt] text-muted-foreground border-t border-border/40 pt-4 mt-4 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground/80">WhatsApp:</span>
                        <a 
                          href={`https://wa.me/55${barb.phone.replace(/\D/g, "")}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-primary hover:underline hover:text-accent font-medium tracking-wide"
                        >
                          {barb.phone}
                        </a>
                      </div>
                      {barb.hired_at && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground/80">Profissional desde:</span>
                          <span className="text-foreground/90">{formatBirthDate(barb.hired_at)}</span>
                        </div>
                      )}
                      {user.role === 'admin' && (
                        <div className="border-t border-border/30 pt-2 mt-2 space-y-1">
                          <div className="flex justify-between items-center text-[10pt]">
                            <span className="font-semibold text-foreground/80">Comissão Serviços:</span>
                            <span className="font-bold text-primary">{barb.service_commission ?? 0}%</span>
                          </div>
                          <div className="flex justify-between items-center text-[10pt]">
                            <span className="font-semibold text-foreground/80">Comissão Produtos:</span>
                            <span className="font-bold text-primary">{barb.product_commission ?? 0}%</span>
                          </div>
                          {barb.user_id && (
                            <div className="flex justify-between items-center text-[10pt] pt-1 border-t border-border/20">
                              <span className="font-semibold text-foreground/80">Usuário Vinculado:</span>
                              <span className="font-bold text-primary truncate max-w-[130px]">
                                {systemUsers.find(u => u.id === barb.user_id)?.name || "Vinculado"}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {user.role === 'admin' && (
                      <div className="flex gap-2.5 w-full border-t border-border/40 pt-4 mt-4">
                        <button
                          type="button"
                          onClick={() => handleEditBarberClick(barb)}
                          className="flex-1 py-2 flex items-center justify-center gap-1.5 bg-background border border-border hover:border-primary/40 text-foreground text-xs font-bold rounded-xl transition-all cursor-pointer"
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBarber(barb.id)}
                          className="p-2 flex items-center justify-center bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground text-xs rounded-xl transition-all cursor-pointer border border-destructive/20 hover:border-destructive"
                          title="Excluir Profissional"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIRMAÇÃO PERSONALIZADO */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-sm border border-destructive/30 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in text-center">
            <div className="mx-auto w-12 h-12 bg-destructive/10 border border-destructive/25 text-destructive rounded-full flex items-center justify-center mb-4 animate-bounce">
              <AlertTriangle size={24} />
            </div>
            
            <h3 className="text-lg font-bold font-display text-foreground mb-2">
              {confirmModal.title}
            </h3>
            
            <p className="text-xs text-muted-foreground leading-relaxed mb-6">
              {confirmModal.message}
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 border border-border hover:bg-muted text-foreground font-bold h-11 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className="flex-1 bg-destructive hover:bg-destructive/80 text-white font-bold h-11 rounded-xl text-xs transition-all cursor-pointer shadow-lg hover:shadow-destructive/20"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE ALERTA DE AGENDAMENTOS FUTUROS PENDENTES AO DESATIVAR */}
      {pendingWarningModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-md border border-amber-500/30 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in text-center">
            <div className="mx-auto w-12 h-12 bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle size={24} />
            </div>
            
            <h3 className="text-lg font-bold font-display text-foreground mb-2">
              Desativar {pendingWarningModal.barber?.name}?
            </h3>
            
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              Este profissional possui <strong className="text-amber-400 font-semibold">{pendingWarningModal.pendingAppts.length} agendamento(s) futuro(s)</strong> confirmado(s) ou pendente(s):
            </p>

            <div className="bg-background/60 border border-border/80 rounded-xl p-3 mb-5 text-left max-h-40 overflow-y-auto space-y-2">
              {pendingWarningModal.pendingAppts.slice(0, 5).map((app) => (
                <div key={app.id} className="text-[11px] flex justify-between items-center border-b border-border/30 pb-1.5 last:border-b-0 last:pb-0">
                  <span className="font-semibold text-foreground truncate max-w-[170px]">{app.client_name}</span>
                  <span className="text-muted-foreground font-mono">
                    {app.appointment_time ? app.appointment_time.replace("T", " às ").slice(0, 16) : ""}
                  </span>
                </div>
              ))}
              {pendingWarningModal.pendingAppts.length > 5 && (
                <p className="text-[10px] text-center text-muted-foreground italic pt-1">
                  + {pendingWarningModal.pendingAppts.length - 5} outro(s) agendamento(s)
                </p>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed mb-6">
              Ao desativá-lo, <strong className="text-foreground">novos agendamentos não poderão ser realizados com ele</strong> na agenda ou online. Os agendamentos existentes acima serão preservados. Deseja prosseguir com a desativação?
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPendingWarningModal({ isOpen: false, barber: null, pendingAppts: [] })}
                className="flex-1 border border-border hover:bg-muted text-foreground font-bold h-11 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executeToggleActive(pendingWarningModal.barber.id, false)}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-bold h-11 rounded-xl text-xs transition-all cursor-pointer shadow-lg hover:shadow-amber-500/20"
              >
                Confirmar Desativação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CRIAÇÃO / EDIÇÃO DE PROFISSIONAIS */}
      {isBarberModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-card/95 text-card-foreground backdrop-blur-xl w-full max-w-lg border border-primary/30 rounded-2xl p-6 md:p-8 shadow-2xl relative animate-scale-in">
            <h3 className="text-xl font-bold font-display mb-6 text-primary flex items-center gap-2">
              {editingBarberId ? <Pencil size={20} /> : <Plus size={20} />}
              {editingBarberId ? "Editar Ficha de Profissional" : "Cadastrar Novo Profissional"}
            </h3>

            {barberError && (
              <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-4 mb-6">
                <AlertTriangle size={18} className="shrink-0" />
                <span>{barberError}</span>
              </div>
            )}

            <form onSubmit={handleSaveBarber} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={barberName}
                    onChange={(e) => setBarberName(e.target.value)}
                    placeholder="Ex: Paulo Tillmann"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Celular / WhatsApp *</label>
                  <input
                    type="text"
                    required
                    value={barberPhone}
                    onChange={handleBarberPhoneChange}
                    placeholder="Ex: (34) 98821-8498"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Data de Nascimento</label>
                  <input
                    type="date"
                    value={barberBirthDate}
                    onChange={(e) => setBarberBirthDate(e.target.value)}
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Especialidade (Especialista em)</label>
                  <input
                    type="text"
                    value={barberSpecialty}
                    onChange={(e) => setBarberSpecialty(e.target.value)}
                    placeholder="Ex: Cortes clássicos"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profissional Desde (Data)</label>
                  <input
                    type="date"
                    value={barberHiredAt}
                    onChange={(e) => setBarberHiredAt(e.target.value)}
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Comissão de Serviços (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={barberServiceCommission}
                    onChange={(e) => setBarberServiceCommission(e.target.value)}
                    placeholder="Ex: 50"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Comissão por Produto (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={barberProductCommission}
                    onChange={(e) => setBarberProductCommission(e.target.value)}
                    placeholder="Ex: 10"
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all font-mono"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                    Usuário Vinculado (Login do Sistema)
                  </label>
                  <select
                    value={barberUserId}
                    onChange={(e) => setBarberUserId(e.target.value)}
                    className="w-full bg-background border border-border focus:border-primary rounded-xl py-3 px-4 text-sm text-foreground focus:outline-none transition-all cursor-pointer"
                  >
                    <option value="">-- Nenhum Usuário Vinculado --</option>
                    {systemUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'barber' ? 'Barbeiro' : u.role === 'secretario' ? 'Secretário(a)' : u.role === 'admin' ? 'Admin' : u.role}) {u.phone ? `- ${u.phone}` : u.email ? `- ${u.email}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <div className="bg-background/60 border border-border rounded-xl p-4 flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <label 
                          className="text-xs font-bold text-foreground cursor-pointer select-none" 
                          onClick={() => setBarberIsActive(!barberIsActive)}
                        >
                          Atende como Barbeiro / Ativo na Agenda
                        </label>
                        <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full uppercase tracking-wider ${
                          barberIsActive 
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                            : 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/40'
                        }`}>
                          {barberIsActive ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-normal">
                        Quando ativado, o profissional fica visível para novos agendamentos online e na agenda do sistema (desktop e mobile).
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={barberIsActive}
                      onClick={() => setBarberIsActive(!barberIsActive)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        barberIsActive ? 'bg-emerald-500' : 'bg-muted border border-border'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          barberIsActive ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-1">Foto do Profissional</label>
                  <div className="flex items-center gap-4 bg-background/40 border border-border p-4 rounded-xl">
                    <div className="w-16 h-16 rounded-full overflow-hidden border border-border shadow-sm bg-background/50 flex items-center justify-center shrink-0">
                      {barberPhoto ? (
                        <img src={barberPhoto} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <User size={24} className="text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <label 
                        htmlFor="barber-photo-upload-input" 
                        className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-bold rounded-xl border border-border cursor-pointer transition-all hover:scale-102"
                      >
                        <Upload size={14} /> Selecionar Foto
                      </label>
                      <input 
                        type="file" 
                        id="barber-photo-upload-input" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleBarberPhotoUpload} 
                      />
                      <p className="text-[9px] text-muted-foreground leading-normal">Selecione uma imagem (PNG, JPG) de até 2MB para salvar no perfil.</p>
                      {barberPhoto && (
                        <button 
                          type="button" 
                          onClick={() => setBarberPhoto("")}
                          className="text-[10px] text-destructive hover:underline font-bold block"
                        >
                          Remover foto
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-border/40 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsBarberModalOpen(false)
                    resetBarberForm()
                  }}
                  className="flex-1 border border-border hover:bg-muted rounded-xl h-12 font-medium transition-colors cursor-pointer text-sm text-foreground"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={barberSubmitting}
                  className="btn-primary flex-1 h-12 rounded-xl text-sm uppercase tracking-wider cursor-pointer disabled:opacity-50"
                >
                  {barberSubmitting ? (
                    <div className="w-5 h-5 border-2 border-background border-t-transparent rounded-full animate-spin mx-auto"></div>
                  ) : (
                    "Salvar Ficha"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
