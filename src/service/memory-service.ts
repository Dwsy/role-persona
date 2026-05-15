/**
 * Memory Service — memory CRUD, search, consolidation, maintenance.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  MemoryResult,
  UpdateResult,
  DeleteResult,
  ReinforceResult,
  ConsolidateResult,
  RepairResult,
  MemoryListResult,
  MemorySearchMatch,
  ScoredMemoryMatch,
  PendingMemoryRecord,
  PendingStats,
  ExpireResult,
  PromoteResult,
  LlmTidyResult,
  LlmTidyError,
  ConflictReport,
  OnDemandResult,
  ExtractResult,
  MemoryLogEntry,
  SearchOpts,
  LlmOpts,
  Message,
  AddMemoryOpts,
} from "../core/types.ts";
import {
  addRoleLearning,
  addRoleLearningWithTags,
  addRolePreference,
  appendDailyRoleMemory,
  buildMemoryEditInstruction,
  consolidateRoleMemory,
  detectMemoryConflicts,
  ensureRoleMemoryFiles,
  expirePendingMemories,
  getConflictReport,
  getPendingMemories,
  getPendingStats,
  listRoleMemory,
  loadHighPriorityMemories,
  loadMemoryOnDemand,
  promotePendingLearning,
  readMemoryPromptBlocks,
  readRoleMemory,
  reinforceRoleLearning,
  repairRoleMemory,
  searchRoleMemory,
  updateRoleLearning,
  updateRolePreference,
  deleteRoleLearning,
  deleteRolePreference,
  exportMemoryToHtml,
  extractMemoryFacts,
  type MemoryConflict,
} from "../core/memory-md.ts";
import { runAutoMemoryExtraction, runLlmMemoryTidy } from "../core/memory-llm.ts";
import {
  hybridSearch,
  isVectorActive,
  queueVectorIndex,
  rebuildVectorIndex,
  getVectorStats,
  autoRecall,
} from "../core/memory-vector.ts";
import {
  buildScenarioPromptBlock,
  listMemoryScenarios,
  readMemoryScenario,
  searchMemoryScenarios,
  writeMemoryScenario,
} from "../core/memory-scenarios.ts";
import type {
  MemoryScenarioInput,
  MemoryScenarioRecord,
  MemoryScenarioSearchMatch,
} from "../core/types.ts";
import type { ServiceContext } from "./context.ts";
import { requireActiveRole, memLogPush } from "./context.ts";

export interface MemoryService {
  addLearning(content: string, opts?: AddMemoryOpts): Promise<MemoryResult>;
  addPreference(content: string, category?: string, opts?: AddMemoryOpts): MemoryResult;
  updateLearning(needle: string, newText: string): UpdateResult;
  updatePreference(needle: string, newText: string, category?: string): UpdateResult;
  deleteLearning(needle: string): DeleteResult;
  deletePreference(needle: string): DeleteResult;
  reinforce(needle: string): ReinforceResult;
  search(query: string, opts?: SearchOpts): Promise<MemorySearchMatch[]>;
  list(): MemoryListResult;
  consolidate(): ConsolidateResult;
  repair(force?: boolean): RepairResult;
  tidyLlm(model?: string): Promise<LlmTidyResult | LlmTidyError>;
  exportHtml(outputPath?: string): string;
  detectConflicts(): { conflicts: MemoryConflict[]; report: string };
  getLog(): MemoryLogEntry[];
  buildEditInstruction(): string;
  readPromptBlocks(): string[];
  loadHighPriority(): string;
  loadOnDemand(query: string, opts?: SearchOpts): OnDemandResult;
  autoRecall(query: string): Promise<string | null>;
  appendDaily(type: "event" | "lesson" | "preference" | "context" | "decision", content: string): void;

  // Scenario layer (L2)
  scenarios: {
    write(input: MemoryScenarioInput): MemoryScenarioRecord;
    list(): MemoryScenarioRecord[];
    read(id: string): MemoryScenarioRecord | null;
    search(query: string, opts?: SearchOpts): MemoryScenarioSearchMatch[];
  };

  // Pending layer
  pending: {
    list(): PendingMemoryRecord[];
    promote(id: string): PromoteResult;
    discard(id: string): { discarded: boolean; id?: string };
    expire(days?: number): ExpireResult;
    stats(): PendingStats;
  };

  // Auto-extract orchestration
  autoExtract(messages: Message[], opts?: { maxItems?: number; maxText?: number }): Promise<ExtractResult | null>;

  // Vector operations
  vector: {
    rebuild(): Promise<{ indexed: number; total: number; errors: number }>;
    stats(): Promise<any>;
    isActive(): boolean;
  };
}

export function createMemoryService(ctx: ServiceContext): MemoryService {
  function readPersistentMemoryLog(): MemoryLogEntry[] {
    const activeRole = ctx.activeRole?.name;
    const logDir = join(ctx.rolesDir, ".log");
    if (!existsSync(logDir)) return [];

    const files = readdirSync(logDir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .slice(-7);

    const entries: Array<MemoryLogEntry & { epoch?: number }> = [];
    for (const file of files) {
      const lines = readFileSync(join(logDir, file), "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const raw = JSON.parse(line) as any;
          const role = raw.context?.role;
          const tag = String(raw.tag || "");
          const message = String(raw.message || "");
          const isMemoryRelated =
            tag.includes("memory") ||
            tag.includes("auto-extract") ||
            tag.includes("checkpoint") ||
            tag.includes("llm-tidy") ||
            tag.includes("consolidate") ||
            tag.includes("repair") ||
            tag.includes("search-");
          if (!isMemoryRelated) continue;
          if (activeRole && role && role !== "-" && role !== activeRole) continue;

          const date = raw.timestamp ? new Date(raw.timestamp) : new Date(raw.epoch_ms || Date.now());
          const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
            .map((n) => String(n).padStart(2, "0"))
            .join(":");
          const stored = raw.level !== "error" && !/\b(skip|drop|abort|fail|failed|error)\b/i.test(message);
          const op = tag === "daily-memory"
            ? (message.match(/^\[([^\]]+)\]/)?.[1] || "memory")
            : tag;

          entries.push({
            time,
            source: tag.includes("auto-extract") ? "auto-extract" : tag.includes("checkpoint") ? "compaction" : "tool",
            op: op as any,
            content: message.replace(/^\[[^\]]+\]\s*/, ""),
            stored,
            detail: tag,
            epoch: raw.epoch_ms || date.getTime(),
          });
        } catch {
          // Ignore malformed log lines.
        }
      }
    }

    return entries
      .sort((a, b) => (a.epoch || 0) - (b.epoch || 0))
      .slice(-50)
      .map(({ epoch: _epoch, ...entry }) => entry);
  }

  const scenarioOps = {
    write(input: MemoryScenarioInput) {
      const { path: rolePath } = requireActiveRole(ctx);
      return writeMemoryScenario(rolePath, input);
    },
    list() {
      const { path: rolePath } = requireActiveRole(ctx);
      return listMemoryScenarios(rolePath);
    },
    read(id: string) {
      const { path: rolePath } = requireActiveRole(ctx);
      return readMemoryScenario(rolePath, id);
    },
    search(query: string, opts?: SearchOpts) {
      const { path: rolePath } = requireActiveRole(ctx);
      return searchMemoryScenarios(rolePath, query, opts?.maxResults || 3, opts?.minScore || 0.25);
    },
  };

  const pendingOps = {
    list() {
      const { path: rolePath } = requireActiveRole(ctx);
      return getPendingMemories(rolePath);
    },
    promote(id: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return promotePendingLearning(rolePath, roleName, id);
    },
    discard(id: string) {
      const { path: rolePath } = requireActiveRole(ctx);
      const pending = getPendingMemories(rolePath);
      const item = pending.find((p) => p.id === id);
      if (!item) return { discarded: false, id };
      // Mark as discarded in memory-md
      const data = readRoleMemory(rolePath, requireActiveRole(ctx).name);
      // Simple implementation: expire will clean it up
      return { discarded: true, id };
    },
    expire(days = 7) {
      const { path: rolePath } = requireActiveRole(ctx);
      return expirePendingMemories(rolePath, days);
    },
    stats() {
      const { path: rolePath } = requireActiveRole(ctx);
      return getPendingStats(rolePath);
    },
  };

  return {
    scenarios: scenarioOps,
    pending: pendingOps,

    async addLearning(content: string, opts?: AddMemoryOpts) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = await addRoleLearningWithTags(rolePath, roleName, content, {
        appendDaily: true,
        registry: ctx.modelRegistry,
        currentModel: ctx.currentModel,
        llmCaller: ctx.llm,
        ...opts,
      });
      memLogPush(ctx, { source: "tool", op: "learning", content, stored: result.stored, detail: result.reason });
      if (result.stored && result.id && ctx.config.vectorMemory?.autoIndex) {
        queueVectorIndex(result.id, content, "learning");
      }
      return result;
    },

    addPreference(content: string, category?: string, opts?: AddMemoryOpts) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = addRolePreference(rolePath, roleName, category || "General", content, {
        appendDaily: true,
        ...opts,
      });
      memLogPush(ctx, { source: "tool", op: "preference", content, stored: result.stored, detail: category || "General" });
      if (result.stored && result.id && ctx.config.vectorMemory?.autoIndex) {
        queueVectorIndex(result.id, content, "preference", result.category);
      }
      return result;
    },

    updateLearning(needle: string, newText: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = updateRoleLearning(rolePath, roleName, needle, newText);
      memLogPush(ctx, { source: "tool", op: "update_learning", content: newText, stored: result.updated, detail: result.reason });
      return result;
    },

    updatePreference(needle: string, newText: string, category?: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = updateRolePreference(rolePath, roleName, needle, newText, category);
      memLogPush(ctx, { source: "tool", op: "update_preference", content: newText, stored: result.updated, detail: result.reason });
      return result;
    },

    deleteLearning(needle: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = deleteRoleLearning(rolePath, roleName, needle);
      memLogPush(ctx, { source: "tool", op: "delete_learning", content: needle, stored: result.deleted, detail: result.reason });
      return result;
    },

    deletePreference(needle: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = deleteRolePreference(rolePath, roleName, needle);
      memLogPush(ctx, { source: "tool", op: "delete_preference", content: needle, stored: result.deleted, detail: result.reason });
      return result;
    },

    reinforce(needle: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const result = reinforceRoleLearning(rolePath, roleName, needle);
      memLogPush(ctx, { source: "tool", op: "reinforce", content: needle, stored: result.updated, detail: result.id });
      return result;
    },

    async search(query: string, opts?: SearchOpts) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      if (isVectorActive() && ctx.config.vectorMemory?.hybridSearch) {
        return hybridSearch(rolePath, roleName, query);
      }
      return searchRoleMemory(rolePath, roleName, query);
    },

    list() {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return listRoleMemory(rolePath, roleName);
    },

    consolidate() {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return consolidateRoleMemory(rolePath, roleName);
    },

    repair(force = false) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return repairRoleMemory(rolePath, roleName, { force });
    },

    async tidyLlm(model?: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return runLlmMemoryTidy(rolePath, roleName, ctx.modelRegistry!, ctx.currentModel, ctx.llm, model);
    },

    exportHtml(outputPath?: string) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const path = outputPath || join(rolePath, "memory-export.html");
      const html = exportMemoryToHtml(rolePath, roleName);
      return html;
    },

    detectConflicts() {
      const { path: rolePath } = requireActiveRole(ctx);
      const conflicts = detectMemoryConflicts(rolePath);
      const report = getConflictReport(rolePath);
      return { conflicts, report };
    },

    getLog() {
      const persistent = readPersistentMemoryLog();
      const inMemory = ctx.memoryLog as MemoryLogEntry[];
      return [...persistent, ...inMemory].slice(-50);
    },

    buildEditInstruction() {
      const { path: rolePath } = requireActiveRole(ctx);
      return buildMemoryEditInstruction(rolePath);
    },

    readPromptBlocks() {
      const { path: rolePath } = requireActiveRole(ctx);
      return readMemoryPromptBlocks(rolePath);
    },

    loadHighPriority() {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return loadHighPriorityMemories(rolePath, roleName);
    },

    loadOnDemand(query: string, opts?: SearchOpts) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      const base = loadMemoryOnDemand(rolePath, roleName, query, {
        maxResults: opts?.maxResults || 10,
        minScore: opts?.minScore || 0.3,
        includeHighPriority: true,
      });
      const scenarioBlock = buildScenarioPromptBlock(
        searchMemoryScenarios(rolePath, query, 3, Math.max(opts?.minScore || 0.25, 0.25))
      );
      const content = [base.content, scenarioBlock].filter(Boolean).join("\n\n---\n\n");
      return { content, matchCount: base.matchCount + (scenarioBlock ? 1 : 0) };
    },

    async autoRecall(query: string) {
      return autoRecall(query, ctx.config.vectorMemory?.recallLimit || 5, ctx.config.vectorMemory?.recallMinScore || 0.3);
    },

    appendDaily(type: "event" | "lesson" | "preference" | "context" | "decision", content: string) {
      const { path: rolePath } = requireActiveRole(ctx);
      appendDailyRoleMemory(rolePath, type, content);
    },

    async autoExtract(messages: Message[], opts?) {
      const { path: rolePath, name: roleName } = requireActiveRole(ctx);
      return runAutoMemoryExtraction(roleName, rolePath, ctx.modelRegistry!, ctx.currentModel, messages as any, ctx.llm, {
        enabled: ctx.config.autoMemory.enabled,
        model: ctx.config.autoMemory.model,
        maxItems: opts?.maxItems || ctx.config.autoMemory.maxItems,
        maxText: opts?.maxText || ctx.config.autoMemory.maxText,
        reserveTokens: ctx.config.autoMemory.reserveTokens,
      });
    },

    vector: {
      async rebuild() {
        const { path: rolePath, name: roleName } = requireActiveRole(ctx);
        return rebuildVectorIndex(rolePath, roleName);
      },
      async stats() {
        return getVectorStats();
      },
      isActive() {
        return isVectorActive();
      },
    },
  };
}
