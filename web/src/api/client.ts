/**
 * Daemon HTTP API client — all requests carry cwd for multiplexing.
 */

export interface ApiResponse<T = any> {
  ok: boolean
  data?: T
  error?: string | { code: string; message: string }
  message?: string
}

export interface RoleInfo { name: string; path: string; identity?: { name?: string; emoji?: string }; isFirstRun?: boolean }
export interface MemoryListResult { text: string; learnings: number; preferences: number; issues: number }
export interface MemorySearchMatch { kind: string; id?: string; text: string; category?: string; score?: number }
export interface KnowledgeEntry { relativePath: string; meta: { title: string; description: string; tags: string[] }; source: string; readonly: boolean; category: string }
export interface EmbeddingStats { enabled: boolean; active: boolean; model: string | null; dim: number | null; count: number; dbPath: string | null }

class ApiClient {
  private baseUrl: string
  private _role: string

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3939')
    this._role = typeof window !== 'undefined' ? localStorage.getItem('rp-role') || '' : ''
  }

  /** Current role for all requests */
  get role(): string { return this._role }
  setRole(role: string) {
    this._role = role
    if (typeof window !== 'undefined') localStorage.setItem('rp-role', role)
  }

  private async post<T>(path: string, body?: Record<string, any>): Promise<ApiResponse<T>> {
    try {
      const payload = { role: this._role || undefined, ...body }
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await resp.json()
      // Normalize structured error responses from daemon
      if (data.error && typeof data.error === 'object') {
        data.error = data.error.message || JSON.stringify(data.error)
      }
      return data
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    try {
      const resp = await fetch(`${this.baseUrl}${path}`)
      const data = await resp.json()
      // Normalize structured error responses from daemon
      if (data.error && typeof data.error === 'object') {
        data.error = data.error.message || JSON.stringify(data.error)
      }
      return data
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── Health ──
  healthCheck() { return this.get<{ pid: number; uptime: number; instances: Array<{ cwd: string; role: string | null }> }>('/api/health') }

  // ── Role selection ──
  selectRole(role: string) { this.setRole(role); return this.post<{ role: string | null }>('/api/cwd', { role }) }

  // ── Instances ──
  listInstances() { return this.get<Array<{ cwd: string; role: string | null }>>('/api/instances') }

  // ── Init ──
  init(cwd?: string) { return this.post('/api/init', cwd ? { cwd } : {}) }

  // ── Role ──
  roleList() { return this.post<string[]>('/api/role/list') }
  roleInfo() { return this.post<RoleInfo>('/api/role/info') }
  roleCreate(name: string) { return this.post('/api/role/create', { name }) }
  roleActivate(name: string) { return this.post('/api/role/activate', { name }) }
  roleMap(name: string) { return this.post('/api/role/map', { name }) }
  roleUnmap() { return this.post('/api/role/unmap') }

  // ── Memory ──
  memoryList() { return this.post<MemoryListResult>('/api/memory/list') }
  memorySearch(query: string) { return this.post<MemorySearchMatch[]>('/api/memory/search', { query }) }
  memoryAddLearning(content: string) { return this.post('/api/memory/add-learning', { content }) }
  memoryAddPreference(content: string, category?: string) { return this.post('/api/memory/add-preference', { content, category }) }
  memoryUpdateLearning(needle: string, text: string) { return this.post('/api/memory/update-learning', { needle, text }) }
  memoryUpdatePreference(needle: string, text: string, category?: string) { return this.post('/api/memory/update-preference', { needle, text, category }) }
  memoryDeleteLearning(needle: string) { return this.post('/api/memory/delete-learning', { needle }) }
  memoryDeletePreference(needle: string) { return this.post('/api/memory/delete-preference', { needle }) }
  memoryReinforce(needle: string) { return this.post('/api/memory/reinforce', { needle }) }
  memoryConsolidate() { return this.post('/api/memory/consolidate') }
  memoryRepair() { return this.post('/api/memory/repair') }
  memoryTidy(model?: string) { return this.post('/api/memory/tidy', { model }) }
  memoryConflicts() { return this.post('/api/memory/conflicts') }
  memoryLog() { return this.post('/api/memory/log') }
  memoryExport(path?: string) { return this.post('/api/memory/export', { path }) }
  memoryExtract(messages: any[]) { return this.post('/api/memory/extract', { messages }) }

  // ── Knowledge ──
  knowledgeList(category?: string) { return this.post('/api/knowledge/list', { category }) }
  knowledgeSearch(query: string, tags?: string[]) { return this.post('/api/knowledge/search', { query, tags }) }
  knowledgeRead(path: string) { return this.post<KnowledgeEntry>('/api/knowledge/read', { path }) }
  knowledgeWrite(entry: { title: string; content: string; category?: string; tags?: string[]; scope?: string }) { return this.post('/api/knowledge/write', entry) }

  // ── Embedding ──
  embeddingStats() { return this.post<EmbeddingStats>('/api/embedding/stats') }
  embeddingRebuild() { return this.post('/api/embedding/rebuild') }

  // ── Prompt ──
  buildPrompt(base?: string) { return this.post<{ prompt: string }>('/api/prompt', { base }) }

  // ── File Operations ──
  fileRead(path: string) { return this.post<{ path: string; content: string; size: number }>('/api/file/read', { path }) }
  fileWrite(path: string, content: string) { return this.post('/api/file/write', { path, content }) }
  fileList(dir: string, recursive = false) { return this.post<Array<{ name: string; isDir: boolean; path: string; children?: any[] }>>('/api/file/list', { dir, recursive }) }

  // ── Activity ──
  activityStats(days = 7, recentLimit = 20) { return this.post<any>('/api/activity/stats', { days, recentLimit }) }

  // ── Config ──
  configRead() { return this.post<{ path: string; content: string }>('/api/config/read') }
  configWrite(content: string) { return this.post('/api/config/write', { content }) }

  // ── Models ──
  modelsList() { return this.get<{ models: Array<{ provider: string; model: string; name: string; contextWindow?: number }> }>('/api/models') }
}

export const apiClient = new ApiClient()
export default apiClient
