import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const compiled = await readFile(new URL("../build/compiled.js", import.meta.url), "utf8");
const loadPlugin = fetch => vm.runInNewContext(compiled, { AbortController, clearTimeout, fetch, setTimeout });

test("compiled artifact evaluates to a plugin and opens a prompt embed without reading notes", async () => {
  const plugin = loadPlugin();
  let invocation;
  await plugin.appOption.Help({ prompt: async (...args) => { invocation = args; } });
  assert.equal(invocation[1].inputs[0].type, "embed");
  assert.equal(invocation[1].primaryAction.label, "Close");
  assert.equal(plugin.renderEmbed.check({ context: { renderEmbedTarget: "prompt" } }), true);
  assert.equal(plugin.renderEmbed.check({ context: { renderEmbedTarget: "notesDashboard" } }), false);
  assert.match(plugin.renderEmbed.run(), /id="question-form"/);
});

test("host bridge sends only bounded chat input and no privileged API key", async () => {
  let sent;
  const plugin = loadPlugin(async (url, options) => {
    sent = { url, options };
    return { ok: true, json: async () => ({ kind: "help", claims: [], sources: [] }) };
  });
  const history = Array.from({ length: 12 }, (_, index) => ({ role: "user", content: "Question " + index }));
  const result = await plugin.onEmbedCall({}, "ask", { question: "  How do footnotes work?  ", history, sites: ["gitclear"], apiKey: "must-not-send" });
  assert.equal(result.ok, true);
  assert.equal(sent.url, "https://amplenote.noteapps.info/help/chat");
  assert.equal(sent.options.credentials, "omit");
  assert.deepEqual(Object.keys(sent.options.headers), ["Content-Type"]);
  const body = JSON.parse(sent.options.body);
  assert.equal(body.question, "How do footnotes work?");
  assert.equal(body.history.length, 6);
  assert.deepEqual(Object.keys(body).sort(), ["history", "question"]);
});

test("bridge errors resolve as envelopes, including busy and network failures", async () => {
  const busy = loadPlugin(async () => ({ ok: false, status: 429, headers: { get: () => "2" } }));
  assert.equal((await busy.onEmbedCall({}, "ask", { question: "Help" })).retryAfter, "2");
  const offline = loadPlugin(async () => { throw new TypeError("offline"); });
  assert.equal((await offline.onEmbedCall({}, "ask", { question: "Help" })).ok, false);
  assert.equal((await offline.onEmbedCall({}, "unexpected", {})).ok, false);
});

test("chat renders safe citations and screenshots, supports follow-ups, and resets history", async () => {
  const calls = [];
  const response = {
    kind: "feature", message: "From NoteApps", claims: [{ text: '<img src=x onerror="alert(1)"> Calendar exists.', interpretation: false,
      supports: [{ evidence_id: "feature-1", quote: "Available publicly." }] }],
    sources: [{ id: "feature-1", site: "noteapps", title: "Amplenote — Calendar", url: "https://noteapps.info/apps/amplenote#feature-built-in-calendar",
      quote: "Available publicly.", availability_label: "Available publicly.", screenshot_url: "https://da6jagld7tjfl.cloudfront.net/example" },
      { id: "bad", site: "amplenote", title: "Bad link", url: "javascript:alert(1)", quote: "Untrusted" }],
  };
  const dom = new JSDOM(loadPlugin().renderEmbed.run(), {
    runScripts: "dangerously", url: "https://plugin.invalid/",
    beforeParse(window) {
      window.callAmplenotePlugin = async (action, payload) => { calls.push({ action, payload }); return { ok: true, response }; };
      window.setAmplenoteEmbedHeight = () => {};
    },
  });
  try {
    const document = dom.window.document;
    const send = async question => {
      document.getElementById("question").value = question;
      document.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 15));
    };
    await send("Does it have a calendar?");
    assert.match(document.querySelector(".assistant").textContent, /<img src=x/);
    assert.equal(document.querySelector("img[src=x]"), null);
    assert.equal(document.querySelector("a[href^='javascript:']"), null);
    assert.equal(document.querySelectorAll("details.source-card").length, 1);
    assert.equal(document.querySelector("img").getAttribute("src"), response.sources[0].screenshot_url);
    assert.equal(document.querySelector("a.citation").rel, "noopener noreferrer");
    await send("How about recurring tasks?");
    assert.equal(calls[1].payload.history.length, 2);
    document.getElementById("new-chat").click();
    await send("A fresh question");
    assert.equal(calls[2].payload.history.length, 0);
    assert.equal(document.querySelectorAll(".message.user").length, 1);
  } finally { dom.window.close(); }
});

test("a failed chat request restores the question for retry", async () => {
  const dom = new JSDOM(loadPlugin().renderEmbed.run(), {
    runScripts: "dangerously", beforeParse(window) { window.callAmplenotePlugin = async () => ({ ok: false, error: "Please retry." }); },
  });
  try {
    dom.window.document.getElementById("question").value = "Help me";
    dom.window.document.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(dom.window.document.getElementById("question").value, "Help me");
    assert.equal(dom.window.document.getElementById("send").disabled, false);
    assert.equal(dom.window.document.querySelector("[role=alert]").textContent, "Please retry.");
  } finally { dom.window.close(); }
});
