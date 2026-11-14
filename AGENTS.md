# Amplenote Help plugin

This is an Amplenote client-side plugin, following the `dashboard-plugin` / `ample-agent-pro`
layout. The entry point is `lib/plugin.js`; `npm run build` writes the single plugin expression
to `build/compiled.js`. The browser client is bundled separately and embedded as a payload.

Read the current [Amplenote Plugin API](https://www.amplenote.com/help/developing_amplenote_plugins)
before changing plugin actions. Use documented `app.prompt`, `renderEmbed`, and `onEmbedCall` APIs.
Keep DOM code out of the host entry point. No private notes are needed or read by this plugin.

- Run `npm test` after changes. It compiles and checks the actual artifact and embedded UI.
- Source URLs must come from stored evidence, never model-generated HTML or URLs.
- Use `textContent` for questions, answers, titles, and quotations; validate outbound URLs.
- Never put the private Tribase API key, Cloudflare credentials, or tunnel credentials in the bundle.
- Public endpoint: `https://amplenote.noteapps.info/help`. Infrastructure is managed in
  `alloy-org/tribase`, under `ansible/help-tunnel.yml` and the help gateway module.
- Do not change DNS for `amplenote.com`. This project owns only its new hostname in `noteapps.info`.
- Use the normal Cloudflare MCP OAuth connection. Do not read MCP credentials from macOS Keychain.
