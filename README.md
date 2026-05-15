# Role Persona

> Role-based persona system for AI agents — memory, knowledge, embedding.
> CLI · HTTP Daemon · MCP Server · Pi Extension · Web Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.0.0-yellow)](https://bun.sh)

---

## Overview

Role Persona is a persistent memory and knowledge system for AI coding agents. It provides:

- **Role Management** — independent personas with isolated memory/knowledge
- **Memory System** — learnings, preferences, auto-extraction, consolidation, vector search
- **Knowledge Base** — multi-source, tag-searchable, version-controlled entries
- **Vector Memory** — LanceDB-backed semantic search with hybrid keyword+vector fusion
- **Multiple Interfaces** — CLI, HTTP daemon, MCP server, Pi extension, Web dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Consumers                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐│
│  │   CLI    │  │  Daemon  │  │ MCP Srv  │  │   Pi Plugin      ││
│  │          │  │ (HTTP)   │  │ (RPC)    │  │ (direct service) ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘│
│       │              │              │                │           │
│  ┌────┴──────────────┴──────────────┴────────────────┴────────┐ │
│  │              ServiceManager (CWD multiplexing)              │ │
│  │   CWD → Service instance    Role name → Service instance   │ │
│  │   30min idle timeout        Auto cleanup                    │ │
│  └────┬───────────────────────────────────────────────────────┘ │
│       │                                                         │
│  ┌────┴──────────────────────────────────────────────────────┐ │
│  │                   Service Layer                            │ │
│  │  RoleService · MemoryService · KnowledgeService            │ │
│  │  EmbeddingService · SystemPromptBuilder                    │ │
│  └────┬──────────────┬──────────────┬───────────────┬────────┘ │
│       │              │              │               │           │
│  ┌────┴──────┐ ┌─────┴─────┐ ┌─────┴──────┐ ┌─────┴────────┐ │
│  │  Core     │ │ Embedding │ │ Vector DB  │ │   Config     │ │
│  │ memory-md │ │ providers │ │  (LanceDB) │ │  (JSONC)     │ │
│  │ memory-llm│ │ OpenAI    │ │            │ │              │ │
│  │ memory-tag│ │ Local     │ │            │ │              │ │
│  └───────────┘ │ MiniLM    │ └────────────┘ └──────────────┘ │
│                └───────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Multiplexing

The daemon supports **CWD-based** and **role-based** multiplexing:

```
CLI mode:    POST /api/memory/list { "cwd": "/project" }  → resolves role from CWD
Web mode:    POST /api/memory/list { "role": "zero" }     → directly activates role
Pi mode:     Direct service import (no HTTP)
```

Each CWD/role gets an independent service instance with 30-minute idle timeout.

## Quick Start

### Installation

```bash
git clone https://github.com/Dwsy/role-persona.git
cd role-persona
bun install
bun run build
```

### CLI Usage

```bash
# Initialize (auto-creates role from CWD)
role-persona init

# Role management
role-persona role list
role-persona role create my-role
role-persona role info

# Memory
role-persona memory list
role-persona memory search "query"
role-persona memory add-learning "Always use TypeScript strict mode"
role-persona memory add-preference "Use pnpm" --category Tools
role-persona memory consolidate
role-persona memory repair
role-persona memory tidy

# Knowledge
role-persona knowledge list
role-persona knowledge search "design patterns"
role-persona knowledge write --title "ADR-001" --content "..." --category architecture

# Vector memory
role-persona embedding stats
role-persona embedding rebuild

# Scenario memory (L2)
role-persona memory scenario-write --title "Code review output" --guidance "Give the conclusion first, then group findings by Critical/Medium/Low." --triggers "code review,review feedback"
role-persona memory scenario-search "review this PR"
role-persona memory scenario-list
role-persona memory scenario-read <scenario-id>

# System prompt
role-persona prompt --base "You are a helpful assistant."
```

### HTTP Daemon

```bash
# Start (persists in memory, warm service)
role-persona daemon start

# Background mode
role-persona daemon start --background

# Custom port
role-persona daemon start --port 8080

# Status / Stop
role-persona daemon status
role-persona daemon stop
```

### Web Dashboard

```bash
# Build
cd web && bun install && bun run build

# Start
role-persona --web                    # unified daemon + web on port 3939
role-persona --web --port 8080        # custom unified port
```

Features:
- **Dashboard** — role banner, memory breakdown, knowledge sources, vector stats, recent activity
- **Memory** — Explorer tree navigation, table view with edit/delete, Markdown rendering, regex search, keyboard shortcuts (`/` search, `j/k` nav, `c` copy)
- **Knowledge** — list, search, click to view Markdown, write new entries
- **Roles** — click to view role detail modal, switch roles
- **Settings** — daemon status, vector stats, JSONC config editor (Form mode with schema-driven inputs + raw JSONC mode)
- **i18n** — English/Chinese
- **Dark/Light** — theme toggle
- **Role selector** — header dropdown, auto-refresh all pages on switch
- **URL state** — tab/path/search persisted in URL params (bookmarkable)
- **Model selector** — dropdown populated from `models.json`

### Pi Extension

```typescript
// extensions/role-persona/index.ts
export { default } from "../../role-persona/src/extensions/pi/adapter.ts";
```

- Registers tools: `memory`, `knowledge`, `role_info`
- Registers commands: `/role`, `/memories`, `/memory-log`, `/memory-fix`, `/memory-tidy`, `/memory-tidy-llm`, `/memory-vector`, `/memory-export`, `/memory-conflicts`, `/memory-distill`, `/memory-distill-stop`, `/memory-tags`, `/kb`
- Handles events: `session_start`, `before_agent_start`, `agent_end`, `session_before_compact`, `session_shutdown`, `turn_end`
- Uses Pi SDK directly for LLM calls (no CLI subprocess)
- On-demand memory search on first message (vector + keyword hybrid)
- Vector auto-recall injection into system prompt
- External readonly memory hints (configurable)
- Compaction memory extraction (`<memory>` block parsing)
- Interactive memory→knowledge distillation mode
- TUI role selector and memory viewer (when available)
- HTTP memory server for browser-based browsing
- Auto-repair and pending expiration on role activation

### MCP Server

```bash
# Start on default port (3939)
bun src/transport/mcp-server.ts

# Custom port
MCP_PORT=8080 bun src/transport/mcp-server.ts
```

Streamable HTTP transport at `/mcp`.

## Configuration

Config file: `~/.pi/roles/pi-role-persona.jsonc`

```jsonc
{
  "autoMemory": {
    "enabled": true,
    "model": [
      { "provider": "nvidia", "model": "deepseek-ai/deepseek-v4-flash" },
      { "provider": "modelscope", "model": "ZhipuAI/GLM-5" }
    ],
    "batchTurns": 5,
    "intervalMs": 1800000
  },
  "vectorMemory": {
    "enabled": true,
    "provider": "openai",
    "model": "text-embedding-3-small",
    "autoRecall": true,
    "hybridSearch": true
  },
  "knowledge": {
    "enabled": true
  },
  "logging": {
    "enabled": true,
    "level": "info"
  }
}
```

Config can be edited via:
- **Web UI Form mode** — schema-driven form with dropdowns for model selection (reads `models.json`)
- **Web UI JSONC mode** — raw editor with `jsonc-parser` (comments preserved on edit)
- **CLI** — `role-persona` commands

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PI_ROLES_DIR` | Override roles directory |
| `ROLE_AUTO_MEMORY` | Enable/disable auto-memory (`0`/`false`) |
| `ROLE_AUTO_MEMORY_MODEL` | Override model |
| `ROLE_LOG` | Enable/disable logging (`0`/`false`) |
| `OPENAI_API_KEY` | OpenAI API key for embeddings |

## Daemon HTTP API

All responses: `{ "ok": true, "data": ... }` or `{ "ok": false, "error": { "code": "...", "message": "..." } }`

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | — | Health + instances |
| GET | `/api/instances` | — | List active instances |
| GET | `/api/models` | — | Available models from `models.json` |
| POST | `/api/cwd` | `{role?, cwd?}` | Switch/init context |
| POST | `/api/init` | `{role?, cwd?}` | Initialize |
| POST | `/api/role/list` | `{role?}` | List roles |
| POST | `/api/role/create` | `{name, role?}` | Create role |
| POST | `/api/role/info` | `{role?}` | Active role info |
| POST | `/api/memory/list` | `{role?}` | List memory |
| POST | `/api/memory/search` | `{query, role?}` | Search |
| POST | `/api/memory/add-learning` | `{content, role?}` | Add learning |
| POST | `/api/memory/consolidate` | `{role?}` | Consolidate |
| POST | `/api/memory/repair` | `{role?}` | Repair |
| POST | `/api/memory/tidy` | `{model?, role?}` | LLM tidy |
| POST | `/api/knowledge/list` | `{category?, role?}` | List knowledge |
| POST | `/api/knowledge/search` | `{query, role?}` | Search |
| POST | `/api/knowledge/read` | `{path, role?}` | Read entry |
| POST | `/api/knowledge/write` | `{title, content, role?}` | Write entry |
| POST | `/api/embedding/stats` | `{role?}` | Vector stats |
| POST | `/api/embedding/rebuild` | `{role?}` | Rebuild index |
| POST | `/api/file/read` | `{path, role?}` | Read role file |
| POST | `/api/file/write` | `{path, content, role?}` | Write role file |
| POST | `/api/file/list` | `{dir, role?}` | List role files |
| POST | `/api/config/read` | — | Read config |
| POST | `/api/config/write` | `{content}` | Write config |
| POST | `/api/prompt` | `{base?, role?}` | Build prompt |
| POST | `/api/shutdown` | — | Stop daemon |

## Project Structure

```
role-persona/
├── src/
│   ├── core/                    # Pure logic, zero Pi dependency
│   │   ├── types.ts             # Shared types (ModelRegistry, LlmCaller, ApiKeyResolver...)
│   │   ├── config.ts            # JSONC config loader
│   │   ├── logger.ts            # JSONL structured logging
│   │   ├── role-store.ts        # Role CRUD, CWD mapping
│   │   ├── memory-md.ts         # Markdown memory CRUD
│   │   ├── memory-llm.ts        # LLM auto-extraction
│   │   ├── memory-tags.ts       # LLM tag extraction
│   │   ├── memory-vector.ts     # Vector search orchestration
│   │   ├── embedding.ts         # Embedding providers (OpenAI/Local/MiniLM)
│   │   ├── vector-db.ts         # LanceDB wrapper
│   │   └── knowledge.ts         # Knowledge base CRUD
│   ├── service/                 # Unified facade
│   │   ├── context.ts           # ServiceContext
│   │   ├── index.ts             # RolePersonaService
│   │   └── *-service.ts         # Sub-services
│   ├── extensions/pi/
│   │   └── adapter.ts           # Pi extension (direct service + Pi SDK)
│   ├── transport/
│   │   ├── daemon.ts            # HTTP daemon (ServiceManager + multiplexing + static Web UI)
│   │   ├── mcp-server.ts        # MCP Streamable HTTP
│   │   └── tui-renderers.ts     # Pi TUI renderers
│   └── bin/
│       ├── cli.ts               # CLI entry (--web, --cwd, --direct)
│       └── daemon.ts            # Daemon entry
├── tests/
│   ├── memory-md.test.ts        # Memory CRUD tests (26/26)
│   ├── core.test.ts             # Core types/config tests
│   ├── cli.test.ts              # CLI integration tests
│   └── mcp.test.ts              # MCP protocol tests
├── web/                         # React dashboard
│   ├── src/
│   │   ├── api/client.ts        # Daemon API client (role-based)
│   │   ├── i18n/                # en.json, zh.json
│   │   ├── hooks/
│   │   │   ├── useApi.ts        # API call hook with loading/error state
│   │   │   └── useUrlState.ts   # URL search param persistence
│   │   ├── components/
│   │   │   ├── Layout.tsx       # Sidebar + topbar + role selector
│   │   │   ├── MarkdownViewer.tsx # Markdown + syntax highlight + edit
│   │   │   ├── JsoncForm.tsx    # Schema-driven JSONC form editor
│   │   │   ├── StatCard.tsx     # Dashboard stat card
│   │   │   └── EmptyState.tsx   # Empty state placeholder
│   │   └── pages/
│   │       ├── Dashboard.tsx    # Stats overview with clickable cards
│   │       ├── Memory.tsx       # Explorer tree + table + Markdown
│   │       ├── Knowledge.tsx    # List + search + Markdown view
│   │       ├── Roles.tsx        # Role grid + detail modal
│   │       └── Settings.tsx     # Config editor + daemon status
│   └── package.json
├── templates/
│   └── memory-export.html       # HTML export template
└── README.md
```

## Memory System

### Types

| Type | Description | Auto-Extracted |
|------|-------------|----------------|
| **Learning** | Cross-session insights | ✓ |
| **Preference** | User preferences | ✓ |
| **Event** | Session events | — |
| **Pending** | Awaiting verification | ✓ |

### Lifecycle

```
Conversation → Auto-Extract → Pending Layer → Verify → Consolidated
                                    ↓
                              Use-driven value
```

### Vector Memory

- **LanceDB** vector storage
- **Hybrid search**: vector + keyword → RRF fusion
- **Auto-index** on write
- **Auto-recall** at session start
- **Embedding providers**: OpenAI, local, MiniLM (ONNX)

### Scenario Memory (L2)

Scenario memory records “what to do in a recurring situation”. It sits between pending atomic facts and consolidated persona guidance, and is useful for code review formats, release procedures, debugging SOPs, and preferred report structures.

```bash
role-persona memory scenario-write \
  --title "Code review output" \
  --guidance "Give the conclusion first, then group findings by Critical/Medium/Low. Explain impact and fix for each item." \
  --triggers "code review,review feedback" \
  --evidence "User prefers structured severity-based review feedback"

role-persona memory scenario-search "review this PR"
```

When building a prompt, role-persona performs on-demand recall from the user query. Matching scenarios are injected as `Scenario Memory Hints`. They are hints, not commands, and never override explicit user instructions.

### Fusion design

If you are looking at Tencent's newly discussed auto-memory approach, start here:

- [`docs/MEMORY-FUSION-DESIGN.md`](./docs/MEMORY-FUSION-DESIGN.md) — maps TencentDB Agent Memory's layered long-term memory, symbolic short-term memory, and traceable drill-down model onto role-persona's daily / pending / consolidated / vector system.

## Logging

JSONL structured logging: `~/.pi/roles/.log/YYYY-MM-DD.jsonl`

```json
{"schema":"2.0.0","timestamp":"2026-05-07T00:16:00Z","level":"info","scope":"auto-extract","message":"start"}
```

## Development

```bash
bun run typecheck        # Type check
bun run test             # All tests (57 tests, 55 pass)
bun test tests/memory-md.test.ts  # Memory module tests (26/26)
bun src/bin/cli.ts ...   # CLI dev
bun src/transport/daemon.ts  # Daemon dev
cd web && bun run dev    # Web dev (Vite HMR)
```

### Test Coverage

| Module | Tests | Status |
|--------|-------|--------|
| `memory-md.ts` | 26 | ✅ CRUD, search, dedup, pending layer |
| `core.test.ts` | 11 | ✅ Types, config, extraction rules |
| `cli.test.ts` | 18 | ⚠️ 16/18 (2 pre-existing: embedding not active) |
| `mcp.test.ts` | 6 | ✅ MCP protocol |

## License

MIT © Dwsy
