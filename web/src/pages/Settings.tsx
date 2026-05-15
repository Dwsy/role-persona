import { useState, useEffect } from 'react'
import { useUrlState } from '@/hooks/useUrlState'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Server, Database, Cpu, RefreshCw, Wifi, WifiOff, FileText, Save, Code, LayoutList } from 'lucide-react'
import * as jsonc from 'jsonc-parser'
import apiClient from '@/api/client'
import JsoncForm, { type ModelOption } from '@/components/JsoncForm'

export default function Settings() {
  const { t } = useTranslation()
  const [daemonStatus, setDaemonStatus] = useState<'running' | 'stopped' | 'checking'>('checking')
  const [healthData, setHealthData] = useState<any>(null)
  const [embeddingStats, setEmbeddingStats] = useState<any>(null)
  const [configRaw, setConfigRaw] = useState('')        // Original JSONC text (preserves comments)
  const [configData, setConfigData] = useState<any>(null) // Parsed object
  const [configPath, setConfigPath] = useState('')
  const [configMode, setConfigMode] = useUrlState('mode', 'form')
  const [configMsg, setConfigMsg] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])

  useEffect(() => {
    checkStatus(); loadConfig(); loadModels()
    const handler = () => { checkStatus(); loadConfig() }
    window.addEventListener('role-changed', handler)
    return () => window.removeEventListener('role-changed', handler)
  }, [])

  const checkStatus = async () => {
    setDaemonStatus('checking')
    const res = await apiClient.healthCheck()
    if (res.ok) { setDaemonStatus('running'); setHealthData(res.data) }
    else setDaemonStatus('stopped')
    const embRes = await apiClient.embeddingStats()
    if (embRes.ok && embRes.data) setEmbeddingStats(embRes.data)
  }

  const loadModels = async () => {
    const res = await apiClient.modelsList()
    if (res.ok && res.data) setModels(res.data.models || [])
  }

  const loadConfig = async () => {
    const res = await apiClient.configRead()
    if (res.ok && res.data) {
      setConfigRaw(res.data.content)
      setConfigPath(res.data.path)
      const parsed = jsonc.parse(res.data.content)
      if (parsed) setConfigData(parsed)
    }
  }

  // Save raw JSONC text
  const handleSaveRaw = async () => {
    const res = await apiClient.configWrite(configRaw)
    if (res.ok) {
      setConfigMsg('Saved! Restart daemon to apply.')
      setTimeout(() => setConfigMsg(''), 3000)
    } else {
      setConfigMsg(`Error: ${res.error}`)
    }
  }

  // Form change: apply JSON edit to raw text (preserves comments)
  const handleFormChange = (newData: any) => {
    setConfigData(newData)
    // Generate JSONC edits using jsonc-parser
    const edits = jsonc.modify(configRaw, [], newData, {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    const newRaw = jsonc.applyEdits(configRaw, edits)
    setConfigRaw(newRaw)
  }

  // Save the current raw text (updated by form or raw editor)
  const handleFormSave = async () => {
    const res = await apiClient.configWrite(configRaw)
    if (res.ok) {
      setConfigMsg('Saved! Restart daemon to apply.')
      setTimeout(() => setConfigMsg(''), 3000)
    } else {
      setConfigMsg(`Error: ${res.error}`)
    }
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <SettingsIcon size={24} />{t('settings.title')}
        </h1>
        <button onClick={checkStatus} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-sm">
          <RefreshCw size={16} />{t('common.refresh')}
        </button>
      </div>

      {/* Daemon Status */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Server size={20} />{t('settings.daemonStatus')}
        </h2>
        <div className="flex items-center gap-3">
          {daemonStatus === 'running' ? (
            <><Wifi size={20} className="text-green-500" /><span className="text-green-600 dark:text-green-400 font-medium">{t('settings.running')}</span></>
          ) : daemonStatus === 'stopped' ? (
            <><WifiOff size={20} className="text-red-500" /><span className="text-red-600 dark:text-red-400 font-medium">{t('settings.stopped')}</span></>
          ) : (
            <><RefreshCw size={20} className="text-gray-400 animate-spin" /><span className="text-gray-500">{t('settings.checking')}</span></>
          )}
        </div>
        {healthData && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div><div className="text-sm text-gray-500 dark:text-gray-400">PID</div><div className="text-lg font-mono text-gray-900 dark:text-white">{healthData.pid}</div></div>
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.uptime')}</div><div className="text-lg font-mono text-gray-900 dark:text-white">{Math.floor((healthData.uptime || 0) / 60)}m {Math.floor((healthData.uptime || 0) % 60)}s</div></div>
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.activeRole')}</div><div className="text-lg font-medium text-gray-900 dark:text-white">{healthData.role || '—'}</div></div>
          </div>
        )}
      </div>

      {/* Embedding Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Database size={20} />{t('settings.vectorMemory')}
        </h2>
        {embeddingStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.model')}</div><div className="text-sm font-mono text-gray-900 dark:text-white">{embeddingStats.model || '—'}</div></div>
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.dimensions')}</div><div className="text-lg font-mono text-gray-900 dark:text-white">{embeddingStats.dim || '—'}</div></div>
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.vectors')}</div><div className="text-lg font-mono text-gray-900 dark:text-white">{embeddingStats.count || 0}</div></div>
            <div><div className="text-sm text-gray-500 dark:text-gray-400">{t('settings.indexSize')}</div><div className="text-sm font-mono text-gray-900 dark:text-white truncate">{embeddingStats.dbPath || '—'}</div></div>
          </div>
        ) : (
          <div className="text-gray-500 dark:text-gray-400">{t('settings.noVectorMemory')}</div>
        )}
      </div>

      {/* Config Editor */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FileText size={20} />Configuration
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono hidden md:inline">{configPath}</span>
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button onClick={() => setConfigMode('form')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${configMode === 'form' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' : 'text-gray-500 dark:text-gray-400'}`}>
                <LayoutList size={12} />Form
              </button>
              <button onClick={() => setConfigMode('raw')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${configMode === 'raw' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' : 'text-gray-500 dark:text-gray-400'}`}>
                <Code size={12} />JSONC
              </button>
            </div>
          </div>
        </div>

        {configMsg && (
          <div className={`px-4 py-2 text-sm ${configMsg.startsWith('Saved') ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
            {configMsg}
          </div>
        )}

        <div className="p-4">
          {configMode === 'form' ? (
            <div>
              {configData ? (
                <JsoncForm data={configData} onChange={handleFormChange} models={models} />
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400">Failed to parse config</div>
              )}
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                <button onClick={handleFormSave} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                  <Save size={14} />Save Config
                </button>
              </div>
            </div>
          ) : (
            <div>
              <textarea
                value={configRaw}
                onChange={e => setConfigRaw(e.target.value)}
                onKeyDown={e => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSaveRaw() } }}
                className="w-full h-96 px-4 py-3 bg-gray-900 text-gray-200 border border-gray-700 rounded-lg font-mono text-[13px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                spellCheck={false}
                style={{ tabSize: 2 }}
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-gray-400">Cmd+S to save • Comments preserved on edit</span>
                <button onClick={handleSaveRaw} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                  <Save size={14} />Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* System Info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Cpu size={20} />{t('settings.systemInfo')}
        </h2>
        <div className="space-y-3">
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('settings.version')}</span><span className="font-mono text-gray-900 dark:text-white">1.0.1</span></div>
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('settings.apiEndpoint')}</span><span className="font-mono text-gray-900 dark:text-white">{window.location.origin}</span></div>
          <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('settings.platform')}</span><span className="font-mono text-gray-900 dark:text-white">{navigator.platform}</span></div>
        </div>
      </div>
    </div>
  )
}
