import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Activity, RefreshCw, Zap, Database, Calendar, Clock, Shield,
  TrendingUp, GitBranch, BookOpen, BarChart3, CircleDot,
} from 'lucide-react'
import apiClient from '@/api/client'

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
    <div className="flex items-end gap-px h-10">
      {values.map((v, i) => (
        <div key={i} className={`flex-1 ${color} rounded-t-sm`} style={{ height: max > 0 ? `${Math.max(4, (v / max) * 100)}%` : '4px' }} />
      ))}
    </div>
  )
}

export default function ActivityPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [act, setAct] = useState<ActivityStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(7)

  const load = async () => {
    setLoading(true)
    const res = await apiClient.activityStats(days, 30)
    if (res.ok && res.data) setAct(res.data as ActivityStats)
    setLoading(false)
  }

  useEffect(() => { load() }, [days])

  if (loading || !act) {
    return <div className="flex items-center justify-center h-64 text-gray-500"><RefreshCw size={20} className="animate-spin mr-2" />{t('common.loading')}</div>
  }

  const hourlyValues = Array.from({ length: 24 }, (_, i) => act.hourly[String(i).padStart(2, '0')] || 0)
  const hourlyMax = Math.max(...hourlyValues, 1)
  const totalEvents = Object.values(act.tags).reduce((s, v) => s + v, 0)
  const topRoles = Object.entries(act.roles).sort(([,a],[,b]) => b-a).slice(0, 8)
  const topTags = Object.entries(act.tags).sort(([,a],[,b]) => b-a).slice(0, 10)
  const extractRate = act.extract.runs > 0 ? ((act.extract.learnings + act.extract.preferences) / act.extract.runs).toFixed(1) : '0'

  const tagColors: Record<string, string> = {
    'auto-extract': 'bg-blue-500',
    'vector': 'bg-purple-500',
    'checkpoint': 'bg-amber-500',
    'daily-memory': 'bg-green-500',
    'pending': 'bg-indigo-500',
    'pending-expire': 'bg-indigo-400',
    'repair': 'bg-orange-500',
    'search-reinforce': 'bg-teal-500',
    'search-promote': 'bg-teal-600',
    'knowledge': 'bg-pink-500',
    'embedding': 'bg-violet-500',
    'model-resolve': 'bg-cyan-500',
    'memory-tags': 'bg-lime-500',
    'llm-tidy': 'bg-rose-500',
    'compact-memory': 'bg-amber-400',
    'memory-tool': 'bg-blue-400',
  }

  const tagIcons: Record<string, any> = {
    'auto-extract': Zap,
    'vector': Database,
    'checkpoint': GitBranch,
    'daily-memory': Calendar,
    'pending': Clock,
    'pending-expire': Clock,
    'repair': Shield,
    'search-reinforce': Activity,
    'search-promote': TrendingUp,
    'knowledge': BookOpen,
    'embedding': Database,
    'llm-tidy': RefreshCw,
  }

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <TrendingUp size={24} className="text-green-500" />Activity Dashboard
        </h1>
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300">
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <button onClick={load} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-xs">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total Events" value={totalEvents} color="blue" />
        <StatCard label="Auto-Extracts" value={act.extract.runs} color="purple" />
        <StatCard label="Items Stored" value={act.extract.learnings + act.extract.preferences} color="green" />
        <StatCard label="Checkpoints" value={act.checkpoints} color="amber" />
        <StatCard label="Error Events" value={act.extract.errors} color={act.extract.errors > act.extract.runs * 2 ? 'red' : 'amber'} />
      </div>

      {/* Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Auto-Extract Pipeline */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Zap size={16} className="text-blue-500" />Auto-Extract Pipeline
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <MetricBox label="Runs" value={act.extract.runs} sub={`${extractRate} items/run`} />
            <MetricBox label="Learnings" value={act.extract.learnings} sub={`${act.extract.preferences} preferences`} />
            <MetricBox label="Filtered" value={act.extract.filtered} sub="dropped by rules" />
            <MetricBox label="Errors" value={act.extract.errors} sub="fallback attempts" />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
              {act.extract.runs > 0 && (
                <>
                  <div className="h-full bg-green-500" style={{ width: `${((act.extract.learnings + act.extract.preferences) / Math.max(act.extract.runs, 1)) * 100}%` }} />
                  <div className="h-full bg-amber-400" style={{ width: `${(act.extract.filtered / Math.max(act.extract.runs, 1)) * 100}%` }} />
                  <div className="h-full bg-red-400" style={{ width: `${(act.extract.errors / Math.max(act.extract.runs, 1)) * 100}%` }} />
                </>
              )}
            </div>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full" />stored</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-400 rounded-full" />filtered</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-full" />errors</span>
          </div>
        </div>

        {/* Hourly Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <BarChart3 size={16} className="text-amber-500" />Hourly Activity ({act.days}d)
          </h3>
          <MiniBar values={hourlyValues} max={hourlyMax} color="bg-blue-500 dark:bg-blue-600" />
          <div className="flex justify-between text-[9px] text-gray-400 mt-1">
            <span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
          {/* Peak hours */}
          <div className="mt-3 text-xs text-gray-500">
            Peak: {(() => {
              const sorted = hourlyValues.map((v, i) => ({ h: i, v })).sort((a, b) => b.v - a.v).slice(0, 3)
              return sorted.map(s => `${s.h}:00`).join(', ')
            })()}
          </div>
        </div>

        {/* Event Types */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <CircleDot size={16} className="text-purple-500" />Event Types
          </h3>
          <div className="space-y-2">
            {topTags.map(([tag, count]) => {
              const pct = totalEvents > 0 ? (count / totalEvents) * 100 : 0
              const Icon = tagIcons[tag] || CircleDot
              return (
                <div key={tag} className="flex items-center gap-2">
                  <Icon size={12} className="text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-700 dark:text-gray-300 w-32 truncate">{tag}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className={`h-full ${tagColors[tag] || 'bg-gray-400'} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-gray-500 w-10 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Role Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Shield size={16} className="text-green-500" />Role Activity
          </h3>
          <div className="space-y-2">
            {topRoles.map(([role, count]) => {
              const maxRole = topRoles[0]?.[1] || 1
              const pct = (count / maxRole) * 100
              return (
                <button key={role} onClick={() => navigate('/roles')}
                  className="w-full flex items-center gap-2 group">
                  <span className="text-xs text-gray-700 dark:text-gray-300 w-20 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">{role}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-gray-500 w-10 text-right">{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Recent Events Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Clock size={16} className="text-gray-500" />Recent Events ({act.recentEvents.length})
        </h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {act.recentEvents.map((ev, i) => {
            return (
              <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-750">
                <span className="text-[10px] text-gray-400 font-mono w-14 flex-shrink-0">{ev.time}</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tagColors[ev.tag] || 'bg-gray-400'}`} />
                <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded flex-shrink-0 w-28 truncate">{ev.tag}</span>
                {ev.role !== '-' && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded flex-shrink-0">{ev.role}</span>}
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{ev.message}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    purple: 'text-purple-600 dark:text-purple-400',
    amber: 'text-amber-600 dark:text-amber-400',
    red: 'text-red-600 dark:text-red-400',
  }
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 text-center">
      <div className={`text-xl font-bold ${colorMap[color]}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  )
}

function MetricBox({ label, value, sub, alert }: { label: string; value: number; sub: string; alert?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${alert ? 'bg-red-50 dark:bg-red-900/30' : 'bg-gray-50 dark:bg-gray-900'}`}>
      <div className={`text-lg font-bold ${alert ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</div>
      <div className="text-xs text-gray-700 dark:text-gray-300">{label}</div>
      <div className="text-[10px] text-gray-500">{sub}</div>
    </div>
  )
}
