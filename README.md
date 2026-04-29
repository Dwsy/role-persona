# role-persona

Role-based persona system for AI agents — memory, knowledge, and embedding management.

Runs as a **Pi extension**, **CLI**, **MCP server**, or **HTTP daemon**.

[中文文档](./README.zh-CN.md)

## Quick start

```bash
# Clone
git clone https://github.com/Dwsy/role-persona.git
cd role-persona
bun install

# Initialize (detects mapped role for current directory)
bun src/bin/cli.ts init

# Use
bun src/bin/cli.ts memory list
bun src/bin/cli.ts memory search "query"
bun src/bin/cli.ts knowledge list
```

## What it does

| Feature | Description |
|---------|-------------|
| **Memory** | Auto-extracted learnings, preferences, events from conversations |
| **Knowledge** | Multi-source knowledge base with search, tags, and categories |
| **Embedding** | Vector search with OpenAI, local ONNX, or shared daemon |
| **Roles** | Per-directory persona with independent memory and prompts |
| **Auto-extract** | LLM-powered memory extraction during agent compaction |
| **Tags** | Auto-tagging with forgetting curve (Ebbinghaus) |
| **Pending layer** | New memories go through verification before becoming permanent |

## Architecture

```
Transport Layer (1,817L)
├── Pi Adapter     532L   thin CLI wrapper, zero service dep
├── CLI            303L   daemon-aware, JSON output
├── MCP Server     221L   Streamable HTTP, SSE
├── HTTP Daemon    334L   Bun.serve, pidfile, single-instance
├── Memory Server  286L   HTML viewer with theme toggle + log dashboard
├── CLI Runner     185L   daemon HTTP → subprocess fallback
├── HTTP Client     52L   daemon HTTP client
└── TUI Renderers  326L   Pi tool result renderers
        │
Service Layer (877L) ← zero Pi dependency
├── context         65L   ServiceContext
├── index          188L   RolePersonaService facade
├── role-service   184L   role CRUD + mapping
├── memory-service 306L   14 memory actions + auto-extract
├── knowledge-svc   71L   knowledge CRUD + search
└── embedding-svc   63L   vector lifecycle
        │
Core Layer (10,071L) ← zero Pi dependency, pure functions
├── types           591L   shared type definitions
├── config          677L   three-tier config (env/jsonc/default)
├── logger          478L   JSONL structured logging
├── spinner-utils    14L   spinner frames
├── role-store      458L   role CRUD, CWD mapping, migration
├── role-template   376L   i18n prompts (zh/en)
├── memory-md      2185L   memory CRUD, parsing, search, pending
├── memory-llm      726L   LLM auto-extraction + tidy
├── extraction-rules  50L   ephemeral/derivable filtering
├── memory-tags     773L   LLM tagging, forgetting curve
├── memory-vector   806L   LanceDB vector, hybrid search
├── memory-export   687L   HTML export with tree navigation
├── knowledge       831L   multi-source knowledge CRUD
├── embedding-daemon 822L   shared ONNX daemon server
├── embedding-minilm 443L   direct ONNX provider
└── daemon-client   154L   daemon client provider
```

## Runtime modes

### 1. CLI (default)

```bash
# Direct execution (cold start ~250ms)
role-persona memory search "query"

# Daemon-aware (auto-detects running daemon, warm ~5ms)
role-persona daemon start --background
role-persona memory search "query"  # routes through HTTP

# Force direct execution
role-persona --direct memory search "query"

# Human-readable output
role-persona --human memory list
```

All commands output JSON to stdout:
```json
{ "ok": true, "data": {...}, "message": "Human summary" }
{ "ok": false, "error": "Description" }
```

### 2. Daemon (persistent background server)

```bash
role-persona daemon start              # foreground
role-persona daemon start --background # detach
role-persona daemon status             # health check
role-persona daemon stop               # graceful shutdown
```

Features:
- PID file at `~/.pi/role-persona-daemon.pid` (single instance)
- Port file at `~/.pi/role-persona-daemon.port`
- Graceful shutdown on SIGTERM/SIGINT
- Warm service: stays in memory, no cold start
- 20 REST endpoints mirroring the Service facade

### 3. MCP Server (Streamable HTTP)

```bash
bun src/transport/mcp-server.ts
# → http://localhost:3939/mcp
```

Protocol: MCP spec 2025-03-26
Transport: `WebStandardStreamableHTTPServerTransport`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | JSON-RPC (initialize, tools/call, tools/list) |
| `/mcp` | GET | SSE stream for server-initiated messages |
| `/mcp` | DELETE | Session termination |
| `/health` | GET | Health check |

4 tools: `memory`, `knowledge`, `role_info`, `role_management`

### 4. Pi Extension

```typescript
// extensions/role-persona/index.ts
export { default } from "../../role-persona/src/transport/pi-adapter.ts";
```

The adapter delegates all operations to the CLI via `cli-runner.ts`:
- If daemon is running → HTTP call (~5ms)
- If daemon is not running → subprocess spawn (~250ms)

Zero imports from service/core layers.

**Extension points:**

| Type | Count | Details |
|------|-------|---------|
| Events | 7 | session_start, resources_discover, before_agent_start, agent_end, session_before_compact, session_shutdown, turn_end |
| Tools | 3 | memory (14 actions), knowledge (4 actions), role_info |
| Commands | 13 | /role, /memories, /memory-log, /memory-fix, /memory-tidy, /memory-tidy-llm, /memory-vector, /memory-tags, /memory-conflicts, /memory-export, /memory-distill, /memory-distill-stop, /kb |

## CLI commands reference

### Role management

```bash
role-persona role list                           # List all roles
role-persona role create <name>                  # Create a new role
role-persona role info                           # Current role info
role-persona role map <role>                     # Map current directory to role
role-persona role unmap                          # Unmap and disable role
```

### Memory management

```bash
# CRUD
role-persona memory add-learning "content"       # Add a learning
role-persona memory add-preference "content" --category Code  # Add preference
role-persona memory update-learning <id> "new text"
role-persona memory update-preference <id> "new text"
role-persona memory delete-learning <id>
role-persona memory delete-preference <id>
role-persona memory reinforce <id>               # Increment usage count

# Query
role-persona memory search "query"               # Search (keyword + vector hybrid)
role-persona memory list                         # List all memories

# Maintenance
role-persona memory consolidate                  # Deduplicate and organize
role-persona memory repair                       # Fix markdown format
role-persona memory tidy                         # Manual tidy
role-persona memory tidy --llm                   # LLM-powered tidy
role-persona memory tidy --llm --model openai/gpt-4.1-mini  # Specific model

# Export
role-persona memory export                       # Export to HTML
role-persona memory export --output ~/mem.html   # Custom path

# Debug
role-persona memory conflicts                    # Detect conflicting memories
role-persona memory log                          # Session operation log

# Stdin-based
echo '[{"role":"user","content":[{"type":"text","text":"hello"}]' | role-persona memory build-prompt
echo '[{"role":"user","content":[{"type":"text","text":"hello"}]' | role-persona memory extract-memory
```

### Knowledge base

```bash
role-persona knowledge list                      # List all entries
role-persona knowledge list Architecture         # Filter by category
role-persona knowledge search "query"            # Search entries
role-persona knowledge search "query" --tags "tag1,tag2"
role-persona knowledge read <path>               # Read entry
role-persona knowledge write --title "Title" --content "Body" [--category Cat] [--tags "t1,t2"]
```

### Embedding / Vector

```bash
role-persona embedding stats                     # Vector memory status
role-persona embedding rebuild                   # Rebuild vector index
```

### System

```bash
role-persona init                                # Initialize roles directory
role-persona prompt                              # Output full system prompt
role-persona prompt --base "Custom base prompt"  # With custom base
```

## Configuration

### File location

The config file is searched in this order:

1. `~/.pi/roles/pi-role-persona.jsonc` (recommended)
2. `~/.pi/agent/pi-role-persona.jsonc`
3. Extension directory
4. Current working directory

Create the file at `~/.pi/roles/pi-role-persona.jsonc`:

```jsonc
{
  // ── Storage ──
  "storage": {
    "rolesDir": "~/.pi/roles"  // Roles directory (default)
  },

  // ── Auto Memory Extraction ──
  // Extracts learnings/preferences from conversations automatically
  "autoMemory": {
    "enabled": true,
    // Model for extraction. Supports multiple formats:
    //   Single: "provider/model-id"
    //   Array:  ["provider/model-1", "provider/model-2"]  (fallback chain)
    //   Object: [{"provider": "openai", "model": "gpt-4.1-mini"}]
    "model": "openai-codex/gpt-5.1-codex-mini",
    "tagModel": null,         // Tag extraction model (inherits from model if null)
    "reserveTokens": 8192,    // Token reserve for extraction
    "maxItems": 3,            // Max items per extraction
    "maxText": 200,           // Max text length per item
    "batchTurns": 5,          // Extract after N turns
    "minTurns": 2,            // Min turns before extraction
    "intervalMs": 1800000,    // Extract interval (30 min)
    "contextOverlap": 4       // Message overlap between extractions
  },

  // ── Memory Settings ──
  "memory": {
    "defaultCategories": ["Communication", "Code", "Tools", "Workflow", "General"],
    "dailyPathTemplate": "{rolePath}/memory/daily/{date}.md",
    "dedupeThreshold": 0.9,   // Similarity threshold for dedup
    "onDemandSearch": {
      "enabled": true,        // Search relevant memories on first message
      "maxResults": 5,
      "minScore": 0.2,
      "alwaysLoadHighPriority": true
    },
    "searchDefaults": {
      "maxResults": 20,
      "minScore": 0.1,
      "includeDailyMemory": true
    }
  },

  // ── Vector Memory ──
  "vectorMemory": {
    "enabled": false,         // Enable vector search
    // Provider: "openai" | "local" | "minilm-direct" | "minilm-daemon"
    "provider": "minilm-daemon",
    "model": "text-embedding-3-small",
    "apiKey": null,           // OpenAI API key (for openai provider)
    "baseUrl": "http://127.0.0.1:52131",  // Local provider URL
    // MiniLM-specific config (for minilm-* providers)
    "minilm": {
      "mode": "daemon",       // "direct" (single-process) or "daemon" (shared)
      "maxSeqLength": 512,
      "batchSize": 8,
      "timeoutMs": 5000,
      "autoStartDaemon": true,
      "useGPU": false
    },
    "autoRecall": true,       // Inject relevant memories on each message
    "autoIndex": true,        // Auto-index new memories
    "hybridSearch": true,     // Combine vector + keyword search
    "vectorWeight": 1.0,      // Vector score weight in hybrid search
    "recallLimit": 3,         // Max recalled items
    "recallMinScore": 0.3,    // Min score for recall
    "dbPath": ".vector-db"    // LanceDB path (relative to role)
  },

  // ── Knowledge Base ──
  "knowledge": {
    "enabled": true,
    "vectorTable": "knowledge",
    "search": {
      "maxResults": 5,
      "minScore": 0.2,
      "roleBoost": 1.2        // Score boost for role-specific entries
    },
    "externalSources": []     // External readonly knowledge sources
  },

  // ── External Readonly Memory ──
  // Inject cross-session memory hints (read-only)
  "externalReadonly": {
    "enabled": false,
    "baseUrl": "http://127.0.0.1:52131",
    "token": null,
    "timeoutMs": 1200,
    "topK": 8,
    "experienceLimit": 8,
    "minConfidence": 0.35
  },

  // ── Logging ──
  "logging": {
    "enabled": true,
    "level": "debug",         // "debug" | "info" | "warn" | "error"
    "retentionDays": 7
  },

  // ── UI ──
  "ui": {
    "spinnerIntervalMs": 120,
    "viewerDefaultFilter": "all"  // "all" | "learnings" | "preferences" | "events"
  },

  // ── Advanced ──
  "advanced": {
    "shutdownFlushTimeoutMs": 1500,
    "forceKeywords": "结束|总结|退出|收尾|final|summary|wrap\\s?up|quit|exit",
    "evolutionReminderTurns": 10
  }
}
```

### Environment variables

All settings can be overridden with environment variables:

| Variable | Config path | Example |
|----------|-------------|---------|
| `PI_ROLES_DIR` | storage.rolesDir | `~/.pi/roles` |
| `ROLE_LOG_LEVEL` | logging.level | `info` |
| `ROLE_LOG_ENABLED` | logging.enabled | `1` |
| `ROLE_VECTOR_PROVIDER` | vectorMemory.provider | `minilm-daemon` |
| `ROLE_VECTOR_ENABLED` | vectorMemory.enabled | `1` |

### Provider comparison

| Provider | Deps | Dimensions | Memory | Latency | Use case |
|----------|------|-----------|--------|---------|----------|
| `openai` | OpenAI API | 1536/3072 | 0 local | ~100ms | Highest quality |
| `local` | pi-session-manager | 768 | 435MB | ~30ms | Backward compat |
| `minilm-direct` | onnxruntime-node | 384 | 150MB | ~15ms | Single process |
| `minilm-daemon` | onnxruntime-node | 384 | 150MB shared | ~20ms | Multi-session (recommended) |

## Data layout

```
~/.pi/roles/
├── config.json                    # CWD → role mapping
├── pi-role-persona.jsonc          # Configuration file
├── knowledge/                     # Global knowledge base
│   ├── Architecture/
│   ├── Code/
│   └── ...
└── <role>/                        # e.g. "zero", "default"
    ├── core/                      # Persona definitions
    │   ├── agents.md              # Workspace rules
    │   ├── identity.md            # Name, style, emoji
    │   ├── soul.md                # Personality, values
    │   ├── user.md                # User profile
    │   ├── tools.md               # Tool preferences
    │   ├── heartbeat.md           # Proactive check rules
    │   └── constraints.md         # Hard boundaries
    ├── memory/
    │   ├── consolidated.md        # Long-term structured memory
    │   ├── pending.md             # Verification buffer
    │   └── daily/                 # Daily logs
    │       ├── 2026-01-15.md
    │       └── 2026-01-16.md
    ├── knowledge/                 # Role-specific knowledge
    ├── context/                   # Session context
    ├── skills/                    # Role skills
    ├── archive/                   # Old memories
    └── .vector-db/                # LanceDB vector index

~/.pi/
├── role-persona-daemon.pid        # Daemon PID file
├── role-persona-daemon.port       # Daemon port file
├── sockets/                       # Embedding daemon IPC
│   └── embedding-daemon.sock
└── models/                        # ONNX models
    └── all-MiniLM-L6-v2/
        └── model.onnx (~80MB)
```

## Testing

```bash
bun test
# 31 pass, 0 fail, 90 assertions, ~6s
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| CLI | 18 | All commands, JSON output, error handling |
| MCP | 7 | Streamable HTTP, initialize, tools, sessions |
| Core | 6 | Types, extraction rules, config |

## Development

```bash
# Install deps
bun install

# Run CLI
bun src/bin/cli.ts --help

# Run daemon
bun src/bin/daemon.ts --background

# Run MCP server
bun src/transport/mcp-server.ts

# Run tests
bun test

# Type check
bun x tsc --noEmit
```

## License

MIT
