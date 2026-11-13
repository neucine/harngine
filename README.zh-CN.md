# Harngine

[English](README.md)

Harngine 是一个用 TypeScript 编写智能体和工作流的运行时。它会持久保存模型决策、工具调用、人工审批和执行结果，因此任务在进程中断后仍可恢复，也可以随时查看它做过什么。

Harngine 目前仍是预发布版本，公开 API 可能调整。

**先看演示：**[两分钟恢复示例](examples/quickstart/README.md) ·
[69 秒客服流程视频](https://github.com/neucine/harngine/releases/download/v0.1.0/walkthrough.mp4) ·
[框架介绍视频](https://youtu.be/upyXdDo2EPY)

恢复示例只使用已发布的框架包，不需要模型账号。它在 Workflow 等待持久化计时器时终止进程，再由新进程打开同一个 SQLite 目录，核对结果与工具调用记录。安装 Node.js 24.21 和 Bun 后运行：

```bash
mkdir harngine-recovery && cd harngine-recovery
curl -fsSLO https://raw.githubusercontent.com/neucine/harngine/main/examples/quickstart/demo.mjs
printf '{"private":true,"type":"module"}\n' > package.json
npm install harngine@0.1.0
bunx harngine-manifest
node demo.mjs
```

预期输出包含 `Recovered ...: result=42, settled tool calls=1`。示例的验证范围和保留的 SQLite 数据见[示例说明](examples/quickstart/README.md)。

# 开始使用

Harngine 需要 Node.js 24.21。从 npm 安装框架包：

```bash
npm install harngine
```

可选的生态集成包发布在 `@harngine` scope 下。按应用需要安装：

```bash
npm install \
  @harngine/openai-responses \
  @harngine/claude-messages \
  @harngine/mcp \
  @harngine/retrieval \
  @harngine/http
```

## 框架和示例应用

`harngine` npm 包提供的是框架。你可以用它定义 Agent、Workflow 和 Tool，启动任务，并在任务中断后恢复或检查执行记录。[恢复示例](examples/quickstart/README.md)里的 Workflow 就包含一次具名工具调用和一个持久化计时器：

```ts
const calculation = workflow({
  id: 'demo.calculation',
  objective: number,
  result: number,
  tools: [record],
  async run(value, flow) {
    const answer = await flow.call('record', record, value);
    await flow.sleep('restart-window', 2_000);
    return answer;
  },
});
```

这里的 `number` 和 `record` 分别是示例中定义的 Schema 和 Tool。完整用法见[框架指南](docs/guide.md)。

下方的 Coding CLI 和 Support Desk 是**使用 Harngine 构建的应用**，用来展示框架能做什么。安装和使用 `harngine` 包并不需要运行这些应用。

# 应用示例

要运行 Coding CLI 和仓库中的示例，请克隆源码并安装工作区依赖：

```bash
git clone https://github.com/neucine/harngine.git
cd harngine
bun install
```

## Coding CLI

Harngine Coding 是用于代码仓库工作的终端智能体。它默认以只读模式启动，实时显示进度，将工具调用压缩成紧凑状态，并在应用每一处精确文件修改前请求批准。

```bash
bun run coding:cli --repo .
```

输入 `/write` 可切换到编辑会话；`/sessions` 和 `--continue` 可以恢复之前的任务。自动化运行可以使用 `--task`，并加上 `--json` 输出一个机器可读结果。

本地开发默认使用 Magpie 和 `codex/gpt-6.1-sol`。如果 Magpie 不可用，交互式设置会提供 OpenAI、Claude 或 Magpie 选项。也可以直接使用 OpenAI：

```bash
OPENAI_API_KEY=... bun run coding:cli \
  --repo . \
  --provider openai \
  --model <model-id>
```

模型提供商、思考过程、审批、单次运行和会话命令见 [Coding CLI 指南](apps/coding/cli/README.md)。

macOS 桌面应用使用同一套 Agent 和持久历史：

```bash
bun run coding:desktop --repo "$PWD"
open -n apps/coding/desktop/build/NeivApp.app
```

目前构建桌面应用需要本地 [Neiv](https://github.com/neucine/neiv) 和
[Weiv](https://github.com/neucine/weiv) 仓库。设置方法见
[Coding Desktop 指南](apps/coding/desktop/README.md)。

## Support Desk

离线 Support Desk 示例完整展示一笔重复扣款从客户请求到审批退款的过程：账户证据、退款政策查询、Triage → Billing 持久交接、精确审批，以及完成后的审计记录。

```bash
bun run demo:support
```

打开终端打印的地址，选择 **Run review**，然后批准这笔精确到 NZ$49 的退款。演示无需模型密钥、支付服务或网络连接。

运行 `bun run demo:support:cli` 可以在终端查看同一个案例。详细步骤见
[Support Desk 指南](examples/support/README.md)。

## 更多应用示例

- [Quest](examples/quest/README.md)：可离线回放、多人共享且能持续保留的博物馆世界。
- [全部示例](examples)：客服、博物馆、家居、创作研究、旅行和尽职调查。

# 开发

## 构建与验证

```bash
bun run build
bun run check
```

继续阅读[框架指南](docs/guide.md)、[包参考](packages/harngine/README.md)或[架构说明](docs/architecture.md)。Harngine 使用内嵌 Node.js 运行时和 SQLite，仓库构建及测试由 Bun 管理。

# 许可证

Harngine 采用 [Mozilla Public License 2.0](LICENSE)。验证流程见
[CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。
