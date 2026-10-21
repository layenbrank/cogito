import { lazy } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  redirect,
  type LoaderFunctionArgs
} from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.tsx'
import { AppShell } from '@/components/shell/app-shell.tsx'
import { findAuthToken, isAdmin } from '@/utils/auth.ts'

function findSignInPath(next?: string): string {
  if (!next || next === '/' || next.startsWith('/signin')) return '/signin'
  return `/signin?next=${encodeURIComponent(next)}`
}

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
const LogsView = lazy(function () {
  return import('@/views/logs/logs.tsx')
})
const ExceptionsView = lazy(function () {
  return import('@/views/exceptions/exceptions.tsx')
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
const PreferencesView = lazy(function () {
  return import('@/views/preferences/preferences.tsx')
})

function requireAdmin({ request }: LoaderFunctionArgs) {
  if (!findAuthToken()) {
    const url = new URL(request.url)
    return redirect(findSignInPath(url.pathname + url.search))
  }
  if (!isAdmin()) {
    return redirect(findSignInPath('/overview'))
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
      {
        element: <Outlet />,
        errorElement: <Fallback.RouteError />,
        children: [
          { index: true, element: <Navigate to="/overview" replace /> },
          { path: 'overview', element: <OverviewView /> },
          { path: 'users', element: <UsersView /> },
          { path: 'tenants', element: <TenantsView /> },
          { path: 'gateway/providers', element: <ProvidersView /> },
          { path: 'gateway/models', element: <ModelsView /> },
          { path: 'gateway/usage', element: <UsageView /> },
          { path: 'logs', element: <LogsView /> },
          { path: 'exceptions', element: <ExceptionsView /> },
          { path: 'gateway/audit', element: <Navigate to="/logs" replace /> },
          { path: 'billing/prices', element: <PricesView /> },
          { path: 'billing/reconciliation', element: <ReconciliationView /> },
          { path: 'sso', element: <SsoView /> },
          { path: 'agent', element: <AgentView /> },
          { path: 'rag', element: <RagView /> },
          { path: 'preferences', element: <PreferencesView /> }
        ]
      }
    ]
  },
  { path: '*', element: <Navigate to="/overview" replace /> }
])

export { router }
