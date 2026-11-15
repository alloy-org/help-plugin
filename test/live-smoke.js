// Explicit integration check against the public service; not part of the offline npm test suite.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.HELP_API_URL || "https://amplenote.noteapps.info/help";
const report = { tested_at: new Date().toISOString(), endpoint: base, cases: [], boundary: [], screenshots: [] };
const first = "How do Rich Footnotes work?";
const cases = [
  { question: first, kind: "help" },
  { question: "Can those include images?", kind: "help", history: [{ role: "user", content: first }, { role: "assistant", content: "Rich Footnotes attach extra context to text." }] },
  { question: "Does Amplenote support filtering search results by note author?", kind: "feature", screenshot: true },
  { question: "Does Amplenote support handwriting recognition?", kind: "feature", screenshot: true },
];
for (const item of cases) {
  const started = performance.now();
  const response = await fetch(base + "/chat", { method: "POST", headers: { "Content-Type": "application/json", "Origin": "null" },
    body: JSON.stringify({ question: item.question, history: item.history || [] }), signal: AbortSignal.timeout(90000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const answer = await response.json();
  assert.equal(answer.kind, item.kind, "Expected route for " + item.question);
  assert.ok(answer.claims.length);
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
  if (item.screenshot) assert.ok(answer.sources.some(source => source.screenshot_url));
  report.cases.push({ question: item.question, seconds: Math.round((performance.now() - started) / 10) / 100, response: answer });
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
