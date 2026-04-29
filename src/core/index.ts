/**
 * Core layer barrel export.
 * Re-exports all core modules for library consumers.
 */

export * from "./types.ts";
export { config, loadConfig, reloadConfig, getConfig } from "./config.ts";
export { log, logStart, logEnd, logWarn, logError } from "./logger.ts";
export {
  createRole, getRoles, getRoleIdentity, isFirstRun,
  resolveRoleForCwd, loadRoleConfig, saveRoleConfig,
  loadRolePrompts, ensureRolesDir, migrateAllRolesToStructuredLayout,
  ROLES_DIR, DEFAULT_ROLE,
} from "./role-store.ts";
export { getDefaultPrompts, resolveTemplateLanguage } from "./role-template.ts";
export {
  addRoleLearning, addRolePreference, updateRoleLearning, updateRolePreference,
  deleteRoleLearning, deleteRolePreference, reinforceRoleLearning,
  searchRoleMemory, listRoleMemory, readRoleMemory,
  consolidateRoleMemory, repairRoleMemory, ensureRoleMemoryFiles,
  readMemoryPromptBlocks, loadHighPriorityMemories, loadMemoryOnDemand,
  buildMemoryEditInstruction, exportMemoryToHtml,
  detectMemoryConflicts, getConflictReport,
  getPendingMemories, getPendingStats, promotePendingLearning, expirePendingMemories,
  appendDailyRoleMemory,
} from "./memory-md.ts";
export {
  runAutoMemoryExtraction, runLlmMemoryTidy,
} from "./memory-llm.ts";
export {
  getAllTags, buildTagCloudHTML,
} from "./memory-tags.ts";
export {
  initVectorMemory, isVectorActive, queueVectorIndex, flushVectorIndex,
  disposeVectorMemory, hybridSearch, autoRecall, rebuildVectorIndex, getVectorStats,
} from "./memory-vector.ts";
export {
  listKnowledge, readKnowledge, searchKnowledge, writeKnowledge,
} from "./knowledge.ts";
export {
  AllMiniLMEmbeddingProvider,
} from "./embedding-minilm.ts";
