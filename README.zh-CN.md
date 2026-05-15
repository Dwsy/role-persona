# Role Persona

> AI Agent 的角色人格系统 — 记忆、知识、向量检索
> CLI · HTTP 守护进程 · MCP 服务器 · Pi 扩展 · Web 仪表盘

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 概述

Role Persona 是一个面向 AI 编程助手的持久化记忆和知识系统：

- **角色管理** — 独立人格，隔离记忆/知识空间
- **记忆系统** — 学习记录、偏好、自动提取、整合、向量搜索
- **知识库** — 多来源、标签搜索、版本控制
- **向量记忆** — LanceDB 语义搜索，混合关键词+向量融合
- **多接口** — CLI、HTTP 守护进程、MCP、Pi 扩展、Web 仪表盘

## 快速开始

```bash
git clone https://github.com/Dwsy/role-persona.git
cd role-persona
bun install
bun run build
```

### CLI 使用

```bash
# 初始化（自动从当前目录创建角色）
role-persona init

# 角色管理
role-persona role list
role-persona role create my-role
role-persona role info

# 记忆
role-persona memory list
role-persona memory search "查询"
role-persona memory add-learning "始终使用 TypeScript 严格模式"
role-persona memory add-preference "用 pnpm 而非 npm" --category Tools
role-persona memory consolidate
role-persona memory repair
role-persona memory tidy

# 知识库
role-persona knowledge list
role-persona knowledge search "设计模式"

# 向量记忆
role-persona embedding stats
role-persona embedding rebuild

# 场景记忆（L2 Scenario）
role-persona memory scenario-write --title "代码审查输出" --guidance "先给结论，再按 Critical/Medium/Low 分级。" --triggers "code review,review feedback"
role-persona memory scenario-search "帮我 review 这段代码"
role-persona memory scenario-list
role-persona memory scenario-read <scenario-id>

# 系统提示词
role-persona prompt --base "你是一个有帮助的助手。"
```

### HTTP 守护进程

```bash
role-persona daemon start            # 前台运行
role-persona daemon start --background # 后台运行
role-persona daemon status            # 查看状态
role-persona daemon stop              # 停止
```

### Web 仪表盘

```bash
cd web && bun install && bun run build
role-persona --web                    # daemon + Web 合并在 3939
role-persona --web --port 8080        # 自定义合并端口
```

功能：
- **仪表盘** — 角色横幅、记忆分布、知识来源、向量状态、最近活动
- **记忆管理** — Explorer 树导航、表格视图（编辑/删除）、Markdown 渲染、正则搜索、键盘快捷键
- **知识库** — 列表、搜索、点击查看 Markdown、写入
- **角色管理** — 点击查看角色详情弹窗、切换角色
- **设置** — daemon 状态、向量统计、JSONC 配置编辑器（表单模式 + 原始模式）
- **国际化** — 中文/英文
- **深色/浅色** — 主题切换
- **角色选择器** — 头部下拉菜单，切换后自动刷新
- **URL 状态** — tab/path/search 保留在 URL 参数中（可书签）
- **模型选择器** — 从 models.json 填充下拉选项

### Pi 扩展

```typescript
// extensions/role-persona/index.ts
export { default } from "../../role-persona/src/extensions/pi/adapter.ts";
```

- 注册工具：`memory`、`knowledge`、`role_info`
- 注册命令：`/role`、`/memories`、`/memory-log`、`/memory-fix`、`/memory-tidy`、`/memory-tidy-llm`、`/memory-vector`、`/memory-export`、`/memory-conflicts`、`/memory-distill`、`/memory-distill-stop`、`/memory-tags`、`/kb`
- 处理事件：`session_start`、`before_agent_start`、`agent_end`、`session_before_compact`、`session_shutdown`、`turn_end`
- 直接使用 Pi SDK 调用 LLM（无 CLI 子进程）
- 首条消息按需记忆搜索（向量 + 关键词混合）
- 向量自动召回注入 system prompt
- 外部只读记忆提示（可配置）
- 压缩时记忆提取（`<memory>` block 解析）
- 交互式 memory→knowledge 蒸馏模式
- TUI 角色选择器和记忆查看器（可用时）
- HTTP 记忆服务器（浏览器浏览）
- 角色激活时自动修复和 pending 过期

## 配置

配置文件：`~/.pi/roles/pi-role-persona.jsonc`

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
  "knowledge": { "enabled": true },
  "logging": { "enabled": true, "level": "info" }
}
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `PI_ROLES_DIR` | 覆盖角色目录 |
| `ROLE_AUTO_MEMORY` | 启用/禁用自动记忆（`0`/`false`） |
| `ROLE_AUTO_MEMORY_MODEL` | 覆盖模型 |
| `ROLE_LOG` | 启用/禁用日志（`0`/`false`） |
| `OPENAI_API_KEY` | OpenAI API 密钥（用于向量嵌入） |

## Daemon HTTP API

所有响应格式：`{ "ok": true, "data": ... }` 或 `{ "ok": false, "error": { "code": "...", "message": "..." } }`

| 方法 | 路由 | Body | 说明 |
|------|------|------|------|
| GET | `/api/health` | — | 健康检查 + 实例列表 |
| GET | `/api/instances` | — | 活跃实例列表 |
| GET | `/api/models` | — | models.json 可用模型 |
| POST | `/api/cwd` | `{role?, cwd?}` | 切换/初始化上下文 |
| POST | `/api/init` | `{role?, cwd?}` | 初始化 |
| POST | `/api/role/list` | `{role?}` | 列出角色 |
| POST | `/api/role/create` | `{name, role?}` | 创建角色 |
| POST | `/api/role/info` | `{role?}` | 当前角色信息 |
| POST | `/api/memory/list` | `{role?}` | 列出记忆 |
| POST | `/api/memory/search` | `{query, role?}` | 搜索记忆 |
| POST | `/api/memory/add-learning` | `{content, role?}` | 添加学习 |
| POST | `/api/memory/consolidate` | `{role?}` | 整合 |
| POST | `/api/memory/repair` | `{role?}` | 修复 |
| POST | `/api/memory/tidy` | `{model?, role?}` | LLM 整理 |
| POST | `/api/knowledge/list` | `{category?, role?}` | 列出知识 |
| POST | `/api/knowledge/search` | `{query, role?}` | 搜索知识 |
| POST | `/api/knowledge/read` | `{path, role?}` | 读取条目 |
| POST | `/api/knowledge/write` | `{title, content, role?}` | 写入条目 |
| POST | `/api/embedding/stats` | `{role?}` | 向量统计 |
| POST | `/api/embedding/rebuild` | `{role?}` | 重建索引 |
| POST | `/api/file/read` | `{path, role?}` | 读取角色文件 |
| POST | `/api/file/write` | `{path, content, role?}` | 写入角色文件 |
| POST | `/api/file/list` | `{dir, role?}` | 列出角色文件 |
| POST | `/api/config/read` | — | 读取配置 |
| POST | `/api/config/write` | `{content}` | 写入配置 |
| POST | `/api/prompt` | `{base?, role?}` | 构建提示词 |
| POST | `/api/shutdown` | — | 停止守护进程 |

## 项目结构

```
role-persona/
├── src/
│   ├── core/                    # 纯逻辑，零 Pi 依赖
│   │   ├── types.ts             # 共享类型
│   │   ├── config.ts            # JSONC 配置加载
│   │   ├── logger.ts            # JSONL 结构化日志
│   │   ├── memory-md.ts         # Markdown 记忆 CRUD
│   │   ├── memory-llm.ts        # LLM 自动提取
│   │   ├── memory-tags.ts       # LLM 标签提取
│   │   ├── memory-vector.ts     # 向量搜索编排
│   │   ├── embedding.ts         # 嵌入提供者
│   │   ├── vector-db.ts         # LanceDB 封装
│   │   └── knowledge.ts         # 知识库 CRUD
│   ├── service/                 # 统一门面
│   ├── extensions/pi/           # Pi 扩展（直接 service + Pi SDK）
│   ├── transport/               # daemon、mcp
│   └── bin/                     # CLI 入口
├── tests/
│   ├── memory-md.test.ts        # 记忆 CRUD 测试 (26/26)
│   ├── core.test.ts             # 核心类型/配置测试
│   ├── cli.test.ts              # CLI 集成测试
│   └── mcp.test.ts              # MCP 协议测试
├── web/                         # React 仪表盘
│   ├── src/
│   │   ├── api/client.ts        # daemon API 客户端
│   │   ├── i18n/                # 国际化
│   │   ├── hooks/               # useApi, useUrlState
│   │   ├── components/          # Layout, MarkdownViewer, JsoncForm
│   │   └── pages/               # Dashboard, Memory, Knowledge, Roles, Settings
│   └── package.json
└── README.md
```

## 记忆系统

### 类型

| 类型 | 说明 | 自动提取 |
|------|------|----------|
| **Learning** | 跨会话洞察 | ✓ |
| **Preference** | 用户偏好 | ✓ |
| **Event** | 会话事件 | — |
| **Pending** | 待验证 | ✓ |

### 生命周期

```
对话 → 自动提取 → 待验证层 → 验证 → 整合记忆
                    ↓
              使用驱动的价值
```

### 向量记忆

- **LanceDB** 向量存储
- **混合搜索**：向量 + 关键词 → RRF 融合
- **自动索引**：写入时自动排队
- **自动召回**：会话开始时语义注入
- **嵌入提供者**：OpenAI、本地、MiniLM (ONNX)

### 场景记忆（L2 Scenario）

Scenario 用来记录“在某类场景下应该怎么做”，介于 pending 原子事实和 consolidated 人格偏好之间。它适合存放：代码审查格式、发布流程、排障 SOP、用户偏好的报告结构等。

```bash
role-persona memory scenario-write \
  --title "代码审查输出" \
  --guidance "先给结论，再按 Critical/Medium/Low 分级；每条建议说明影响和修复方式。" \
  --triggers "code review,review feedback,代码审查" \
  --evidence "用户偏好结构化分级反馈"

role-persona memory scenario-search "帮我 review 这个 PR"
```

当构建 prompt 时，`role-persona` 会基于用户 query 做 on-demand 搜索；命中 Scenario 后，以 `Scenario Memory Hints` 注入上下文。Scenario 不是命令，不覆盖用户显式要求，只提供可追溯的行为提示。

### 融合设计

如果你关注“腾讯新出的 auto 记忆”那类分层记忆思路，可以先看：

- [`docs/MEMORY-FUSION-DESIGN.md`](./docs/MEMORY-FUSION-DESIGN.md) —— 将 TencentDB Agent Memory 的分层长期记忆、符号化短期记忆、可追溯下钻机制，映射到 role-persona 的 daily / pending / consolidated / vector 体系。


## 日志

JSONL 结构化日志：`~/.pi/roles/.log/YYYY-MM-DD.jsonl`

```json
{"schema":"2.0.0","timestamp":"2026-05-07T00:16:00Z","level":"info","scope":"auto-extract","message":"start"}
```

## 开发

```bash
bun run typecheck        # 类型检查
bun run test             # 全部测试 (57 tests, 55 pass)
bun test tests/memory-md.test.ts  # 记忆模块测试 (26/26)
bun src/bin/cli.ts ...   # CLI 开发
bun src/transport/daemon.ts  # 守护进程开发
cd web && bun run dev    # Web 开发 (Vite HMR)
```

### 测试覆盖

| 模块 | 测试数 | 状态 |
|------|--------|------|
| `memory-md.ts` | 26 | ✅ CRUD、搜索、去重、pending 层 |
| `core.test.ts` | 11 | ✅ 类型、配置、提取规则 |
| `cli.test.ts` | 18 | ⚠️ 16/18 (2 个预存：embedding 未激活) |
| `mcp.test.ts` | 6 | ✅ MCP 协议 |

## 许可证

MIT © Dwsy
