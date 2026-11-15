# Amplenote Help

A small Amplenote plugin that opens a chat from **Help** in the slash-command or Quick Open menu.
Answers use Amplenote's published help pages, with links and expandable source quotations.
When those pages do not answer a feature question, the service can show Amplenote's NoteApps
feature assessment and its recorded screenshot. Other apps' assessments are excluded.

**Deployment status:** the public GPU gateway is live at `https://amplenote.noteapps.info/help`.
Public chat, follow-ups, source links, screenshot files, and the compiled plugin's chat UI pass
integration checks. Build and install below to test it inside Amplenote.

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
6. Choose **Expand chat** in the prompt footer to open the full-width plugin view. This starts a new chat.

The current prompt API has no width setting. The compact popup sizes its embed to leave room for
the host header/footer, keeps the composer visible, and scrolls only its transcript. The expanded
view uses the available width, with a 1,200px reading limit. No Amplenote web-app release is needed.
Source clicks call the host's `app.navigate` through the plugin bridge. Amplenote web supports help
URLs there; if a client rejects another source URL (such as NoteApps), the UI offers its address
for copying rather than attempting a blocked iframe popup.

Run `npm run test:live` to check the deployed gateway, source scope, opaque-origin CORS,
private-route isolation, follow-ups, and recorded screenshots. This is a small live smoke test,
not a comprehensive accuracy evaluation; its current expected routes reflect the indexed corpus.

No API key or plugin settings are required. No Amplenote notes, tasks, or account data are read.
The chat history stays in the open window and is sent with follow-up questions; **New chat** clears
that local history. The server saves each submitted question, its resolved follow-up wording, the
answer and evidence versions, retrieval trace, and any yes/no vote and optional comment. These question/feedback tables contain
no Amplenote account identity or IP address. The composer discloses question/feedback
storage. The Help action does not insert an answer into your current note.

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
The gateway expands the question into up to three alternate keyword searches, combines lexical
and semantic matches, and reranks both introductions and matching sections with a small local
cross-encoder. How-to matches receive a bounded semantic review that preserves the direction
of the requested workflow. The context budget is shared across the strongest articles so a long
general guide cannot crowd out a linked setup guide. Citation decoding permits only real source/
quotation pairs; exact-text and independent claim verification still apply.
The strongest articles supply the synopsis context; a separate **Related Amplenote help** list
retains up to five distinct help-page links even when no synopsis can be verified. Troubleshooting
answers suggest supported checks without claiming to inspect the user's account.
The gateway checks whether a grounded help answer addresses the actual question.
Its fallback queries only Amplenote's NoteApps records and preserves unknown, beta, pending-review,
and qualified states. Screenshot links are recorded evidence; a missing image does not establish
anything about feature support.

The public gateway supplies CORS headers for sandboxed browser origins. No Amplenote CORS proxy
is required, and no private Tribase API credential is shipped to the browser. A Cloudflare Tunnel
exposes only `/help/chat`, `/help/feedback`, and `/help/health`; its other paths return 404.

**Yes, this answers my question** and **No, this doesn't answer** save one changeable vote per
answer; expand **Add detail** before voting to include a comment. A per-answer token authorizes
that vote, and the server stores only its hash. Feedback never becomes factual evidence or
rewrites help pages. Two positive votes on the same question can give unchanged source evidence
a small ranking boost; operators can review negative feedback to improve source pages and tests.

See [infrastructure](docs/infrastructure.md) for the deployed resources and operations.

## Local preview

After building:

```sh
npm run preview
```

Run `npm run test:live-ui` to exercise the compiled host bridge and embedded chat against the
public GPU gateway. For a private-origin diagnostic, first run
`ssh -N -L 18091:127.0.0.1:8091 sop-gpu1`, then in another terminal run
`HELP_UPSTREAM=http://127.0.0.1:18091/help npm run test:live-ui`.

Open `http://127.0.0.1:8093`. This serves the same compiled embed and forwards chat requests to the
public help gateway. It is a development preview, not an Amplenote sandbox emulator. For a local
gateway, use `HELP_API_URL=http://127.0.0.1:8091/help npm run preview`.

To build against a different HTTPS gateway:

```sh
HELP_API_URL=https://example.com/help npm run build
```

Only HTTPS endpoints, or HTTP on localhost for development, are accepted at build time.

## Fuller answers and current AI guides

Suggested topics share one horizontally scrollable row so they leave room for the composer.
For general AI questions, the maintained topic entry point is Ample Agent Pro. The retriever
loads relevant sections from that guide and retains the MCP and AmpleAI guides as alternatives.
Explicit questions about a named tool keep their own retrieval priority. This routing is an
editorial preference; every returned factual claim still requires indexed source evidence.
Broad requests can use five articles and up to eight verified points, with larger generation
and verification budgets. Focused questions still follow the requested workflow. Follow-up
history keeps a short excerpt of every returned point so later options are not lost.

When a cited help section (or its own rich footnote) includes a suitable image, up to two
distinct screenshots appear inline with captions and links to the originating help page.
Only stored image URLs on Amplenote's image host or the NoteApps screenshot CDN are accepted.
Unavailable images disappear while source links remain available. These are source illustrations,
not a view of the user's private account.
