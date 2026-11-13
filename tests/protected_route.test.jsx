import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProtectedRoute from '../src/components/ProtectedRoute.jsx'
import * as AuthModule from '../src/context/AuthContext.jsx'

describe('ProtectedRoute Role-Based Access Control', () => {
  it('Redireciona usuário deslogado para /login', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      user: null,
      loading: false
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<div>Tela de Login</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['admin', 'secretario']}>
                <div>Painel Admin</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Tela de Login')).toBeInTheDocument()
    expect(screen.queryByText('Painel Admin')).not.toBeInTheDocument()
  })

  it('Redireciona usuário com role "client" para /login ao tentar rota protegida', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', role: 'client', name: 'Cliente Comum' },
      loading: false
    })

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<div>Tela de Login</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={['admin', 'secretario']}>
                <div>Painel Admin</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Tela de Login')).toBeInTheDocument()
    expect(screen.queryByText('Painel Admin')).not.toBeInTheDocument()
  })

  it('Bloqueia barbeiro em rota exclusiva de admin/secretário e redireciona para /agenda-barbeiros', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      user: { id: 'u2', role: 'barber', name: 'Barbeiro Silva' },
      loading: false
    })

    render(
      <MemoryRouter initialEntries={['/configuracoes']}>
        <Routes>
          <Route path="/agenda-barbeiros" element={<div>Agenda do Barbeiro</div>} />
          <Route
            path="/configuracoes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <div>Configurações Gerais</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Agenda do Barbeiro')).toBeInTheDocument()
    expect(screen.queryByText('Configurações Gerais')).not.toBeInTheDocument()
  })

  it('Permite admin acessar rotas restritas', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      user: { id: 'u3', role: 'admin', name: 'Admin Master' },
      loading: false
    })

    render(
      <MemoryRouter initialEntries={['/configuracoes']}>
        <Routes>
          <Route
            path="/configuracoes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <div>Configurações Gerais</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Configurações Gerais')).toBeInTheDocument()
  })

  it('Permite secretário acessar rotas de gestão operacional, mas bloqueia configurações exclusivas de admin', () => {
    vi.spyOn(AuthModule, 'useAuth').mockReturnValue({
      user: { id: 'u4', role: 'secretario', name: 'Secretário João' },
      loading: false
    })

    render(
      <MemoryRouter initialEntries={['/configuracoes']}>
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard de Gestão</div>} />
          <Route
            path="/configuracoes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <div>Configurações Gerais</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText('Dashboard de Gestão')).toBeInTheDocument()
    expect(screen.queryByText('Configurações Gerais')).not.toBeInTheDocument()
  })
})
