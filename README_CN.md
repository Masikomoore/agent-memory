<div align="center">

# 🧠 Agent Memory

### 一套记忆，所有 Agent 共用。

**为 Claude Code、Codex CLI、Cursor、Gemini CLI、VS Code Agent、OpenClaw 以及任何 MCP 客户端提供可自托管的长期共享记忆层。**

[English](README.md) · [快速开始](#快速开始) · [客户端接入](docs/AGENT_CLIENTS.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md)

</div>

---

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

默认 Docker Compose 会同时运行：

- Agent Memory Server
- `nomic-embed-text` Embedding
- `qwen2.5:3b` SmartExtractor
- LanceDB 持久卷
- Ollama 模型持久卷

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
