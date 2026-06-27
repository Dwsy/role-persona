#!/usr/bin/env bun

/**
 * HTTP Daemon — persistent Bun.serve with pidfile single-instance.
 *
 * Features:
 * - PID file at ~/.pi/role-persona-daemon.pid for single-instance enforcement
 * - Background mode via --background flag (detaches from terminal)
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Warm service: stays in memory, no cold-start per request
 *
 * Usage:
 *   bun src/bin/daemon.ts                         # foreground, port 3939
 *   bun src/bin/daemon.ts --background            # detach, run in background
 *   bun src/bin/daemon.ts --port 8080             # custom port
 *   kill $(cat ~/.pi/role-persona-daemon.pid)     # stop
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createService, type RolePersonaService, type ServiceOptions } from "../service/index.ts";
import { loadConfig } from "../core/config.ts";
import type { LlmCaller, LlmCompletionResult, ModelRegistry, ModelInfo, ApiKeyResolver } from "../core/types.ts";

// ── Config ──

const DAEMON_DIR = join(homedir(), ".pi");
const PID_FILE = join(DAEMON_DIR, "role-persona-daemon.pid");
const PORT_FILE = join(DAEMON_DIR, "role-persona-daemon.port");
const DEFAULT_PORT = 3939;
const DEFAULT_STATIC_DIR = join(import.meta.dir || ".", "../../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── PID Management ──

function readPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return null;
    // Check if process is alive
    try { process.kill(pid, 0); return pid; } catch { return null; }
  } catch { return null; }
}

function writePid(pid: number) {
  if (!existsSync(DAEMON_DIR)) mkdirSync(DAEMON_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

function writePort(port: number) {
  if (!existsSync(DAEMON_DIR)) mkdirSync(DAEMON_DIR, { recursive: true });
  writeFileSync(PORT_FILE, String(port), "utf-8");
}

function removePid() {
  try { unlinkSync(PID_FILE); } catch {}
  try { unlinkSync(PORT_FILE); } catch {}
}

export function readPort(): number {
  try {
    if (existsSync(PORT_FILE)) return parseInt(readFileSync(PORT_FILE, "utf-8").trim(), 10) || DEFAULT_PORT;
  } catch {}
  return DEFAULT_PORT;
}

export function isDaemonRunning(): boolean {
  return readPid() !== null;
}

// ── Routes ──

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

function errResponse(e: unknown, status = 500): Response {
  const msg = e instanceof Error ? e.message : String(e);
  const code = status === 400 ? "BAD_REQUEST" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "INTERNAL";
  return json({ ok: false, error: { code, message: msg } }, status);
}

function badRequest(msg: string) {
  return json({ ok: false, error: { code: "BAD_REQUEST", message: msg } }, 400);
}

function notFound(msg: string) {
  return json({ ok: false, error: { code: "NOT_FOUND", message: msg } }, 404);
}

function forbidden(msg: string) {
  return json({ ok: false, error: { code: "FORBIDDEN", message: msg } }, 403);
}

function internal(msg: string) {
  return json({ ok: false, error: { code: "INTERNAL", message: msg } }, 500);
}

function serveStatic(req: Request): Response {
  const url = new URL(req.url);
  const requested = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  let filePath = join(DEFAULT_STATIC_DIR, requested);

  if (!filePath.startsWith(DEFAULT_STATIC_DIR)) return forbidden("Path escape blocked");
  if (!existsSync(filePath)) filePath = join(DEFAULT_STATIC_DIR, "index.html");

  if (!existsSync(filePath)) {
    return new Response("Web UI not built. Run: cd web && bun run build", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
    });
  }

  try {
    return new Response(readFileSync(filePath), {
      headers: { "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream", ...CORS },
    });
  } catch (e) {
    return errResponse(e);
  }
}

async function readBody<T>(req: Request): Promise<T> {
  const text = await req.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ── LLM Support (reads models.json, uses fetch) ──

interface ModelsJsonProvider {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: Array<{ id: string; name: string; contextWindow?: number; maxTokens?: number }>;
}

function loadModelsJson(): Record<string, ModelsJsonProvider> {
  try {
    const path = join(homedir(), ".pi", "agent", "models.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")).providers || {};
  } catch { return {}; }
}

function createDaemonModelRegistry(): ModelRegistry {
  const providers = loadModelsJson();
  const allModels: ModelInfo[] = [];
  for (const [provName, prov] of Object.entries(providers)) {
    for (const m of prov.models) {
      allModels.push({
        provider: provName,
        id: m.id,
        name: m.name,
        maxTokens: m.maxTokens,
        contextWindow: m.contextWindow,
        baseUrl: prov.baseUrl,
        apiKey: prov.apiKey,
        api: prov.api,
        reasoning: (m as any).reasoning,
      } as any);
    }
  }
  return {
    getAll: () => allModels,
    async getApiKeyAndHeaders(model: ModelInfo) {
      const prov = providers[(model as any).provider || model.provider];
      if (!prov) return { ok: false };
      return { ok: true, apiKey: prov.apiKey };
    },
  };
}

function createDaemonApiKeyResolver(): ApiKeyResolver {
  const providers = loadModelsJson();
  return {
    async resolve(provider?: string) {
      const target = provider ? providers[provider] : providers["openai"];
      return target?.apiKey || process.env.OPENAI_API_KEY || null;
    },
  };
}

function createDaemonLlmCaller(): LlmCaller {
  return {
    async complete(model, request, options) {
      const prov = (model as any).provider;
      const providers = loadModelsJson();
      const providerCfg = providers[prov];
      if (!providerCfg) throw new Error(`Provider not found: ${prov}`);

      const isReasoning = !!(model as any).reasoning;
      const messages: Array<{ role: string; content: string }> = request.messages.map((m) => ({
        role: m.role,
        content: m.content.map((c) => c.text).join(""),
      }));

      // Patch 3: reasoning models need system prompt forcing JSON output
      if (isReasoning && messages.length > 0 && messages[0].role !== "system") {
        messages.unshift({
          role: "system",
          content: "Output ONLY valid JSON. No explanation, no reasoning, no markdown. Just the JSON object.",
        });
      }

      const body: any = {
        model: model.id,
        messages,
        max_tokens: options.maxTokens || 1024,
      };

      // Patch 4: reasoning models need higher token budget
      if (isReasoning) {
        body.reasoning_effort = "low";
        if (body.max_tokens < 16384) body.max_tokens = 32768;
      }

      const url = `${providerCfg.baseUrl}/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey || providerCfg.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "unknown");
        console.error(`[daemon] LLM call failed (${response.status}):`, err);
        throw new Error(`LLM call failed (${response.status}): ${err}`);
      }

      const data = await response.json() as any;
      const text = data.choices?.[0]?.message?.content || "";
      const thinking = (data.choices?.[0]?.message as any)?.reasoning_content || "";

      // Patch 5: thinking content not returned to caller, only text
      const content: Array<{ type: string; text?: string; thinking?: string }> = [];
      if (text) {
        content.push({ type: "text", text });
      } else if (thinking) {
        // Fallback: extract JSON from thinking if content is empty
        const jsonMatch = thinking.match(/(\{[\s\S]*"learnings"[\s\S]*\})/);
        if (jsonMatch) {
          content.push({ type: "text", text: jsonMatch[1] });
        }
      }

      // Patch 6: finish_reason mapping
      const finishReason = data.choices?.[0]?.finish_reason || "unknown";
      const stopReason = ["stop", "length", "tool_calls"].includes(finishReason) ? "stop" : "error";

      return { content, stopReason } as LlmCompletionResult;
    },

    convertToLlm(messages: unknown[]) {
      return (messages as any[]).map((m: any) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map((c: any) => ({ type: c.type || "text", text: c.text || "" }))
          : [{ type: "text", text: String(m.content || "") }],
      }));
    },

    serializeConversation(messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>) {
      return messages.map((m) => {
        const text = m.content.map((c) => c.text || "").join("");
        return `[${m.role}]: ${text}`;
      }).join("\n\n");
    },
  };
}

// ── Service Manager (CWD multiplexing) ──

const normalize = (p: string) => p.replace(/\/$/, "");

class ServiceManager {
  private instances = new Map<string, { service: RolePersonaService; lastUsed: number }>();
  private opts: ServiceOptions;
  private maxIdleMs = 30 * 60 * 1000;

  constructor(opts: ServiceOptions) {
    this.opts = opts;
    setInterval(() => this.cleanup(), 60_000);
  }

  /** Get service by CWD (resolves role from mapping) or by role name (direct activate) */
  async get(cwdOrRole: string): Promise<RolePersonaService> {
    const key = normalize(cwdOrRole);
    let entry = this.instances.get(key);
    if (!entry) {
      const service = createService(this.opts);
      // If looks like a path (contains /), init with CWD. Otherwise activate role directly.
      if (key.includes("/") || key.includes("\\")) {
        await service.init(key);
      } else {
        // Direct role activation — init with homedir first, then activate
        await service.init(homedir());
        try { service.role.activate(key); } catch {}
      }
      entry = { service, lastUsed: Date.now() };
      this.instances.set(key, entry);
      console.log(`[daemon] +instance key=${key} role=${service.getActiveRole()?.name ?? "none"}`);
    }
    entry.lastUsed = Date.now();
    return entry.service;
  }

  list(): Array<{ key: string; role: string | null }> {
    return [...this.instances.entries()].map(([key, e]) => ({
      key,
      role: e.service.getActiveRole()?.name ?? null,
    }));
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.instances) {
      if (now - entry.lastUsed > this.maxIdleMs) {
        entry.service.dispose().catch(() => {});
        this.instances.delete(key);
        console.log(`[daemon] -instance idle cwd=${key}`);
      }
    }
  }

  async dispose() {
    for (const [, entry] of this.instances) {
      await entry.service.dispose().catch(() => {});
    }
    this.instances.clear();
  }
}

function buildRoutes(mgr: ServiceManager): Map<string, (req: Request) => Promise<Response>> {
  const r = new Map<string, (req: Request) => Promise<Response>>();

  // Helper: read body once, extract role, get service
  async function get(body: any): Promise<RolePersonaService> {
    return mgr.get(body.role || body.cwd || process.cwd());
  }

  r.set("GET /api/health", async () => {
    return json({ ok: true, pid: process.pid, uptime: process.uptime(), instances: mgr.list() });
  });
  r.set("GET /api/instances", async () => json({ ok: true, data: mgr.list() }));

  // ── CWD/Role ──
  r.set("POST /api/cwd", async (req) => {
    const b = await readBody<{cwd?: string; role?: string}>(req);
    const key = b.role || b.cwd;
    if (!key) return badRequest("cwd or role required");
    const s = await mgr.get(key);
    return json({ ok: true, data: { key, role: s.getActiveRole()?.name ?? null } });
  });
  r.set("POST /api/init", async (req) => {
    const b = await readBody<any>(req);
    const s = await get(b);
    return json({ ok: true, data: { role: s.getActiveRole()?.name ?? null } });
  });

  // ── Role ──
  r.set("POST /api/role/list", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.role.list() }); });
  r.set("POST /api/role/create", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.name ? json({ ok: true, data: s.role.create(b.name) }) : badRequest("name required"); });
  r.set("POST /api/role/activate", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.name ? json({ ok: true, data: s.role.activate(b.name) }) : badRequest("name required"); });
  r.set("POST /api/role/info", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.getActiveRole() }); });
  r.set("POST /api/role/map", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.name ? json({ ok: true, data: s.role.map(b.cwd || process.cwd(), b.name) }) : badRequest("name required"); });
  r.set("POST /api/role/unmap", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.role.unmap(b.cwd || process.cwd()) }); });

  // ── Memory ──
  r.set("POST /api/memory/add-learning", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.content ? json({ ok: true, data: await s.memory.addLearning(b.content) }) : badRequest("content required"); });
  r.set("POST /api/memory/add-preference", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.content ? json({ ok: true, data: s.memory.addPreference(b.content, b.category) }) : badRequest("content required"); });
  r.set("POST /api/memory/update-learning", async (req) => { const b = await readBody<any>(req); const s = await get(b); return (b.needle && b.text) ? json({ ok: true, data: s.memory.updateLearning(b.needle, b.text) }) : badRequest("needle+text required"); });
  r.set("POST /api/memory/update-preference", async (req) => { const b = await readBody<any>(req); const s = await get(b); return (b.needle && b.text) ? json({ ok: true, data: s.memory.updatePreference(b.needle, b.text, b.category) }) : badRequest("needle+text required"); });
  r.set("POST /api/memory/delete-learning", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.needle ? json({ ok: true, data: s.memory.deleteLearning(b.needle) }) : badRequest("needle required"); });
  r.set("POST /api/memory/delete-preference", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.needle ? json({ ok: true, data: s.memory.deletePreference(b.needle) }) : badRequest("needle required"); });
  r.set("POST /api/memory/reinforce", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.needle ? json({ ok: true, data: s.memory.reinforce(b.needle) }) : badRequest("needle required"); });
  r.set("POST /api/memory/search", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.query ? json({ ok: true, data: await s.memory.search(b.query) }) : badRequest("query required"); });
  r.set("POST /api/memory/scenario/write", async (req) => {
    const b = await readBody<any>(req);
    const s = await get(b);
    return (b.title && b.guidance)
      ? json({ ok: true, data: s.memory.scenarios.write({ title: b.title, guidance: b.guidance, triggers: b.triggers, evidence: b.evidence, scope: b.scope }) })
      : badRequest("title+guidance required");
  });
  r.set("POST /api/memory/scenario/list", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.scenarios.list() }); });
  r.set("POST /api/memory/scenario/read", async (req) => { const b = await readBody<any>(req); const s = await get(b); if (!b.id) return badRequest("id required"); const result = s.memory.scenarios.read(b.id); return result ? json({ ok: true, data: result }) : notFound("Scenario not found"); });
  r.set("POST /api/memory/scenario/search", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.query ? json({ ok: true, data: s.memory.scenarios.search(b.query, { maxResults: b.maxResults, minScore: b.minScore }) }) : badRequest("query required"); });
  r.set("POST /api/memory/list", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.list() }); });
  r.set("POST /api/memory/consolidate", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.consolidate() }); });
  r.set("POST /api/memory/repair", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.repair(true) }); });
  r.set("POST /api/memory/conflicts", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.detectConflicts() }); });
  r.set("POST /api/memory/log", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.memory.getLog() }); });
  r.set("POST /api/memory/export", async (req) => { const b = await readBody<any>(req); const s = await get(b); const role = s.getActiveRole(); if (!role) return badRequest("No active role"); const html = s.memory.exportHtml(b.path); return json({ ok: true, data: { bytes: html.length } }); });
  r.set("POST /api/memory/extract", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: await s.memory.autoExtract(b.messages || []) }); });
  r.set("POST /api/memory/tidy", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: await s.memory.tidyLlm(b.model) }); });

  // ── Knowledge ──
  r.set("POST /api/knowledge/list", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: s.knowledge.list(b.category) }); });
  r.set("POST /api/knowledge/search", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.query ? json({ ok: true, data: s.knowledge.search(b.query, { tags: b.tags }) }) : badRequest("query required"); });
  r.set("POST /api/knowledge/read", async (req) => { const b = await readBody<any>(req); const s = await get(b); if (!b.path) return badRequest("path required"); const result = s.knowledge.read(b.path); return result ? json({ ok: true, data: result }) : notFound("Not found"); });
  r.set("POST /api/knowledge/write", async (req) => { const b = await readBody<any>(req); const s = await get(b); return b.title ? json({ ok: true, data: s.knowledge.write(b) }) : badRequest("title required"); });

  // ── Embedding ──
  r.set("POST /api/embedding/stats", async (req) => {
    const b = await readBody<any>(req);
    const s = await get(b);
    const stats = await s.embedding.stats();
    return json({
      ok: true,
      data: stats ?? { enabled: s.getConfig().vectorMemory.enabled, active: false, model: null, dim: null, count: 0, dbPath: null },
    });
  });
  r.set("POST /api/embedding/rebuild", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: await s.embedding.rebuild() }); });

  // ── File Operations ──
  r.set("POST /api/file/read", async (req) => {
    const b = await readBody<any>(req);
    if (!b.path) return badRequest("path required");
    try {
      const s = await get(b);
      const role = s.getActiveRole();
      if (!role) return badRequest("No active role");
      const fullPath = join(role.path, b.path);
      if (!fullPath.startsWith(role.path)) return forbidden("Path escape blocked");
      if (!existsSync(fullPath)) return notFound("File not found");
      const content = readFileSync(fullPath, "utf-8");
      return json({ ok: true, data: { path: b.path, content, size: content.length } });
    } catch (e) { return errResponse(e); }
  });
  r.set("POST /api/file/write", async (req) => {
    const b = await readBody<any>(req);
    if (!b.path || b.content === undefined) return badRequest("path+content required");
    try {
      const s = await get(b);
      const role = s.getActiveRole();
      if (!role) return badRequest("No active role");
      const fullPath = join(role.path, b.path);
      if (!fullPath.startsWith(role.path)) return forbidden("Path escape blocked");
      writeFileSync(fullPath, b.content, "utf-8");
      return json({ ok: true, data: { path: b.path, size: b.content.length } });
    } catch (e) { return errResponse(e); }
  });
  r.set("POST /api/file/list", async (req) => {
    const b = await readBody<any>(req);
    try {
      const s = await get(b);
      const role = s.getActiveRole();
      if (!role) return badRequest("No active role");
      const fullDir = join(role.path, b.dir || "");
      if (!fullDir.startsWith(role.path)) return forbidden("Path escape blocked");
      if (!existsSync(fullDir)) return notFound("Directory not found");

      const scanDir = (dir: string, rel: string): any[] => {
        return readdirSync(dir, { withFileTypes: true })
          .filter(e => !e.name.startsWith(".") && e.name !== "node_modules")
          .flatMap(e => {
            const p = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
              if (b.recursive) {
                return [{ name: e.name, isDir: true, path: p, children: scanDir(join(dir, e.name), p) }];
              }
              return [{ name: e.name, isDir: true, path: p }];
            }
            return [{ name: e.name, isDir: false, path: p }];
          })
          .sort((a, b2) => {
            if (a.isDir !== b2.isDir) return a.isDir ? -1 : 1;
            return b2.name.localeCompare(a.name);
          });
      };

      return json({ ok: true, data: scanDir(fullDir, b.dir || "") });
    } catch (e) { return errResponse(e); }
  });

  // ── Models ──
  r.set("GET /api/models", async () => {
    try {
      const modelsPath = join(homedir(), ".pi", "agent", "models.json");
      if (!existsSync(modelsPath)) return json({ ok: true, data: { providers: {} } });
      const raw = readFileSync(modelsPath, "utf-8");
      const data = JSON.parse(raw);
      // Flatten to list of {provider, model, name, contextWindow}
      const models: any[] = [];
      for (const [provName, prov] of Object.entries(data.providers || {})) {
        for (const m of (prov as any).models || []) {
          models.push({ provider: provName, model: m.id, name: m.name, contextWindow: m.contextWindow, maxTokens: m.maxTokens });
        }
      }
      return json({ ok: true, data: { models, raw: data } });
    } catch (e) { return errResponse(e); }
  });

  // ── Config ──
  r.set("POST /api/config/read", async () => {
    try {
      const configPath = join(homedir(), ".pi", "roles", "pi-role-persona.jsonc");
      if (!existsSync(configPath)) return json({ ok: true, data: { path: configPath, content: "{}" } });
      return json({ ok: true, data: { path: configPath, content: readFileSync(configPath, "utf-8") } });
    } catch (e) { return errResponse(e); }
  });
  r.set("POST /api/config/write", async (req) => {
    const b = await readBody<any>(req);
    if (!b.content) return badRequest("content required");
    try {
      const configPath = join(homedir(), ".pi", "roles", "pi-role-persona.jsonc");
      writeFileSync(configPath, b.content, "utf-8");
      return json({ ok: true, data: { path: configPath, size: b.content.length } });
    } catch (e) { return errResponse(e); }
  });

  // ── Activity Analytics (from JSONL logs) ──
  r.set("POST /api/activity/stats", async (req) => {
    try {
      const b = await readBody<any>(req);
      const days = Math.min(b.days || 7, 30);
      const rolesDir = join(homedir(), ".pi", "roles");
      const logDir = join(rolesDir, ".log");
      if (!existsSync(logDir)) return json({ ok: true, data: { tags: {}, hourly: {}, roles: {}, extract: { runs: 0, learnings: 0, preferences: 0, errors: 0 }, checkpoints: 0, recentEvents: [] } });

      const files = readdirSync(logDir)
        .filter((name: string) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .sort()
        .slice(-days);

      const tags: Record<string, number> = {};
      const hourly: Record<string, number> = {};
      const roles: Record<string, number> = {};
      const extract = { runs: 0, learnings: 0, preferences: 0, errors: 0, filtered: 0 };
      let checkpoints = 0;
      const recentEvents: Array<{ time: string; tag: string; message: string; role: string; ts: number }> = [];
      const recentN = Math.min(b.recentLimit || 20, 100);

      for (const file of files) {
        const filePath = join(logDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const j = JSON.parse(line);
              const tag = j.tag || "";
              const msg = j.message || "";
              const ctx = j.context || {};
              const ts = j.epoch_ms || (j.timestamp ? new Date(j.timestamp).getTime() : 0);
              const hour = j.timestamp ? j.timestamp.substring(11, 13) : "??";
              const role = ctx.role || "-";

              tags[tag] = (tags[tag] || 0) + 1;
              if (hour !== "??") hourly[hour] = (hourly[hour] || 0) + 1;
              if (role !== "-") roles[role] = (roles[role] || 0) + 1;

              if (tag === "auto-extract") {
                if (msg.includes("start")) extract.runs++;
                const lMatch = msg.match(/(\d+) learnings/);
                const pMatch = msg.match(/(\d+) preferences/);
                if (lMatch) extract.learnings += parseInt(lMatch[1], 10);
                if (pMatch) extract.preferences += parseInt(pMatch[1], 10);
                if (/(error|fail|abort)/i.test(msg)) extract.errors++;
                if (msg.includes("filtered")) extract.filtered++;
              }
              if (tag === "checkpoint") checkpoints++;

              // Collect recent events for the last entries
              if (ts > 0) {
                const d = new Date(ts);
                const time = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
                recentEvents.push({ time, tag, message: msg.slice(0, 120), role, ts });
              }
            } catch {}
          }
        } catch {}
      }

      // Sort and keep recent
      recentEvents.sort((a, b2) => b2.ts - a.ts);
      const trimmedRecent = recentEvents.slice(0, recentN);

      return json({
        ok: true,
        data: { tags, hourly, roles, extract, checkpoints, recentEvents: trimmedRecent, days, files: files.length },
      });
    } catch (e) { return errResponse(e); }
  });

  // ── Prompt ──
  r.set("POST /api/prompt", async (req) => { const b = await readBody<any>(req); const s = await get(b); return json({ ok: true, data: { prompt: await s.buildSystemPrompt(b.base || "You are an AI assistant.") } }); });

  // ── Shutdown ──
  r.set("POST /api/shutdown", async () => { setTimeout(() => { removePid(); process.exit(0); }, 100); return json({ ok: true, data: { shutting_down: true } }); });

  return r;
}

// ── Start ──

export interface DaemonOptions {
  port?: number;
  background?: boolean;
}

export function startDaemon(opts: DaemonOptions = {}) {
  const existingPid = readPid();
  if (existingPid) {
    console.error(`[daemon] already running (pid ${existingPid}). Kill it first: kill ${existingPid}`);
    process.exit(1);
  }

  const port = opts.port ?? DEFAULT_PORT;
  const config = loadConfig();
  const mgr = new ServiceManager({
    config,
    llm: createDaemonLlmCaller(),
    modelRegistry: createDaemonModelRegistry(),
    currentModel: null,
    apiKeyResolver: createDaemonApiKeyResolver(),
  });
  const routes = buildRoutes(mgr);

  const server = Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/")) {
        const routeKey = `${req.method} ${path}`;
        const handler = routes.get(routeKey);
        if (!handler) return notFound(`Not found: ${routeKey}`);
        try { return await handler(req); } catch (e) { return errResponse(e); }
      }

      if (req.method !== "GET" && req.method !== "HEAD") return notFound(`Not found: ${req.method} ${path}`);
      return serveStatic(req);
    },
  });

  writePid(process.pid);
  writePort(server.port);

  const shutdown = () => {
    console.log("[daemon] shutting down...");
    removePid();
    mgr.dispose().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`[role-persona daemon] pid=${process.pid} http://localhost:${server.port}`);
  console.log(`[role-persona daemon] web=http://localhost:${server.port}`);
  console.log(`[role-persona daemon] static=${DEFAULT_STATIC_DIR}`);
  console.log(`[role-persona daemon] pidfile=${PID_FILE}`);
  console.log(`[role-persona daemon] stop: kill ${process.pid} or POST /api/shutdown`);

  return { server, mgr };
}

// ── Background spawn ──

export async function startDaemonBackground(port = DEFAULT_PORT): Promise<{ ok: boolean; pid?: number; error?: string }> {
  if (isDaemonRunning()) {
    const pid = readPid()!;
    return { ok: true, pid, error: `already running (pid ${pid})` };
  }

  const proc = spawn("bun", [join(import.meta.dir || ".", "../transport/daemon.ts"), "--port", String(port)], {
    detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.unref();

  return new Promise((resolve) => {
    let resolved = false;
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("pid=") && !resolved) { resolved = true; resolve({ ok: true, pid: readPid() || proc.pid }); }
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("already running") && !resolved) { resolved = true; resolve({ ok: false, error: "already running" }); }
    });
    setTimeout(() => { if (!resolved) { resolved = true; resolve({ ok: false, error: "timeout" }); } }, 5000);
  });
}

// ── Direct run ──
if (import.meta.main) {
  const portArg = process.argv.find((a) => a.startsWith("--port"));
  const port = portArg ? parseInt(process.argv[process.argv.indexOf(portArg) + 1] || "3939") : DEFAULT_PORT;
  const bg = process.argv.includes("--background");
  if (bg) { const r = startDaemonBackground(port); console.log(JSON.stringify(r)); }
  else startDaemon({ port });
}
