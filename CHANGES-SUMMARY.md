# role-persona 改动摘要

**重放日期**: 2026-05-16  
**源路径**: `/home/dwsy/.npm-global/lib/node_modules/role-persona/`  
**目标路径**: `/Users/dengwenyu/.pi/agent/role-persona/`

---

## ✅ 已复制的文件

| 文件 | 大小 | 说明 |
|------|------|------|
| `src/extensions/cline/adapter.ts` | 14 KB | Cline 插件 v2（完整注入） |
| `src/extensions/cline/plugin.ts` | 0.2 KB | Cline 入口文件 |
| `CLINE-PLUGIN-SOP.md` | 3.7 KB | 插件编写 SOP |
| `src/core/memory-vector.ts` | 17.6 KB | 智能召回 + 增量索引 |
| `src/core/memory-md.ts` | 95.2 KB | 语义去重 + 每日摘要 + 使用统计 + 模糊匹配 + 多格式导出 |
| `src/core/memory-scenarios.ts` | 8.7 KB | 场景触发 |
| `src/core/knowledge.ts` | 29.4 KB | 标签云 |
| `src/core/index.ts` | 2.8 KB | 更新导出 |

---

## 🎯 改动功能

### 1. 智能召回 (memory-vector.ts)
- `detectRecallIntent(query)` — 意图检测
- `smartAutoRecall(query, opts)` — 智能召回
- `incrementalIndex(id, text, action)` — 增量索引
- `batchIncrementalIndex(operations)` — 批量增量

### 2. 语义去重 (memory-md.ts)
- `textSimilarity(a, b)` — 文本相似度
- `fuzzySimilarity(a, b)` — 模糊相似度
- `smartDedup(rolePath, roleName, text)` — 智能去重

### 3. 每日摘要 (memory-md.ts)
- `parseDailyMemory(rolePath, date)` — 解析每日记忆
- `generateDailySummary(rolePath, date)` — 生成摘要
- `summarizeDateRange(rolePath, start, end)` — 批量摘要

### 4. 使用统计 (memory-md.ts)
- `getMemoryUsageStats(rolePath, roleName)` — 获取统计
- `updateMemoryUsage(rolePath, roleName, id)` — 更新使用

### 5. 多格式导出 (memory-md.ts)
- `exportMemoryToJson(rolePath, roleName)` — JSON 导出
- `exportMemoryToMarkdown(rolePath, roleName)` — Markdown 导出
- `exportMemory(rolePath, roleName, format)` — 统一导出

### 6. 场景触发 (memory-scenarios.ts)
- `detectScenarioTriggers(rolePath, messages)` — 检测触发
- `shouldInjectScenarioContext(rolePath, query)` — 快速判断

### 7. 标签云 (knowledge.ts)
- `buildKnowledgeTagCloud(rolePath)` — 生成标签云
- `formatTagCloudMarkdown(cloud)` — Markdown 格式
- `formatTagCloudHtml(cloud)` — HTML 格式

---

## 📊 构建验证

```
$ bun run build:cli
Bundled 24 modules in 32ms
cli.js  148.95 KB (entry point)
✅ 构建成功
```

---

## 🧪 功能验证

```
$ bun run dist/bin/cli.js memory list --role default
✅ CLI 正常工作
✅ 记忆读取正常
```

---

**状态**: ✅ 重放完成

### 5. Cline 插件 v2 (cline/adapter.ts)
- `buildMemoryRule()` — 构建完整系统提示注入
  - 文件路径（FILE LOCATIONS）
  - 角色提示（identity.md, soul.md, user.md）
  - 记忆内容（consolidated.md）
  - 编辑指令（Memory Edit Spec）
- `loadConsolidated()` — 支持多格式解析
- `saveConsolidated()` — 统一保存格式
- 3 个工具：memory, knowledge, role_info
- 1 个规则：role-persona-context（完整注入）
- 1 个钩子：afterRun

### 6. Cline 集成测试
- 源码编译 Cline CLI（NixOS 修复）
- 配置 fufu/mimo-v2.5 模型
- 修复 `configExtensions` 传递（run-agent.ts, session-runtime.ts）
- 修改 in-process 模式（local-runtime-bootstrap.ts）
- 验证：记忆注入、工具调用、知识库、角色信息

---

## 📋 SOP 文档

- `CLINE-PLUGIN-SOP.md` — 插件编写标准操作流程
