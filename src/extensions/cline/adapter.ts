/**
 * role-persona Cline Plugin — 自包含版本 v2
 * 完整注入：文件路径 + 角色提示 + 记忆内容 + 编辑指令
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type AgentPlugin = {
  name: string;
  manifest?: Record<string, unknown>;
  setup: (api: any, ctx: any) => void | Promise<void>;
  hooks?: Record<string, any>;
};

// ── 路径常量 ──

const ROLE_DIR = join(homedir(), ".pi", "roles", "default");
const MEMORY_DIR = join(ROLE_DIR, "memory");
const CORE_DIR = join(ROLE_DIR, "core");
const CONSOLIDATED_FILE = join(MEMORY_DIR, "consolidated.md");
const DAILY_DIR = join(MEMORY_DIR, "daily");

// ── 工具函数 ──

function ensureDirs() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });
  if (!existsSync(CORE_DIR)) mkdirSync(CORE_DIR, { recursive: true });
}

function readFileSafe(path: string): string {
  try { return existsSync(path) ? readFileSync(path, "utf-8") : ""; }
  catch { return ""; }
}

interface MemoryEntry { id: string; text: string; used: number; }

function loadConsolidated(): { learnings: MemoryEntry[]; preferences: string[] } {
  ensureDirs();
  const content = readFileSafe(CONSOLIDATED_FILE);
  if (!content) return { learnings: [], preferences: [] };

  const learnings: MemoryEntry[] = [];
  const preferences: string[] = [];

  // Match all Learnings sections (High Priority, Normal, New)
  for (const match of content.matchAll(/# Learnings[\s\S]*?\n([\s\S]*?)(?=\n# |$)/gi)) {
    for (const line of match[1].split("\n")) {
      if (!line.startsWith("- [") || line.includes("- (none)")) continue;
      const m = line.match(/- \[([^\]]+)\]\s+(?:\[\d+x\]\s+)?(.+)/);
      if (m) learnings.push({ id: m[1], text: m[2].trim(), used: 0 });
    }
  }

  // Match all Preferences sections
  for (const match of content.matchAll(/# Preferences:[\s\S]*?\n([\s\S]*?)(?=\n# |$)/gi)) {
    for (const line of match[1].split("\n")) {
      if (!line.startsWith("- ") || line.includes("- (none)")) continue;
      preferences.push(line.replace(/^- /, "").trim());
    }
  }

  return { learnings, preferences };
}

function saveConsolidated(learnings: MemoryEntry[], preferences: string[]) {
  ensureDirs();
  const content = `# Memory: default
# Last Consolidated: ${new Date().toISOString().split("T")[0]}

---

# Learnings (New)
${learnings.map(l => `- [${l.id}] ${l.text}`).join("\n") || "- (none)"}

# Preferences: General
${preferences.map(p => `- ${p}`).join("\n") || "- (none)"}
`;
  writeFileSync(CONSOLIDATED_FILE, content, "utf-8");
}

function appendDaily(text: string) {
  ensureDirs();
  const today = new Date().toISOString().split("T")[0];
  const dailyFile = join(DAILY_DIR, `${today}.md`);
  const time = new Date().toTimeString().split(" ")[0];
  const entry = `\n## [${time}] MEMORY\n${text}\n`;
  if (existsSync(dailyFile)) {
    writeFileSync(dailyFile, readFileSync(dailyFile, "utf-8") + entry, "utf-8");
  } else {
    writeFileSync(dailyFile, `# Memory: ${today}\n${entry}`, "utf-8");
  }
}

function genId(): string { return Math.random().toString(36).slice(2, 12); }

function toolOk(data: any, message?: string) {
  return { content: message || JSON.stringify(data, null, 2), details: data };
}
function toolErr(text: string) { return { content: text, isError: true }; }

// ── 构建系统提示注入内容 ──

function buildMemoryRule(): string {
  const parts: string[] = [];

  // 1. 文件路径
  const today = new Date().toISOString().split("T")[0];
  parts.push([
    `## 📁 FILE LOCATIONS`,
    `All persona files are stored in: **${ROLE_DIR}**`,
    `- identity → ${ROLE_DIR}/core/identity.md`,
    `- user → ${ROLE_DIR}/core/user.md`,
    `- soul → ${ROLE_DIR}/core/soul.md`,
    `- memory → ${ROLE_DIR}/memory/consolidated.md`,
    `- daily → ${ROLE_DIR}/memory/daily/${today}.md`,
  ].join("\n"));

  // 2. 角色提示（读取 core 文件）
  const identity = readFileSafe(join(CORE_DIR, "identity.md"));
  const soul = readFileSafe(join(CORE_DIR, "soul.md"));
  const user = readFileSafe(join(CORE_DIR, "user.md"));
  if (identity || soul || user) {
    parts.push("## 🎭 Role Persona");
    if (identity) parts.push(`### Identity\n${identity}`);
    if (soul) parts.push(`### Soul\n${soul}`);
    if (user) parts.push(`### User\n${user}`);
  }

  // 3. 记忆内容
  const data = loadConsolidated();
  const memLines: string[] = ["## Your Memory"];
  if (data.learnings.length > 0) {
    memLines.push("", "### Learnings (persistent cross-session memories)");
    for (const l of data.learnings) memLines.push(`- ${l.text}`);
  }
  if (data.preferences.length > 0) {
    memLines.push("", "### User Preferences");
    for (const p of data.preferences) memLines.push(`- ${p}`);
  }
  memLines.push("", `Total: ${data.learnings.length} learnings, ${data.preferences.length} preferences`);
  parts.push(memLines.join("\n"));

  // 4. 编辑指令
  parts.push([
    `## 📝 Memory Edit Spec`,
    ``,
    `Memory file: ${CONSOLIDATED_FILE}`,
    ``,
    `When you update memory, follow this format exactly:`,
    ``,
    `1) Learning sections`,
    `- # Learnings (High Priority)  -> used >= 3`,
    `- # Learnings (Normal)         -> used 1-2`,
    `- # Learnings (New)            -> used = 0`,
    `- Learning line format: - [Nx] concise text`,
    ``,
    `2) Preference sections`,
    `- # Preferences: Communication | Code | Tools | Workflow | General`,
    `- Preference line format: - concise text`,
    ``,
    `3) Use the memory tool to add/search/manage memories.`,
    `   Use the knowledge tool for reusable knowledge entries.`,
  ].join("\n"));

  return parts.join("\n\n---\n\n");
}

// ── Plugin ──

const plugin: AgentPlugin = {
  name: "role-persona",
  manifest: { capabilities: ["tools", "hooks", "rules"] },

  setup(api, ctx) {
    ctx.logger?.log("[role-persona] Loading v2...");

    // ── memory 工具 ──
    api.registerTool({
      name: "memory",
      description: "Manage persistent memory. Actions: list, search, add, delete, consolidate, update.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "search", "add", "delete", "consolidate", "update"], description: "Memory action" },
          content: { type: "string", description: "Memory content for add/update" },
          query: { type: "string", description: "Search query" },
          id: { type: "string", description: "Memory ID for delete/update" },
          type: { type: "string", enum: ["learning", "preference"], description: "Memory type (default: learning)" },
          category: { type: "string", description: "Preference category" },
        },
        required: ["action"],
      },
      execute: async (input: unknown) => {
        const { action, content, query, id, type: memType, category } = input as Record<string, string>;
        try {
          switch (action) {
            case "list": {
              const data = loadConsolidated();
              const lines = ["## Memory (default)", "", `- Learnings: ${data.learnings.length}`, `- Preferences: ${data.preferences.length}`, ""];
              if (data.learnings.length > 0) {
                lines.push("### Learnings");
                for (const l of data.learnings) lines.push(`- [${l.id}] ${l.text}`);
              }
              if (data.preferences.length > 0) {
                lines.push("### Preferences");
                for (const p of data.preferences) lines.push(`- ${p}`);
              }
              return toolOk(data, lines.join("\n"));
            }
            case "search": {
              const data = loadConsolidated();
              const q = (query || "").toLowerCase();
              const matches: any[] = [];
              for (const l of data.learnings) { if (l.text.toLowerCase().includes(q)) matches.push({ type: "learning", ...l }); }
              for (const p of data.preferences) { if (p.toLowerCase().includes(q)) matches.push({ type: "preference", text: p }); }
              return toolOk(matches, `${matches.length} matches for "${query}"`);
            }
            case "add": {
              if (!content) return toolErr("content is required");
              const data = loadConsolidated();
              const type = memType || "learning";
              if (type === "preference") {
                data.preferences.push(content);
                appendDaily(`Preference added: ${content}`);
              } else {
                const newId = genId();
                data.learnings.push({ id: newId, text: content, used: 0 });
                appendDaily(`Learning added [${newId}]: ${content}`);
              }
              saveConsolidated(data.learnings, data.preferences);
              return toolOk({ stored: true }, `Stored ${type}: ${content}`);
            }
            case "update": {
              if (!id || !content) return toolErr("id and content required");
              const data = loadConsolidated();
              const idx = data.learnings.findIndex(l => l.id === id);
              if (idx >= 0) {
                const old = data.learnings[idx];
                data.learnings[idx] = { ...old, text: content };
                saveConsolidated(data.learnings, data.preferences);
                appendDaily(`Learning updated [${id}]: ${old.text} → ${content}`);
                return toolOk({ updated: true }, `Updated [${id}]: ${content}`);
              }
              return toolErr(`Not found: ${id}`);
            }
            case "delete": {
              if (!id) return toolErr("id is required");
              const data = loadConsolidated();
              const idx = data.learnings.findIndex(l => l.id === id);
              if (idx >= 0) {
                const removed = data.learnings.splice(idx, 1)[0];
                saveConsolidated(data.learnings, data.preferences);
                appendDaily(`Learning deleted [${id}]: ${removed.text}`);
                return toolOk({ deleted: true }, `Deleted: ${removed.text}`);
              }
              return toolErr(`Not found: ${id}`);
            }
            case "consolidate": {
              const data = loadConsolidated();
              const seen = new Set<string>();
              const deduped = data.learnings.filter(l => {
                const key = l.text.toLowerCase().trim();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              const before = data.learnings.length;
              saveConsolidated(deduped, data.preferences);
              return toolOk({ before, after: deduped.length, removed: before - deduped.length },
                `Consolidated: ${before} → ${deduped.length} (${before - deduped.length} removed)`);
            }
            default: return toolErr(`Unknown action: ${action}`);
          }
        } catch (err: any) { return toolErr(`Memory error: ${err.message}`); }
      },
    });

    // ── knowledge 工具 ──
    api.registerTool({
      name: "knowledge",
      description: "Searchable knowledge base. Actions: list, search, read, write.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "search", "read", "write"] },
          title: { type: "string" },
          content: { type: "string" },
          category: { type: "string" },
        },
        required: ["action"],
      },
      execute: async (input: unknown) => {
        const { action, title, content, category } = input as Record<string, string>;
        const kbDir = join(MEMORY_DIR, "knowledge");
        ensureDirs();
        if (!existsSync(kbDir)) mkdirSync(kbDir, { recursive: true });

        const { readdirSync, readFileSync: rf, writeFileSync: wf, existsSync: ex } = await import("node:fs");
        switch (action) {
          case "list": {
            const files = ex(kbDir) ? readdirSync(kbDir).filter(f => f.endsWith(".md")) : [];
            return toolOk({ total: files.length }, `Knowledge: ${files.length} entries\n${files.map(f => `- ${f.replace(".md", "")}`).join("\n") || "(empty)"}`);
          }
          case "write": {
            if (!title || !content) return toolErr("title and content required");
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            wf(join(kbDir, `${slug}.md`), `---\ntitle: ${title}\ncategory: ${category || "general"}\n---\n\n${content}`, "utf-8");
            return toolOk({ written: slug }, `Written: ${title}`);
          }
          case "read": {
            if (!title) return toolErr("title required");
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            const fp = join(kbDir, `${slug}.md`);
            if (!ex(fp)) return toolErr(`Not found: ${title}`);
            return toolOk({ path: fp }, rf(fp, "utf-8"));
          }
          default: return toolErr(`Unknown action: ${action}`);
        }
      },
    });

    // ── role_info 工具 ──
    api.registerTool({
      name: "role_info",
      description: "Get the current role and workspace info.",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const data = loadConsolidated();
        return toolOk({
          name: "default", path: ROLE_DIR, memoryDir: MEMORY_DIR,
          learnings: data.learnings.length, preferences: data.preferences.length,
        }, [
          `## Role Info`, `**Name**: default`, `**Path**: ${ROLE_DIR}`,
          `**Memory Dir**: ${MEMORY_DIR}`, `**Learnings**: ${data.learnings.length}`,
          `**Preferences**: ${data.preferences.length}`,
        ].join("\n"));
      },
    });

    // ── Rules（完整注入系统提示）──
    api.registerRule({
      id: "role-persona-context",
      content: () => buildMemoryRule(),
      source: "role-persona",
    });

    ctx.logger?.log("[role-persona] v2 loaded: tools(memory,knowledge,role_info) + rules(file+role+memory+edit)");
  },

  hooks: {
    afterRun({ result }) {
      if (result.status === "completed") console.log("[role-persona] Run completed");
    },
  },
};

export default plugin;
