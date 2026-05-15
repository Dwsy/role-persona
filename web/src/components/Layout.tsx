import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sun, Moon, Globe, ChevronDown, Users } from 'lucide-react'
import Sidebar from './Sidebar'
import { useTheme } from '@/lib/theme'
import apiClient from '@/api/client'

export default function Layout() {
  const { i18n } = useTranslation()
  const { isDark, toggleTheme } = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [roles, setRoles] = useState<string[]>([])
  const [currentRole, setCurrentRole] = useState(apiClient.role)
  const [showRoleMenu, setShowRoleMenu] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
      if (window.innerWidth < 768) setSidebarCollapsed(true)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    apiClient.roleList().then(res => {
      if (res.ok && res.data) setRoles(res.data as string[])
    })
  }, [])

  const selectRole = (role: string) => {
    apiClient.selectRole(role)
    setCurrentRole(role)
    setShowRoleMenu(false)
    // Reload page data by triggering a refresh
    window.dispatchEvent(new CustomEvent('role-changed', { detail: role }))
  }

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'zh' : 'en'
    i18n.changeLanguage(newLang)
    localStorage.setItem('language', newLang)
  }

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {isMobile && !sidebarCollapsed && (
        <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setSidebarCollapsed(true)} />
      )}

      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        {/* Top bar */}
        <header className="flex-shrink-0 h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 z-10">
          {/* Role selector */}
          <div className="relative">
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
            >
              <Users size={16} className="text-gray-500" />
              <span className="text-gray-900 dark:text-white font-medium">{currentRole || 'Select Role'}</span>
              <ChevronDown size={14} className="text-gray-400" />
            </button>
            {showRoleMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowRoleMenu(false)} />
                <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                  {roles.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">No roles</div>
                  ) : roles.map(role => (
                    <button
                      key={role}
                      onClick={() => selectRole(role)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                        role === currentRole
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-750'
                      }`}
                    >
                      {role === currentRole && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                      {role}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={toggleLanguage} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 text-sm">
              <Globe size={16} /><span>{i18n.language === 'en' ? '中文' : 'EN'}</span>
            </button>
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
