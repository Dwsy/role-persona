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
  buildMemoryEditInstruction, exportMemoryToHtml, exportMemoryToJson, exportMemoryToMarkdown, exportMemory,
  detectMemoryConflicts, getConflictReport,
  getPendingMemories, getPendingStats, promotePendingLearning, expirePendingMemories,
  appendDailyRoleMemory,
  textSimilarity, findPotentialDuplicates, smartDedup,
  parseDailyMemory, generateDailySummary, summarizeDateRange, type DailySummaryResult,
  getMemoryUsageStats, updateMemoryUsage, type MemoryUsageStats,
  fuzzySimilarity, type ExportFormat, type ExportOptions,
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
  smartAutoRecall, detectRecallIntent, type RecallIntent,
  incrementalIndex, batchIncrementalIndex, vectorIndexContains,
  type IndexAction, type IncrementalIndexResult,
} from "./memory-vector.ts";
export {
  ensureMemoryScenarioLayer, writeMemoryScenario, listMemoryScenarios,
  readMemoryScenario, searchMemoryScenarios, buildScenarioPromptBlock,
  detectScenarioTriggers, shouldInjectScenarioContext, type ScenarioTriggerResult,
} from "./memory-scenarios.ts";
export {
  listKnowledge, readKnowledge, searchKnowledge, writeKnowledge,
  buildKnowledgeTagCloud, formatTagCloudMarkdown, formatTagCloudHtml,
  type TagCloudItem, type TagCloudResult,
} from "./knowledge.ts";
export {
  type EmbeddingProvider,
  OpenAIEmbeddingProvider,
  LocalEmbeddingProvider,
  MiniLMEmbeddingProvider,
  createEmbeddingProvider,
} from "./embedding.ts";
export { VectorDB } from "./vector-db.ts";
export {
  AllMiniLMEmbeddingProvider,
} from "./embedding-minilm.ts";
