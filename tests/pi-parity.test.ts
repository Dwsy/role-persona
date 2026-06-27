import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/service/index.ts";

function makeRoleFixture() {
  const tmp = join(tmpdir(), `rp-pi-parity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const rolesDir = join(tmp, "roles");
  const rolePath = join(rolesDir, "zero");
  mkdirSync(join(rolePath, "core"), { recursive: true });
  mkdirSync(join(rolePath, "memory", "daily"), { recursive: true });
  writeFileSync(join(rolePath, "core", "identity.md"), "# Identity\nTest role", "utf-8");
  writeFileSync(join(rolePath, "core", "soul.md"), "# Soul\n", "utf-8");
  writeFileSync(join(rolePath, "core", "user.md"), "# User\n", "utf-8");
  writeFileSync(join(rolePath, "BOOTSTRAP.md"), "# Bootstrap\nInitialize this role.", "utf-8");
  return { tmp, rolesDir, rolePath };
}

describe("Pi adapter parity surfaces", () => {
  test("direct Pi adapter keeps old TUI renderers and export behavior wired", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src", "extensions", "pi", "adapter.ts"), "utf-8");

    expect(source).toContain("registerRoleMessageRenderers(pi)");
    expect(source).toContain("...memoryToolRenderers");
    expect(source).toContain("...knowledgeToolRenderers");
    expect(source).toContain("...roleInfoToolRenderers");
    expect(source).toContain("writeFileSync(exportPath, html");
    expect(source).toContain("service.role.getStructure(role.path, params.path");
  });

  test("continue extension keeps command and shortcut while guarding missing UI", () => {
    const source = readFileSync(join(import.meta.dir, "..", "..", "extensions", "continue.ts"), "utf-8");

    expect(source).toContain('pi.registerCommand("continue"');
    expect(source).toContain("pi.registerShortcut(Key.ctrlAlt(\"c\")");
    expect(source).toContain("ctx.ui?.notify");
    expect(source).toContain("ctx.ui?.setEditorText");
  });
});

describe("Role service parity behavior", () => {
  test("role_info structure supports path, recursive and maxEntries", () => {
    const { tmp, rolesDir, rolePath } = makeRoleFixture();
    try {
      mkdirSync(join(rolePath, "memory", "nested"), { recursive: true });
      writeFileSync(join(rolePath, "memory", "a.md"), "a", "utf-8");
      writeFileSync(join(rolePath, "memory", "nested", "b.md"), "b", "utf-8");

      const service = createService({ rolesDir });
      service.role.activate("zero");

      const flat = service.role.getStructure(rolePath, "memory");
      expect(flat.files).toContain("memory/a.md");
      expect(flat.files).not.toContain("memory/nested/b.md");

      const recursive = service.role.getStructure(rolePath, "memory", { recursive: true, maxEntries: 1 });
      expect(recursive.recursive).toBe(true);
      expect(recursive.count).toBe(1);
      expect(() => service.role.getStructure(rolePath, "../outside")).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("first-run prompt includes BOOTSTRAP guidance", async () => {
    const { tmp, rolesDir } = makeRoleFixture();
    try {
      const service = createService({ rolesDir });
      service.role.activate("zero");

      const prompt = await service.buildSystemPrompt("Base prompt");
      expect(prompt).toContain("Base prompt");
      expect(prompt).toContain("FIRST RUN - BOOTSTRAP");
      expect(prompt).toContain("Initialize this role.");
      expect(prompt).toContain("delete BOOTSTRAP.md");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("memory export returns HTML for the active role", () => {
    const { tmp, rolesDir } = makeRoleFixture();
    try {
      const service = createService({ rolesDir });
      service.role.activate("zero");

      const html = service.memory.exportHtml();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("zero");
      expect(existsSync(join(tmp, "roles", "zero", "memory-export.html"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
