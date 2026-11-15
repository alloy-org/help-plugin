// Explicit integration check against the public service; not part of the offline npm test suite.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.HELP_API_URL || "https://amplenote.noteapps.info/help";
const report = { tested_at: new Date().toISOString(), endpoint: base, cases: [], boundary: [], screenshots: [] };
const first = "How do Rich Footnotes work?";
const cases = [
  { question: "How do I have AI write a note for me?", kind: "help", agentPro: true, helpScreenshot: true },
  { question: "What AI features are available in Amplenote?", kind: "help", agentPro: true, broadAI: true },
  { question: "How do I insert a task from an email", kind: "help", mailToNote: true },
  { question: "How do I forward an email into my Amplenote task list?", kind: "help", mailToNote: true },
  { question: "How can I turn a Gmail message into an Amplenote task?", kind: "help", mailToNote: true },
  { question: "Why doesn't my task show up next to calendar?", kind: "help", taskDomains: true },
  { question: "My calendar sidebar has no tasks. What should I check?", kind: "help", taskDomains: true },
  { question: "Where do I choose which notes and tags supply the calendar task list?", kind: "help", taskDomains: true },
  { question: first, kind: "help" },
  { question: "Can those include images?", kind: "help", history: [{ role: "user", content: first }, { role: "assistant", content: "Rich Footnotes attach extra context to text." }] },
  { question: "Does Amplenote support filtering search results by note author?", kind: "feature", screenshot: true },
  { question: "Does Amplenote support handwriting recognition?", kind: ["help", "feature"], screenshot: true, handwriting: true },
];
for (const item of cases) {
  const started = performance.now();
  const response = await fetch(base + "/chat", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "null" },
    body: JSON.stringify({ question: item.question, history: item.history || [] }), signal: AbortSignal.timeout(90000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const answer = await response.json();
  assert.ok((Array.isArray(item.kind) ? item.kind : [item.kind]).includes(answer.kind), "Expected route for " + item.question);
  assert.ok(answer.claims.length);
  assert.ok(answer.articles.length >= 3 && answer.articles.length <= 5, "Always retain distinct help recommendations");
  assert.equal(new Set(answer.articles.map(article => article.url)).size, answer.articles.length);
  assert.ok(answer.articles.every(article => new URL(article.url).hostname === "www.amplenote.com"));
  if (item.taskDomains) {
    assert.match(answer.claims.map(claim => claim.text).join(" "), /task domain/i);
    assert.ok(answer.articles.slice(0, 3).some(article => article.url.endsWith("/using_calendar_task_domains")));
    assert.ok(answer.sources.some(source => source.url.endsWith("/using_calendar_task_domains")), "Synopsis cites the indexed Task Domains page");
  }
  if (item.mailToNote) {
    assert.ok(answer.articles.slice(0, 3).some(article => article.url.endsWith("/mail-to-note")), "Mail-to-Note appears among the first three recommendations");
    assert.match(answer.claims.map(claim => claim.text).join(" "), /mail-to-note|forward|email address/i);
    assert.ok(answer.sources.every(source => !source.url.endsWith("/task_digest_emails")), "Incoming email capture must not cite an outgoing task digest");
  }
  if (item.agentPro) {
    assert.match(answer.claims.map(claim=>claim.text).join(" "), /agent pro/i);
    assert.ok(answer.sources.some(source=>source.url.endsWith("/ample_agent_pro_quick_start_usage")), "AI answer cites the current Agent Pro guide");
    assert.ok(answer.articles[0].url.endsWith("/ample_agent_pro_quick_start_usage"), "Current primary guide leads recommendations");
  }
  if (item.broadAI) {
    assert.ok(answer.claims.length >= 4, "A broad overview should cover multiple substantive points");
    assert.ok(new Set(answer.sources.map(source=>source.url)).size >= 2, "Overview covers documented alternatives");
  }
  if (item.helpScreenshot) {
    assert.ok(answer.sources.some(source=>source.screenshot_url?.startsWith("https://images.amplenote.com/") && source.screenshot_caption), "Relevant help screenshot includes a caption and a source-page record");
  }
  const sources = new Map(answer.sources.map(source => [source.id, source]));
  for (const claim of answer.claims) {
    assert.ok(claim.supports.length);
    for (const support of claim.supports) {
      const source = sources.get(support.evidence_id);
      assert.ok(source, "Every claim must cite returned evidence");
      const url = new URL(source.url);
      assert.equal(url.protocol, "https:");
      if (answer.kind === "help") {
        assert.equal(url.hostname, "www.amplenote.com");
        assert.ok(url.pathname.startsWith("/help/"));
      } else {
        assert.equal(url.hostname, "noteapps.info");
        assert.equal(url.pathname, "/apps/amplenote");
      }
    }
  }
  if (item.handwriting && answer.kind === "help") {
    assert.ok(answer.sources.some(source => source.url.endsWith("/ocr_capture_image_contents_to_text") && /handwrit/i.test(source.quote)),
      "A help answer about handwriting must cite the OCR article's actual handwritten-text evidence");
  }
  if (item.screenshot && answer.kind === "feature") assert.ok(answer.sources.some(source => source.screenshot_url));
  const { feedback_token, ...recordedAnswer } = answer;
  report.cases.push({ question: item.question, seconds: Math.round((performance.now() - started) / 10) / 100, response: recordedAnswer });
  if (item.question === cases[0].question) {
    const vote = { interaction_id: answer.interaction_id, feedback_token, helpful: false, comment: "Automated smoke test: feedback persistence" };
    const denied = await fetch(base + "/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...vote, feedback_token: "x".repeat(43) }) });
    assert.equal(denied.status, 404);
    const saved = await fetch(base + "/feedback", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "null" }, body: JSON.stringify(vote) });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("access-control-allow-origin"), "*");
    assert.equal((await saved.json()).ok, true);
    report.feedback = { interaction_id: answer.interaction_id, valid_vote_status: saved.status, invalid_token_status: denied.status };
  }
  console.log(answer.kind + ": " + item.question);
}
const preflight = await fetch(base + "/chat", { method: "OPTIONS", headers: { "Origin": "null", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
assert.equal(preflight.status, 200);
assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
for (const path of ["/coverage", "/ask", "/v1/models", "/help/coverage"]) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 404, "Private path must not be exposed: " + path);
  report.boundary.push({ path, status: response.status });
}
const forbiddenScope = await fetch(base + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Help", sites: ["gitclear"] }) });
assert.equal(forbiddenScope.status, 422);
for (const url of new Set(report.cases.flatMap(item => item.response.sources.map(source => source.screenshot_url).filter(Boolean)))) {
  const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, "Recorded screenshot should be reachable: " + url);
  const ranged = await fetch(url, { headers: { Range: "bytes=0-31" }, signal: AbortSignal.timeout(20000) });
  assert.ok([200, 206].includes(ranged.status));
  const reader = ranged.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const prefix = Buffer.from(value).subarray(0, 16);
  const format = prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "png"
    : prefix.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")) ? "jpeg"
    : prefix.subarray(0, 3).toString() === "GIF" ? "gif"
    : prefix.subarray(0, 4).toString() === "RIFF" && prefix.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
  assert.ok(format, "Recorded screenshot must contain recognized image bytes: " + url);
  report.screenshots.push({ url, status: response.status, content_type: response.headers.get("content-type"), verified_format: format });
}
await mkdir("reports", { recursive: true });
await writeFile("reports/live-smoke.json", JSON.stringify(report, null, 2) + "\n");
console.log("CORS, private-route isolation, source scope, and screenshot checks passed.");
