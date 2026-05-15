/**
 * VectorDB — LanceDB wrapper for vector storage.
 *
 * Decoupled from embedding providers. Stores VectorEntry objects,
 * supports vector search with L2 distance → similarity conversion.
 *
 * Zero Pi SDK dependency.
 */

import { existsSync, mkdirSync } from "node:fs";
import { log } from "./logger.ts";
import type { VectorEntry, VectorSearchResult } from "./types.ts";

const TABLE_NAME = "memories";

// Lazy import to avoid loading native module at startup
let lancedbModule: typeof import("@lancedb/lancedb") | null = null;
async function loadLanceDB() {
  if (!lancedbModule) {
    try {
      lancedbModule = await import("@lancedb/lancedb");
    } catch (err) {
      throw new Error(`Failed to load @lancedb/lancedb. Install with: npm i @lancedb/lancedb. ${err}`);
    }
  }
  return lancedbModule;
}

export class VectorDB {
  private db: any = null;
  private table: any = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly vectorDim: number,
  ) {}

  private async ensureInit(): Promise<void> {
    if (this.table) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    const lancedb = await loadLanceDB();

    if (!existsSync(this.dbPath)) {
      mkdirSync(this.dbPath, { recursive: true });
    }

    this.db = await lancedb.connect(this.dbPath);
    const tables = await this.db.tableNames();

    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      this.table = await this.db.createTable(TABLE_NAME, [
        {
          id: "__schema__",
          text: "",
          vector: new Array(this.vectorDim).fill(0),
          kind: "learning",
          category: "",
          createdAt: 0,
        },
      ]);
      await this.table.delete('id = "__schema__"');
    }

    log("vector-db", `initialized at ${this.dbPath} (dim=${this.vectorDim})`);
  }

  async store(entry: VectorEntry): Promise<void> {
    await this.ensureInit();
    await this.table.add([entry]);
  }

  async storeBatch(entries: VectorEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureInit();
    await this.table.add(entries);
  }

  async search(vector: number[], limit: number = 5, minScore: number = 0.3): Promise<VectorSearchResult[]> {
    await this.ensureInit();

    const rows = await this.table.vectorSearch(vector).limit(limit).toArray();

    return rows
      .map((row: any) => {
        const distance: number = row._distance ?? 0;
        const score = 1 / (1 + distance);
        return {
          entry: {
            id: row.id as string,
            text: row.text as string,
            vector: row.vector as number[],
            kind: row.kind as VectorEntry["kind"],
            category: row.category as string,
            createdAt: row.createdAt as number,
          },
          score,
        };
      })
      .filter((r: VectorSearchResult) => r.score >= minScore);
  }

  async delete(id: string): Promise<void> {
    await this.ensureInit();
    const safeId = id.replace(/'/g, "''");
    await this.table.delete(`id = '${safeId}'`);
  }

  async count(): Promise<number> {
    await this.ensureInit();
    return this.table.countRows();
  }

  async clear(): Promise<void> {
    await this.ensureInit();
    await this.table.delete("id IS NOT NULL");
  }

  async dispose(): Promise<void> {
    this.table = null;
    this.db = null;
    this.initPromise = null;
  }
}
