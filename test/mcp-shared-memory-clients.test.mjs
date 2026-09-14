import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { createMemoryHttpServer } = jiti("../src/server/http-server.ts");

function makeClient(name, baseUrl) {
  const client = new Client(
    { name, version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    authProvider: { token: async () => "shared-test-secret" },
  });
  return { client, transport };
}

describe("shared memory across independent MCP clients", () => {
  let server;
  let baseUrl;
  const entries = [];
  const calls = { capture: [], recall: [] };

  before(async () => {
    const runtime = {
      defaultAgentId: "main",
      defaultWriteScope: "global",
      async health() {
        return {
          status: "ok",
          memories: entries.length,
          captureEnabled: true,
          vectorDim: 1536,
        };
      },
      service: {
        async capture(request) {
          calls.capture.push(request);
          entries.push({
            id: `memory-${entries.length + 1}`,
            text: request.conversationText,
            vector: [0.1, 0.2],
            category: "fact",
            scope: request.scope ?? "global",
            importance: 0.8,
            timestamp: Date.now(),
            metadata: JSON.stringify({ captured_by: request.agentId }),
          });
          return { created: 1, merged: 0, skipped: 0, boundarySkipped: 0 };
        },
        async recall(request) {
          calls.recall.push(request);
          const query = request.query.toLowerCase();
          return entries
            .filter((entry) => entry.text.toLowerCase().includes(query))
            .map((entry) => ({ entry, score: 0.99 }));
        },
      },
    };

    server = createMemoryHttpServer(runtime, {
      host: "127.0.0.1",
      port: 0,
      token: "shared-test-secret",
      allowedHosts: ["127.0.0.1", "localhost"],
      allowedOrigins: ["127.0.0.1", "localhost"],
      maxBodyBytes: 1024 * 1024,
    }, {
      info() {},
      warn() {},
      error() {},
      debug() {},
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  });

  it("lets one logical agent capture and another logical agent recall the same central memory", async () => {
    const writer = makeClient("claude-code-integration-test", baseUrl);
    const reader = makeClient("codex-integration-test", baseUrl);

    try {
      await writer.client.connect(writer.transport);
      await reader.client.connect(reader.transport);

      assert.match(writer.client.getInstructions() ?? "", /memory_recall/);
      assert.match(writer.client.getInstructions() ?? "", /memory_capture/);
      assert.match(writer.client.getInstructions() ?? "", /agentId/);

      const capture = await writer.client.callTool({
        name: "memory_capture",
        arguments: {
          conversationText: "interop-sapphire-742 is the cross-agent verification phrase",
          agentId: "claude-code",
        },
      });
      assert.equal(capture.isError ?? false, false);
      assert.equal(capture.structuredContent.created, 1);

      const recalled = await reader.client.callTool({
        name: "memory_recall",
        arguments: {
          query: "interop-sapphire-742",
          agentId: "codex",
        },
      });
      assert.equal(recalled.isError ?? false, false);
      assert.equal(recalled.structuredContent.count, 1);
      assert.match(recalled.structuredContent.memories[0].text, /interop-sapphire-742/);
      assert.equal(recalled.structuredContent.memories[0].scope, "global");
      assert.equal(calls.capture.at(-1).agentId, "claude-code");
      assert.equal(calls.capture.at(-1).scope, "global");
      assert.equal(calls.recall.at(-1).agentId, "codex");
    } finally {
      await Promise.allSettled([writer.client.close(), reader.client.close()]);
    }
  });
});

describe("documented MCP client configuration examples", () => {
  it("ships parseable JSON examples and an authenticated Codex HTTP config", async () => {
    const base = new URL("../examples/mcp-clients/", import.meta.url);
    const [claudeRaw, cursorRaw, geminiRaw, vscodeRaw, codexRaw, instructions, packageRaw] = await Promise.all([
      readFile(new URL("claude-code.mcp.json", base), "utf8"),
      readFile(new URL("cursor-mcp.json", base), "utf8"),
      readFile(new URL("gemini-settings.json", base), "utf8"),
      readFile(new URL("vscode-mcp.json", base), "utf8"),
      readFile(new URL("codex-config.toml", base), "utf8"),
      readFile(new URL("agent-memory-instructions.md", base), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);

    const claude = JSON.parse(claudeRaw);
    const cursor = JSON.parse(cursorRaw);
    const gemini = JSON.parse(geminiRaw);
    const vscode = JSON.parse(vscodeRaw);
    const pkg = JSON.parse(packageRaw);

    assert.equal(claude.mcpServers["agent-memory"].type, "http");
    assert.match(claude.mcpServers["agent-memory"].url, /\/mcp$/);
    assert.match(claude.mcpServers["agent-memory"].headers.Authorization, /MEMORY_SERVER_TOKEN/);

    assert.match(cursor.mcpServers["agent-memory"].url, /\/mcp$/);
    assert.match(cursor.mcpServers["agent-memory"].headers.Authorization, /MEMORY_SERVER_TOKEN/);

    assert.match(gemini.mcpServers["agent-memory"].httpUrl, /\/mcp$/);
    assert.match(gemini.mcpServers["agent-memory"].headers.Authorization, /MEMORY_SERVER_TOKEN/);

    assert.equal(vscode.servers.agentMemory.type, "http");
    assert.match(vscode.servers.agentMemory.url, /\/mcp$/);
    assert.equal(vscode.inputs[0].password, true);

    assert.match(codexRaw, /\[mcp_servers\.agent-memory\]/);
    assert.match(codexRaw, /bearer_token_env_var\s*=\s*"MEMORY_SERVER_TOKEN"/);
    assert.match(instructions, /memory_recall/);
    assert.match(instructions, /memory_capture/);
    assert.match(instructions, /agentId/);
    assert.ok(pkg.files.includes("examples/mcp-clients/**/*"));
  });
});
