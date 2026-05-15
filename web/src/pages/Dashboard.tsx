import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Brain, BookOpen, Clock, Activity, RefreshCw, Zap, Database,
  FileText, Tag, TrendingUp, AlertCircle, CheckCircle, Server,
  Calendar, BarChart3, Layers, CircleDot, ArrowUpRight, XCircle,
  Settings, Shield, Star, GitBranch,
} from 'lucide-react'
import apiClient from '@/api/client'

interface DashboardData {
  role: string
  rolePath: string
  isFirstRun: boolean
  memory: { learnings: number; preferences: number; issues: number; highPriority: number; normalPriority: number; newItems: number }
  knowledge: { totalEntries: number; categories: number; sources: Array<{ id: string; count: number; readonly: boolean }> }
  embedding: { enabled: boolean; active: boolean; model: string | null; dim: number | null; count: number }
  dailyFiles: number
  uptime: number
  instances: number
}

interface ActivityStats {
  tags: Record<string, number>
  hourly: Record<string, number>
  roles: Record<string, number>
  extract: { runs: number; learnings: number; preferences: number; errors: number; filtered: number }
  checkpoints: number
  recentEvents: Array<{ time: string; tag: string; message: string; role: string; ts: number }>
  days: number
  files: number
}

function MiniBar({ values, max, color }: { values: number[]; max: number; color: string }) {
  return (
    <div className="flex items-end gap-px h-8">
      {values.map((v, i) => (
        <div key={i} className={`flex-1 ${color} rounded-t-sm opacity-80`} style={{ height: max > 0 ? `${Math.max(4, (v / max) * 100)}%` : '4px' }} />
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [activity, setActivity] = useState<ActivityStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAll = async () => {
    setLoading(true)
    const [roleRes, memRes, kbRes, embRes, healthRes, fileListRes, actRes] = await Promise.all([
      apiClient.roleInfo(), apiClient.memoryList(), apiClient.knowledgeList(),
      apiClient.embeddingStats(), apiClient.healthCheck(), apiClient.fileList('memory/daily'),
      apiClient.activityStats(7, 12),
    ])

    const memText: string = memRes.ok && memRes.data ? memRes.data.text || '' : ''
    const lines = memText.split('\n')
    let highCount = 0, normalCount = 0, newCount = 0
    for (const line of lines) {
      const match = line.match(/\[(\d+)x\]/)
      if (match) {
        const used = parseInt(match[1])
        if (used >= 5) highCount++
        else if (used > 0) normalCount++
        else newCount++
      }
    }

    const kbData = kbRes.ok && kbRes.data ? kbRes.data as any : null
    const kbSources = kbData?.sources?.map((s: any) => ({
      id: s.id,
      count: s.categories?.reduce((acc: number, c: any) => acc + (c.entries?.length || 0), 0) || 0,
      readonly: s.readonly,
    })) || []

    setData({
      role: roleRes.ok && roleRes.data ? (roleRes.data as any).name || '' : '',
      rolePath: roleRes.ok && roleRes.data ? (roleRes.data as any).path || '' : '',
      isFirstRun: roleRes.ok && roleRes.data ? (roleRes.data as any).isFirstRun || false : false,
      memory: {
        learnings: memRes.ok && memRes.data ? memRes.data.learnings : 0,
        preferences: memRes.ok && memRes.data ? memRes.data.preferences : 0,
        issues: memRes.ok && memRes.data ? memRes.data.issues : 0,
        highPriority: highCount, normalPriority: normalCount, newItems: newCount,
      },
      knowledge: {
        totalEntries: kbData?.totalEntries || 0,
        categories: kbData?.sources?.reduce((acc: number, s: any) => acc + s.categories?.length || 0, 0) || 0,
        sources: kbSources,
      },
      embedding: {
        enabled: embRes.ok && embRes.data ? embRes.data.enabled : false,
        active: embRes.ok && embRes.data ? embRes.data.active : false,
        model: embRes.ok && embRes.data ? embRes.data.model : null,
        dim: embRes.ok && embRes.data ? embRes.data.dim : null,
        count: embRes.ok && embRes.data ? embRes.data.count : 0,
      },
      dailyFiles: fileListRes.ok && fileListRes.data ? fileListRes.data.length : 0,
      uptime: healthRes.ok && healthRes.data ? (healthRes.data as any).uptime || 0 : 0,
      instances: healthRes.ok && healthRes.data ? (healthRes.data as any).instances?.length || 0 : 0,
    })

    if (actRes.ok && actRes.data) {
      setActivity(actRes.data as ActivityStats)
    }

    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    const handler = () => loadAll()
    window.addEventListener('role-changed', handler)
    return () => window.removeEventListener('role-changed', handler)
  }, [])

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64 text-gray-500"><RefreshCw size={20} className="animate-spin mr-2" />{t('common.loading')}</div>
  }

  const totalMem = data.memory.learnings + data.memory.preferences
  const act = activity
  const hourlyValues = act ? Array.from({ length: 24 }, (_, i) => act.hourly[String(i).padStart(2, '0')] || 0) : []
  const hourlyMax = Math.max(...hourlyValues, 1)
  const totalEvents = act ? Object.values(act.tags).reduce((s, v) => s + v, 0) : 0

  const tagColors: Record<string, string> = {
    'auto-extract': 'bg-blue-500',
    'vector': 'bg-purple-500',
    'checkpoint': 'bg-amber-500',
    'daily-memory': 'bg-green-500',
    'pending': 'bg-indigo-500',
    'repair': 'bg-orange-500',
    'search-reinforce': 'bg-teal-500',
    'knowledge': 'bg-pink-500',
  }

  const tagIcons: Record<string, any> = {
    'auto-extract': Zap,
    'vector': Database,
    'checkpoint': GitBranch,
    'daily-memory': Calendar,
    'pending': Clock,
    'repair': Shield,
    'search-reinforce': Activity,
    'knowledge': BookOpen,
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('nav.dashboard')}</h1>
        <button onClick={loadAll} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-sm">
          <RefreshCw size={14} />{t('common.refresh')}
        </button>
      </div>

      {/* Role Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 rounded-xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm opacity-80 mb-1">{t('roles.activeRole')}</div>
            <div className="text-3xl font-bold">{data.role || 'No Role'}</div>
            {data.isFirstRun && <span className="inline-block mt-1 px-2 py-0.5 bg-white/20 rounded text-xs">First Run</span>}
          </div>
          <div className="text-right opacity-80 text-sm">
            <div className="flex items-center gap-1"><Clock size={14} />{Math.floor(data.uptime / 60)}m uptime</div>
            <div className="flex items-center gap-1 mt-1"><Layers size={14} />{data.instances} instance{data.instances !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      {/* Clickable Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ClickableCard icon={Brain} label={t('memory.learnings')} value={data.memory.learnings} color="blue"
          sub={`${data.memory.highPriority} high`} onClick={() => navigate('/memory')} />
        <ClickableCard icon={Activity} label={t('memory.preferences')} value={data.memory.preferences} color="green"
          onClick={() => navigate('/memory')} />
        <ClickableCard icon={BookOpen} label={t('knowledge.totalEntries')} value={data.knowledge.totalEntries} color="purple"
          sub={`${data.knowledge.categories} categories`} onClick={() => navigate('/knowledge')} />
        <ClickableCard icon={Database} label="Vectors" value={data.embedding.count} color={data.embedding.active ? 'green' : 'gray'}
          sub={data.embedding.active ? 'Active' : 'Inactive'} onClick={() => navigate('/settings')} />
      </div>

      {/* Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Memory Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Brain size={16} className="text-blue-500" />Memory Breakdown
            </h3>
            <button onClick={() => navigate('/memory')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
              View all <ArrowUpRight size={10} />
            </button>
          </div>
          <div className="space-y-3">
            <BarRow icon={Shield} label="High Priority" count={data.memory.highPriority} total={data.memory.learnings} color="bg-red-500" />
            <BarRow icon={CircleDot} label="Normal" count={data.memory.normalPriority} total={data.memory.learnings} color="bg-amber-500" />
            <BarRow icon={Star} label="New (0x)" count={data.memory.newItems} total={data.memory.learnings} color="bg-emerald-500" />
            <BarRow icon={Settings} label="Preferences" count={data.memory.preferences} total={totalMem} color="bg-blue-500" />
          </div>
          {data.memory.issues > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg text-xs text-yellow-700 dark:text-yellow-400">
              <AlertCircle size={14} />{data.memory.issues} issues detected
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <Calendar size={12} />{data.dailyFiles} daily files
          </div>
        </div>

        {/* Knowledge Sources */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <BookOpen size={16} className="text-purple-500" />Knowledge Sources
            </h3>
            <button onClick={() => navigate('/knowledge')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
              Browse <ArrowUpRight size={10} />
            </button>
          </div>
          <div className="space-y-2">
            {data.knowledge.sources.map(src => (
              <button key={src.id} onClick={() => navigate('/knowledge')}
                className="w-full flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-750 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-gray-400" />
                  <span className="text-sm text-gray-900 dark:text-white">{src.id}</span>
                  {src.readonly && <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded">ro</span>}
                </div>
                <span className="text-sm font-mono text-gray-500 dark:text-gray-400">{src.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Vector Memory */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />Vector Memory
            </h3>
            <button onClick={() => navigate('/settings')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
              Settings <ArrowUpRight size={10} />
            </button>
          </div>
          <div className="space-y-3">
            <InfoRow label="Status" icon={data.embedding.active ? CheckCircle : XCircle}
              value={data.embedding.active ? 'Active' : 'Inactive'} highlight={data.embedding.active} />
            <InfoRow label="Model" icon={Tag} value={data.embedding.model || '—'} />
            <InfoRow label="Dimensions" icon={BarChart3} value={String(data.embedding.dim || '—')} />
            <InfoRow label="Indexed" icon={Database} value={`${data.embedding.count} vectors`} />
          </div>
          {!data.embedding.enabled && (
            <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Enable in <button onClick={() => navigate('/settings')} className="text-blue-600 dark:text-blue-400 hover:underline">Settings</button>
            </div>
          )}
        </div>

        {/* Activity Insights */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <TrendingUp size={16} className="text-green-500" />Activity Insights
            </h3>
            <button onClick={() => navigate('/activity')} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5">
              Dashboard <ArrowUpRight size={10} />
            </button>
          </div>

          {act ? (
            <div className="space-y-4">
              {/* Auto-Extract Health */}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{act.extract.runs}</div>
                  <div className="text-[10px] text-gray-500">Extracts</div>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">{act.extract.learnings + act.extract.preferences}</div>
                  <div className="text-[10px] text-gray-500">Stored</div>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-900 rounded-lg">
                  <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{act.checkpoints}</div>
                  <div className="text-[10px] text-gray-500">Checkpoints</div>
                </div>
              </div>

              {/* Hourly Heatmap */}
              <div>
                <div className="text-[10px] text-gray-500 mb-1.5">Activity by hour ({act.days}d)</div>
                <MiniBar values={hourlyValues} max={hourlyMax} color="bg-blue-500 dark:bg-blue-600" />
                <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
                  <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
                </div>
              </div>

              {/* Top Tags */}
              <div>
                <div className="text-[10px] text-gray-500 mb-1.5">Top event types</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(act.tags).sort(([,a],[,b]) => b-a).slice(0, 6).map(([tag, count]) => {
                    const Icon = tagIcons[tag] || CircleDot
                    return (
                      <span key={tag} className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] text-gray-600 dark:text-gray-400">
                        <Icon size={10} className="text-gray-400" />{tag}<span className="font-mono">{count}</span>
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Recent Events */}
              <div>
                <div className="text-[10px] text-gray-500 mb-1.5">Latest</div>
                <div className="space-y-1">
                  {act.recentEvents.slice(0, 5).map((ev, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-gray-400 font-mono w-12 flex-shrink-0">{ev.time}</span>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tagColors[ev.tag] || 'bg-gray-400'}`} />
                      <span className="text-gray-700 dark:text-gray-300 truncate">{ev.message.slice(0, 50)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">No activity data</div>
          )}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1"><Server size={12} />Daemon running</span>
            <button onClick={() => navigate('/memory')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300"><BarChart3 size={12} />{totalMem} memories</button>
            <button onClick={() => navigate('/knowledge')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300"><Tag size={12} />{data.knowledge.categories} categories</button>
            <button onClick={() => navigate('/memory')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300"><Calendar size={12} />{data.dailyFiles} daily</button>
            {act && <button onClick={() => navigate('/activity')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300"><TrendingUp size={12} />{totalEvents} events ({act.days}d)</button>}
          </div>
          <button onClick={() => navigate('/settings')} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300">
            <span className={`w-2 h-2 rounded-full ${data.embedding.active ? 'bg-green-500' : 'bg-gray-400'}`} />
            Vector: {data.embedding.active ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClickableCard({ icon: Icon, label, value, color, sub, onClick }: {
  icon: any; label: string; value: number; color: string; sub?: string; onClick: () => void
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    green: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    gray: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/30',
  }
  return (
    <button onClick={onClick} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:shadow-md transition-shadow group">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[color]}`}>
          <Icon size={16} />
        </div>
        <ArrowUpRight size={14} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </button>
  )
}

function BarRow({ icon: Icon, label, count, total, color }: {
  icon: any; label: string; count: number; total: number; color: string
}) {
  const pct = total > 0 ? (count / total) * 100 : 0
  return (
    <div className="flex items-center gap-3">
      <Icon size={14} className="text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-700 dark:text-gray-300 truncate">{label}</span>
          <span className="text-gray-500 dark:text-gray-400 font-mono">{count}</span>
        </div>
        <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, icon: Icon, value, highlight }: {
  label: string; icon: any; value: string; highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Icon size={14} className={highlight ? 'text-green-500' : 'text-gray-400'} />
        {label}
      </div>
      <span className={`text-xs font-mono ${highlight ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>{value}</span>
    </div>
  )
}
