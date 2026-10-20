import { lazy } from 'react'
import { createBrowserRouter, Navigate, redirect } from 'react-router-dom'

import { AppShell } from '@/components/shell/app-shell.tsx'
import { isAdmin, isAuthenticated } from '@/utils/auth.ts'

const SignInView = lazy(function () {
  return import('@/views/signin/signin.tsx')
})
const OverviewView = lazy(function () {
  return import('@/views/overview/overview.tsx')
})
const UsersView = lazy(function () {
  return import('@/views/users/users.tsx')
})
const TenantsView = lazy(function () {
  return import('@/views/tenants/tenants.tsx')
})
const ProvidersView = lazy(function () {
  return import('@/views/gateway/providers/providers.tsx')
})
const ModelsView = lazy(function () {
  return import('@/views/gateway/models/models.tsx')
})
const UsageView = lazy(function () {
  return import('@/views/gateway/usage/usage.tsx')
})
const AuditView = lazy(function () {
  return import('@/views/gateway/audit/audit.tsx')
})
const PricesView = lazy(function () {
  return import('@/views/billing/prices/prices.tsx')
})
const ReconciliationView = lazy(function () {
  return import('@/views/billing/reconciliation/reconciliation.tsx')
})
const SsoView = lazy(function () {
  return import('@/views/sso/sso.tsx')
})
const AgentView = lazy(function () {
  return import('@/views/agent/agent.tsx')
})
const RagView = lazy(function () {
  return import('@/views/rag/rag.tsx')
})

function requireAdmin() {
  if (!isAuthenticated()) {
    return redirect('/signin')
  }
  if (!isAdmin()) {
    return redirect('/signin?next=/overview')
  }
  return null
}

const router = createBrowserRouter([
  {
    path: '/signin',
    element: <SignInView />
  },
  {
    path: '/',
    element: <AppShell />,
    loader: requireAdmin,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewView /> },
      { path: 'users', element: <UsersView /> },
      { path: 'tenants', element: <TenantsView /> },
      { path: 'gateway/providers', element: <ProvidersView /> },
      { path: 'gateway/models', element: <ModelsView /> },
      { path: 'gateway/usage', element: <UsageView /> },
      { path: 'gateway/audit', element: <AuditView /> },
      { path: 'billing/prices', element: <PricesView /> },
      { path: 'billing/reconciliation', element: <ReconciliationView /> },
      { path: 'sso', element: <SsoView /> },
      { path: 'agent', element: <AgentView /> },
      { path: 'rag', element: <RagView /> }
    ]
  },
  { path: '*', element: <Navigate to="/overview" replace /> }
])

export { router }
