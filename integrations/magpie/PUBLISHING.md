# Publishing `magpie-agent-memory` to npm & Magpie Discover

This folder is structured as a standalone, marketplace-ready Magpie asynchronous gateway hook package (`GatewayOnly = true`: declares `magpie.hooks`, `magpie.icon`, and `magpie.options`, with no `main` or `exports`).

## 1. Publish to npm (Standalone Package Route)

You can publish either from a dedicated mirror repository (`Masikomoore/magpie-agent-memory` whose root contains the files in this directory) or directly from `integrations/magpie/`:

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
2. Append the entry from [`registry-entry.json`](./registry-entry.json) to `registry.json` under `"plugins"`.
3. Preview your listing locally in Magpie before opening the PR:

   ```bash
   MAGPIE_PLUGIN_MARKET=file:///path/to/your-fork/registry.json magpie
   ```

4. Open a PR to `magpie-community/plugins`. Magpie refreshes `registry.json` every 6 hours and displays the plugin under **Settings → Plugins → Discover** with your `magpie.icon` and bilingual summary.

## 3. Optional: GitHub `magpie-plugin` Topic Auto-Discovery Note

Magpie's **Discover → Unofficial · GitHub** list (`internal/plugin/github.go`, `readTagged()`) currently inspects `package.json` at repository root for `magpie.middleware`, `magpie.agent`, `magpie.page.file`, or `main`/`exports`/`index.js`, and does not yet include `magpie.hooks` in `readTagged()`.

- Submitting to `magpie-community/plugins/registry.json` (Step 2 above) works immediately with zero Magpie core changes and places the plugin in the primary Discover recommendations.
- If you also publish a standalone GitHub repository `Masikomoore/magpie-agent-memory` tagged with the `magpie-plugin` topic, consider opening a small upstream PR to `yetone/magpie` adding `Hooks string \`json:"hooks"\`` to `readTagged()` in `internal/plugin/github.go` so `GatewayOnly` hook packages are auto-discovered from GitHub topics too.
