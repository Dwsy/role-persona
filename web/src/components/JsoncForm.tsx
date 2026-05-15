import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical } from 'lucide-react'

export interface ModelOption {
  provider: string
  model: string
  name: string
  contextWindow?: number
}

interface JsoncFormProps {
  data: any
  schema?: any
  onChange: (data: any) => void
  path?: string
  depth?: number
  models?: ModelOption[]
}

// Infer schema from data
function inferSchema(data: any, key?: string): any {
  if (data === null || data === undefined) return { type: 'string' }
  if (typeof data === 'boolean') return { type: 'boolean' }
  if (typeof data === 'number') return { type: 'number' }
  if (typeof data === 'string') {
    if (key?.includes('path') || key?.includes('dir') || key?.includes('Path')) return { type: 'path' }
    if (key?.includes('url') || key?.includes('Url') || key?.includes('baseUrl')) return { type: 'url' }
    if (key?.includes('token') || key?.includes('key') || key?.includes('Key') || key?.includes('apiKey')) return { type: 'secret' }
    return { type: 'string' }
  }
  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'object') {
      return { type: 'array', items: inferSchema(data[0]) }
    }
    return { type: 'array', items: { type: typeof data[0] || 'string' } }
  }
  if (typeof data === 'object') {
    const properties: Record<string, any> = {}
    for (const [k, v] of Object.entries(data)) {
      properties[k] = inferSchema(v, k)
    }
    return { type: 'object', properties }
  }
  return { type: 'string' }
}

// Pretty label from key
function labelFromKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .replace(/_/g, ' ')
    .replace(/\bapi\b/i, 'API')
    .replace(/\burl\b/i, 'URL')
    .replace(/\bid\b/i, 'ID')
    .trim()
}

export default function JsoncForm({ data, onChange, path = '', depth = 0, models = [] }: JsoncFormProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  if (data === null || data === undefined) return null

  const schema = inferSchema(data)
  const isRoot = depth === 0

  // ── Boolean ──
  if (schema.type === 'boolean') {
    return (
      <div className="flex items-center justify-between py-1.5">
        <label className="text-xs text-gray-600 dark:text-gray-400">{labelFromKey(path.split('.').pop() || '')}</label>
        <button
          onClick={() => onChange(!data)}
          className={`relative w-9 h-5 rounded-full transition-colors ${data ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${data ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>
    )
  }

  // ── Number ──
  if (schema.type === 'number') {
    return (
      <div className="flex items-center justify-between py-1.5">
        <label className="text-xs text-gray-600 dark:text-gray-400">{labelFromKey(path.split('.').pop() || '')}</label>
        <input
          type="number"
          value={data}
          onChange={e => onChange(Number(e.target.value) || 0)}
          className="w-32 px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    )
  }

  // ── String / Path / URL / Secret ──
  if (schema.type === 'string' || schema.type === 'path' || schema.type === 'url' || schema.type === 'secret') {
    const key = path.split('.').pop() || ''
    return (
      <div className="py-1.5">
        <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">{labelFromKey(key)}</label>
        <input
          type={schema.type === 'secret' ? 'password' : 'text'}
          value={data || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={schema.type === 'path' ? '/path/to/...' : schema.type === 'url' ? 'https://...' : ''}
          className="w-full px-2.5 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    )
  }

  // ── Array ──
  if (schema.type === 'array') {
    const key = path.split('.').pop() || ''
    const isSimpleArray = data.length === 0 || typeof data[0] !== 'object'
    const isModelSpecArray = data.length > 0 && data[0]?.provider && data[0]?.model

    return (
      <div className={`${isRoot ? '' : 'mt-2'}`}>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{labelFromKey(key)}</label>
          <button
            onClick={() => {
              const newItem = isModelSpecArray ? { provider: '', model: '' } : isSimpleArray ? '' : {}
              onChange([...data, newItem])
            }}
            className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
          >
            <Plus size={10} />Add
          </button>
        </div>
        <div className="space-y-1.5 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
          {data.map((item: any, idx: number) => (
            <div key={idx} className="flex items-start gap-1.5 group">
              <GripVertical size={12} className="text-gray-300 dark:text-gray-600 mt-1.5 flex-shrink-0 cursor-grab opacity-0 group-hover:opacity-100" />
              <div className="flex-1 min-w-0">
                {isModelSpecArray ? (
                  models.length > 0 ? (
                    <select
                      value={`${item.provider}/${item.model}`}
                      onChange={e => {
                        const [prov, ...rest] = e.target.value.split('/')
                        const arr = [...data]
                        arr[idx] = { provider: prov, model: rest.join('/') }
                        onChange(arr)
                      }}
                      className="w-full px-2 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">-- Select model --</option>
                      {models.map((m, mi) => (
                        <option key={mi} value={`${m.provider}/${m.model}`}>
                          {m.provider}/{m.model} {m.name ? `(${m.name})` : ''} {m.contextWindow ? ` [${Math.round(m.contextWindow/1000)}k]` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-1.5">
                      <input
                        value={item.provider || ''}
                        onChange={e => { const arr = [...data]; arr[idx] = { ...arr[idx], provider: e.target.value }; onChange(arr) }}
                        placeholder="provider"
                        className="flex-1 px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        value={item.model || ''}
                        onChange={e => { const arr = [...data]; arr[idx] = { ...arr[idx], model: e.target.value }; onChange(arr) }}
                        placeholder="model"
                        className="flex-[2] px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )
                ) : isSimpleArray ? (
                  <input
                    value={String(item)}
                    onChange={e => { const arr = [...data]; arr[idx] = e.target.value; onChange(arr) }}
                    className="w-full px-2 py-1 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                ) : (
                  <JsoncForm data={item} onChange={v => { const arr = [...data]; arr[idx] = v; onChange(arr) }} path={`${path}[${idx}]`} depth={depth + 1} models={models} />
                )}
              </div>
              <button
                onClick={() => { const arr = data.filter((_: any, i: number) => i !== idx); onChange(arr) }}
                className="p-0.5 mt-0.5 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 flex-shrink-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          {data.length === 0 && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 italic py-1">Empty</div>
          )}
        </div>
      </div>
    )
  }

  // ── Object ──
  if (schema.type === 'object') {
    const entries = Object.entries(data)
    const key = path.split('.').pop() || ''
    const isCollapsed = collapsed[path]
    

    return (
      <div className={`${isRoot ? '' : 'mt-2'}`}>
        {!isRoot && (
          <button
            onClick={() => setCollapsed(c => ({ ...c, [path]: !c[path] }))}
            className="flex items-center gap-1 mb-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {labelFromKey(key)}
            <span className="text-[10px] text-gray-400 font-normal">({entries.length})</span>
          </button>
        )}
        {!isCollapsed && (
          <div className={`${isRoot ? 'space-y-1' : 'space-y-0.5 pl-3 border-l-2 border-gray-200 dark:border-gray-700'}`}>
            {entries.map(([k, v]) => {
              const childPath = path ? `${path}.${k}` : k
              if (v === null || v === undefined) return null
              if (typeof v === 'object' && !Array.isArray(v)) {
                return (
                  <div key={k} className="py-1">
                    <JsoncForm data={v} onChange={newVal => { const obj = { ...data }; obj[k] = newVal; onChange(obj) }} path={childPath} depth={depth + 1} models={models} />
                  </div>
                )
              }
              return (
                <div key={k} className="py-0.5">
                  <JsoncForm data={v} onChange={newVal => { const obj = { ...data }; obj[k] = newVal; onChange(obj) }} path={childPath} depth={depth + 1} models={models} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return null
}
