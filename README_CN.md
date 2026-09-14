<div align="center">

# 🧠 Agent Memory

### 一套记忆，所有 Agent 共用。

**为 Claude Code、Codex CLI、Cursor、Gemini CLI、VS Code Agent、OpenClaw 以及任何 MCP 客户端提供可自托管的长期共享记忆层。**

[English](README.md) · [快速开始](#快速开始) · [客户端接入](docs/AGENT_CLIENTS.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md) · [Discussions](https://github.com/Masikomoore/agent-memory/discussions)

</div>

---

> [!TIP]
> **如果你平时会切换两个以上的 AI Agent，这个项目就是为你准备的。** 如果你希望长期记忆属于自己，而不是被某个 IDE、模型或厂商锁定，欢迎先点一个 ⭐ Star，跟着项目一起成长。

## Agent 不应该各自失忆

今天的大多数 AI 工具都有自己的上下文，却没有共同的长期记忆。Claude Code 刚理解你的项目习惯，换到 Codex 又要从头解释；Cursor 记住了一个架构决定，Gemini CLI 并不知道。

Agent Memory 把记忆从具体工具里拿出来，变成一项独立基础设施：

```text
Claude Code ─┐
Codex CLI ───┤
Cursor ──────┤
Gemini CLI ──┼──► Agent Memory Server ─► Memory Core ─► LanceDB
VS Code ─────┤          MCP + REST
OpenClaw ────┘
```

**Agent 只是客户端；Memory Server 才是长期记忆的唯一权威来源。**

### 30 秒理解 Agent Memory

| 现在 | 使用 Agent Memory 之后 |
|---|---|
| 每个 Agent 都有不同的上下文 | 所有 Agent 从同一权威记忆层召回 |
| 重要决定散落在聊天记录里 | 长期事实自动提取成可检索记忆 |
| 换工具就要重新解释项目 | Claude Code、Codex、Cursor 等可以共享 |
| 记忆绑定某个插件或厂商 | 记忆运行在你自己的 MCP / REST 服务里 |
| 一味“全记住”最终越来越吵 | 衰减、强化、去重、分层和 Scope 管理生命周期 |

现阶段最适合：已经同时使用多个 AI Agent、偏好自托管，并且不想为了长期记忆额外维护知识图谱的开发者和小团队。

## 它解决什么问题？

- **跨工具共享**：不同 Agent 使用同一份长期记忆
- **自动维护**：不要求你手工编辑“知识库”
- **私有自托管**：电脑、NAS、局域网、VPN、Coolify、云服务器都可以
- **协议开放**：MCP + REST，不绑定某个 Agent 厂商
- **长期生命周期**：提取、去重、衰减、强化、分层、Scope 管理
- **LanceDB 持久化**：语义检索 + 关键词检索
- **模型可替换**：OpenAI-compatible API 或本地 Ollama
- **不需要知识图谱**：重点就是 Agent 长期记忆，而不是图谱维护

## 已经真实验证

我们已经完成过一次真实跨客户端验收：

> **Claude Code 写入一条长期记忆 → 独立 Codex CLI 会话从同一个 Memory Server 成功召回。**

Claude Code 与 Codex CLI 已做真实环境验证；Cursor、Gemini CLI、VS Code 已提供 MCP 配置模板；OpenClaw 已有远程 REST 模式和自动化测试。

## 快速开始

```bash
git clone https://github.com/Masikomoore/agent-memory.git
cd agent-memory
cp .env.example .env

# 在 .env 中设置一个足够长的 MEMORY_SERVER_TOKEN
openssl rand -hex 32

docker compose up -d
curl http://127.0.0.1:7337/health
```

默认 Docker Compose 运行：

- Agent Memory Server
- 你自行配置的 OpenAI-compatible Embedding Provider
- 你自行配置的 OpenAI-compatible LLM Provider
- LanceDB 持久卷

如果希望所有模型都在本机 Ollama 运行，可以叠加
`docker-compose.ollama.yaml`；模型名仍由你自行选择，仓库不替你指定。

MCP 地址：

```text
http://127.0.0.1:7337/mcp
```

客户端使用 Bearer Token 访问。详细接入方式见 [docs/AGENT_CLIENTS.md](docs/AGENT_CLIENTS.md)。

## 我们希望它最终变成什么？

不是某个 IDE 的插件，而是你的私人 **Agent Memory Infrastructure**：

- 一台服务器保存你长期使用的记忆
- 所有 Agent/CLI/IDE 都能安全接入
- 记忆由 Agent 自动召回、自动提取、自动维护
- 切换工具，不再重新解释自己和项目
- 数据始终由你掌控

当前仍处于 Alpha 阶段。特别欢迎大家参与客户端适配、管理 UI、多用户权限、备份恢复、部署模板、指标监控和记忆质量评测。

完整计划见 [ROADMAP.md](ROADMAP.md)，贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 现在最欢迎的贡献

- 验证 Cursor、Gemini CLI、VS Code 或其他 MCP 客户端的真实接入
- 完善备份恢复、诊断、监控、Docker、NAS、Coolify 部署流程
- 用小型测试用例复现一次“不该记住 / 没召回到 / 召回错了”的问题
- 改进身份认证、ACL、Token 轮换和远程部署安全
- 做一个轻量的记忆查看 / 搜索 / 管理界面
- 把某一条安装路径写到第一次使用的人也能一次成功

可以直接查看 [`good first issue`](https://github.com/Masikomoore/agent-memory/labels/good%20first%20issue) 和 [`help wanted`](https://github.com/Masikomoore/agent-memory/labels/help%20wanted)，较大的设计建议可以先到 [Discussions](https://github.com/Masikomoore/agent-memory/discussions) 讨论。

## 开源原则

- Memory Server 是唯一权威记忆源
- Agent 只是客户端，不各自维护分裂数据库
- 默认自动化，而不是人工维护
- 私有部署优先
- MCP / REST 保持工具无关
- “遗忘”与“记住”同样重要
- 不要求知识图谱

## License 与来源说明

项目使用 [MIT License](LICENSE)。Agent Memory 作为独立项目发布，拥有自己的 Git 历史、路线图和版本节奏，不是 GitHub Fork，也不依赖任何 upstream remote。

底层记忆引擎有部分代码来自 MIT 声明的 `memory-lancedb-pro` 代码基础；具体来源与署名见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

<div align="center">

**换 Agent，不应该等于换记忆。**

如果这个方向对你有用，欢迎 ⭐ Star、提交 Issue 或参与开发。

</div>
