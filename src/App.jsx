import { lazy, Suspense } from "react"
import { Routes, Route } from "react-router-dom"
import { IS_API_CONFIGURED } from "./context/AuthContext.jsx"
import Navbar from "./components/Navbar.jsx"
import BackgroundGlow from "./components/BackgroundGlow.jsx"
import ProtectedRoute from "./components/ProtectedRoute.jsx"

const Home = lazy(() => import("./pages/Home.jsx"))
const Sobre = lazy(() => import("./pages/Sobre.jsx"))
const TrabalheConosco = lazy(() => import("./pages/TrabalheConosco.jsx"))
const Login = lazy(() => import("./pages/Login.jsx"))
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"))
const Agenda = lazy(() => import("./pages/Agenda.jsx"))
const AgendaGrid = lazy(() => import("./pages/AgendaGrid.jsx"))
const Clientes = lazy(() => import("./pages/Clientes.jsx"))
const Caixa = lazy(() => import("./pages/Caixa.jsx"))
const MeuCaixa = lazy(() => import("./pages/MeuCaixa.jsx"))
const Servicos = lazy(() => import("./pages/Servicos.jsx"))
const Produtos = lazy(() => import("./pages/Produtos.jsx"))
const Profissionais = lazy(() => import("./pages/Profissionais.jsx"))
const Relatorios = lazy(() => import("./pages/Relatorios.jsx"))
const Configuracoes = lazy(() => import("./pages/Configuracoes.jsx"))
const MeuPerfil = lazy(() => import("./pages/MeuPerfil.jsx"))
const Agendar = lazy(() => import("./pages/Agendar.jsx"))
const ResetPassword = lazy(() => import("./pages/ResetPassword.jsx"))

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-8 h-8 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans relative overflow-x-hidden">
      {!IS_API_CONFIGURED && (
        <div className="bg-red-950/90 border-b border-red-500/60 text-red-200 px-4 py-3 text-center text-sm font-semibold z-50 sticky top-0 shadow-lg">
          ⚠️ ERRO DE CONFIGURAÇÃO (CLUB 01): As variáveis <code className="bg-black/50 px-1.5 py-0.5 rounded text-white">VITE_SUPABASE_URL</code> e <code className="bg-black/50 px-1.5 py-0.5 rounded text-white">VITE_SUPABASE_PUBLISHABLE_KEY</code> não foram encontradas no arquivo <code className="bg-black/50 px-1.5 py-0.5 rounded text-white">.env</code>.
        </div>
      )}
      <BackgroundGlow />
      <Navbar />
      <div className="flex-1 relative z-10">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sobre" element={<Sobre />} />
            <Route path="/trabalhe-conosco" element={<TrabalheConosco />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Dashboard /></ProtectedRoute>} />
            <Route path="/agenda" element={<ProtectedRoute allowedRoles={['admin', 'secretario', 'barber']}><Agenda /></ProtectedRoute>} />
            <Route path="/agenda-barbeiros" element={<ProtectedRoute allowedRoles={['admin', 'secretario', 'barber']}><AgendaGrid /></ProtectedRoute>} />
            <Route path="/clientes" element={<ProtectedRoute allowedRoles={['admin', 'secretario', 'barber']}><Clientes /></ProtectedRoute>} />
            <Route path="/caixa" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Caixa /></ProtectedRoute>} />
            <Route path="/meu-caixa" element={<ProtectedRoute allowedRoles={['admin', 'secretario', 'barber']}><MeuCaixa /></ProtectedRoute>} />
            <Route path="/servicos" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Servicos /></ProtectedRoute>} />
            <Route path="/produtos" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Produtos /></ProtectedRoute>} />
            <Route path="/profissionais" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Profissionais /></ProtectedRoute>} />
            <Route path="/relatorios" element={<ProtectedRoute allowedRoles={['admin', 'secretario']}><Relatorios /></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute allowedRoles={['admin']}><Configuracoes /></ProtectedRoute>} />
            <Route path="/meu-perfil" element={<ProtectedRoute allowedRoles={['admin', 'secretario', 'barber']}><MeuPerfil /></ProtectedRoute>} />
            <Route path="/agendar" element={<Agendar />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  )
}
