/**
 * Vector Memory — search/index logic using LanceDB + EmbeddingProvider.
 *
 * Architecture:
 *   embedding.ts  — EmbeddingProvider implementations (OpenAI/Local/MiniLM)
 *   vector-db.ts  — VectorDB class (LanceDB wrapper)
 *   this file     — search/index/auto-recall logic
 *
 * Zero Pi SDK dependency. Embedding and storage are injectable.
 */

import { join } from "node:path";
import { log } from "./logger.ts";
import { config } from "./config.ts";
import type {
  ApiKeyResolver,
  EmbeddingProvider,
  VectorEntry,
  VectorSearchResult,
  ScoredMemoryMatch,
  MemorySearchMatch,
  VectorStats,
  RebuildResult,
} from "./types.ts";
import { readRoleMemory, searchRoleMemory } from "./memory-md.ts";
import { VectorDB } from "./vector-db.ts";
import { createEmbeddingProvider } from "./embedding.ts";

// Re-export for backward compat
export type { EmbeddingProvider };

// ============================================================================
// Module State (per-role singleton)
// ============================================================================

let activeDB: VectorDB | null = null;
let activeEmbedding: EmbeddingProvider | null = null;
let activeRolePath: string | null = null;
let indexQueue: Array<{ id: string; text: string; kind: "learning" | "preference"; category: string }> = [];
let indexFlushTimer: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// Initialization
// ============================================================================

function getVectorDBPath(rolePath: string): string {
  return join(rolePath, ".vector-db");
}

function isVectorEnabled(): boolean {
  return config.vectorMemory?.enabled === true;
}

/**
 * Initialize vector memory for a role. Call once per session.
 * Returns true if vector memory is available, false if degraded to keyword-only.
 */
export async function initVectorMemory(
  rolePath: string,
  apiKeyResolver?: ApiKeyResolver,
): Promise<boolean> {
  if (!isVectorEnabled()) {
    log("vector", "disabled by config");
    return false;
  }

  try {
    activeEmbedding = await createEmbeddingProvider(apiKeyResolver);
    if (!activeEmbedding) {
      log("vector", "no embedding provider available");
      return false;
    }

    const dbPath = getVectorDBPath(rolePath);
    activeDB = new VectorDB(dbPath, activeEmbedding.dim);
    activeRolePath = rolePath;

    log("vector", `initialized (provider=${config.vectorMemory?.provider}, dim=${activeEmbedding.dim})`);
    return true;
  } catch (err) {
    log("vector", `init failed: ${err}`);
    activeDB = null;
    activeEmbedding = null;
    return false;
  }
}

export function isVectorActive(): boolean {
  return activeDB !== null && activeEmbedding !== null;
}

// ============================================================================
// Index Operations
// ============================================================================

export function queueVectorIndex(
  id: string,
  text: string,
  kind: "learning" | "preference",
  category: string = "",
): void {
  if (!isVectorActive()) return;

  indexQueue.push({ id, text, kind, category });

  if (indexFlushTimer) clearTimeout(indexFlushTimer);
  indexFlushTimer = setTimeout(() => flushIndexQueue(), 2000);
}

async function flushIndexQueue(): Promise<void> {
  if (!activeDB || !activeEmbedding || indexQueue.length === 0) return;

  const batch = [...indexQueue];
  indexQueue = [];
  indexFlushTimer = null;

  log("vector-index", `flushing ${batch.length} entries`);

  const entries: VectorEntry[] = [];
  for (const item of batch) {
    try {
      const vector = await activeEmbedding.embed(item.text);
      entries.push({
        id: item.id,
        text: item.text,
        vector,
        kind: item.kind,
        category: item.category,
        createdAt: Date.now(),
      });
    } catch (err) {
      log("vector-index", `embed failed for ${item.id}: ${err}`);
    }
  }

  if (entries.length > 0) {
    try {
      await activeDB.storeBatch(entries);
      log("vector-index", `stored ${entries.length} entries`);
    } catch (err) {
      log("vector-index", `batch store failed: ${err}`);
    }
  }
}

export async function flushVectorIndex(): Promise<void> {
  if (indexFlushTimer) {
    clearTimeout(indexFlushTimer);
    indexFlushTimer = null;
  }
  await flushIndexQueue();
}

export function disposeVectorMemory(): void {
  if (indexFlushTimer) {
    clearTimeout(indexFlushTimer);
    indexFlushTimer = null;
  }
  activeDB?.dispose();
  activeDB = null;
  activeEmbedding = null;
  activeRolePath = null;
  indexQueue = [];
}

// ============================================================================
// Search
// ============================================================================

export async function vectorSearch(
  rolePath: string,
  query: string,
  limit?: number,
  minScore?: number,
): Promise<VectorSearchResult[]> {
  if (!activeDB || !activeEmbedding) return [];

  const maxResults = limit ?? config.vectorMemory?.recallLimit ?? 5;
  const minScoreVal = minScore ?? config.vectorMemory?.recallMinScore ?? 0.3;

  try {
    const vector = await activeEmbedding.embed(query);
    return await activeDB.search(vector, maxResults, minScoreVal);
  } catch (err) {
    log("vector-search", `failed: ${err}`);
    return [];
  }
}

/**
 * Hybrid search: vector + keyword → RRF (Reciprocal Rank Fusion)
 */
export async function hybridSearch(
  rolePath: string,
  roleName: string,
  query: string,
  limit?: number,
): Promise<ScoredMemoryMatch[]> {
  const maxResults = limit ?? config.vectorMemory?.recallLimit ?? 5;

  // Vector search
  const vectorResults = await vectorSearch(rolePath, query, maxResults * 2);

  // Keyword search
  const keywordResults = await searchRoleMemory(rolePath, roleName, query);

  // RRF fusion
  const k = 60;
  const scores = new Map<string, { match: ScoredMemoryMatch; score: number }>();

  // Rank vector results
  const sortedVector = [...vectorResults].sort((a, b) => b.score - a.score);
  for (let i = 0; i < sortedVector.length; i++) {
    const r = sortedVector[i];
    const key = r.entry.id || r.entry.text;
    const existing = scores.get(key);
    const rrf = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrf * (config.vectorMemory?.vectorWeight ?? 1.0);
    } else {
      scores.set(key, {
        match: {
          kind: r.entry.kind as any,
          id: r.entry.id,
          text: r.entry.text,
          category: r.entry.category,
          score: r.score,
        },
        score: rrf * (config.vectorMemory?.vectorWeight ?? 1.0),
      });
    }
  }

  // Rank keyword results
  for (let i = 0; i < keywordResults.length; i++) {
    const r = keywordResults[i];
    const key = r.id || r.text;
    const existing = scores.get(key);
    const rrf = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrf;
    } else {
      scores.set(key, {
        match: { ...r, score: 0 },
        score: rrf,
      });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => ({ ...s.match, score: s.score }));
}

// ============================================================================
// Auto-Recall
// ============================================================================

export function formatRecalledMemories(results: VectorSearchResult[]): string {
  if (results.length === 0) return "";

  const lines = ["## Recalled Memories (vector search)", ""];
  for (const r of results) {
    const score = (r.score * 100).toFixed(0);
    lines.push(`- [${score}%] ${r.entry.text}`);
  }
  return lines.join("\n");
}

export async function autoRecall(
  query: string,
  limit?: number,
  minScore?: number,
): Promise<string | null> {
  if (!activeDB || !activeEmbedding) return null;

  const results = await vectorSearch(activeRolePath || "", query, limit, minScore);
  if (results.length === 0) return null;

  return formatRecalledMemories(results);
}

// ============================================================================
// Rebuild
// ============================================================================

export async function rebuildVectorIndex(rolePath: string, roleName: string): Promise<RebuildResult> {
  if (!activeDB || !activeEmbedding) {
    return { indexed: 0, total: 0, errors: 0 };
  }

  const data = readRoleMemory(rolePath, roleName);
  const items: Array<{ id: string; text: string; kind: "learning" | "preference"; category: string }> = [];

  for (const l of data.learnings) {
    items.push({ id: l.id, text: l.text, kind: "learning", category: "" });
  }
  for (const p of data.preferences) {
    items.push({ id: p.id, text: p.text, kind: "preference", category: p.category });
  }

  await activeDB.clear();

  let indexed = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const vector = await activeEmbedding.embed(item.text);
      await activeDB.store({
        id: item.id,
        text: item.text,
        vector,
        kind: item.kind,
        category: item.category,
        createdAt: Date.now(),
      });
      indexed++;
    } catch (err) {
      errors++;
      log("vector-rebuild", `embed failed for ${item.id}: ${err}`);
    }
  }

  log("vector-rebuild", `done: ${indexed}/${items.length} indexed, ${errors} errors`);
  return { indexed, total: items.length, errors };
}

// ============================================================================
// Stats
// ============================================================================

export async function getVectorStats(): Promise<VectorStats | null> {
  if (!activeDB) return null;

  const count = await activeDB.count();
  return {
    enabled: isVectorEnabled(),
    active: isVectorActive(),
    model: activeEmbedding?.model || null,
    dim: activeEmbedding?.dim || null,
    count,
    dbPath: activeRolePath ? getVectorDBPath(activeRolePath) : null,
  };
}


