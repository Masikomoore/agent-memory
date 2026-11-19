<div align="center">

# 🧠 Agent Memory

### 一套记忆，所有 Agent 共用。

**为 Claude Code、Codex CLI、WorkBuddy、Cursor、Gemini CLI、Grok Build、VS Code Agent、OpenClaw 以及任何 MCP 客户端提供可自托管的长期共享记忆层 —— 融合 MCP 主动调用 与 Session/Turn Hooks 无感自动记忆。**

[English](README.md) · [双轨接入](#双轨接入mcp--sessionturn-hooks) · [快速开始](#快速开始) · [客户端接入](docs/AGENT_CLIENTS.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md) · [Discussions](https://github.com/Masikomoore/agent-memory/discussions)

</div>

---

> [!TIP]
> **如果你平时会切换两个以上的 AI Agent，这个项目就是为你准备的。** 如果你希望长期记忆属于自己，而不是被某个 IDE、模型或厂商锁定，欢迎先点一个 ⭐ Star，跟着项目一起成长。

## 我为什么做 Agent Memory

这个产品起因于一次很直接的教训：我的 Codex Pro 账号被封了，而我之前从来没有完整保存过自己的历史数据。本地 Codex 的项目开发文件还在，但一部分网页端聊天记录、开发规划时的互动、以及很多形成项目决策的上下文，都一起没了。

这是我第一次真正体会到账号被封意味着什么。我几乎一直在使用市场上所有顶级 AI 公司的产品——Claude、Codex、Grok、Gemini 等等。也正因为如此，我马上意识到，这并不只是某一个账号的问题：如果每个 Agent 都各自保存一部分只有它自己拥有的工作记忆，那么换工具、账号失效，甚至某项服务停止，都可能让一部分项目历史跟着消失。

于是我做了 **Agent Memory**：一套独立于这些 Agent IDE、CLI 和厂商的记忆工具。现在它已经接入 Claude Code、Codex CLI、WorkBuddy、Grok Build 和 Gemini CLI，几套工具共用同一个 Memory Server，实际使用已经很流畅。我也把它开源出来，送给和我一样同时使用 **两个以上 Agent** 的朋友，让长期工作记忆真正掌握在自己手里。

## Agent 不应该各自失忆

今天的大多数 AI 工具都有自己的上下文，却没有共同的长期记忆。Claude Code 刚理解你的项目习惯，换到 Codex 又要从头解释；WorkBuddy 记住了一个项目约定，Gemini CLI 并不知道。

Agent Memory 把记忆从具体工具里拿出来，变成一项独立基础设施：

```text
Claude Code ───┐  MCP (/mcp) + Hooks (UserPromptSubmit / Stop / PreCompact / SessionEnd)
Codex CLI ─────┤  MCP (/mcp) + Hooks (UserPromptSubmit / Stop)
WorkBuddy ─────┤  MCP (/mcp) + Hooks (~/.workbuddy/settings.json)
Cursor ────────┼──► Agent Memory Server ─► Memory Core ─► LanceDB
Gemini CLI ────┤       MCP + REST           │
Grok Build ────┤                            ├─ SmartExtractor（含瞬态重试）
VS Code ───────┤                            ├─ 混合检索（向量 + L0/L1/L2 全摘要 BM25）
OpenClaw ──────┘                            ├─ 衰减 / 强化 / 去重 / Scope 隔离压缩
                                            └─ Scope 权限与生命周期管理
```

**Agent 只是客户端；Memory Server 才是长期记忆的唯一权威来源。**

### 30 秒理解 Agent Memory

| 现在 | 使用 Agent Memory 之后 |
|---|---|
| 每个 Agent 都有不同的上下文 | 所有 Agent 从同一权威记忆层召回 |
| 重要决定散落在聊天记录里 | 每轮对话结束后后台异步自动提取，长期事实沉淀为可检索记忆 |
| 换工具就要重新解释项目 | Claude Code、Codex、WorkBuddy、Cursor、Gemini、Grok、VS Code 等无缝共享 |
| 靠提示词提醒模型调用 MCP 容易漏调 | **MCP + Session/Turn Hooks 双轨并存**：每轮前自动注入相关记忆，需要时再主动深搜 |
| 一味“全记住”最终越来越吵 | 衰减、强化、去重、分层、Scope 隔离压缩共同维护记忆质量 |

现阶段最适合：已经同时使用多个 AI Agent、偏好自托管，并且不想为了长期记忆额外维护知识图谱的开发者和小团队。

## 核心能力与近期引擎升级

- **双轨自动记忆（MCP + Session/Turn Hooks）**：支持 **Claude Code**、**Codex CLI**、**WorkBuddy**、**Grok Build**、**Antigravity CLI**、**Cursor**、**Hermes Agent** 原生生命周期钩子，每轮前无感召回、每轮后后台异步增量捕获，与 MCP 主动工具互补且防回环。
- **全摘要层 BM25 混合检索（`search_text`）**：LanceDB 向量检索叠加覆盖 `text + l0_abstract + l1_overview + l2_content` 的全摘要 BM25 索引，老库升级时自动完成 Schema 迁移与回填。
- **生产级数据与隐私加固**：重复 ID 物理行写入保护（防止向量被覆盖）、LLM JSON 解析报错日志全面脱敏（不泄露对话原文）、提取链路瞬态上游故障单次退避重试、`memory-compactor` 按 Scope 严格隔离防跨区合并。
- **私有自托管与模型可替换**：支持本地、NAS、局域网、Coolify / Docker；任意 OpenAI-compatible API 或本地 Ollama，不绑定厂商、不需要知识图谱。

## 双轨接入：MCP + Session/Turn Hooks

只配 MCP 时，Agent 拥有了记忆工具，但仍依赖模型当轮自觉去调用。新增的 **`agent-memory-hook`** 为 **Claude Code**、**Codex CLI**、**WorkBuddy**、**Grok Build**、**Antigravity CLI**、**Cursor** 和 **Hermes Agent** 补齐了宿主机生命周期自动化，与 MCP 双轨共存：

- **每轮前自动召回**：本地快速跳过寒暄/斜杠命令，8 轮内不重复刷屏同一记忆，严格 fail-open 超时兜底（绝不阻塞输入），并按各客户端原生协议注入带 `[UNTRUSTED DATA]` 边界的相关记忆（`hookSpecificOutput.additionalContext`、Antigravity `injectSteps`、Cursor `additional_context` / `continue: true`、Hermes `{"context": ...}`）。
- **每轮后后台异步增量捕获**：主进程约 `50ms` 内立即返回不卡顿；后台 detached worker 解析 Claude / WorkBuddy / Grok / Cursor JSONL、Codex rollout JSONL 与 Antigravity `USER_INPUT`/`PLANNER_RESPONSE` 日志（含 `lastPrompt + last_assistant_message` 及 Hermes `extra.user_message + assistant_response` 兜底配对），按本地水位线仅提交新增轮次，自动剔除 `tool_use` / `tool_result` 与注入的 `<relevant-memories>` 杜绝回环，临时任务文件**零密钥落盘**。
- **兼容桌面 GUI 客户端**：自动加载 `~/.config/agent-memory/hook.env`（`chmod 600`），即使桌面端未继承 `.zshrc` 也能正常鉴权。
- **非破坏性安装与一键体检**：`agent-memory-hook install <claude-code|codex|workbuddy|grok|antigravity-cli|cursor|hermes>` 幂等合并配置、保留原有设置、注释与其他 Hooks；`agent-memory-hook doctor` 一键体检服务健康、配置加载、缓存目录与各客户端安装状态。

## 已经真实验证

> **真实环境已验证 Claude Code → Codex 召回、Codex 写入 → Claude Code + Grok 跨端召回，以及本机 Claude Code / Codex 接入远端节点的 Session/Turn Hooks 实时召回与 `doctor` 验收。**

| 客户端 | MCP 接入 | Session/Turn Hooks (`agent-memory-hook`) | 状态 |
|---|---|---|---|
| Claude Code | Streamable HTTP `/mcp` | `~/.claude/settings.json`（`UserPromptSubmit` / 异步 `Stop` / `PreCompact` / `SessionEnd`） | ✅ 真机验证（MCP + Hooks） |
| Codex CLI | Streamable HTTP `/mcp` | `~/.codex/hooks.json`（`UserPromptSubmit` / `Stop` + 后台异步 worker） | ✅ 真机验证（MCP + Hooks） |
| WorkBuddy | Streamable HTTP `/mcp` | `~/.workbuddy/settings.json`（`UserPromptSubmit` / `Stop` / `PreCompact` / `SessionEnd`） | ✅ 安装器、模板与 E2E 验证 |
| Grok Build | Streamable HTTP `/mcp` | `~/.grok/hooks/agent-memory.json`（`UserPromptSubmit` / `Stop` / `PreCompact` / `SessionEnd`） | ✅ MCP 真机验证 + Hook 安装器与测试就绪 |
| Antigravity CLI | Streamable HTTP `/mcp` | `~/.gemini/config/hooks.json`（`SessionStart` / `PreInvocation` / `Stop`） | ✅ Hook 安装器、模板与测试就绪 |
| Cursor | Streamable HTTP `/mcp` | `~/.cursor/hooks.json`（`sessionStart` / `beforeSubmitPrompt` / `stop` / `preCompact` / `sessionEnd`） | ✅ MCP 模板 + Hook 安装器与测试就绪 |
| Hermes Agent | Streamable HTTP `/mcp` | `~/.hermes/config.yaml`（`pre_llm_call` / `post_llm_call` / `on_session_finalize`） | ✅ Hook 安装器、YAML 合并与测试就绪 |
| OpenClaw | REST 远程模式 | 原生生命周期插件（`memory.mode: "remote"`） | ✅ 自动化集成覆盖 |
| Gemini CLI | Streamable HTTP `/mcp` | — | ✅ 带认证 MCP 传输验证 |
| VS Code | Streamable HTTP `/mcp` | — | 🧩 配置模板就绪 |
| Magpie 网关（所有经网关路由的客户端） | — | 异步网关钩子插件（[`integrations/magpie`](integrations/magpie/README.md)） | ✅ 真机加载验证（`magpie plugin add`） |

详细接入说明见 [docs/AGENT_CLIENTS.md](docs/AGENT_CLIENTS.md)。

## 快速开始

### 方式一：一句话让 AI Agent 帮你无感安装 / 更新（推荐）

如果你已经在用 Claude Code、Codex CLI、WorkBuddy、Grok Build、Gemini CLI 或 Cursor，直接把下面这句话发给它（完整版提示词见 [`examples/mcp-clients/agent-install-prompt.md`](examples/mcp-clients/agent-install-prompt.md)）：

```text
帮我从 https://github.com/Masikomoore/agent-memory 安装或更新 Agent Memory：先检查本机已安装的客户端以及现有 MCP 与 Hook 配置（不要覆盖我原有的其他配置和 Hooks），接好 MCP，并帮我配置 ~/.config/agent-memory/hook.env（chmod 600）以及本机已安装客户端（Claude Code / Codex / WorkBuddy / Grok / Antigravity CLI / Cursor / Hermes）的 agent-memory-hook，最后用 `agent-memory-hook doctor` 和真实的召回/写入测试验证通过。
```

这段 Agent 安装提示词会明确约束 AI 完成三件关键动作，做到**首次安装与后续更新都无感**：

1. **先检查再动手**：扫描本机已安装的客户端（Claude Code、Codex、WorkBuddy、Grok、Antigravity CLI、Cursor、Hermes）与现有 Hooks，保留所有无关配置、注释和已有 Hooks，优先使用稳定的 Node 绝对路径 + 编译后的 `dist/src/client/memory-hook-cli.js`。
2. **安全安装与幂等更新**：配置 `/mcp` 行为规则与 `~/.config/agent-memory/hook.env`（权限 `600`，绝不在聊天或仓库暴露 Token）；对 Hook 先跑 `agent-memory-hook install <host>`（默认 `--dry-run` 预览），确认无重复、符合 Codex 严格 Schema 后再 `--apply` 写入，老用户更新时重复执行也幂等无副作用。
3. **闭环验证才算完成**：自动执行 `agent-memory-hook doctor` 检查服务端连通性、环境变量与各客户端 Hook 状态，并做一次只读 `UserPromptSubmit` 召回测试与跨端 MCP 写入/召回验证，有问题直接原地修复。

---

### 方式二：手工安装（服务端 + 客户端 Hooks）

#### 第 1 步：启动 Memory Server（Docker Compose 或直接运行）

```bash
git clone https://github.com/Masikomoore/agent-memory.git
cd agent-memory
cp .env.example .env

# 在 .env 中设置一个足够长的 MEMORY_SERVER_TOKEN
openssl rand -hex 32

docker compose up -d
curl http://127.0.0.1:7337/health
```

默认 Docker Compose 运行 Agent Memory Server、LanceDB 持久卷，并连接你自行配置的 OpenAI-compatible Embedding / LLM 服务；如果希望全本地运行 Ollama，可叠加 `docker-compose.ollama.yaml`。

MCP 地址为 `http://127.0.0.1:7337/mcp`（使用 `Authorization: Bearer <MEMORY_SERVER_TOKEN>`）。局域网/广域网与 Coolify 部署见 [docs/MEMORY_SERVER.md](docs/MEMORY_SERVER.md) 和 [docs/DEPLOY_COOLIFY.md](docs/DEPLOY_COOLIFY.md)。

#### 第 2 步：手工启用客户端 Session/Turn Hooks

```bash
# 1. 构建编译后的 Hook CLI（Node 直接执行，启动约 30~50ms）
npm ci && npm run build

# 2. 一次性写入服务端地址与 Token（终端 CLI 与桌面端客户端通用）
mkdir -p ~/.config/agent-memory
cat > ~/.config/agent-memory/hook.env <<'EOF'
MEMORY_SERVER_URL=http://127.0.0.1:7337
MEMORY_SERVER_TOKEN=替换为你的MEMORY_SERVER_TOKEN
EOF
chmod 600 ~/.config/agent-memory/hook.env

# 3. 按需安装到对应客户端（不带 --apply 时仅 dry-run 预览；不会覆盖已有其他 Hooks）
node dist/src/client/memory-hook-cli.js install claude-code --apply
node dist/src/client/memory-hook-cli.js install codex --apply
node dist/src/client/memory-hook-cli.js install workbuddy --apply
node dist/src/client/memory-hook-cli.js install grok --apply
node dist/src/client/memory-hook-cli.js install antigravity-cli --apply   # 别名: agy
node dist/src/client/memory-hook-cli.js install cursor --apply
node dist/src/client/memory-hook-cli.js install hermes --apply

# 4. 一键体检：验证服务健康、env 加载、缓存目录与已安装 Hooks
node dist/src/client/memory-hook-cli.js doctor
```

#### 后续无感更新

- **服务端更新**：`git pull && docker compose up -d --build`（Coolify 部署直接点 **Redeploy**）。已有 LanceDB 表会在启动时自动完成 `search_text` 加列、全摘要层回填与 FTS 索引切换，无需手工删库或迁移。
- **客户端 Hooks 更新**：`git pull && npm run build && node dist/src/client/memory-hook-cli.js doctor`（仅在新增 Hook 事件时重新执行 `install <host> --apply`，原地更新不重复）。

## 我们希望它最终变成什么？

不是某个 IDE 的插件，而是你的私人 **Agent Memory Infrastructure**：

- 一台服务器保存你长期使用的记忆
- 所有 Agent/CLI/IDE 都能通过 MCP 与 Hooks 安全接入
- 记忆由系统自动召回、自动提取、自动维护
- 切换工具，不再重新解释自己和项目
- 数据始终由你掌控

当前仍处于 Alpha 阶段。完整计划见 [ROADMAP.md](ROADMAP.md)，贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 现在最欢迎的贡献

- 验证 WorkBuddy、Cursor、VS Code 或其他 MCP / Hook 客户端的真实接入，并补齐 Gemini CLI 完成模型登录后的 agent-level 验收
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
