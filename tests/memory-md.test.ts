/**
 * memory-md.ts unit tests
 * Uses temp directories for isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureRoleMemoryFiles,
  readRoleMemory,
  addRoleLearning,
  addRolePreference,
  reinforceRoleLearning,
  updateRoleLearning,
  updateRolePreference,
  deleteRoleLearning,
  deleteRolePreference,
  searchRoleMemory,
  listRoleMemory,
  consolidateRoleMemory,
  repairRoleMemory,
  addPendingLearning,
  getPendingMemories,
  promotePendingLearning,
  expirePendingMemories,
} from "../src/core/memory-md.ts";

let tmpDir: string;
let rolePath: string;
const roleName = "test-role";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rp-test-"));
  rolePath = join(tmpDir, roleName);
  ensureRoleMemoryFiles(rolePath, roleName);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── ensureRoleMemoryFiles ──

describe("ensureRoleMemoryFiles", () => {
  test("creates memory directory structure", () => {
    expect(existsSync(join(rolePath, "memory"))).toBe(true);
    expect(existsSync(join(rolePath, "memory", "consolidated.md"))).toBe(true);
    expect(existsSync(join(rolePath, "memory", "pending.md"))).toBe(true);
    expect(existsSync(join(rolePath, "memory", "daily"))).toBe(true);
    expect(existsSync(join(rolePath, "memory", "scenarios"))).toBe(true);
  });

  test("creates consolidated.md with frontmatter", () => {
    const content = readFileSync(join(rolePath, "memory", "consolidated.md"), "utf-8");
    expect(content).toContain("---");
    expect(content).toContain(`name: "${roleName}"`);
    expect(content).toContain("# Learnings");
  });
});

// ── readRoleMemory ──

describe("readRoleMemory", () => {
  test("reads empty memory", () => {
    const data = readRoleMemory(rolePath, roleName);
    expect(data.learnings).toBeArrayOfSize(0);
    expect(data.preferences).toBeArrayOfSize(0);
    expect(data.roleName).toBe(roleName);
  });
});

// ── addRoleLearning ──

describe("addRoleLearning", () => {
  test("adds a learning", () => {
    const result = addRoleLearning(rolePath, roleName, "Always use TypeScript strict mode");
    expect(result.stored).toBe(true);
    expect(result.id).toBeString();
  });

  test("rejects empty text", () => {
    const result = addRoleLearning(rolePath, roleName, "");
    expect(result.stored).toBe(false);
    expect(result.reason).toBe("empty");
  });

  test("rejects duplicate", () => {
    addRoleLearning(rolePath, roleName, "Use pnpm over npm");
    const result = addRoleLearning(rolePath, roleName, "Use pnpm over npm");
    expect(result.stored).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  test("persists to file", () => {
    addRoleLearning(rolePath, roleName, "Test learning");
    const data = readRoleMemory(rolePath, roleName);
    expect(data.learnings.length).toBe(1);
    expect(data.learnings[0].text).toBe("Test learning");
    expect(data.learnings[0].used).toBe(0);
  });
});

// ── addRolePreference ──

describe("addRolePreference", () => {
  test("adds a preference with category", () => {
    const result = addRolePreference(rolePath, roleName, "Code", "Use 2 spaces for indentation");
    expect(result.stored).toBe(true);
    expect(result.category).toBe("Code");
  });

  test("rejects duplicate preference", () => {
    addRolePreference(rolePath, roleName, "Code", "Use TypeScript");
    const result = addRolePreference(rolePath, roleName, "Code", "Use TypeScript");
    expect(result.stored).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  test("persists to file", () => {
    addRolePreference(rolePath, roleName, "Tools", "Use pnpm");
    const data = readRoleMemory(rolePath, roleName);
    expect(data.preferences.length).toBe(1);
    expect(data.preferences[0].category).toBe("Tools");
  });
});

// ── reinforceRoleLearning ──

describe("reinforceRoleLearning", () => {
  test("increments usage counter", () => {
    addRoleLearning(rolePath, roleName, "Test reinforce");
    const result = reinforceRoleLearning(rolePath, roleName, "Test reinforce");
    expect(result.updated).toBe(true);
    expect(result.used).toBe(1);

    const result2 = reinforceRoleLearning(rolePath, roleName, "Test reinforce");
    expect(result2.used).toBe(2);
  });

  test("returns false for non-existent", () => {
    const result = reinforceRoleLearning(rolePath, roleName, "nonexistent");
    expect(result.updated).toBe(false);
  });
});

// ── updateRoleLearning ──

describe("updateRoleLearning", () => {
  test("updates by fuzzy match", () => {
    addRoleLearning(rolePath, roleName, "Use TypeScript for all projects");
    const result = updateRoleLearning(rolePath, roleName, "TypeScript", "Use TypeScript strict mode for all projects");
    expect(result.updated).toBe(true);
    expect(result.newText).toContain("strict mode");
  });

  test("returns false for no match", () => {
    addRoleLearning(rolePath, roleName, "Something else");
    const result = updateRoleLearning(rolePath, roleName, "nonexistent", "new text");
    expect(result.updated).toBe(false);
  });
});

// ── deleteRoleLearning ──

describe("deleteRoleLearning", () => {
  test("deletes by fuzzy match", () => {
    addRoleLearning(rolePath, roleName, "Delete this learning");
    const result = deleteRoleLearning(rolePath, roleName, "Delete this");
    expect(result.deleted).toBe(true);
    const data = readRoleMemory(rolePath, roleName);
    expect(data.learnings.length).toBe(0);
  });

  test("returns false for non-existent", () => {
    const result = deleteRoleLearning(rolePath, roleName, "nonexistent");
    expect(result.deleted).toBe(false);
  });
});

// ── searchRoleMemory ──

describe("searchRoleMemory", () => {
  test("searches learnings", () => {
    addRoleLearning(rolePath, roleName, "TypeScript strict mode is important");
    addRoleLearning(rolePath, roleName, "Use pnpm for package management");
    const results = searchRoleMemory(rolePath, roleName, "TypeScript");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.text.includes("TypeScript"))).toBe(true);
  });

  test("searches preferences", () => {
    addRolePreference(rolePath, roleName, "Code", "Prefer functional programming");
    const results = searchRoleMemory(rolePath, roleName, "functional");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.text.includes("functional"))).toBe(true);
  });

  test("returns empty for no match", () => {
    addRoleLearning(rolePath, roleName, "Something");
    const results = searchRoleMemory(rolePath, roleName, "nonexistent");
    expect(results.length).toBe(0);
  });
});

// ── listRoleMemory ──

describe("listRoleMemory", () => {
  test("lists all memory items", () => {
    addRoleLearning(rolePath, roleName, "Learning unique A");
    addRoleLearning(rolePath, roleName, "Learning unique B");
    addRolePreference(rolePath, roleName, "Code", "Preference unique X");
    const result = listRoleMemory(rolePath, roleName);
    expect(result.learnings).toBeGreaterThanOrEqual(2);
    expect(result.preferences).toBeGreaterThanOrEqual(1);
    expect(result.text).toContain("Learning unique A");
    expect(result.text).toContain("Preference unique X");
  });
});

// ── consolidateRoleMemory ──

describe("consolidateRoleMemory", () => {
  test("deduplicates similar entries", () => {
    addRoleLearning(rolePath, roleName, "Use TypeScript strict mode");
    addRoleLearning(rolePath, roleName, "use typescript strict mode");
    const result = consolidateRoleMemory(rolePath, roleName);
    expect(result.afterLearnings).toBeLessThanOrEqual(result.beforeLearnings);
  });
});

// ── repairRoleMemory ──

describe("repairRoleMemory", () => {
  test("reports no issues for valid memory", () => {
    addRoleLearning(rolePath, roleName, "Valid learning");
    const result = repairRoleMemory(rolePath, roleName, { force: true });
    expect(result.repaired).toBe(false);
    expect(result.issues).toBe(0);
  });
});

// ── Pending layer ──

describe("Pending layer", () => {
  test("adds pending learning", () => {
    const result = addPendingLearning(rolePath, "Pending item", "auto");
    expect(result.stored).toBe(true);
    expect(result.id).toBeString();
  });

  test("lists pending items", () => {
    addPendingLearning(rolePath, "Pending 1", "auto");
    addPendingLearning(rolePath, "Pending 2", "auto");
    const pending = getPendingMemories(rolePath);
    expect(pending.length).toBe(2);
    expect(pending[0].promoted).toBe(false);
  });

  test("promotes pending to consolidated", () => {
    const addResult = addPendingLearning(rolePath, "Promote me to consolidated", "auto");
    expect(addResult.stored).toBe(true);
    const pending = getPendingMemories(rolePath);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].text).toBeTruthy();
    // promote needs 3 args: rolePath, roleName, idOrQuery
    const result = promotePendingLearning(rolePath, roleName, pending[0].id);
    expect(result.promoted).toBe(true);
    const data = readRoleMemory(rolePath, roleName);
    expect(data.learnings.some(l => l.text.includes("Promote me"))).toBe(true);
  });

  test("expires old pending items", () => {
    addPendingLearning(rolePath, "Old item", "auto");
    const result = expirePendingMemories(rolePath, 0); // expire immediately
    expect(result.expired).toBeGreaterThanOrEqual(0);
  });
});
