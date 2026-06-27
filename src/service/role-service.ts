/**
 * Role Service — role CRUD, mapping, resolution.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type {
  ActiveRole,
  RoleConfig,
  RoleResolution,
  RoleIdentity,
  RoleCreateResult,
  MapResult,
  UnmapResult,
  DirectoryListing,
  MigrationResult,
} from "../core/types.ts";
import {
  createRole,
  DEFAULT_ROLE,
  ensureRolesDir,
  getRoleIdentity,
  getRoles,
  isFirstRun,
  isRoleDisabledForCwd,
  loadRoleConfig,
  loadRolePrompts,
  migrateAllRolesToStructuredLayout,
  resolveRoleForCwd,
  ROLES_DIR,
  saveRoleConfig,
} from "../core/role-store.ts";
import { repairRoleMemory, expirePendingMemories, ensureRoleMemoryFiles } from "../core/memory-md.ts";
import { log } from "../core/logger.ts";
import type { ServiceContext } from "./context.ts";

export interface StructureOptions {
  recursive?: boolean;
  maxEntries?: number;
}

export interface RoleService {
  list(): string[];
  get(): ActiveRole | null;
  create(name: string): RoleCreateResult;
  activate(name: string): ActiveRole;
  map(cwd: string, roleName: string): MapResult;
  unmap(cwd: string): UnmapResult;
  resolve(cwd: string): RoleResolution;
  getIdentity(rolePath: string): RoleIdentity | null;
  getPrompts(rolePath: string): string;
  getStructure(rolePath: string, subPath?: string, options?: StructureOptions): DirectoryListing;
  loadConfig(): RoleConfig;
  saveConfig(config: RoleConfig): void;
  migrateAll(): MigrationResult;
}

function normalizePath(path: string): string {
  return path.replace(/\/$/, "");
}

export function createRoleService(ctx: ServiceContext): RoleService {
  return {
    list() {
      return getRoles();
    },

    get() {
      return ctx.activeRole;
    },

    create(name: string) {
      const rolePath = join(ctx.rolesDir, name);
      if (existsSync(rolePath)) {
        return { ok: false, path: rolePath, name };
      }
      createRole(name);
      return { ok: true, path: rolePath, name };
    },

    activate(name: string) {
      const rolePath = join(ctx.rolesDir, name);
      if (!existsSync(rolePath)) {
        createRole(name);
      }

      // Ensure memory files exist
      ensureRoleMemoryFiles(rolePath, name);

      // Auto-repair consolidated.md
      try {
        const repairResult = repairRoleMemory(rolePath, name);
        if (repairResult.repaired) {
          log("role-activate", `auto-repair: ${repairResult.issues} issues fixed for ${name}`);
        }
      } catch { /* repair is best-effort */ }

      // Expire old pending memories (> 7 days without promotion)
      try {
        const expireResult = expirePendingMemories(rolePath, 7);
        if (expireResult.expired > 0) {
          log("role-activate", `expired ${expireResult.expired} old pending memories for ${name}`);
        }
      } catch { /* expire is best-effort */ }

      const identity = getRoleIdentity(rolePath);
      const firstRun = isFirstRun(rolePath);
      const active: ActiveRole = { name, path: rolePath, identity, isFirstRun: firstRun };
      ctx.activeRole = active;
      return active;
    },

    map(cwd: string, roleName: string) {
      const rolePath = join(ctx.rolesDir, roleName);
      if (!existsSync(rolePath)) {
        throw new Error(`Role "${roleName}" does not exist.`);
      }
      const config = loadRoleConfig();
      const cwdKey = normalizePath(cwd);
      config.mappings[cwdKey] = roleName;
      config.disabledPaths = (config.disabledPaths || []).filter((p) => normalizePath(p) !== cwdKey);
      saveRoleConfig(config);
      this.activate(roleName);
      return { ok: true, cwd: cwdKey, role: roleName };
    },

    unmap(cwd: string) {
      const config = loadRoleConfig();
      const cwdKey = normalizePath(cwd);
      let removedMapping = false;
      for (const [path] of Object.entries(config.mappings)) {
        if (normalizePath(path) === cwdKey) {
          delete config.mappings[path];
          removedMapping = true;
        }
      }
      const disabled = new Set((config.disabledPaths || []).map((p) => normalizePath(p)));
      disabled.add(cwdKey);
      config.disabledPaths = Array.from(disabled);
      saveRoleConfig(config);
      ctx.activeRole = null;
      return { ok: true, removedMapping };
    },

    resolve(cwd: string) {
      const config = loadRoleConfig();
      return resolveRoleForCwd(cwd, config);
    },

    getIdentity(rolePath: string) {
      return getRoleIdentity(rolePath);
    },

    getPrompts(rolePath: string) {
      return loadRolePrompts(rolePath);
    },

    getStructure(rolePath: string, subPath?: string, options: StructureOptions = {}) {
      const requested = (subPath || ".").trim().replace(/^\/+/, "") || ".";
      const target = requested === "." ? rolePath : join(rolePath, requested);
      const resolvedTarget = resolve(target);
      const resolvedRoot = resolve(rolePath);

      // Security: prevent path escape
      const rel = relative(resolvedRoot, resolvedTarget);
      const relParts = rel.split(/[\\/]/).filter(Boolean);
      if (rel.startsWith("..") || relParts.includes("..")) {
        throw new Error("Path escapes role directory.");
      }

      if (!existsSync(resolvedTarget)) {
        throw new Error(`Path not found: ${requested}`);
      }

      const recursive = options.recursive ?? false;
      const maxEntries = Math.max(1, Math.min(500, Math.floor(options.maxEntries || 200)));
      const st = statSync(resolvedTarget);
      let files: string[] = [];
      if (st.isFile()) {
        files = [resolvedTarget];
      } else {
        const visit = (dir: string) => {
          if (files.length >= maxEntries) return;
          const entries = readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of entries) {
            if (files.length >= maxEntries) break;
            const full = join(dir, entry.name);
            if (entry.isFile()) {
              files.push(full);
            } else if (recursive && entry.isDirectory()) {
              visit(full);
            }
          }
        };
        visit(resolvedTarget);
      }

      const relFiles = files.slice(0, maxEntries).map((p: string) => relative(resolvedRoot, p) || ".");

      return {
        path: rolePath,
        base: rel || ".",
        files: relFiles,
        count: relFiles.length,
        recursive,
      };
    },

    loadConfig() {
      return loadRoleConfig();
    },

    saveConfig(config: RoleConfig) {
      saveRoleConfig(config);
    },

    migrateAll() {
      return migrateAllRolesToStructuredLayout();
    },
  };
}
