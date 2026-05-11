'use client'

import { usePathname } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import AuthGuard from '@/components/auth/AuthGuard'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/login'
  // Culture Radar and Moments Radar are admin-only, protected at the API
  // layer by API_SECRET. They do not need a Supabase session, so bypass
  // AuthGuard entirely — this also keeps them working when Supabase env
  // vars are not configured.
  const isOpenAdminRoute =
    pathname.startsWith('/culture-radar') || pathname.startsWith('/moments-radar')

  // The standalone report page renders as a sharable newsletter — no
  // sidebar, no chrome.
  const isStandaloneReport = pathname === '/culture-radar/report'

  if (isLoginPage || isStandaloneReport) {
    return <>{children}</>
  }

  if (isOpenAdminRoute) {
    return (
      <div className="flex min-h-screen">
        <Sidebar />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="fixed top-0 right-0 z-20 bg-white px-5 flex items-center" style={{ height: 75 }}>
          <img
            src="/jack-logo.png"
            alt="Jack & A!"
            style={{ height: 58, width: 'auto', display: 'block' }}
          />
        </div>
        <main
          style={{ marginLeft: 'var(--sidebar-width)' }}
          className="flex-1 min-h-screen bg-gray-50"
        >
          {children}
        </main>
      </div>
    )
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        {/* Jack & A! logo — fixed top-right corner */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="fixed top-0 right-0 z-20 bg-white px-5 flex items-center" style={{ height: 75 }}>
          <img
            src="/jack-logo.png"
            alt="Jack & A!"
            style={{ height: 58, width: 'auto', display: 'block' }}
          />
        </div>
        <main
          style={{ marginLeft: 'var(--sidebar-width)' }}
          className="flex-1 min-h-screen bg-gray-50"
        >
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}
