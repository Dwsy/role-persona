# role-persona

AI 代理的角色人格系统 — 记忆、知识库、向量嵌入管理。

支持 **Pi 扩展**、**CLI**、**MCP 服务器**、**HTTP 守护进程** 四种运行模式。

[English](./README.md)

## 快速开始

```bash
# 克隆
git clone https://github.com/Dwsy/role-persona.git
cd role-persona
bun install

# 初始化（自动检测当前目录映射的角色）
bun src/bin/cli.ts init

# 使用
bun src/bin/cli.ts memory list
bun src/bin/cli.ts memory search "查询内容"
bun src/bin/cli.ts knowledge list
```

## 功能特性

| 功能 | 说明 |
|------|------|
| **记忆** | 从对话中自动提取学习、偏好、事件 |
| **知识库** | 多源知识库，支持搜索、标签、分类 |
| **向量嵌入** | 语义搜索（OpenAI / 本地 ONNX / 共享守护进程） |
| **角色系统** | 按目录映射角色，独立记忆和提示词 |
| **自动提取** | LLM 驱动的记忆提取（压缩时触发） |
| **标签系统** | 自动打标 + 遗忘曲线（艾宾浩斯） |
| **待验证层** | 新记忆先进入验证缓冲区，确认后才永久化 |

## 架构

```
传输层 (1,817行)
├── Pi 适配器      532行  薄包装，零 service 依赖
├── CLI            303行  守护进程感知，JSON 输出
├── MCP 服务器     221行  Streamable HTTP, SSE
├── HTTP 守护进程  334行  Bun.serve, pidfile, 单实例
├── Memory Server  286行  HTML 查看器（暗色/亮色主题 + 日志面板）
├── CLI Runner     185行  daemon HTTP → subprocess 回退
├── HTTP Client     52行  daemon HTTP 客户端
└── TUI Renderers  326行  Pi 工具结果渲染器
        │
服务层 (877行) ← 零 Pi 依赖
├── context         65行  ServiceContext
├── index          188行  RolePersonaService 门面
├── role-service   184行  角色 CRUD + 映射
├── memory-service 306行  14 个记忆操作 + 自动提取
├── knowledge-svc   71行  知识库 CRUD + 搜索
└── embedding-svc   63行  向量生命周期
        │
核心层 (10,071行) ← 零 Pi 依赖，纯函数
├── types           591行  共享类型定义
├── config          677行  三级配置（环境变量/jsonc/默认值）
├── logger          478行  JSONL 结构化日志
├── spinner-utils    14行  Spinner 帧
├── role-store      458行  角色 CRUD, CWD 映射, 迁移
├── role-template   376行  i18n 提示词模板（中文/英文）
├── memory-md      2185行  记忆 CRUD, 解析, 搜索, 待验证层
├── memory-llm      726行  LLM 自动提取 + 整理
├── extraction-rules  50行  临时/可推导过滤
├── memory-tags     773行  LLM 打标, 遗忘曲线
├── memory-vector   806行  LanceDB 向量, 混合搜索
├── memory-export   687行  HTML 导出（树形导航）
├── knowledge       831行  多源知识库 CRUD
├── embedding-daemon 822行  共享 ONNX 守护进程服务器
├── embedding-minilm 443行  直接 ONNX Provider
└── daemon-client   154行  守护进程客户端 Provider
```

## 运行模式

### 1. CLI（默认）

```bash
# 直接执行（冷启动 ~250ms）
role-persona memory search "query"

# 守护进程感知（自动检测运行中的 daemon，热启动 ~5ms）
role-persona daemon start --background
role-persona memory search "query"  # 通过 HTTP 路由

# 强制直接执行
role-persona --direct memory search "query"

# 人类可读输出
role-persona --human memory list
```

所有命令默认输出 JSON 到 stdout：
```json
{ "ok": true, "data": {...}, "message": "人类可读摘要" }
{ "ok": false, "error": "错误描述" }
```

### 2. 守护进程（持久化后台服务器）

```bash
role-persona daemon start              # 前台运行
role-persona daemon start --background # 后台运行
role-persona daemon status             # 健康检查
role-persona daemon stop               # 优雅关闭
```

特性：
- PID 文件 `~/.pi/role-persona-daemon.pid`（单实例）
- 端口文件 `~/.pi/role-persona-daemon.port`
- SIGTERM/SIGINT 优雅关闭
- 热内存：常驻进程，无冷启动
- 20 个 REST 端点，镜像 Service 门面

### 3. MCP 服务器（Streamable HTTP）

```bash
bun src/transport/mcp-server.ts
# → http://localhost:3939/mcp
```

协议：MCP spec 2025-03-26
传输：`WebStandardStreamableHTTPServerTransport`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | POST | JSON-RPC（initialize, tools/call, tools/list） |
| `/mcp` | GET | SSE 流（服务器推送消息） |
| `/mcp` | DELETE | 会话终止 |
| `/health` | GET | 健康检查 |

4 个工具：`memory`、`knowledge`、`role_info`、`role_management`

### 4. Pi 扩展

```typescript
// extensions/role-persona/index.ts
export { default } from "../../role-persona/src/transport/pi-adapter.ts";
```

适配器通过 `cli-runner.ts` 委托所有操作到 CLI：
- 守护进程运行中 → HTTP 调用（~5ms）
- 守护进程未运行 → 子进程启动（~250ms）

零 service/core 层导入。

**扩展点：**

| 类型 | 数量 | 详情 |
|------|------|------|
| 事件 | 7 | session_start, resources_discover, before_agent_start, agent_end, session_before_compact, session_shutdown, turn_end |
| 工具 | 3 | memory (14 动作), knowledge (4 动作), role_info |
| 命令 | 13 | /role, /memories, /memory-log, /memory-fix, /memory-tidy, /memory-tidy-llm, /memory-vector, /memory-tags, /memory-conflicts, /memory-export, /memory-distill, /memory-distill-stop, /kb |

## CLI 命令参考

### 角色管理

```bash
role-persona role list                           # 列出所有角色
role-persona role create <name>                  # 创建新角色
role-persona role info                           # 当前角色信息
role-persona role map <role>                     # 映射当前目录到角色
role-persona role unmap                          # 取消映射并禁用
```

### 记忆管理

```bash
# CRUD
role-persona memory add-learning "内容"          # 添加学习
role-persona memory add-preference "内容" --category Code  # 添加偏好
role-persona memory update-learning <id> "新内容"
role-persona memory update-preference <id> "新内容"
role-persona memory delete-learning <id>
role-persona memory delete-preference <id>
role-persona memory reinforce <id>               # 增加使用次数

# 查询
role-persona memory search "查询"                # 搜索（关键词 + 向量混合）
role-persona memory list                         # 列出所有记忆

# 维护
role-persona memory consolidate                  # 去重整合
role-persona memory repair                       # 修复 markdown 格式
role-persona memory tidy                         # 手动整理
role-persona memory tidy --llm                   # LLM 整理
role-persona memory tidy --llm --model openai/gpt-4.1-mini  # 指定模型

# 导出
role-persona memory export                       # 导出 HTML
role-persona memory export --output ~/mem.html   # 自定义路径

# 调试
role-persona memory conflicts                    # 检测冲突记忆
role-persona memory log                          # 会话操作日志

# 基于 stdin
echo '[{"role":"user","content":[{"type":"text","text":"你好"}]' | role-persona memory build-prompt
echo '[{"role":"user","content":[{"type":"text","text":"你好"}]' | role-persona memory extract-memory
```

### 知识库

```bash
role-persona knowledge list                      # 列出所有条目
role-persona knowledge list Architecture         # 按分类过滤
role-persona knowledge search "查询"             # 搜索条目
role-persona knowledge search "查询" --tags "tag1,tag2"
role-persona knowledge read <path>               # 读取条目
role-persona knowledge write --title "标题" --content "内容" [--category 分类] [--tags "t1,t2"]
```

### 向量嵌入

```bash
role-persona embedding stats                     # 向量记忆状态
role-persona embedding rebuild                   # 重建向量索引
```

### 系统

```bash
role-persona init                                # 初始化角色目录
role-persona prompt                              # 输出完整 system prompt
role-persona prompt --base "自定义基础提示词"
```

## 配置

### 配置文件位置

配置文件按以下顺序搜索：

1. `~/.pi/roles/pi-role-persona.jsonc`（推荐）
2. `~/.pi/agent/pi-role-persona.jsonc`
3. 扩展目录
4. 当前工作目录

在 `~/.pi/roles/pi-role-persona.jsonc` 创建配置文件：

```jsonc
{
  // ── 存储 ──
  "storage": {
    "rolesDir": "~/.pi/roles"  // 角色目录（默认）
  },

  // ── 自动记忆提取 ──
  // 从对话中自动提取学习/偏好
  "autoMemory": {
    "enabled": true,
    // 模型配置，支持多种格式：
    //   单个: "provider/model-id"
    //   数组: ["provider/model-1", "provider/model-2"]  （回退链）
    //   对象: [{"provider": "openai", "model": "gpt-4.1-mini"}]
    "model": "openai-codex/gpt-5.1-codex-mini",
    "tagModel": null,         // 标签提取模型（null 时继承 model）
    "reserveTokens": 8192,    // 提取预留 token
    "maxItems": 3,            // 每次提取最大条目数
    "maxText": 200,           // 每条最大文本长度
    "batchTurns": 5,          // N 轮后触发提取
    "minTurns": 2,            // 最少轮次才提取
    "intervalMs": 1800000,    // 提取间隔（30 分钟）
    "contextOverlap": 4       // 提取间消息重叠数
  },

  // ── 记忆设置 ──
  "memory": {
    "defaultCategories": ["Communication", "Code", "Tools", "Workflow", "General"],
    "dailyPathTemplate": "{rolePath}/memory/daily/{date}.md",
    "dedupeThreshold": 0.9,   // 去重相似度阈值
    "onDemandSearch": {
      "enabled": true,        // 首条消息时搜索相关记忆
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

  // ── 向量记忆 ──
  "vectorMemory": {
    "enabled": false,         // 启用向量搜索
    // Provider: "openai" | "local" | "minilm-direct" | "minilm-daemon"
    "provider": "minilm-daemon",
    "model": "text-embedding-3-small",
    "apiKey": null,           // OpenAI API Key（openai provider 需要）
    "baseUrl": "http://127.0.0.1:52131",  // 本地 Provider URL
    // MiniLM 配置（minilm-* provider）
    "minilm": {
      "mode": "daemon",       // "direct"（单进程）或 "daemon"（共享）
      "maxSeqLength": 512,
      "batchSize": 8,
      "timeoutMs": 5000,
      "autoStartDaemon": true,
      "useGPU": false
    },
    "autoRecall": true,       // 每条消息注入相关记忆
    "autoIndex": true,        // 自动索引新记忆
    "hybridSearch": true,     // 向量 + 关键词混合搜索
    "vectorWeight": 1.0,      // 混合搜索中向量分数权重
    "recallLimit": 3,         // 最大召回条目数
    "recallMinScore": 0.3,    // 召回最低分数
    "dbPath": ".vector-db"    // LanceDB 路径（相对于角色目录）
  },

  // ── 知识库 ──
  "knowledge": {
    "enabled": true,
    "vectorTable": "knowledge",
    "search": {
      "maxResults": 5,
      "minScore": 0.2,
      "roleBoost": 1.2        // 角色专属条目分数加成
    },
    "externalSources": []     // 外部只读知识源
  },

  // ── 外部只读记忆 ──
  // 注入跨会话记忆提示（只读）
  "externalReadonly": {
    "enabled": false,
    "baseUrl": "http://127.0.0.1:52131",
    "token": null,
    "timeoutMs": 1200,
    "topK": 8,
    "experienceLimit": 8,
    "minConfidence": 0.35
  },

  // ── 日志 ──
  "logging": {
    "enabled": true,
    "level": "debug",         // "debug" | "info" | "warn" | "error"
    "retentionDays": 7
  },

  // ── 界面 ──
  "ui": {
    "spinnerIntervalMs": 120,
    "viewerDefaultFilter": "all"  // "all" | "learnings" | "preferences" | "events"
  },

  // ── 高级 ──
  "advanced": {
    "shutdownFlushTimeoutMs": 1500,
    "forceKeywords": "结束|总结|退出|收尾|final|summary|wrap\\s?up|quit|exit",
    "evolutionReminderTurns": 10
  }
}
```

### 环境变量

所有设置都可以通过环境变量覆盖：

| 变量 | 配置路径 | 示例 |
|------|----------|------|
| `PI_ROLES_DIR` | storage.rolesDir | `~/.pi/roles` |
| `ROLE_LOG_LEVEL` | logging.level | `info` |
| `ROLE_LOG_ENABLED` | logging.enabled | `1` |
| `ROLE_VECTOR_PROVIDER` | vectorMemory.provider | `minilm-daemon` |
| `ROLE_VECTOR_ENABLED` | vectorMemory.enabled | `1` |

### Provider 对比

| Provider | 依赖 | 维度 | 内存 | 延迟 | 适用场景 |
|----------|------|------|------|------|----------|
| `openai` | OpenAI API | 1536/3072 | 0 本地 | ~100ms | 最高质量 |
| `local` | pi-session-manager | 768 | 435MB | ~30ms | 向后兼容 |
| `minilm-direct` | onnxruntime-node | 384 | 150MB | ~15ms | 单进程快速 |
| `minilm-daemon` | onnxruntime-node | 384 | 150MB 共享 | ~20ms | 多会话推荐 |

## 数据布局

```
~/.pi/roles/
├── config.json                    # 目录 → 角色映射
├── pi-role-persona.jsonc          # 配置文件
├── knowledge/                     # 全局知识库
│   ├── Architecture/
│   ├── Code/
│   └── ...
└── <role>/                        # 如 "zero", "default"
    ├── core/                      # 人格定义
    │   ├── agents.md              # 工作空间规则
    │   ├── identity.md            # 名字、风格、表情
    │   ├── soul.md                # 个性、价值观
    │   ├── user.md                # 用户画像
    │   ├── tools.md               # 工具偏好
    │   ├── heartbeat.md           # 主动检查规则
    │   └── constraints.md         # 硬性边界
    ├── memory/
    │   ├── consolidated.md        # 长期结构化记忆
    │   ├── pending.md             # 待验证缓冲区
    │   └── daily/                 # 每日日志
    │       ├── 2026-01-15.md
    │       └── 2026-01-16.md
    ├── knowledge/                 # 角色专属知识库
    ├── context/                   # 会话上下文
    ├── skills/                    # 角色技能
    ├── archive/                   # 归档记忆
    └── .vector-db/                # LanceDB 向量索引

~/.pi/
├── role-persona-daemon.pid        # 守护进程 PID 文件
├── role-persona-daemon.port       # 守护进程端口文件
├── sockets/                       # 嵌入守护进程 IPC
│   └── embedding-daemon.sock
└── models/                        # ONNX 模型
    └── all-MiniLM-L6-v2/
        └── model.onnx (~80MB)
```

## 测试

```bash
bun test
# 31 通过, 0 失败, 90 断言, ~6秒
```

| 测试套件 | 数量 | 覆盖 |
|----------|------|------|
| CLI | 18 | 全部命令、JSON 输出、错误处理 |
| MCP | 7 | Streamable HTTP、initialize、tools、sessions |
| Core | 6 | 类型、提取规则、配置 |

## 开发

```bash
# 安装依赖
bun install

# 运行 CLI
bun src/bin/cli.ts --help

# 运行守护进程
bun src/bin/daemon.ts --background

# 运行 MCP 服务器
bun src/transport/mcp-server.ts

# 运行测试
bun test

# 类型检查
bun x tsc --noEmit
```

## 许可证

MIT
