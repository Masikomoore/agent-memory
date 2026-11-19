# Publishing `magpie-agent-memory` to npm & Magpie Discover

This folder is structured as a standalone, marketplace-ready Magpie plugin combining asynchronous gateway hooks (`magpie.hooks`) with Plugin MCP Tools (`main: "./index.mjs"`, served at `/mcp/magpie/tools`), plus `magpie.icon` and `magpie.options`.

## 1. Publish to npm (Standalone Package Route)

You can publish either from the dedicated repository (`Masikomoore/magpie-agent-memory`) or directly from `integrations/magpie/`:

```bash
cd integrations/magpie

# Preview exact tarball contents before publishing
npm pack --dry-run

# Publish public package to npm
npm publish --access public
```

After publishing, anyone can install it in Magpie with:

```bash
magpie plugin add magpie-agent-memory
```

## 2. Submit to Magpie's Official Discover List (`magpie-community/plugins`)

1. Fork <https://github.com/magpie-community/plugins>.
2. Append the entry from [`registry-entry.json`](./registry-entry.json) to `registry.json` under `"plugins"` (`"name": "agent-memory"`).
3. Preview your listing locally in Magpie before opening the PR:

   ```bash
   MAGPIE_PLUGIN_MARKET=file:///path/to/your-fork/registry.json magpie
   ```

4. Open a PR to `magpie-community/plugins`. Magpie refreshes `registry.json` every 6 hours and displays the plugin under **Settings → Plugins → Discover** as **`agent-memory`** with its `magpie.icon` and bilingual summary.

## 3. GitHub `magpie-plugin` Topic Auto-Discovery

Because `package.json` declares `"main": "./index.mjs"` and `index.mjs` is committed at repository root, tagging the standalone repository `Masikomoore/magpie-agent-memory` with the `magpie-plugin` GitHub topic automatically satisfies Magpie's `readTagged()` discovery check as well.
