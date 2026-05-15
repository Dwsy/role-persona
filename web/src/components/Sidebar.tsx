import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Brain,
  BookOpen,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from 'lucide-react'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { path: '/memory', icon: Brain, labelKey: 'nav.memory' },
  { path: '/knowledge', icon: BookOpen, labelKey: 'nav.knowledge' },
  { path: '/activity', icon: TrendingUp, labelKey: 'nav.activity' },
  { path: '/roles', icon: Users, labelKey: 'nav.roles' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
]

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation()

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      } bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700`}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700">
          {!collapsed && (
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
              Role Persona
            </h1>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`
              }
            >
              <item.icon size={20} className="flex-shrink-0" />
              {!collapsed && (
                <span className="text-sm font-medium">{t(item.labelKey)}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-200 dark:border-gray-700">
          {!collapsed && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              v0.1.0
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}
