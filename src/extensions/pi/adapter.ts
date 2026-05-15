/**
 * Pi Extension Plugin — direct service layer calls, ZERO CLI dependency.
 *
 * Architecture:
 *   plugin.ts (this file) ← Pi ExtensionAPI
 *     ↓ direct import
 *   service/ ← core/
 *     ↑
 *   @mariozechner/pi-ai (complete/completeSimple)
 *   @mariozechner/pi-coding-agent (convertToLlm/serializeConversation)
 *
 * All LLM calls use Pi SDK directly. No subprocess, no daemon HTTP.
 * Error handling: retry (3x), timeout (30s default), result validation.
 */

// Pi SDK imports — resolved from pi-mono at runtime
import { homedir } from "node:os";
import { join } from "node:path";

const PI_MONO = join(homedir(), ".pi", "pi-mono", "packages");

// Lazy-loaded Pi SDK modules
let _piAi: any = null;
let _piCodingAgent: any = null;
let _typebox: any = null;

async function getPiAi() {
  if (!_piAi) {
    try { _piAi = await import(join(PI_MONO, "ai", "src", "index.ts")); }
    catch { _piAi = await import("@mariozechner/pi-ai"); }
  }
  return _piAi;
}
async function getPiCodingAgent() {
  if (!_piCodingAgent) {
    try { _piCodingAgent = await import(join(PI_MONO, "coding-agent", "src", "index.ts")); }
    catch { _piCodingAgent = await import("@mariozechner/pi-coding-agent"); }
  }
  return _piCodingAgent;
}
async function getTypebox() {
  if (!_typebox) {
    try { _typebox = await import("@sinclair/typebox"); }
    catch { _typebox = { Type: { Object: (...a: any[]) => ({}), Optional: (t: any) => t, String: () => "string", Number: () => "number", Boolean: () => "boolean", Array: (t: any) => [t], Literal: (v: any) => v, Union: (t: any) => t[0] } }; }
  }
  return _typebox;
}

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model, Api, AssistantMessage } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

import type {
  LlmCaller,
  LlmCompletionResult,
  ModelRegistry,
  ModelInfo,
  ApiKeyResolver,
  Message,
} from "../../core/types.ts";
import { setSessionId } from "../../core/logger.ts";

import { createService, type RolePersonaService, type ServiceOptions } from "../../service/index.ts";
import { loadConfig } from "../../core/config.ts";

// Pi TUI imports
let _tui: any = null;
async function getTui() {
  if (!_tui) {
    try { _tui = await import("@mariozechner/pi-tui"); } catch { _tui = {}; }
  }
  return _tui;
}

// ── Error Handling ──────────────────────────────────────────────────────

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        opts.onRetry?.(attempt + 1, lastError);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError!;
}

function safeError(ctx: ExtensionContext | undefined, scope: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  try { console.error(`[role-persona:${scope}]`, msg); } catch {}
  try {
    if (ctx?.hasUI && ctx.ui?.notify) {
      ctx.ui.notify(`${scope}: ${msg}`, "error" as any);
    }
  } catch {}
}

async function runWithSafety<T>(
  ctx: ExtensionContext | undefined,
  scope: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    safeError(ctx, scope, error);
    return null;
  }
}

// ── Pi SDK Bridge: LlmCaller ────────────────────────────────────────────

async function createLlmCaller(): Promise<LlmCaller> {
  const piAi = await getPiAi();
  const codingAgent = await getPiCodingAgent();

  return {
    async complete(model, request, options) {
      const piModel = model as unknown as Model<Api>;
      const ctx = {
        messages: request.messages.map((m) => ({
          role: m.role as "user",
          content: m.content.map((c) => ({ type: c.type as "text", text: c.text })),
          timestamp: m.timestamp,
        })),
      };
      const result: AssistantMessage = await piAi.complete(piModel, ctx, {
        apiKey: options.apiKey,
        maxTokens: options.maxTokens,
      });
      return {
        content: result.content.map((c: any) => ({
          type: c.type,
          text: c.text,
          thinking: c.thinking,
        })),
        stopReason: result.stopReason,
        errorMessage: result.errorMessage,
      } as LlmCompletionResult;
    },

    convertToLlm(messages: unknown[]) {
      return codingAgent.convertToLlm(messages as any).map((m: any) => ({
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map((c: any) => ({ type: c.type || "text", text: c.text }))
          : [{ type: "text", text: String(m.content || "") }],
      }));
    },

    serializeConversation(messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>) {
      return codingAgent.serializeConversation(messages as any);
    },
  };
}

// ── Pi SDK Bridge: ModelRegistry adapter ─────────────────────────────────

function createModelRegistryAdapter(ctx: ExtensionContext): ModelRegistry {
  const registry = ctx.modelRegistry as any;
  return {
    getAll(): ModelInfo[] {
      try {
        const all = registry.getAll?.() || [];
        return all.map((m: any) => ({
          provider: m.provider || "",
          id: m.id || "",
          name: m.name,
          maxTokens: m.maxTokens,
          contextWindow: m.contextWindow,
          api: m.api,
          baseUrl: m.baseUrl,
        }));
      } catch {
        return [];
      }
    },
    async getApiKeyAndHeaders(model: ModelInfo) {
      try {
        const auth = await registry.getApiKeyAndHeaders(model);
        return { ok: auth.ok ?? !!auth.apiKey, apiKey: auth.apiKey };
      } catch {
        return { ok: false };
      }
    },
  };
}

// ── Pi SDK Bridge: ApiKeyResolver ─────────────────────────────────────────

function createApiKeyResolver(ctx: ExtensionContext): ApiKeyResolver {
  const registry = ctx.modelRegistry as any;
  return {
    async resolve(provider?: string): Promise<string | null> {
      try {
        if (registry.getApiKeyForProvider) {
          const key = await registry.getApiKeyForProvider(provider || "openai");
          if (key) return key;
        }
        // Fallback: find any model from the provider and get its key
        const all = registry.getAll?.() || [];
        const target = provider
          ? all.find((m: any) => m.provider === provider)
          : all.find((m: any) => m.provider === "openai");
        if (target) {
          const auth = await registry.getApiKeyAndHeaders(target);
          if (auth.ok && auth.apiKey) return auth.apiKey;
        }
      } catch {}
      return process.env.OPENAI_API_KEY || null;
    },
  };
}

// ── Service Lifecycle ────────────────────────────────────────────────────

let _service: RolePersonaService | null = null;
let _serviceReady = false;

async function getService(ctx: ExtensionContext): Promise<RolePersonaService | null> {
  if (_service && _serviceReady) return _service;

  try {
    const config = loadConfig();
    const llmCaller = await createLlmCaller();
    const modelRegistry = createModelRegistryAdapter(ctx);
    const apiKeyResolver = createApiKeyResolver(ctx);
    const currentModel = ctx.model
      ? {
          provider: ctx.model.provider || "",
          id: ctx.model.id || "",
          name: (ctx.model as any).name,
          maxTokens: ctx.model.maxTokens,
        }
      : null;

    const opts: ServiceOptions = {
      config,
      llm: llmCaller,
      modelRegistry,
      currentModel,
      apiKeyResolver,
    };

    _service = createService(opts);
    await _service.init(ctx.cwd);
    _serviceReady = true;
    return _service;
  } catch (err) {
    safeError(ctx, "service-init", err);
    return null;
  }
}

async function disposeService(): Promise<void> {
  if (_service) {
    try {
      await _service.dispose();
    } catch {}
    _service = null;
    _serviceReady = false;
  }
}

// ── Tool Result Helpers ─────────────────────────────────────────────────

function toolOk(data: any, message?: string) {
  const text = message || (typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return { content: [{ type: "text" as const, text }], details: data };
}

function toolErr(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

// ── Shared state ──
let memoryDistillMode: { active: boolean; requestedModel?: string } | null = null;

// ── Tool Registration ────────────────────────────────────────────────────

function registerTools(pi: ExtensionAPI) {
  // ── memory ──
  pi.registerTool({
    name: "memory",
    label: "Role Memory",
    description:
      "Manage role memory. Actions: add_learning, add_preference, update_learning, update_preference, delete_learning, delete_preference, reinforce, search, list, consolidate, repair, llm_tidy, vector_rebuild, vector_stats.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("add_learning"),
        Type.Literal("add_preference"),
        Type.Literal("update_learning"),
        Type.Literal("update_preference"),
        Type.Literal("delete_learning"),
        Type.Literal("delete_preference"),
        Type.Literal("reinforce"),
        Type.Literal("search"),
        Type.Literal("list"),
        Type.Literal("consolidate"),
        Type.Literal("repair"),
        Type.Literal("llm_tidy"),
        Type.Literal("vector_rebuild"),
        Type.Literal("vector_stats"),
      ]),
      content: Type.Optional(Type.String()),
      category: Type.Optional(Type.String()),
      query: Type.Optional(Type.String()),
      id: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: Record<string, any>, _signal?: any, _onUpdate?: any, ctx?: any) {
      try {
        const service = await getService(ctx);
        if (!service) return toolErr("Service not initialized");
        const mem = service.memory;

        switch (params.action) {
          case "add_learning": {
            const r = await withRetry(() => mem.addLearning(params.content));
            return toolOk(r, r.stored ? `Stored: ${r.text || params.content}` : `Skipped: ${r.reason}`);
          }
          case "add_preference": {
            const r = mem.addPreference(params.content, params.category);
            return toolOk(r, r.stored ? `Stored preference` : `Skipped: ${r.reason}`);
          }
          case "update_learning": {
            const r = mem.updateLearning(params.id || params.query, params.content);
            return toolOk(r, r.updated ? "Updated" : `Not updated: ${r.reason}`);
          }
          case "update_preference": {
            const r = mem.updatePreference(params.id || params.query, params.content, params.category);
            return toolOk(r, r.updated ? "Updated" : `Not updated: ${r.reason}`);
          }
          case "delete_learning": {
            const r = mem.deleteLearning(params.id || params.query || params.content);
            return toolOk(r, r.deleted ? "Deleted" : `Not deleted: ${r.reason}`);
          }
          case "delete_preference": {
            const r = mem.deletePreference(params.id || params.query || params.content);
            return toolOk(r, r.deleted ? "Deleted" : `Not deleted: ${r.reason}`);
          }
          case "reinforce": {
            const r = mem.reinforce(params.id || params.query || params.content);
            return toolOk(r, r.updated ? `Reinforced (used: ${r.used})` : "Not found");
          }
          case "search": {
            const r = await withRetry(() => mem.search(params.query || params.content));
            return toolOk(r, `${r.length} matches`);
          }
          case "list": {
            const r = mem.list();
            return toolOk(r);
          }
          case "consolidate": {
            const r = mem.consolidate();
            return toolOk(r, `L: ${r.beforeLearnings}→${r.afterLearnings}, P: ${r.beforePreferences}→${r.afterPreferences}`);
          }
          case "repair": {
            const r = mem.repair(true);
            return toolOk(r, r.repaired ? `Repaired ${r.issues} issues` : "No issues");
          }
          case "llm_tidy": {
            const r = await withRetry(() => mem.tidyLlm(params.model), { timeoutMs: 120_000, maxRetries: 1 });
            return toolOk(r);
          }
          case "vector_rebuild": {
            const r = await withRetry(() => mem.vector.rebuild());
            return toolOk(r, `Indexed ${r.indexed}/${r.total}`);
          }
          case "vector_stats": {
            const r = await mem.vector.stats();
            return toolOk(r);
          }
          default:
            return toolErr(`Unknown action: ${params.action}`);
        }
      } catch (error) {
        return toolErr(`memory tool failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  // ── knowledge ──
  pi.registerTool({
    name: "knowledge",
    label: "Knowledge Base",
    description: "Searchable knowledge base. Actions: list, search, read, write.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("search"),
        Type.Literal("read"),
        Type.Literal("write"),
      ]),
      query: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      category: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      content: Type.Optional(Type.String()),
      scope: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: Record<string, any>, _signal?: any, _onUpdate?: any, ctx?: any) {
      try {
        const service = await getService(ctx);
        if (!service) return toolErr("Service not initialized");
        const kb = service.knowledge;

        switch (params.action) {
          case "list": {
            const r = kb.list(params.category);
            return toolOk(r, `${r.totalEntries} entries`);
          }
          case "search": {
            const r = kb.search(params.query, { tags: params.tags, category: params.category });
            return toolOk(r, `${r.length} results`);
          }
          case "read": {
            const r = kb.read(params.path);
            return r ? toolOk(r) : toolErr(`Not found: ${params.path}`);
          }
          case "write": {
            const r = kb.write({
              title: params.title || "Untitled",
              description: params.description,
              content: params.content || "",
              category: params.category,
              tags: params.tags,
              scope: params.scope,
            });
            return toolOk(r, `${r.isNew ? "Created" : "Updated"} v${r.version}`);
          }
          default:
            return toolErr(`Unknown action: ${params.action}`);
        }
      } catch (error) {
        return toolErr(`knowledge tool failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });

  // ── role_info ──
  pi.registerTool({
    name: "role_info",
    label: "Role Info",
    description: "Get the active role directory structure.",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
      recursive: Type.Optional(Type.Boolean()),
      maxEntries: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId: string, _params: Record<string, any>, _signal?: any, _onUpdate?: any, ctx?: any) {
      try {
        const service = await getService(ctx);
        if (!service) return toolErr("Service not initialized");
        const role = service.getActiveRole();
        if (!role) return toolErr("No active role");
        const listing = service.role.getStructure(role.path);
        return toolOk(listing);
      } catch (error) {
        return toolErr(`role_info failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
}

// ── Command Registration ─────────────────────────────────────────────────

function notify(ctx: ExtensionContext | undefined, message: string, level?: string) {
  try {
    if (ctx?.hasUI && ctx.ui?.notify) ctx.ui.notify(message, level as any);
  } catch {}
}

function msg(pi: ExtensionAPI, customType: string, content: string) {
  pi.sendMessage({ customType, content, display: true }, { triggerTurn: false });
}

function registerCommands(pi: ExtensionAPI) {
  function safeCommand(name: string, spec: any) {
    const handler = spec.handler;
    pi.registerCommand(name, {
      ...spec,
      handler: async (args: string, ctx: ExtensionContext) => {
        await runWithSafety(ctx, `/${name}`, () => handler(args, ctx));
      },
    });
  }

  // ── /role ──
  safeCommand("role", {
    description: "Role management: /role info | create | map | unmap | list",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const argv = (args || "").trim().split(/\s+/);
      const cmd = argv[0] || "info";
      const cwd = ctx.cwd || process.cwd();

      switch (cmd) {
        case "info": {
          const role = service.getActiveRole();
          if (!role) { notify(ctx, "No active role", "warning"); return; }
          const identity = service.role.getIdentity(role.path);
          let info = `## Role Info\n\n`;
          info += `**Name**: ${role.name}\n`;
          info += `**Display**: ${identity?.name || "unset"}\n`;
          info += `**Path**: ${role.path}\n`;
          info += `**First Run**: ${role.isFirstRun ? "Yes" : "No"}\n`;
          msg(pi, "role-info", info);
          break;
        }
        case "create": {
          let name = argv[1];
          if (!name && ctx.hasUI) {
            // TUI: show preset role names
            const tui = await getTui();
            if (tui.SelectList) {
              const presets = ["architect", "backend", "frontend", "reviewer", "mentor", "assistant"];
              const items = [
                { value: "__custom__", label: "+ 自定义名称", description: "输入任意角色名" },
                ...presets.map((n) => ({ value: n, label: n, description: "预设建议" })),
              ];
              const selected = await (ctx.ui.custom as any)((_tuiInst: any, theme: any, _kb: any, done: any) => {
                const { Container, Text } = tui;
                const container = new Container();
                container.addChild(new Text(theme.fg("accent", theme.bold("创建角色"))));
                container.addChild(new Text(theme.fg("muted", "先上下选择，再回车确认")));
                container.addChild(new Text(""));
                const selectList = new tui.SelectList(items, Math.min(items.length, 10), {
                  selectedPrefix: (text: string) => theme.fg("accent", text),
                  selectedText: (text: string) => theme.fg("accent", theme.bold(text)),
                  description: (text: string) => theme.fg("dim", text),
                });
                selectList.onSelect = (item: any) => done(item.value);
                selectList.onCancel = () => done(null);
                container.addChild(selectList);
                return {
                  render(width: number) { return container.render(width); },
                  invalidate() { container.invalidate(); },
                  handleInput(data: string) { selectList.handleInput(data); _tui.requestRender(); },
                };
              }, { overlay: true, overlayOptions: { anchor: "center", width: "60%", maxHeight: "80%" } });

              if (!selected) { notify(ctx, "已取消创建", "info"); return; }
              if (selected === "__custom__") {
                name = await (ctx.ui as any).input("新角色名称:", "my-assistant");
                if (!name?.trim()) { notify(ctx, "已取消", "info"); return; }
                name = name.trim();
              } else {
                name = selected;
              }
            }
          }
          if (!name) { notify(ctx, "Usage: /role create <name>", "warning"); return; }
          const r = service.role.create(name);
          if (r.ok) {
            service.role.map(cwd, name);
            notify(ctx, `Created & mapped: ${name}`, "success");
          } else {
            notify(ctx, `Role exists: ${name}`, "warning");
          }
          break;
        }
        case "map": {
          let name = argv[1];
          if (!name && ctx.hasUI) {
            // TUI: show role list selector
            const tui = await getTui();
            if (tui.SelectList) {
              const roles = service.role.list();
              const items = roles.map((rName) => {
                const rPath = join(service.getRolesDir(), rName);
                const identity = service.role.getIdentity(rPath);
                return {
                  value: rName,
                  label: identity?.name ? `${rName} (${identity.name})` : rName,
                  description: "已配置",
                };
              });
              const selected = await (ctx.ui.custom as any)((_tuiInst: any, theme: any, _kb: any, done: any) => {
                const { Container, Text } = tui;
                const container = new Container();
                container.addChild(new Text(theme.fg("accent", theme.bold("选择角色"))));
                container.addChild(new Text(theme.fg("muted", "将当前目录映射到选中角色")));
                container.addChild(new Text(""));
                const selectList = new tui.SelectList(items, Math.min(items.length, 10), {
                  selectedPrefix: (text: string) => theme.fg("accent", text),
                  selectedText: (text: string) => theme.fg("accent", theme.bold(text)),
                  description: (text: string) => theme.fg("dim", text),
                });
                selectList.onSelect = (item: any) => done(item.value);
                selectList.onCancel = () => done(null);
                container.addChild(selectList);
                return {
                  render(width: number) { return container.render(width); },
                  invalidate() { container.invalidate(); },
                  handleInput(data: string) { selectList.handleInput(data); _tui.requestRender(); },
                };
              }, { overlay: true, overlayOptions: { anchor: "center", width: "60%", maxHeight: "80%" } });

              if (!selected) { notify(ctx, "已取消映射", "info"); return; }
              name = selected;
            }
          }
          if (!name) { notify(ctx, "Usage: /role map <name>", "warning"); return; }
          const r = service.role.map(cwd, name);
          notify(ctx, r.ok ? `Mapped: ${cwd} → ${name}` : "Map failed", r.ok ? "success" : "error");
          break;
        }
        case "unmap": {
          const r = service.role.unmap(cwd);
          notify(ctx, r.ok ? "Unmapped" : "Unmap failed", r.ok ? "info" : "error");
          break;
        }
        case "list": {
          const roles = service.role.list();
          let info = `## Roles (${roles.length})\n\n`;
          for (const name of roles) {
            info += `- ${name}\n`;
          }
          msg(pi, "role-list", info);
          break;
        }
        default:
          notify(ctx, `Unknown: ${cmd}`, "error");
      }
    },
  });

  // ── /memories ──
  safeCommand("memories", {
    description: "View role memory: /memories [tui] — tui for terminal viewer, default starts HTTP server",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const role = service.getActiveRole();
      if (!role) { notify(ctx, "No active role", "warning"); return; }

      const mode = (args || "").trim().toLowerCase();

      // /memories tui — terminal viewer
      if (mode === "tui" && ctx.hasUI) {
        try {
          const tui = await getTui();
          if (tui.RoleMemoryViewerComponent) {
            await (ctx.ui.custom as any)(
              (tuiInst: any, theme: any, _kb: any, done: any) =>
                new tui.RoleMemoryViewerComponent(role.path, role.name, tuiInst, theme, done),
              { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "95%" } }
            );
          } else {
            notify(ctx, "TUI viewer not available", "warning");
          }
        } catch {
          notify(ctx, "TUI viewer failed", "warning");
        }
        return;
      }

      // Default: start HTTP server + notify URL
      try {
        const { openMemoryServer } = await import("../../transport/memory-server.ts");
        const handle = await openMemoryServer(role.path, role.name);
        notify(ctx, `Memory server: ${handle.url} (port ${handle.port})`, "success");
      } catch {
        // Fallback: plain text list
        const list = service.memory.list();
        msg(pi, "memories", list.text);
      }
    },
  });

  // ── /memory-log ──
  safeCommand("memory-log", {
    description: "Session memory log",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const log = service.memory.getLog();
      if (!log.length) { notify(ctx, "No memory operations this session", "info"); return; }
      const stored = log.filter((e) => e.stored).length;
      let output = `## Memory Log — ${log.length} ops (✓${stored} / ✗${log.length - stored})\n\n`;
      for (const e of log) {
        const icon = e.stored ? "✓" : "✗";
        output += `- ${icon} **${e.op}**: ${e.content.slice(0, 80)}${e.detail ? ` — ${e.detail}` : ""}\n`;
      }
      msg(pi, "memory-log", output);
    },
  });

  // ── /memory-fix ──
  safeCommand("memory-fix", {
    description: "Repair consolidated.md",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const r = service.memory.repair(true);
      notify(ctx, r.repaired ? `Repaired ${r.issues} issues` : "No issues", r.repaired ? "success" : "info");
    },
  });

  // ── /memory-tidy ──
  safeCommand("memory-tidy", {
    description: "Manual memory consolidation",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const r = service.memory.consolidate();
      notify(ctx, `Consolidated: L ${r.beforeLearnings}→${r.afterLearnings}, P ${r.beforePreferences}→${r.afterPreferences}`, "success");
    },
  });

  // ── /memory-tidy-llm ──
  safeCommand("memory-tidy-llm", {
    description: "LLM-guided memory tidy",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      notify(ctx, "LLM tidy running...", "info");
      const r = await service.memory.tidyLlm(args?.trim() || undefined);
      if ("error" in r) { notify(ctx, `LLM tidy failed: ${r.error}`, "error"); return; }
      const summary = [`LLM tidy done`, `- model: ${r.model}`, `- L: ${r.apply.beforeLearnings}→${r.apply.afterLearnings}`, `- P: ${r.apply.beforePreferences}→${r.apply.afterPreferences}`].join("\n");
      notify(ctx, "LLM tidy complete", "success");
      msg(pi, "memory-tidy-llm", summary);
    },
  });

  // ── /memory-vector ──
  safeCommand("memory-vector", {
    description: "Vector memory: /memory-vector stats | rebuild",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const sub = (args || "").trim().toLowerCase() || "stats";
      if (sub === "rebuild") {
        notify(ctx, "Rebuilding vector index...", "info");
        const r = await service.memory.vector.rebuild();
        notify(ctx, `Indexed ${r.indexed}/${r.total}`, "success");
        return;
      }
      const stats = await service.memory.vector.stats();
      msg(pi, "memory-vector-stats", `Vector: ${JSON.stringify(stats, null, 2)}`);
    },
  });

  // ── /memory-export ──
  safeCommand("memory-export", {
    description: "Export memory to HTML",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      service.memory.exportHtml();
      notify(ctx, "Memory exported", "success");
    },
  });

  // ── /memory-conflicts ──
  safeCommand("memory-conflicts", {
    description: "Detect memory conflicts",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const r = service.memory.detectConflicts();
      if (r.conflicts.length === 0) {
        notify(ctx, "No conflicts", "success");
      } else {
        let output = `## Conflicts (${r.conflicts.length})\n\n`;
        for (const c of r.conflicts) {
          output += `- **${c.type}** (${c.items[0]?.text} vs ${c.items[1]?.text})\n  ${c.suggestion}\n\n`;
        }
        msg(pi, "memory-conflicts", output);
      }
    },
  });

  // ── /memory-distill ──
  safeCommand("memory-distill", {
    description: "Enable interactive LLM-guided memory→knowledge distillation",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const role = service.getActiveRole();
      if (!role) { notify(ctx, "No active role", "warning"); return; }

      const requestedModel = (args || "").trim() || undefined;
      memoryDistillMode = { active: true, requestedModel };

      const intro = [
        `# Memory Distill Mode — ${role.name}`,
        "",
        "已进入基于 LLM 的交互式蒸馏模式。",
        "",
        "下一轮开始，模型会：",
        "- 读取当前角色的 memory / knowledge 状态",
        "- 必要时先向你提几个高价值问题",
        "- 再给出 memory→knowledge 晋升提案",
        "",
        "建议你下一条直接说：",
        "- '开始蒸馏'",
        "- 或补充你关心的范围",
        "",
        `模型提示偏好: ${requestedModel || "(当前会话模型)"}`,
        "",
        "退出方式：/memory-distill-stop",
      ].join("\n");

      msg(pi, "memory-distill", intro);
      notify(ctx, `已启用 ${role.name} 的交互式 memory-distill 模式`, "success");
    },
  });

  // ── /memory-distill-stop ──
  safeCommand("memory-distill-stop", {
    description: "Disable interactive memory→knowledge distillation mode",
    handler: async (_args: string, ctx: ExtensionContext) => {
      memoryDistillMode = null;
      notify(ctx, "已关闭 memory-distill 模式", "success");
    },
  });

  // ── /memory-tags ──
  safeCommand("memory-tags", {
    description: "Browse memory by auto-extracted tags with forgetting curve visualization",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const role = service.getActiveRole();
      if (!role) { notify(ctx, "No active role", "warning"); return; }

      const argv = (args || "").trim().split(/\s+/);
      const isExport = argv.includes("--export");
      const query = argv.filter((a) => a !== "--export").join(" ") || undefined;

      // Import core functions
      const { readRoleMemory } = await import("../../core/memory-md.ts");
      const { getAllTags, buildTagCloudHTML } = await import("../../core/memory-tags.ts");

      const memoryData = readRoleMemory(role.path, role.name);
      const tagRegistry = getAllTags(memoryData);

      // Export mode
      if (isExport) {
        const { writeFileSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join: pathJoin } = await import("node:path");
        const html = buildTagCloudHTML(tagRegistry, memoryData.roleName);
        const tmpFile = pathJoin(tmpdir(), `${role.name}-tags.html`);
        writeFileSync(tmpFile, html, "utf-8");
        notify(ctx, `Tag cloud exported: ${tmpFile}`, "success");
        return;
      }

      // Plain text mode (always available)
      const sortedTags = Object.entries(tagRegistry)
        .sort((a: any, b: any) => b[1].weight - a[1].weight)
        .filter(([tag]: [string, any]) => !query || tag.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 50);

      if (sortedTags.length === 0) {
        notify(ctx, "No tags found", "info");
        return;
      }

      const lines = [`# Tag Cloud — ${role.name}`, ""];
      for (const [tag, meta] of sortedTags as [string, any][]) {
        const strength = meta.weight > 5 ? "🔥" : meta.weight > 2 ? "⭐" : "💤";
        lines.push(`- ${strength} **${tag}** (${meta.count} memories, weight: ${meta.weight.toFixed(2)})`);
      }

      // Add summary
      const totalTags = Object.keys(tagRegistry).length;
      lines.push("", `---`, `Total: ${totalTags} unique tags, showing top ${sortedTags.length}`);

      msg(pi, "memory-tags", lines.join("\n"));
    },
  });

  // ── /kb ──
  safeCommand("kb", {
    description: "Knowledge base: /kb list | search <query> | stats",
    handler: async (args: string, ctx: ExtensionContext) => {
      const service = await getService(ctx);
      if (!service) { notify(ctx, "Service not initialized", "error"); return; }
      const argv = (args || "").trim().split(/\s+/);
      const cmd = argv[0] || "list";

      switch (cmd) {
        case "list": {
          const r = service.knowledge.list(argv[1]);
          let output = `Knowledge — ${r.totalEntries} entries\n\n`;
          for (const src of r.sources) {
            const total = src.categories.reduce((s, c) => s + c.entries.length, 0);
            if (total === 0) continue;
            output += `[${src.id}${src.readonly ? " (ro)" : ""}]\n`;
            for (const cat of src.categories) {
              output += `  ${cat.category}/ — ${cat.entries.length}\n`;
            }
          }
          msg(pi, "kb-list", output);
          break;
        }
        case "search": {
          const query = argv.slice(1).join(" ");
          if (!query) { notify(ctx, "Usage: /kb search <query>", "warning"); return; }
          const r = service.knowledge.search(query);
          const lines = r.map((item, i) => `${i + 1}. [${item.entry.source}] ${item.entry.meta.title} (${item.relevance.toFixed(2)})`);
          msg(pi, "kb-search", lines.join("\n") || "No matches");
          break;
        }
        case "stats": {
          const r = service.knowledge.list();
          notify(ctx, `${r.totalEntries} entries`, "info");
          break;
        }
        default:
          notify(ctx, "Usage: /kb [list|search <query>|stats]", "info");
      }
    },
  });
}

// ── Event Handlers ───────────────────────────────────────────────────────

function registerEvents(pi: ExtensionAPI) {
  // ── session_start ──
  pi.on("session_start", async (_event, ctx) => {
    await runWithSafety(ctx, "session_start", async () => {
      // Capture session ID for logging correlation
      const sessionId = (ctx as any).sessionManager?.getSessionId?.();
      if (sessionId) setSessionId(sessionId);

      const service = await getService(ctx);
      if (!service) return;
      const role = service.getActiveRole();
      if (role && ctx.hasUI) {
        ctx.ui.setStatus("role", role.name);
      } else if (ctx.hasUI) {
        ctx.ui.setStatus("role", "none");
      }
    });
  });

  // ── resources_discover ──
  pi.on("resources_discover", async () => {
    try {
      const extDir = new URL(".", import.meta.url).pathname;
      const { join } = await import("node:path");
      const { existsSync } = await import("node:fs");
      const skillsDir = join(extDir, "..", "skills");
      if (existsSync(skillsDir)) return { skillPaths: [skillsDir] };
    } catch {}
    return;
  });

  // ── Prompt cache ──
  let _cachedPrompt: string | null = null;
  let _promptCacheAt = 0;
  const PROMPT_CACHE_TTL = 5 * 60 * 1000;

  // ── before_agent_start ──
  pi.on("before_agent_start", async (event, ctx) => {
    const safePrompt = event?.systemPrompt || "You are an AI assistant.";
    const result = await runWithSafety(ctx, "before_agent_start", async () => {
      const service = await getService(ctx);
      if (!service) return { systemPrompt: safePrompt };

      const messages = (event as any).messages || [];
      const now = Date.now();

      let prompt: string;
      if (_cachedPrompt && now - _promptCacheAt < PROMPT_CACHE_TTL) {
        service.buildSystemPrompt(event.systemPrompt, messages).then((p) => {
          _cachedPrompt = p;
          _promptCacheAt = Date.now();
        }).catch(() => {});
        prompt = _cachedPrompt!;
      } else {
        prompt = await service.buildSystemPrompt(event.systemPrompt, messages);
        _cachedPrompt = prompt;
        _promptCacheAt = now;
      }

      // Inject distill mode prompt if active
      if (memoryDistillMode?.active) {
        const role = service.getActiveRole();
        prompt += `\n\n## Memory Distill Mode\nYou are currently in an interactive memory→knowledge distillation workflow for role \`${role?.name || "unknown"}\`.\n\nGoals:\n1. Read the role's memory and knowledge state using the available tools.\n2. Ask concise clarification questions when needed instead of assuming promotion decisions.\n3. Produce a promotion proposal, not a vague reflection.\n4. Distinguish between memory, role knowledge, project knowledge, and global knowledge.\n5. Be conservative: bad knowledge is more expensive than extra memory.\n\nBehavior:\n- First, inspect relevant memory files and existing knowledge entries.\n- If key ambiguity remains, ask a small number of high-value questions to the user.\n- If enough evidence already exists, skip the questions and directly produce a distillation proposal.\n- Prefer operational rules, reusable heuristics, and architectural conventions over emotional reflection.\n- Do not write knowledge automatically unless the user explicitly asks you to execute the promotion.\n\nSuggested output sections:\n- Summary\n- Candidate Decisions\n- Open Questions\n- Promotion Plan\n\nRequested model hint: ${memoryDistillMode.requestedModel || "(use current session model)"}`;
      }

      return { systemPrompt: prompt };
    });
    return result || { systemPrompt: safePrompt };
  });

  // ── Auto-memory state ──
  let autoMemoryPendingTurns = 0;
  let autoMemoryLastAt = 0;
  let autoMemoryLastMessages: unknown[] | null = null;
  let autoMemoryLastFlushLen = 0;
  let autoMemoryInFlight = false;

  function shouldFlushAutoMemory(messages: unknown[]): { should: boolean; reason: string } {
    const text = (messages as any[]).flatMap((m: any) =>
      (Array.isArray(m?.content) ? m.content : []).filter((c: any) => c?.type === "text").map((c: any) => c.text || "")
    ).join("\n");
    const now = Date.now();

    if (/记住这个|remember this|save this|记下来/i.test(text)) return { should: true, reason: "keyword" };
    if (autoMemoryPendingTurns >= 5) return { should: true, reason: "batch" };
    if (now - autoMemoryLastAt >= 30 * 60 * 1000 && autoMemoryPendingTurns >= 2) return { should: true, reason: "interval" };
    return { should: false, reason: "defer" };
  }

  async function flushAutoMemory(messages: unknown[], ctx: ExtensionContext, reason: string) {
    if (autoMemoryInFlight) return;
    autoMemoryInFlight = true;
    try {
      const service = await getService(ctx);
      if (!service) return;
      const result = await service.memory.autoExtract(messages.slice(-10) as any);
      autoMemoryLastFlushLen = messages.length;
      autoMemoryLastAt = Date.now();
      autoMemoryPendingTurns = 0;
      if (result && ctx.hasUI) {
        ctx.ui.setStatus("memory-checkpoint", `✧ ${result.storedLearnings}L ${result.storedPrefs}P`);
      }
    } finally {
      autoMemoryInFlight = false;
    }
  }

  // ── agent_end ──
  pi.on("agent_end", async (event, ctx) => {
    await runWithSafety(ctx, "agent_end", async () => {
      autoMemoryPendingTurns += 1;
      autoMemoryLastMessages = event.messages;
      const decision = shouldFlushAutoMemory(event.messages);
      if (!decision.should) return;
      if (autoMemoryInFlight) return;
      setTimeout(() => {
        flushAutoMemory(autoMemoryLastMessages || event.messages, ctx, decision.reason)
          .catch((err) => safeError(ctx, "agent_end.flush", err));
      }, 0);
    });
  });

  // ── session_before_compact ──
  // Intercept compaction to extract memories before context is lost.
  pi.on("session_before_compact", async (event, ctx) => {
    await runWithSafety(ctx, "session_before_compact", async () => {
      const service = await getService(ctx);
      if (!service) return;

      const config = service.getConfig();
      if (!config.autoMemory?.enabled) return;

      const preparation = (event as any).preparation;
      if (!preparation?.messagesToSummarize?.length) return;

      const model = ctx.model;
      if (!model) return;

      const registry = ctx.modelRegistry as any;
      if (!registry || typeof registry.getApiKeyAndHeaders !== "function") return;

      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return;

      const codingAgent = await getPiCodingAgent();
      if (typeof codingAgent.compact !== "function") return;

      const maxItems = config.autoMemory.maxItems || 10;

      const memoryInstruction = `

IMPORTANT: Write the session summary in CHINESE (中文). The summary should capture the main discussion points and outcomes in Chinese.

In addition to the summary, extract key memories and knowledge from this conversation.
Output them in a <memory> block at the END of your response, after the Chinese summary.
The memory block content must remain in ENGLISH.

Format:

<memory>
[
  {"type": "learning", "content": "concise durable insight or pattern"},
  {"type": "preference", "content": "user preference or habit", "category": "Communication|Code|Tools|Workflow|General"},
  {"type": "event", "content": "significant event or milestone"},
  {"type": "knowledge", "title": "Knowledge Title", "description": "One-line summary", "content": "Reusable artifact: pattern, decision, rule, checklist, or architectural convention", "category": "Code|Design|Architecture|Workflow|Tools|General", "tags": ["tag1"]}
]
</memory>

Rules:
- Summary: MUST be written in Chinese (中文).
- Memory block: MUST remain in English for storage consistency.
- "learning": durable cross-session facts, patterns, rules discovered. Suggest 1-3 relevant tags.
- "preference": user communication style, habits, tool preferences.
- "event": significant session-level events or milestones worth noting.
- "knowledge": reusable artifacts worth promoting to the knowledge base.
- Prefer quality over quantity: extract fewer, higher-value items.
- Keep memory content under 120 characters.
- Max ${maxItems} memory items total (knowledge and event items do not count toward this limit).
- Skip the <memory> block entirely if nothing worth remembering.
- The <memory> block must contain valid JSON inside the tags.`;

      try {
        const result = await codingAgent.compact(
          preparation,
          model,
          auth.apiKey,
          auth.headers,
          memoryInstruction,
          (event as any).signal,
        );

        // Parse and strip <memory> block from summary
        const memoryMatch = result.summary.match(/<memory>\s*([\s\S]*?)\s*<\/memory>/);
        if (memoryMatch) {
          result.summary = result.summary.replace(/<memory>[\s\S]*?<\/memory>/, "").trimEnd();

          try {
            const items = JSON.parse(memoryMatch[1]) as Array<{
              type: string;
              content?: string;
              category?: string;
              tags?: string[];
              title?: string;
              description?: string;
            }>;

            let storedL = 0, storedP = 0;
            for (const item of items) {
              if (item.type === "learning") {
                if (!item.content?.trim()) continue;
                const r = await service.memory.addLearning(item.content, { source: "compaction", appendDaily: true });
                if (r.stored) storedL++;
              } else if (item.type === "preference") {
                if (!item.content?.trim()) continue;
                const r = service.memory.addPreference(item.content, item.category || "General", { source: "compaction", appendDaily: true });
                if (r.stored) storedP++;
              } else if (item.type === "event") {
                if (!item.content?.trim()) continue;
                service.memory.appendDaily("event", item.content);
              } else if (item.type === "knowledge") {
                if (!item.title?.trim() || !item.content?.trim()) continue;
                service.knowledge.write({
                  title: item.title,
                  description: item.description || "",
                  content: item.content,
                  category: item.category || "General",
                  tags: item.tags || [],
                });
              }
            }

            if (ctx.hasUI) {
              ctx.ui.setStatus("memory-checkpoint", `✧ COMPACT ${storedL}L ${storedP}P`);
            }
          } catch (parseErr) {
            // Parse failure is non-fatal, compaction summary still works
          }
        }

        return {
          compaction: {
            summary: result.summary,
            firstKeptEntryId: result.firstKeptEntryId,
            tokensBefore: result.tokensBefore,
            details: result.details,
          },
        };
      } catch {
        // Compaction failed — return nothing, pi will run default compaction
        return;
      }
    });
  });

  // ── session_shutdown ──
  pi.on("session_shutdown", async (_event, ctx) => {
    await runWithSafety(ctx, "session_shutdown", async () => {
      if (autoMemoryPendingTurns > 0 && autoMemoryLastMessages) {
        await Promise.race([
          flushAutoMemory(autoMemoryLastMessages, ctx, "shutdown"),
          new Promise<void>((r) => setTimeout(r, 5000)),
        ]);
      }
      await disposeService();
      if (ctx.hasUI) {
        ctx.ui.setStatus("role", undefined);
        ctx.ui.setStatus("memory-checkpoint", undefined);
      }
    });
  });

  // ── turn_end (evolution reminder) ──
  let userTurnCount = 0;
  let lastEvolutionAt = 0;
  let lastEvolutionDate = "";

  pi.on("turn_end", async (event, ctx) => {
    await runWithSafety(ctx, "turn_end", async () => {
      if (!ctx.hasUI) return;
      const messages = (event as any).messages || [];
      const lastUserIdx = messages.findLastIndex((m: any) => m.role === "user");
      const lastAssistantIdx = messages.findLastIndex((m: any) => m.role === "assistant");
      if (lastUserIdx < 0 || (lastAssistantIdx >= 0 && lastAssistantIdx > lastUserIdx)) return;

      userTurnCount++;
      const today = new Date().toISOString().split("T")[0];
      const now = Date.now();
      const cooldown = 60 * 60 * 1000;
      if (userTurnCount >= 10 && lastEvolutionDate !== today && now - lastEvolutionAt >= cooldown) {
        lastEvolutionDate = today;
        lastEvolutionAt = now;
        userTurnCount = 0;
        pi.sendMessage({
          customType: "evolution-reminder",
          content: "[Low-priority] Consider daily reflection when convenient.",
          display: false,
        }, { triggerTurn: false, deliverAs: "nextTurn" });
      }
    });
  });
}

// ── Main Extension Export ─────────────────────────────────────────────────

export default function rolePersonaExtension(pi: ExtensionAPI) {
  try { registerTools(pi); } catch (err) { safeError(undefined, "register_tools", err); }
  try { registerCommands(pi); } catch (err) { safeError(undefined, "register_commands", err); }
  try { registerEvents(pi); } catch (err) { safeError(undefined, "register_events", err); }
}
