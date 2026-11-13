# Harngine

[English](README.md)

Harngine 是一个用 TypeScript 编写智能体和工作流的运行时。它会持久保存模型决策、工具调用、人工审批和执行结果，因此任务在进程中断后仍可恢复，也可以随时查看它做过什么。

Harngine 目前仍是预发布版本，公开 API 可能调整。

[运行两分钟恢复示例](examples/quickstart/README.md)：只使用已发布的框架包，不需要模型账号。示例在持久化等待期间终止进程，再由新进程恢复结果。

# 开始使用

Harngine 需要 Node.js 24.21。从 npm 安装框架包：

```bash
npm install harngine
```

可选的生态集成包发布在 `@harngine` scope 下，仅安装应用所需的包。

## 框架示例

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

想先了解运行时与应用的关系，可看[框架介绍视频](https://youtu.be/upyXdDo2EPY)。下方的应用展示了使用场景。

# 应用示例

这些应用需要克隆源码后运行（`git clone https://github.com/neucine/harngine.git`，然后执行 `cd harngine` 和 `bun install`），与 npm 框架入门示例分开。

## Coding CLI

Harngine Coding 是用于代码仓库工作的终端智能体，提供可检查的执行进度，并在修改文件前请求批准。设置和命令见 [CLI 指南](apps/coding/cli/README.md)；另有 [macOS 桌面指南](apps/coding/desktop/README.md)。

## Support Desk

离线 Support Desk 示例展示重复扣款经过人工审批后完成退款。可以观看[69 秒演示视频](https://github.com/neucine/harngine/releases/download/v0.1.0/walkthrough.mp4)，或按 [Support Desk 指南](examples/support/README.md)运行。

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
