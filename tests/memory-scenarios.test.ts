import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureMemoryScenarioLayer,
  writeMemoryScenario,
  listMemoryScenarios,
  readMemoryScenario,
  searchMemoryScenarios,
  buildScenarioPromptBlock,
} from "../src/core/memory-scenarios.ts";
import { createService } from "../src/service/index.ts";

describe("memory-scenarios", () => {
  test("writes, reads and searches scenario markdown", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rp-scenario-"));
    try {
      const rolePath = join(tmp, "zero");
      ensureMemoryScenarioLayer(rolePath);

      const record = writeMemoryScenario(rolePath, {
        title: "Code review output style",
        scope: "role",
        guidance: "Always give the conclusion first, then Critical/Medium/Low.",
        triggers: ["code review", "review feedback"],
        evidence: ["User asked for concise structured feedback."],
      });

      const list = listMemoryScenarios(rolePath);
      expect(list.length).toBe(1);
      expect(list[0].title).toBe("Code review output style");

      const read = readMemoryScenario(rolePath, record.id);
      expect(read).not.toBeNull();
      expect(read?.guidance).toContain("Always give the conclusion first");

      const search = searchMemoryScenarios(rolePath, "review feedback", 5, 0.1);
      expect(search.length).toBeGreaterThan(0);
      expect(search[0].id).toBe(record.id);

      const prompt = buildScenarioPromptBlock(search);
      expect(prompt).toContain("Scenario Memory Hints");
      expect(prompt).toContain("Critical/Medium/Low");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("service prompt injects matching scenario hints", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "rp-scenario-service-"));
    try {
      const rolesDir = join(tmp, "roles");
      const service = createService({ rolesDir });
      service.role.create("zero");
      await service.init(tmp);
      service.role.activate("zero");

      const role = service.getActiveRole();
      expect(role).not.toBeNull();
      writeMemoryScenario(role!.path, {
        title: "PR review output",
        guidance: "Use conclusion-first review output with severity groups.",
        triggers: ["review pr", "pull request review"],
        evidence: ["Scenario service test"],
      });

      const prompt = await service.buildSystemPrompt("Base prompt", [
        { role: "user", content: [{ type: "text", text: "please review PR" }] },
      ] as any);

      expect(prompt).toContain("Scenario Memory Hints");
      expect(prompt).toContain("PR review output");
      expect(prompt).toContain("conclusion-first");
      await service.dispose();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
