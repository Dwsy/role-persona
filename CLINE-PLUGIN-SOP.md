# Cline 插件编写 SOP

## 1. 插件结构

```typescript
import type { AgentPlugin } from "@cline/core";

const plugin: AgentPlugin = {
  name: "my-plugin",
  manifest: {
    capabilities: ["tools", "hooks", "rules"],  // 声明使用的能力
  },
  setup(api, ctx) {
    // api.registerTool()    — 注册工具
    // api.registerCommand() — 注册命令
    // api.registerRule()    — 注册规则（注入系统提示）
  },
  hooks: {
    beforeRun({ snapshot }) { /* 运行前 */ },
    afterRun({ result }) { /* 运行后 */ },
    beforeTool({ toolCall, input }) { /* 工具执行前 */ },
    afterTool({ toolCall, result }) { /* 工具执行后 */ },
  },
};

export default plugin;
```

## 2. 能 Capabilities

| 能力 | 说明 | API |
|------|------|-----|
| `tools` | 注册工具 | `api.registerTool()` |
| `commands` | 注册斜杠命令 | `api.registerCommand()` |
| `rules` | 注入系统提示 | `api.registerRule()` |
| `hooks` | 生命周期钩子 | `hooks.beforeRun/afterRun/beforeTool/afterTool` |
| `messageBuilders` | 重写消息 | `api.registerMessageBuilder()` |
| `providers` | 自定义模型提供商 | `api.registerProvider()` |

## 3. 工具注册

```typescript
api.registerTool({
  name: "my_tool",           // snake_case
  description: "工具描述",
  inputSchema: {
    type: "object",
    properties: {
      param: { type: "string", description: "参数说明" },
    },
    required: ["param"],
  },
  execute: async (input) => {
    // input 已验证
    return { content: "结果", details: { ... } };
  },
});
```

## 4. 规则注入（系统提示）

```typescript
api.registerRule({
  id: "my-rule",
  content: "注入到系统提示的文本",
  source: "my-plugin",
});

// 或动态内容
api.registerRule({
  id: "my-rule",
  content: () => `当前时间: ${new Date().toISOString()}`,
  source: "my-plugin",
});
```

## 5. 生命周期钩子

```typescript
hooks: {
  // 运行开始前
  beforeRun({ snapshot }) {
    console.log("Run starting...");
  },
  
  // 运行结束后
  afterRun({ result }) {
    if (result.status === "completed") {
      console.log("Run completed");
    }
  },
  
  // 工具执行前（可拦截）
  beforeTool({ toolCall, input }) {
    if (toolCall.toolName === "bash" && input.command?.includes("rm -rf")) {
      return { skip: true, reason: "Blocked dangerous command" };
    }
  },
  
  // 工具执行后
  afterTool({ toolCall, result }) {
    console.log(`${toolCall.toolName} executed`);
  },
}
```

## 6. 安装方式

### 方式 A：直接放到 `~/.cline/plugins/`（推荐）

```bash
# 单文件插件
cp my-plugin.ts ~/.cline/plugins/

# 目录插件
mkdir -p ~/.cline/plugins/my-plugin/
# 放入 index.ts 等文件
```

### 方式 B：通过 CLI 安装

```bash
cline plugin install ./path/to/plugin
```

## 7. 调试

```bash
# 查看已发现的插件
cline config plugins

# 检查 hub 日志
cat ~/.cline/data/logs/hub-daemon.log | grep plugin

# 使用 verbose 模式
cline --verbose "你的提示"
```

## 8. 沙箱限制

⚠️ **沙箱模式不支持 `registerRule`**，需要修改 Cline 源码启用 in-process 模式：

```typescript
// packages/core/src/services/local-runtime-bootstrap.ts
loadedPlugins = await resolveAndLoadAgentPlugins({
  mode: "in_process",  // 添加这行
  pluginPaths: localConfig?.pluginPaths,
  // ...
});
```

## 9. 常见问题

| 问题 | 解决方案 |
|------|----------|
| 工具不显示 | 检查 `manifest.capabilities` 是否包含 `"tools"` |
| 规则不注入 | 沙箱模式不支持，需改为 in-process |
| 插件加载失败 | 检查 `cline.config plugins` 和 hub 日志 |
| 依赖找不到 | 自包含插件，避免外部依赖 |
