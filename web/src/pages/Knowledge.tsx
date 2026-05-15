import { useState, useEffect } from 'react'
import { useUrlState } from '@/hooks/useUrlState'
import { useTranslation } from 'react-i18next'
import { Search, BookOpen, Plus, Tag, Folder, RefreshCw, ArrowLeft } from 'lucide-react'
import apiClient from '@/api/client'
import MarkdownViewer from '@/components/MarkdownViewer'

interface KbItem {
  id: string
  file: string
  title: string
  description: string
  category: string
  tags: string[]
  source: string
  updated: string
}

export default function Knowledge() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<KbItem[]>([])
  const [searchQuery, setSearchQuery] = useUrlState('q', '')
  const [searchResults, setSearchResults] = useState<KbItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEntry, setSelectedEntry] = useState<{ title: string; content: string } | null>(null)
  const [showWriteModal, setShowWriteModal] = useState(false)
  const [writeForm, setWriteForm] = useState({ title: '', content: '', category: '', tags: '' })

  useEffect(() => {
    loadEntries()
    const handler = () => loadEntries()
    window.addEventListener('role-changed', handler)
    return () => window.removeEventListener('role-changed', handler)
  }, [])

  const loadEntries = async () => {
    setLoading(true)
    const res = await apiClient.knowledgeList()
    if (res.ok && res.data) {
      const items: KbItem[] = []
      const data = res.data as any
      for (const src of data.sources || []) {
        for (const cat of src.categories || []) {
          for (const e of cat.entries || []) {
            items.push({
              id: `${src.id}/${cat.category}/${e.file}`,
              file: e.file || '',
              title: e.title || '',
              description: e.description || '',
              category: cat.category || '',
              tags: e.tags || [],
              source: src.id || '',
              updated: e.updated || '',
            })
          }
        }
      }
      setEntries(items)
    }
    setLoading(false)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    const res = await apiClient.knowledgeSearch(searchQuery)
    if (res.ok && res.data) {
      const items: KbItem[] = (res.data as any[]).map((r: any) => ({
        id: r.entry?.relativePath || '',
        file: r.entry?.relativePath || '',
        title: r.entry?.meta?.title || '',
        description: r.entry?.meta?.description || '',
        category: r.entry?.category || '',
        tags: r.entry?.meta?.tags || [],
        source: r.entry?.source || '',
        updated: r.entry?.meta?.updated || '',
      }))
      setSearchResults(items)
    }
  }

  const handleRead = async (file: string, title: string) => {
    const res = await apiClient.knowledgeRead(file)
    if (res.ok && res.data) {
      setSelectedEntry({ title, content: (res.data as any).body || '(no content)' })
    }
  }

  const handleWrite = async () => {
    const res = await apiClient.knowledgeWrite({
      title: writeForm.title,
      content: writeForm.content,
      category: writeForm.category || 'general',
      tags: writeForm.tags.split(',').map(t => t.trim()).filter(Boolean),
    })
    if (res.ok) {
      setShowWriteModal(false)
      setWriteForm({ title: '', content: '', category: '', tags: '' })
      loadEntries()
    }
  }

  const displayEntries = searchResults.length > 0 ? searchResults : entries

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <BookOpen size={24} />
          {t('knowledge.title')}
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowWriteModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
            <Plus size={16} />{t('knowledge.write')}
          </button>
          <button onClick={loadEntries} className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-sm">
            <RefreshCw size={16} />{t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('knowledge.searchPlaceholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
          />
        </div>
        <button onClick={handleSearch} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          {t('common.search')}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('knowledge.totalEntries')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{entries.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('knowledge.categories')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{new Set(entries.map(e => e.category)).size}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">{t('knowledge.tags')}</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{new Set(entries.flatMap(e => e.tags)).size}</div>
        </div>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : displayEntries.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('knowledge.noEntries')}</div>
      ) : (
        <div className="space-y-2">
          {displayEntries.map((entry, i) => (
            <div
              key={entry.id || i}
              onClick={() => handleRead(entry.file, entry.title)}
              className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 cursor-pointer transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">{entry.title}</h3>
                  {entry.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{entry.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                      <Folder size={10} className="inline mr-1" />{entry.category}
                    </span>
                    {entry.source && (
                      <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">{entry.source}</span>
                    )}
                  </div>
                </div>
                {entry.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap justify-end">
                    {entry.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                        <Tag size={10} className="inline mr-0.5" />{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Read Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedEntry(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-3xl flex flex-col mx-4" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
              <button onClick={() => setSelectedEntry(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                <ArrowLeft size={18} className="text-gray-500" />
              </button>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selectedEntry.title}</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <MarkdownViewer content={selectedEntry.content} />
            </div>
          </div>
        </div>
      )}

      {/* Write Modal */}
      {showWriteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowWriteModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('knowledge.writeEntry')}</h2>
            </div>
            <div className="p-6 space-y-4">
              <input type="text" value={writeForm.title} onChange={e => setWriteForm(f => ({ ...f, title: e.target.value }))} placeholder={t('knowledge.titlePlaceholder')}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white" />
              <input type="text" value={writeForm.category} onChange={e => setWriteForm(f => ({ ...f, category: e.target.value }))} placeholder={t('knowledge.categoryPlaceholder')}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white" />
              <input type="text" value={writeForm.tags} onChange={e => setWriteForm(f => ({ ...f, tags: e.target.value }))} placeholder={t('knowledge.tagsPlaceholder')}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white" />
              <textarea value={writeForm.content} onChange={e => setWriteForm(f => ({ ...f, content: e.target.value }))} placeholder={t('knowledge.contentPlaceholder')} rows={8}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white resize-none" />
            </div>
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
              <button onClick={() => setShowWriteModal(false)} className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">{t('common.cancel')}</button>
              <button onClick={handleWrite} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
