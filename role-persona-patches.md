# role-persona 源码修改记录

**修改日期**: 2026-05-15  
**目的**: 修复 daemon 自动记忆功能与 fufu/mimo-v2.5 推理模型的兼容性问题  
**修改文件**: `src/transport/daemon.ts`

---

## 修改 1: 加载配置文件

**问题**: daemon 启动时没有加载 `pi-role-persona.jsonc` 配置，导致 `autoMemory.model` 设置不生效（模型解析失败 "abort: no models resolved"）。

**修复**: 在 `startDaemon` 中导入并加载配置。

```diff
+import { loadConfig } from "../core/config.ts";

  const port = opts.port ?? DEFAULT_PORT;
+ const config = loadConfig();
  const mgr = new ServiceManager({
+   config,
    llm: createDaemonLlmCaller(),
    ...
  });
```

---

## 修改 2: 模型注册表传递 reasoning 属性

**问题**: `createDaemonModelRegistry` 没有将 `models.json` 中的 `reasoning: true` 属性传递给模型对象，导致 daemon 不知道 mimo-v2.5 是推理模型。

**修复**: 在模型对象中添加 `reasoning` 属性。

```diff
  allModels.push({
    provider: provName,
    id: m.id,
    name: m.name,
    maxTokens: m.maxTokens,
    contextWindow: m.contextWindow,
    baseUrl: prov.baseUrl,
    apiKey: prov.apiKey,
    api: prov.api,
+   reasoning: (m as any).reasoning,
  } as any);
```

---

## 修改 3: 推理模型系统提示词注入

**问题**: 推理模型（如 mimo-v2.5）会花费大量 token 在推理过程上，导致 `content` 字段为空或被截断，无法输出 JSON。

**修复**: 对推理模型自动注入 system message，强制直接输出 JSON。

```diff
+ const isReasoning = !!(model as any).reasoning;
  const messages = request.messages.map((m) => ({
    role: m.role,
    content: m.content.map((c) => c.text).join(""),
  }));
+ if (isReasoning && messages.length > 0 && messages[0].role !== "system") {
+   messages.unshift({
+     role: "system",
+     content: "Output ONLY valid JSON. No explanation, no reasoning, no markdown. Just the JSON object.",
+   });
+ }
```

---

## 修改 4: 推理模型 token 预算放大

**问题**: `memory-llm.ts` 给 auto-extract 只分配 512 tokens，推理模型 95% 花在 reasoning 上，content 几乎为 0。

**修复**: 推理模型自动将 max_tokens 提升到 32768。

```diff
+ if (isReasoning) {
+   body.reasoning_effort = "low";
+   if (body.max_tokens < 16384) body.max_tokens = 32768;
+ }
```

---

## 修改 5: thinking 内容不返回给调用方

**问题**: `extractResponseText`（memory-llm.ts）会将 thinking + text 合并，thinking 放在前面。如果 thinking 中包含 `{` 字符（来自 prompt），`extractJsonObject` 的贪婪正则 `/\{[\s\S]*\}/` 会从 thinking 中的 `{` 开始匹配，导致 JSON 解析失败。

**修复**: daemon 不在 content 数组中返回 thinking 块，只返回 text。thinking 内容仅用于日志。

```diff
- const content: Array<{ type: string; text?: string; thinking?: string }> = [];
- if (thinking) {
-   content.push({ type: "thinking", thinking });
- }
- if (text) {
-   content.push({ type: "text", text });
- }
+ const content: Array<{ type: string; text?: string; thinking?: string }> = [];
+ if (text) {
+   content.push({ type: "text", text });
+ } else if (thinking) {
+   const jsonMatch = thinking.match(/(\{[\s\S]*"learnings"[\s\S]*\})/);
+   if (jsonMatch) {
+     content.push({ type: "text", text: jsonMatch[1] });
+   }
+ }
```

---

## 修改 6: finish_reason 映射

**问题**: 推理模型的 `finish_reason` 通常是 `"length"`（被截断），原代码将其视为 error。

**修复**: `"length"` 和 `"tool_calls"` 也映射为 `"stop"`。

```diff
- stopReason: data.choices?.[0]?.finish_reason === "stop" ? "stop" : "error",
+ const finishReason = data.choices?.[0]?.finish_reason || "unknown";
+ const stopReason = ["stop", "length", "tool_calls"].includes(finishReason) ? "stop" : "error";
```

---

## 修改 7: reasoning_content 错误日志

**问题**: LLM 调用失败时没有控制台输出，难以调试。

**修复**: 添加 `console.error` 输出 HTTP 错误。

```diff
  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
+   console.error(`[daemon] LLM call failed (${response.status}):`, err);
    throw new Error(`LLM call failed (${response.status}): ${err}`);
  }
```

---

## 测试结果

| 测试项 | 之前 | 之后 |
|--------|------|------|
| 模型解析 | ❌ "no models resolved" | ✅ fufu/mimo-v2.5 |
| LLM 调用 | ❌ "returned error" / "parse failed" | ✅ response ok |
| JSON 解析 | ❌ parse failed | ✅ parsed |
| 记忆存储 | ❌ null | ✅ storedLearnings/storedPrefs |

配置模型为 fufu/mimo-v2.5 后，自动记忆提取完全正常工作。

---

## 补丁 3: Cline 插件适配器 (cline/adapter.ts)

**修改日期**: 2026-05-16
**目的**: 创建 Cline 的 role-persona 插件，实现记忆注入和工具注册
**修改文件**: `src/extensions/cline/adapter.ts`

### 功能
1. **系统提示注入** (`registerRule`)
   - 文件路径（FILE LOCATIONS）
   - 角色提示（identity.md, soul.md, user.md）
   - 记忆内容（consolidated.md）
   - 编辑指令（Memory Edit Spec）

2. **工具注册** (`registerTool`)
   - `memory` — list/search/add/update/delete/consolidate
   - `knowledge` — list/read/write
   - `role_info` — 角色信息查询

3. **钩子** (`hooks`)
   - `afterRun` — 运行完成日志

### 与 Pi 版本的对比

| 功能 | Pi adapter | Cline adapter |
|------|------------|---------------|
| 文件路径注入 | ✅ | ✅ |
| 角色提示注入 | ✅ | ✅ |
| 记忆内容注入 | ✅ | ✅ |
| 编辑指令注入 | ✅ | ✅ |
| 向量搜索 | ✅ | ❌ |
| 自动提取 | ✅ | ❌ |
| 外部记忆 | ✅ | ❌ |

### 构建
```bash
bun run build:cline
```

### 测试
```bash
# 放到 ~/.cline/plugins/ 目录
cp src/extensions/cline/adapter.ts ~/.cline/plugins/role-persona.ts

# 重启 hub
cline hub stop && cline hub start

# 测试
cline "调用 memory 工具执行 list"
```

---

## 补丁 4: Cline 源码修改（启用 in-process 模式）

**修改日期**: 2026-05-16
**目的**: 沙箱模式不支持 registerRule，需要改为 in-process 模式
**修改文件**: `cline/sdk/packages/core/src/services/local-runtime-bootstrap.ts`

### 修改内容
```diff
  loadedPlugins = await resolveAndLoadAgentPlugins({
+   mode: "in_process",
    pluginPaths: localConfig?.pluginPaths,
    workspacePath,
    cwd: input.config.cwd,
    // ...
  });
```

### Cline CLI 修改（传递插件配置）

**修改文件**: `cline/sdk/apps/cli/src/runtime/run-agent.ts`
```diff
  localRuntime: {
    userInstructionService,
    onTeamRestored: () => emitTeamRestored(config),
+   configExtensions: ["rules", "skills", "workflows", "plugins"],
  },
```

**修改文件**: `cline/sdk/apps/cli/src/runtime/interactive/session-runtime.ts`
```diff
  localRuntime: {
    userInstructionService: input.userInstructionService,
    onTeamRestored: () => {},
+   configExtensions: ["rules", "skills", "workflows", "plugins"],
  },
```
