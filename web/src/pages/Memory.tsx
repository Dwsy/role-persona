import { useState, useEffect, useCallback, useRef } from 'react'
import { useUrlState } from '@/hooks/useUrlState'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Edit3,
  File,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import apiClient from '@/api/client'
import MarkdownViewer from '@/components/MarkdownViewer'

interface MemoryItem {
  id: string
  type: 'learning' | 'preference' | 'event'
  text: string
  category?: string
  tags?: string[]
  used?: number
  date?: string
  source?: string
  priority: 'high' | 'normal' | 'new' | 'other'
}

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

type Tab = 'table' | 'file'

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

function parseMemoryText(text: string): MemoryItem[] {
  const items: MemoryItem[] = []
  const lines = text.split('\n')
  let section: 'learning' | 'preference' | 'event' | '' = ''
  let priority: MemoryItem['priority'] = 'normal'
  let prefCategory = 'General'
  let eventDate = ''
  let eventTitle = ''
  const seen = new Set<string>()

  for (const line of lines) {
    const t = line.trim()
    if (!t || t === '---' || t === '- ...') continue

    if (/^###\s+Learnings$/i.test(t)) { section = 'learning'; priority = 'normal'; continue }
    if (/^###\s+Preferences$/i.test(t)) { section = 'preference'; prefCategory = 'General'; continue }
    if (/^###\s+Events$/i.test(t)) { section = 'event'; continue }

    if (/^#+\s*Learnings.*High/i.test(t)) { section = 'learning'; priority = 'high'; continue }
    if (/^#+\s*Learnings.*Normal/i.test(t)) { section = 'learning'; priority = 'normal'; continue }
    if (/^#+\s*Learnings.*New/i.test(t)) { section = 'learning'; priority = 'new'; continue }
    if (/^#+\s*Learnings/i.test(t)) { section = 'learning'; priority = 'normal'; continue }

    const prefH = t.match(/^#+\s*Preferences?\s*:?\s*(.+)/i)
    if (prefH) { section = 'preference'; prefCategory = prefH[1].trim() || 'General'; continue }

    if (/^#+\s*Events$/i.test(t)) { section = 'event'; continue }
    if (t.startsWith('#') || t.startsWith('- Learnings:') || t.startsWith('- Preferences:') || t.startsWith('- Parse issues:')) continue

    if (section === 'learning' && t.startsWith('- ')) {
      const m1 = t.match(/^-\s*\[([a-f0-9]+)\]\s*\[(\d+)x\]\s*(.+)$/)
      const m2 = t.match(/^-\s*\[(\d+)x\]\s*(.+)$/)
      const match = m1 || m2
      if (match) {
        const used = m1 ? parseInt(m1[2], 10) : parseInt(m2![1], 10)
        const itemText = (m1 ? m1[3] : m2![2]).trim()
        if (/^test-\d+/.test(itemText)) continue
        const key = itemText.toLowerCase().slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        const itemPriority: MemoryItem['priority'] = priority === 'high' ? 'high' : used === 0 ? 'new' : 'normal'
        items.push({ id: `l-${items.length}`, type: 'learning', text: itemText, used, priority: itemPriority })
      }
      continue
    }

    if (section === 'preference' && t.startsWith('- ')) {
      const itemText = t.slice(2).trim()
      if (/^test-/.test(itemText) || itemText === '...') continue
      const key = itemText.toLowerCase().slice(0, 80)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ id: `p-${items.length}`, type: 'preference', text: itemText, category: prefCategory, priority: 'other' })
      continue
    }

    if (section === 'event') {
      const header = t.match(/^#+\s*\[([^\]]+)\]\s*(.+)/)
      if (header) {
        if (eventTitle) {
          items.push({ id: `e-${items.length}`, type: 'event', text: `${eventDate}: ${eventTitle}`, date: eventDate, priority: 'other' })
        }
        eventDate = header[1]
        eventTitle = header[2]
        continue
      }
      if (eventTitle && t.length > 5 && !t.startsWith('#')) {
        items.push({ id: `e-${items.length}`, type: 'event', text: `${eventDate}: ${eventTitle}`, date: eventDate, priority: 'other' })
        eventTitle = ''
      }
    }
  }

  if (eventTitle) {
    items.push({ id: `e-${items.length}`, type: 'event', text: `${eventDate}: ${eventTitle}`, date: eventDate, priority: 'other' })
  }

  return items
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.isDir ? countFiles(node.children || []) : 1), 0)
}

function fileTitle(path: string): string {
  return path.split('/').filter(Boolean).join(' / ')
}

function isMarkdownFile(path: string): boolean {
  return path.endsWith('.md') || path.endsWith('.markdown')
}

export default function Memory() {
  const { t } = useTranslation()
  const [tab, setTabRaw] = useUrlState('tab', 'table')
  const setTab = (value: Tab) => setTabRaw(value)
  const [selectedFile, setSelectedFile] = useUrlState('file', 'memory/consolidated.md')
  const [searchQuery, setSearchQuery] = useUrlState('q', '')

  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['memory', 'memory/daily']))
  const [fileContent, setFileContent] = useState('')
  const [items, setItems] = useState<MemoryItem[]>([])
  const [filteredItems, setFilteredItems] = useState<MemoryItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [stats, setStats] = useState({ learnings: 0, preferences: 0, issues: 0 })

  const [loading, setLoading] = useState(true)
  const [fileLoading, setFileLoading] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null)
  const [editText, setEditText] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<MemoryItem | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const loadSelectedFile = useCallback(async (path: string) => {
    setFileLoading(true)
    const res = await apiClient.fileRead(path)
    if (res.ok && res.data) {
      setFileContent(res.data.content)
      if (path === 'memory/consolidated.md') {
        setItems(parseMemoryText(res.data.content))
      }
    } else {
      setFileContent(`Failed to load ${path}\n\n${res.error || 'Unknown error'}`)
    }
    setFileLoading(false)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [treeRes, memRes] = await Promise.all([
      apiClient.fileList('memory', true),
      apiClient.memoryList(),
    ])

    if (treeRes.ok && treeRes.data) {
      setFileTree(treeRes.data as FileNode[])
    }

    if (memRes.ok && memRes.data) {
      setStats({ learnings: memRes.data.learnings, preferences: memRes.data.preferences, issues: memRes.data.issues })
      const parsed = parseMemoryText(memRes.data.text || '')
      setItems(parsed)
    }

    await loadSelectedFile(selectedFile)
    setLoading(false)
  }, [loadSelectedFile, selectedFile])

  useEffect(() => {
    loadAll()
    const handler = () => loadAll()
    window.addEventListener('role-changed', handler)
    return () => window.removeEventListener('role-changed', handler)
  }, [loadAll])

  useEffect(() => {
    let result = items
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(item => {
        const text = item.text.toLowerCase()
        const tags = (item.tags || []).join(' ').toLowerCase()
        try {
          if (q.startsWith('/') && q.endsWith('/')) {
            const re = new RegExp(q.slice(1, -1), 'i')
            return re.test(text) || re.test(tags)
          }
        } catch {}
        return text.includes(q) || tags.includes(q) || (item.category || '').toLowerCase().includes(q)
      })
    }
    setFilteredItems(result)
    setSelectedIndex(0)
  }, [items, searchQuery])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          ;(e.target as HTMLInputElement).blur()
          setSearchQuery('')
        }
        return
      }
      if (tab !== 'table') return
      switch (e.key) {
        case '/': e.preventDefault(); searchRef.current?.focus(); break
        case 'j': setSelectedIndex(i => Math.min(filteredItems.length - 1, i + 1)); break
        case 'k': setSelectedIndex(i => Math.max(0, i - 1)); break
        case 'c': copySelected(); break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [filteredItems, tab])

  useEffect(() => {
    const row = tableRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedIndex])

  const selectFile = async (path: string) => {
    setSelectedFile(path)
    if (isMarkdownFile(path)) {
      setTab(path === 'memory/consolidated.md' ? 'table' : 'file')
    } else {
      setTab('file')
    }
    await loadSelectedFile(path)
  }

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleSaveFile = async (content: string) => {
    const res = await apiClient.fileWrite(selectedFile, content)
    if (res.ok) {
      setFileContent(content)
      if (selectedFile === 'memory/consolidated.md') setItems(parseMemoryText(content))
      setActionMsg('Saved')
      setTimeout(() => setActionMsg(''), 2000)
    } else {
      setActionMsg(errorMessage(res.error, 'Save failed'))
      setTimeout(() => setActionMsg(''), 3000)
    }
  }

  const handleAction = async (action: () => Promise<any>, msg: string) => {
    setActionMsg(t('common.loading'))
    const res = await action()
    setActionMsg(res.ok ? msg : (res.error || t('common.error')))
    if (res.ok) loadAll()
    setTimeout(() => setActionMsg(''), 3000)
  }

  const copySelected = () => {
    const item = filteredItems[selectedIndex]
    if (!item) return
    navigator.clipboard.writeText(item.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const openEdit = (item: MemoryItem) => {
    setEditingItem(item)
    setEditText(item.text)
    setEditCategory(item.category || '')
  }

  const handleSaveEdit = async () => {
    if (!editingItem || !editText.trim()) return
    setActionMsg(t('common.loading'))
    let res
    if (editingItem.type === 'learning') {
      res = await apiClient.memoryUpdateLearning(editingItem.text, editText.trim())
    } else if (editingItem.type === 'preference') {
      res = await apiClient.memoryUpdatePreference(editingItem.text, editText.trim(), editCategory)
    }
    if (res?.ok) {
      setEditingItem(null)
      setActionMsg('Updated')
      loadAll()
    } else {
      setActionMsg(errorMessage(res?.error, 'Update failed'))
    }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const handleDelete = async (item: MemoryItem) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archivePath = `memory/archive/${timestamp}-${item.id}.md`
    const archiveContent = `# Archived Memory\n\n- **Type**: ${item.type}\n- **ID**: ${item.id}\n- **Category**: ${item.category || '-'}\n- **Used**: ${item.used || 0}x\n- **Archived**: ${new Date().toISOString()}\n\n## Content\n\n${item.text}`
    await apiClient.fileWrite(archivePath, archiveContent)

    setActionMsg(t('common.loading'))
    let res
    if (item.type === 'learning') {
      res = await apiClient.memoryDeleteLearning(item.text)
    } else if (item.type === 'preference') {
      res = await apiClient.memoryDeletePreference(item.text)
    } else {
      setActionMsg('Cannot delete this type')
      return
    }
    if (res?.ok) {
      setDeleteConfirm(null)
      setActionMsg(`Deleted and archived: ${archivePath}`)
      loadAll()
    } else {
      setActionMsg(errorMessage(res?.error, 'Delete failed'))
    }
    setTimeout(() => setActionMsg(''), 3000)
  }

  const highlightMatch = (text: string) => {
    if (!searchQuery) return text
    try {
      const re = searchQuery.startsWith('/') && searchQuery.endsWith('/')
        ? new RegExp(`(${searchQuery.slice(1, -1)})`, 'gi')
        : new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      return text.replace(re, '<mark class="bg-yellow-200 dark:bg-yellow-800/50 px-0.5 rounded">$1</mark>')
    } catch {
      return text
    }
  }

  return (
    <div className="flex gap-4" style={{ height: 'calc(100vh - 8rem)' }}>
      <aside className="w-64 flex-shrink-0">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 h-full flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Files</span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{countFiles(fileTree)}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            <FileTreeNode
              node={{ name: 'memory', path: 'memory', isDir: true, children: fileTree }}
              level={0}
              selectedPath={selectedFile}
              expandedDirs={expandedDirs}
              onToggle={toggleDir}
              onSelect={selectFile}
            />
          </div>
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-gray-500">L:</span> <span className="font-mono text-gray-900 dark:text-white">{stats.learnings}</span></div>
            <div><span className="text-gray-500">P:</span> <span className="font-mono text-gray-900 dark:text-white">{stats.preferences}</span></div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2 flex-shrink-0">
              <Brain size={20} />{t('memory.title')}
            </h1>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 ml-4 flex-shrink-0">
              <button onClick={() => setTab('table')} disabled={selectedFile !== 'memory/consolidated.md'}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tab === 'table' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'}`}>
                Table
              </button>
              <button onClick={() => setTab('file')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'file' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'}`}>
                Markdown
              </button>
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{fileTitle(selectedFile)}</span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => handleAction(() => apiClient.memoryConsolidate(), t('memory.consolidateSuccess'))} className="flex items-center gap-1 px-3 py-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-lg hover:bg-yellow-200 dark:hover:bg-yellow-900/50 text-xs">
              <RefreshCw size={12} />{t('memory.consolidate')}
            </button>
            <button onClick={() => handleAction(() => apiClient.memoryRepair(), t('memory.repairSuccess'))} className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 text-xs">
              <Wrench size={12} />{t('memory.repair')}
            </button>
            <button onClick={() => handleAction(() => apiClient.memoryTidy(), 'Done')} className="flex items-center gap-1 px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 text-xs">
              <Sparkles size={12} />{t('memory.tidy')}
            </button>
            <button onClick={loadAll} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-xs">
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {actionMsg && (
          <div className="px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-lg text-xs">{actionMsg}</div>
        )}

        {tab === 'table' && selectedFile === 'memory/consolidated.md' ? (
          <TablePanel
            loading={loading}
            filteredItems={filteredItems}
            selectedIndex={selectedIndex}
            searchQuery={searchQuery}
            searchRef={searchRef}
            tableRef={tableRef}
            copied={copied}
            onSearch={setSearchQuery}
            onSelectIndex={setSelectedIndex}
            onCopy={copySelected}
            onEdit={openEdit}
            onDelete={setDeleteConfirm}
            highlightMatch={highlightMatch}
          />
        ) : (
          <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col min-h-0">
            <div className="flex-shrink-0 px-6 pt-4 pb-2 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <FileText size={15} className="text-blue-500" />{fileTitle(selectedFile)}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {fileLoading ? <div className="text-sm text-gray-500">{t('common.loading')}</div> : (
                <MarkdownViewer content={fileContent} editable={isMarkdownFile(selectedFile)} onSave={handleSaveFile} />
              )}
            </div>
          </div>
        )}
      </main>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingItem(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2"><Edit3 size={18} />Edit {editingItem.type}</h2>
              <button onClick={() => setEditingItem(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} className="text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Content</label>
                <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              {editingItem.type === 'preference' && (
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Category</label>
                  <input value={editCategory} onChange={e => setEditCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div className="text-xs text-gray-400 dark:text-gray-500">ID: {editingItem.id} · Used: {editingItem.used || 0}x</div>
            </div>
            <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setEditingItem(null)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={handleSaveEdit} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"><Save size={14} />Save</button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2 mb-3"><Archive size={18} className="text-amber-500" />Archive & Delete</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">This memory will be archived to <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">memory/archive/</code> before deletion.</p>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 mb-4">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{deleteConfirm.type} · {deleteConfirm.category || '-'}</div>
                <div className="text-sm text-gray-900 dark:text-white">{deleteConfirm.text}</div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-sm">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex items-center gap-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"><Trash2 size={14} />Archive & Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TablePanel({
  loading,
  filteredItems,
  selectedIndex,
  searchQuery,
  searchRef,
  tableRef,
  copied,
  onSearch,
  onSelectIndex,
  onCopy,
  onEdit,
  onDelete,
  highlightMatch,
}: {
  loading: boolean
  filteredItems: MemoryItem[]
  selectedIndex: number
  searchQuery: string
  searchRef: React.RefObject<HTMLInputElement>
  tableRef: React.RefObject<HTMLDivElement>
  copied: boolean
  onSearch: (value: string) => void
  onSelectIndex: (index: number) => void
  onCopy: () => void
  onEdit: (item: MemoryItem) => void
  onDelete: (item: MemoryItem) => void
  highlightMatch: (text: string) => string
}) {
  return (
    <div className="flex-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden min-h-0">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="text-xs text-gray-500 dark:text-gray-400">memory / <span className="text-gray-900 dark:text-white">consolidated.md</span></div>
        <div className="flex-1" />
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input ref={searchRef} type="text" value={searchQuery} onChange={e => onSearch(e.target.value)} placeholder="Filter... (/regex/)"
            className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>
      <div ref={tableRef} className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 z-10">
            <tr>
              <th className="w-12 text-center py-2 px-3 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700" />
              <th className="text-left py-2 px-3 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700 min-w-[300px]">Content</th>
              <th className="w-28 text-left py-2 px-3 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">Category</th>
              <th className="w-20 text-left py-2 px-3 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700">Meta</th>
              <th className="w-16 text-center py-2 px-3 text-gray-500 font-medium border-b border-gray-200 dark:border-gray-700" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-500">Loading...</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-gray-500"><FileText size={32} className="mx-auto mb-2 opacity-30" />No items</td></tr>
            ) : filteredItems.map((item, idx) => (
              <tr key={item.id || idx} data-index={idx} onClick={() => onSelectIndex(idx)}
                className={`cursor-pointer transition-colors ${idx === selectedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                <td className="text-center py-2 px-3 border-b border-gray-100 dark:border-gray-700">
                  <span className={`inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${item.priority === 'high' ? 'bg-red-500 text-white' : item.priority === 'new' ? 'bg-emerald-500 text-white' : item.type === 'learning' ? 'bg-amber-500 text-white' : 'bg-gray-500 text-white'}`}>
                    {item.type === 'learning' ? `${item.used || 0}x` : item.type.slice(0, 3)}
                  </span>
                </td>
                <td className="py-2 px-3 border-b border-gray-100 dark:border-gray-700 text-gray-900 dark:text-gray-200 leading-relaxed max-w-lg" dangerouslySetInnerHTML={{ __html: highlightMatch(item.text) }} />
                <td className="py-2 px-3 border-b border-gray-100 dark:border-gray-700 text-gray-500 dark:text-gray-400">{item.category || ''}</td>
                <td className="py-2 px-3 border-b border-gray-100 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-mono text-[10px]">{item.source || ''}</td>
                <td className="py-2 px-3 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-1 justify-center">
                    {(item.type === 'learning' || item.type === 'preference') && (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); onEdit(item) }} className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400" title="Edit"><Edit3 size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete(item) }} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
        <span>{filteredItems.length} items</span>
        <div className="flex items-center gap-2">
          {copied && <span className="text-green-600 dark:text-green-400 flex items-center gap-1"><Check size={12} />Copied</span>}
          <button onClick={onCopy} className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"><Copy size={12} />Copy</button>
        </div>
      </div>
    </div>
  )
}

function FileTreeNode({
  node,
  level,
  selectedPath,
  expandedDirs,
  onToggle,
  onSelect,
}: {
  node: FileNode
  level: number
  selectedPath: string
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}) {
  const hasChildren = !!node.children?.length
  const expanded = expandedDirs.has(node.path)
  const active = selectedPath === node.path
  const Icon = node.isDir ? (expanded ? FolderOpen : Folder) : File

  return (
    <div>
      <button
        type="button"
        onClick={() => node.isDir ? onToggle(node.path) : onSelect(node.path)}
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${active ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
        style={{ paddingLeft: `${8 + level * 12}px` }}
      >
        {node.isDir ? (
          expanded ? <ChevronDown size={12} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <Icon size={14} className={node.isDir ? 'text-amber-500' : 'text-gray-400'} />
        <span className="flex-1 truncate text-left">{node.name}</span>
        {node.isDir && <span className="text-[10px] text-gray-400 font-mono">{countFiles(node.children || [])}</span>}
      </button>
      {node.isDir && hasChildren && expanded && (
        <div className="border-l border-gray-200 dark:border-gray-700 ml-3">
          {node.children!.map(child => (
            <FileTreeNode key={child.path} node={child} level={level + 1} selectedPath={selectedPath} expandedDirs={expandedDirs} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}
