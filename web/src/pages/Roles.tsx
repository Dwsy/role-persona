import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users, Plus, CheckCircle, RefreshCw, FolderOpen, X, Brain, BookOpen,
  Zap, ArrowRight, Settings, ChevronRight, Layers
} from 'lucide-react'
import apiClient from '@/api/client'

interface RoleDetail {
  name: string
  path: string
  identity?: { name?: string; emoji?: string }
  isFirstRun?: boolean
}

interface RoleStats {
  learnings: number
  preferences: number
  knowledgeEntries: number
  vectorActive: boolean
}

export default function Roles() {
  const { t } = useTranslation()
  const [roles, setRoles] = useState<string[]>([])
  const [currentRole, setCurrentRole] = useState(apiClient.role)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<RoleDetail | null>(null)
  const [selectedStats, setSelectedStats] = useState<RoleStats | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => { loadRoles() }, [])

  const loadRoles = async () => {
    setLoading(true)
    const res = await apiClient.roleList()
    if (res.ok && res.data) setRoles(res.data as string[])
    setLoading(false)
  }

  const handleSelect = (name: string) => {
    apiClient.setRole(name)
    setCurrentRole(name)
    setSelectedRole(null)
    window.dispatchEvent(new CustomEvent('role-changed', { detail: name }))
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const res = await apiClient.roleCreate(newName.trim())
    if (res.ok) {
      setShowCreate(false)
      setNewName('')
      handleSelect(newName.trim())
      loadRoles()
    }
  }

  const openDetail = async (name: string) => {
    setSelectedRole(name)
    setSelectedDetail(null)
    setSelectedStats(null)
    setDetailLoading(true)

    // Temporarily switch to this role to get stats
    const prevRole = apiClient.role
    apiClient.setRole(name)

    const [infoRes, memRes, kbRes, embRes] = await Promise.all([
      apiClient.roleInfo(),
      apiClient.memoryList(),
      apiClient.knowledgeList(),
      apiClient.embeddingStats(),
    ])

    // Restore previous role
    apiClient.setRole(prevRole)

    if (infoRes.ok && infoRes.data) setSelectedDetail(infoRes.data as RoleDetail)
    setSelectedStats({
      learnings: memRes.ok && memRes.data ? memRes.data.learnings : 0,
      preferences: memRes.ok && memRes.data ? memRes.data.preferences : 0,
      knowledgeEntries: kbRes.ok && kbRes.data ? (kbRes.data as any).totalEntries || 0 : 0,
      vectorActive: embRes.ok && embRes.data ? embRes.data.active : false,
    })
    setDetailLoading(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Users size={24} />{t('roles.title')}
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Plus size={16} />{t('roles.create')}
          </button>
          <button onClick={loadRoles} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-sm">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Current Role Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 rounded-xl p-5 text-white">
        <div className="flex items-center gap-3">
          <CheckCircle size={20} className="opacity-80" />
          <div>
            <div className="text-sm opacity-80">{t('roles.activeRole')}</div>
            <div className="text-xl font-bold">{currentRole || 'None'}</div>
          </div>
        </div>
      </div>

      {/* Role Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : roles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('roles.noRoles')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map(name => (
            <button
              key={name}
              onClick={() => openDetail(name)}
              className={`bg-white dark:bg-gray-800 rounded-xl border p-5 text-left transition-all group ${
                name === currentRole
                  ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  {name === currentRole ? (
                    <CheckCircle size={18} className="text-blue-500" />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 dark:border-gray-600 group-hover:border-blue-400 transition-colors" />
                  )}
                  <span className="font-semibold text-gray-900 dark:text-white">{name}</span>
                </div>
                <ChevronRight size={16} className="text-gray-400 group-hover:text-blue-500 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Role Detail Modal */}
      {selectedRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedRole(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm opacity-80 mb-1">Role</div>
                  <div className="text-2xl font-bold">{selectedRole}</div>
                  {selectedDetail?.identity?.name && (
                    <div className="text-sm opacity-80 mt-1">{selectedDetail.identity.name}</div>
                  )}
                </div>
                <button onClick={() => setSelectedRole(null)} className="p-1.5 rounded-lg hover:bg-white/20">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6">
              {detailLoading ? (
                <div className="text-center py-8 text-gray-500"><RefreshCw size={20} className="animate-spin mx-auto mb-2" />Loading...</div>
              ) : (
                <>
                  {/* Info */}
                  <div className="space-y-3 mb-6">
                    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                      <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><FolderOpen size={14} />Path</span>
                      <span className="text-sm font-mono text-gray-900 dark:text-white truncate max-w-[250px]">{selectedDetail?.path || '—'}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                      <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><Layers size={14} />Status</span>
                      <span className="text-sm text-gray-900 dark:text-white">{selectedDetail?.isFirstRun ? 'First Run' : 'Configured'}</span>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  {selectedStats && (
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      <div className="bg-gray-50 dark:bg-gray-750 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1"><Brain size={12} />Learnings</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-white">{selectedStats.learnings}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-750 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1"><Settings size={12} />Preferences</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-white">{selectedStats.preferences}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-750 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1"><BookOpen size={12} />Knowledge</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-white">{selectedStats.knowledgeEntries}</div>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-750 rounded-lg p-3">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1"><Zap size={12} />Vector</div>
                        <div className={`text-xl font-bold ${selectedStats.vectorActive ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                          {selectedStats.vectorActive ? 'ON' : 'OFF'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {selectedRole !== currentRole ? (
                      <button onClick={() => handleSelect(selectedRole)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                        <ArrowRight size={16} />Switch to this role
                      </button>
                    ) : (
                      <div className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg font-medium">
                        <CheckCircle size={16} />Current role
                      </div>
                    )}
                    <button onClick={() => setSelectedRole(null)}
                      className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreate(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('roles.createRole')}</h2>
            </div>
            <div className="p-6">
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder={t('roles.namePlaceholder')}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white" autoFocus />
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">{t('common.cancel')}</button>
              <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{t('common.create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
