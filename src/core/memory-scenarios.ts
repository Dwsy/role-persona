import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export interface MemoryScenarioInput {
  title: string;
  triggers?: string[];
  scope?: string;
  guidance: string;
  evidence?: string[];
}

export interface MemoryScenarioRecord extends MemoryScenarioInput {
  id: string;
  updated: string;
  path: string;
}

export interface MemoryScenarioSearchMatch extends MemoryScenarioRecord {
  score: number;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function slugify(text: string): string {
  const slug = normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "scenario";
}

function hashId(text: string): string {
  return createHash("sha1").update(text.toLowerCase()).digest("hex").slice(0, 8);
}

function scenarioDir(rolePath: string): string {
  return join(rolePath, "memory", "scenarios");
}

function scenarioPath(rolePath: string, id: string): string {
  return join(scenarioDir(rolePath), `${id}.md`);
}

function ensureScenarioDir(rolePath: string): void {
  const dir = scenarioDir(rolePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5\s/_-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

function scoreText(query: string, text: string): number {
  const q = tokenize(query);
  const t = tokenize(text);
  if (q.size === 0 || t.size === 0) return 0;
  let overlap = 0;
  for (const token of q) if (t.has(token)) overlap += 1;
  return overlap / q.size;
}

function parseListSection(lines: string[]): string[] {
  return lines
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1])
    .filter((item): item is string => Boolean(item))
    .map(normalizeText)
    .filter(Boolean);
}

function section(content: string, heading: string): string {
  const match = content.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |\\z)`, "m"));
  return match?.[1]?.trim() || "";
}

export function ensureMemoryScenarioLayer(rolePath: string): void {
  ensureScenarioDir(rolePath);
}

export function writeMemoryScenario(rolePath: string, input: MemoryScenarioInput): MemoryScenarioRecord {
  ensureScenarioDir(rolePath);
  const title = normalizeText(input.title);
  const guidance = input.guidance.trim();
  const id = `${slugify(title)}-${hashId(`${title}:${guidance}`)}`;
  const updated = today();
  const triggers = (input.triggers || []).map(normalizeText).filter(Boolean);
  const evidence = (input.evidence || []).map(normalizeText).filter(Boolean);
  const scope = normalizeText(input.scope || "role");
  const path = scenarioPath(rolePath, id);

  const body = [
    "---",
    `id: ${JSON.stringify(id)}`,
    `title: ${JSON.stringify(title)}`,
    `scope: ${JSON.stringify(scope)}`,
    `updated: ${JSON.stringify(updated)}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Trigger Cues",
    triggers.length ? triggers.map((item) => `- ${item}`).join("\n") : "- (none)",
    "",
    "## Guidance",
    guidance,
    "",
    "## Evidence",
    evidence.length ? evidence.map((item) => `- ${item}`).join("\n") : "- (none)",
    "",
  ].join("\n");

  writeFileSync(path, body, "utf-8");
  return { id, title, scope, triggers, guidance, evidence, updated, path };
}

export function listMemoryScenarios(rolePath: string): MemoryScenarioRecord[] {
  ensureScenarioDir(rolePath);
  return readdirSync(scenarioDir(rolePath))
    .filter((name) => name.endsWith(".md"))
    .map((name) => readMemoryScenario(rolePath, name.replace(/\.md$/, "")))
    .filter((item): item is MemoryScenarioRecord => Boolean(item))
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
}

export function readMemoryScenario(rolePath: string, id: string): MemoryScenarioRecord | null {
  const path = scenarioPath(rolePath, id);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
  const triggers = parseListSection(section(content, "Trigger Cues").split(/\r?\n/)).filter((item) => item !== "(none)");
  const evidence = parseListSection(section(content, "Evidence").split(/\r?\n/)).filter((item) => item !== "(none)");
  const guidance = section(content, "Guidance");
  const scope = content.match(/^scope:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "role";
  const updated = content.match(/^updated:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "") || today();
  return { id, title, scope, triggers, guidance, evidence, updated, path };
}

export function searchMemoryScenarios(rolePath: string, query: string, limit = 3, minScore = 0.25): MemoryScenarioSearchMatch[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  return listMemoryScenarios(rolePath)
    .map((scenario) => {
      const haystack = [scenario.title, scenario.scope, ...(scenario.triggers || []), scenario.guidance].join("\n");
      return { ...scenario, score: scoreText(normalizedQuery, haystack) };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export function buildScenarioPromptBlock(matches: MemoryScenarioSearchMatch[]): string {
  if (matches.length === 0) return "";
  const blocks = matches.map((scenario) => [
    `### ${scenario.title}`,
    `- id: ${scenario.id}`,
    `- score: ${scenario.score.toFixed(2)}`,
    scenario.triggers?.length ? `- triggers: ${scenario.triggers.join(", ")}` : "- triggers: (none)",
    "",
    scenario.guidance,
    scenario.evidence?.length ? `\nEvidence:\n${scenario.evidence.map((item) => `- ${item}`).join("\n")}` : "",
  ].join("\n"));

  return [`## Scenario Memory Hints`, ...blocks].join("\n\n");
}

// ============================================================================
// Auto-Trigger: Analyze conversation and suggest relevant scenarios
// ============================================================================

export interface ScenarioTriggerResult {
  /** Whether any scenarios were triggered */
  triggered: boolean;
  /** Matched scenarios */
  scenarios: MemoryScenarioSearchMatch[];
  /** Formatted prompt block for injection */
  promptBlock: string;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Analyze a conversation and detect if any scenarios should be triggered.
 * This is designed to be called at the start of a conversation turn.
 */
export function detectScenarioTriggers(
  rolePath: string,
  messages: Array<{ role: string; content?: string }>,
  opts?: {
    limit?: number;
    minScore?: number;
    maxMessages?: number;
  },
): ScenarioTriggerResult {
  const limit = opts?.limit ?? 3;
  const minScore = opts?.minScore ?? 0.3;
  const maxMessages = opts?.maxMessages ?? 5;

  // Build query from recent messages
  const recentMessages = messages
    .filter(m => m.role === "user")
    .slice(-maxMessages);

  if (recentMessages.length === 0) {
    return { triggered: false, scenarios: [], promptBlock: "", confidence: 0 };
  }

  // Combine recent user messages for better context
  const query = recentMessages
    .map(m => m.content || "")
    .join(" ");

  if (query.length < 5) {
    return { triggered: false, scenarios: [], promptBlock: "", confidence: 0 };
  }

  // Search for matching scenarios
  const matches = searchMemoryScenarios(rolePath, query, limit, minScore);

  if (matches.length === 0) {
    return { triggered: false, scenarios: [], promptBlock: "", confidence: 0 };
  }

  // Calculate overall confidence
  const avgScore = matches.reduce((sum, m) => sum + m.score, 0) / matches.length;
  const confidence = Math.min(avgScore * 1.5, 1); // Scale up but cap at 1

  // Build prompt block
  const promptBlock = buildScenarioPromptBlock(matches);

  return {
    triggered: true,
    scenarios: matches,
    promptBlock,
    confidence,
  };
}

/**
 * Quick check: should we inject scenario context?
 * Returns true if the conversation likely needs scenario context.
 */
export function shouldInjectScenarioContext(
  rolePath: string,
  query: string,
): boolean {
  if (!query || query.length < 5) return false;

  const matches = searchMemoryScenarios(rolePath, query, 1, 0.4);
  return matches.length > 0;
}
