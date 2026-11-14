# Amplenote Help

A small Amplenote plugin that opens a chat from **Help** in the slash-command or Quick Open menu.
Answers use Amplenote's published help pages, with links and expandable source quotations.
When those pages do not answer a feature question, the service can show Amplenote's NoteApps
feature assessment and its recorded screenshot. Other apps' assessments are excluded.

**Deployment status:** the plugin and live GPU gateway are implemented, but the public hostname
currently receives Cloudflare's JavaScript challenge. A hostname-only rule permission is pending;
see [infrastructure status](docs/infrastructure.md). The normal Amplenote install will be usable
once that public-access check passes.

## Build and install

Use Node.js 20 or later:

```sh
npm ci
npm test
npm run build
```

1. Create a note named **Help** in Amplenote.
2. Insert a JavaScript code block and paste the complete contents of `build/compiled.js` into it.
3. Enable the note as a plugin through Amplenote's plugin settings, following the
   [plugin development guide](https://www.amplenote.com/help/developing_amplenote_plugins).
4. In a note, type `/help` and choose the **Help** plugin action. It is also available through
   Quick Open. The action opens an `app.prompt` containing the chat embed.
5. Ask a question, ask a follow-up, and expand a source card to inspect its quotation or screenshot.

Run `npm run test:live` to check the deployed gateway, source scope, opaque-origin CORS,
private-route isolation, follow-ups, and recorded screenshots. This is a small live smoke test,
not a comprehensive accuracy evaluation; its current expected routes reflect the indexed corpus.

No API key or plugin settings are required. No Amplenote notes, tasks, or account data are read.
The chat history stays in the open window and is sent with follow-up questions; **New chat** clears it.
The Help action does not insert an answer into your current note.

## Source and build layout

| File | Responsibility |
| --- | --- |
| `lib/plugin.js` | Help action, prompt embed, bounded HTTP bridge |
| `lib/render-embed.js` | Self-contained HTML document |
| `lib/chat-client.js` | Chat, citations, source cards, screenshots, follow-ups, retries |
| `lib/chat.css` | Responsive light/dark layout |
| `esbuild.js` | Separate client and host builds; single-expression plugin artifact |
| `test/plugin.test.js` | Tests the compiled plugin and actual embedded browser client |

The host bundle follows the same single-expression output convention as `dashboard-plugin`.
Its embedded client has no external script or stylesheet dependencies.

## Public gateway

The endpoint is `https://amplenote.noteapps.info/help/chat`. It accepts only `question` and
bounded `history`; callers cannot select another corpus, app ID, model, or upstream URL.
The gateway first checks whether a grounded help answer addresses the actual question.
Its fallback queries only Amplenote's NoteApps records and preserves unknown, beta, pending-review,
and qualified states. Screenshot links are recorded evidence; a missing image does not establish
anything about feature support.

The public gateway supplies CORS headers for sandboxed browser origins. No Amplenote CORS proxy
is required, and no private Tribase API credential is shipped to the browser. A Cloudflare Tunnel
exposes only `/help/chat` and `/help/health`; its other paths return 404.

See [infrastructure](docs/infrastructure.md) for the deployed resources and operations.

## Local preview

After building:

```sh
npm run preview
```

For a private-origin integration check while public access is pending, first run
`ssh -N -L 18091:127.0.0.1:8091 sop-gpu1`, then in another terminal run
`HELP_UPSTREAM=http://127.0.0.1:18091/help npm run test:live-ui`.
This runs the compiled plugin host bridge and embedded chat against the real GPU service.

Open `http://127.0.0.1:8093`. This serves the same compiled embed and forwards chat requests to the
public help gateway. It is a development preview, not an Amplenote sandbox emulator. For a local
gateway, use `HELP_API_URL=http://127.0.0.1:8091/help npm run preview`.

To build against a different HTTPS gateway:

```sh
HELP_API_URL=https://example.com/help npm run build
```

Only HTTPS endpoints, or HTTP on localhost for development, are accepted at build time.
