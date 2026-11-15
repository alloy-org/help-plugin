// Exercise both halves of the compiled plugin against a real gateway, without installing a note.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const upstream = process.env.HELP_UPSTREAM || "https://amplenote.noteapps.info/help";
const calls = [];
const plugin = vm.runInNewContext(await readFile("build/compiled.js", "utf8"), {
  AbortController, clearTimeout, setTimeout, URL,
  fetch: (url, options) => fetch(upstream + new URL(url).pathname.replace(/^\/help/, ""), options),
});
const dom = new JSDOM(plugin.renderEmbed.run(), {
  runScripts: "dangerously", url: "https://help-plugin.invalid/",
  beforeParse(window) {
    window.callAmplenotePlugin = async (action, payload) => {
      const started = Date.now();
      const result = await plugin.onEmbedCall({}, action, payload);
      const safeResult = JSON.parse(JSON.stringify(result));
      if (safeResult.response) delete safeResult.response.feedback_token;
      calls.push({ action, question: payload.question, history_length: payload.history?.length || 0, seconds: (Date.now() - started) / 1000, result: safeResult });
      return result;
    };
    window.setAmplenoteEmbedHeight = () => {};
  },
});
try {
  const document = dom.window.document;
  for (const [question, expectedKind] of [
    ["How do Rich Footnotes work?", "help"],
    ["Can those include images?", "help"],
    ["Does Amplenote support filtering search results by note author?", "feature"],
  ]) {
    document.getElementById("question").value = question;
    document.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    const started = Date.now();
    while (document.getElementById("send").disabled && Date.now() - started < 70000) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(document.querySelectorAll("[role=alert]").length, 0, "Chat should complete without a bridge or HTTP error");
    const result = calls.at(-1).result;
    assert.equal(result.ok, true);
    assert.equal(result.response.kind, expectedKind);
    assert.ok(document.querySelectorAll("a.citation").length);
    console.log(expectedKind + ": " + question);
  }
  assert.equal(calls[1].history_length, 2);
  assert.ok(document.querySelector("img[src^='https://da6jagld7tjfl.cloudfront.net/']"));
  document.getElementById("new-chat").click();
  document.getElementById("question").value = "Why doesn't my task show up next to calendar?";
  document.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  const pending = Date.now();
  while (document.getElementById("send").disabled && Date.now() - pending < 70000) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.at(-1).result.response.kind, "help");
  assert.match(document.querySelector(".assistant").textContent, /task domain/i);
  assert.ok(document.querySelectorAll(".article-list a").length >= 3);
  const no = document.querySelectorAll(".feedback-actions button")[1];
  document.querySelector(".feedback textarea").value = "Automated compiled-UI smoke test";
  no.click();
  const feedbackPending = Date.now();
  while (no.disabled && Date.now() - feedbackPending < 70000) await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(no.getAttribute("aria-pressed"), "true");
  assert.match(document.querySelector(".feedback-status").textContent, /saved/);
  document.getElementById("new-chat").click();
  assert.equal(document.querySelectorAll(".message").length, 0);
  await mkdir("reports", { recursive: true });
  await writeFile("reports/live-ui-smoke.json", JSON.stringify({ tested_at: new Date().toISOString(), upstream, calls }, null, 2) + "\n");
} finally { dom.window.close(); }
