import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const compiled = await readFile(new URL("../build/compiled.js", import.meta.url), "utf8");
const loadPlugin = fetch => vm.runInNewContext(compiled, { AbortController, clearTimeout, fetch, setTimeout, URL });

test("compiled artifact evaluates to a plugin and opens a prompt embed without reading notes", async () => {
  const plugin = loadPlugin();
  let invocation;
  await plugin.appOption.Help({ prompt: async (...args) => { invocation = args; } });
  assert.equal(invocation[1].inputs[0].type, "embed");
  assert.equal(invocation[1].primaryAction.label, "Close");
  assert.equal(invocation[1].desiredWidth, 900);
  assert.equal(plugin.renderEmbed.check({ context: { renderEmbedTarget: "prompt" } }), true);
  assert.equal(plugin.renderEmbed.check({ context: { renderEmbedTarget: "notesDashboard" } }), false);
  assert.match(plugin.renderEmbed.run(), /id="question-form"/);
});

test("sidebar option shows a help icon and opens the same prompt embed", async () => {
  const plugin = loadPlugin();
  const option = plugin.sidebarOption["Ask a question"];
  assert.deepEqual({ ...option.check() }, { icon: "contact_support" });
  let invocation;
  await option.run({ prompt: async (...args) => { invocation = args; } });
  assert.equal(invocation[1].inputs[0].type, "embed");
  assert.equal(invocation[1].desiredWidth, 900);
});

test("prompt retries without desiredWidth on clients that reject the key", async () => {
  const plugin = loadPlugin();
  const calls = [];
  await plugin.appOption.Help({ prompt: async (...args) => {
    calls.push(args);
    if ("desiredWidth" in args[1]) throw new Error("Unknown prompt option: desiredWidth");
  } });
  assert.equal(calls.length, 2);
  assert.equal("desiredWidth" in calls[1][1], false);
  assert.equal(calls[1][1].inputs[0].type, "embed");
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

test("related help remains visible without a synopsis and feedback can retry or change a vote", async () => {
  const calls = [];
  const response = { kind: "excerpts", message: "Closest help articles", claims: [], sources: [],
    interaction_id: "a".repeat(32), feedback_token: "b".repeat(43),
    articles: [0, 1, 2, 3, 4].map(index => ({ title: "Help article " + index,
      url: "https://www.amplenote.com/help/topic_" + index, snippet: "A relevant configuration check." })) };
  response.articles.push({ title: "Unsafe", url: "javascript:alert(1)" });
  let feedbackAttempts = 0;
  const dom = new JSDOM(loadPlugin().renderEmbed.run(), {
    runScripts: "dangerously", beforeParse(window) {
      window.callAmplenotePlugin = async (action, payload) => {
        calls.push({ action, payload });
        if (action === "ask") return { ok: true, response };
        return ++feedbackAttempts === 1 ? { ok: false, error: "Please retry." } : { ok: true, response: { ok: true } };
      };
    },
  });
  try {
    const doc = dom.window.document;
    doc.getElementById("question").value = "Why are my tasks missing?";
    doc.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(doc.querySelectorAll(".article-list a").length, 5);
    assert.equal(doc.querySelector("a[href^='javascript:']"), null);
    const [yes, no] = doc.querySelectorAll(".feedback-actions button");
    doc.querySelector(".feedback textarea").value = "Task Domain setup was missing.";
    no.click();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(no.disabled, false);
    assert.match(doc.querySelector(".feedback-status").textContent, /retry/);
    no.click();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(no.getAttribute("aria-pressed"), "true");
    assert.equal(calls.at(-1).payload.helpful, false);
    assert.equal(calls.at(-1).payload.comment, "Task Domain setup was missing.");
    yes.click();
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(calls.at(-1).payload.helpful, true);
    assert.equal(yes.getAttribute("aria-pressed"), "true");
    assert.equal(no.getAttribute("aria-pressed"), "false");
  } finally { dom.window.close(); }
});

test("feedback bridge sends a bounded vote bound to the displayed answer", async () => {
  let sent;
  const plugin = loadPlugin(async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const result = await plugin.onEmbedCall({}, "feedback", {
    interaction_id: "a".repeat(32), feedback_token: "b".repeat(43), helpful: false,
    comment: "x".repeat(2000), sites: ["gitclear"], question: "must-not-send",
  });
  assert.equal(result.ok, true);
  assert.equal(sent.url, "https://amplenote.noteapps.info/help/feedback");
  assert.equal(sent.body.comment.length, 1000);
  assert.deepEqual(Object.keys(sent.body).sort(), ["comment", "feedback_token", "helpful", "interaction_id"]);
  assert.equal((await plugin.onEmbedCall({}, "feedback", { helpful: true })).ok, false);
});


test("source navigation uses the host bridge and validates links again at the host boundary", async () => {
  const plugin = loadPlugin();
  const opened = [];
  const app = { navigate: async url => { opened.push(url); return true; } };
  assert.equal((await plugin.onEmbedCall(app, "navigate", {url: "https://www.amplenote.com/help/mail-to-note"})).ok, true);
  assert.equal((await plugin.onEmbedCall(app, "navigate", {url: "https://evil.invalid/"})).ok, false);
  assert.equal((await plugin.onEmbedCall(app, "navigate", {url: "https://www.amplenote.com@evil.invalid/help/mail-to-note"})).ok, false);
  assert.equal(opened.length, 1);
  assert.equal((await plugin.onEmbedCall({navigate: async () => false}, "navigate", {url: "https://noteapps.info/apps/amplenote"})).ok, false);
  const dom = new JSDOM(plugin.renderEmbed.run(), {runScripts: "dangerously", beforeParse(window) {
    window.callAmplenotePlugin = async (action, payload) => {
      if (action === "ask") return {ok: true, response: {articles: [{url: opened[0], title: "Mail-to-note"}]}};
      assert.equal(action, "navigate");
      assert.equal(payload.url, opened[0]);
      return {ok: false, error: "Copy its address to your browser."};
    };
  }});
  try {
    const doc = dom.window.document;
    doc.getElementById("question").value = "Email capture?";
    doc.getElementById("question-form").dispatchEvent(new dom.window.Event("submit", {cancelable: true}));
    await new Promise(resolve => setTimeout(resolve, 15));
    const link = doc.querySelector(".article-list a");
    assert.equal(link.hasAttribute("target"), false);
    const event = new dom.window.MouseEvent("click", {bubbles: true, cancelable: true});
    link.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(doc.querySelector(".link-error input").value, opened[0]);
  } finally {dom.window.close();}
});

test("Expand opens the full-width plugin section and prompt height follows the browser window", async () => {
  const plugin = loadPlugin();
  let url, args;
  await plugin.appOption.Help({context: {pluginUUID: "uuid"}, prompt: async () => [null, "expand"], openEmbed: async value => {args=value;}, navigate: async value => {url=value;}});
  assert.equal(url, "https://www.amplenote.com/notes/plugins/uuid");
  assert.equal(args.view, "helpChat");
  assert.equal(plugin.renderEmbed.check({context: {renderEmbedTarget: "section"}}), true);
  const heights = [];
  const dom = new JSDOM(plugin.renderEmbed.run(), {runScripts: "dangerously", beforeParse(window) {
    window.outerHeight = 850;
    window.setAmplenoteEmbedHeight = height => heights.push(height);
  }});
  try {
    assert.equal(heights[0], 370);
    dom.window.outerHeight = 700;
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(heights.at(-1), 220);
  } finally {dom.window.close();}
  assert.match(plugin.renderEmbed.run({context: {renderEmbedTarget: "section"}}), /data-view="full"/);
});

test("follow-up history retains the last option of a thorough answer within its limit", async () => {
  const calls = [];
  const response = {claims: Array.from({length:8}, (_, index) => ({text: `Option ${index}: ` + "Detailed sourced explanation. ".repeat(30),supports:[]}))};
  const dom = new JSDOM(loadPlugin().renderEmbed.run(), {runScripts:"dangerously", beforeParse(window) {
    window.callAmplenotePlugin = async (action,payload) => {calls.push(payload);return {ok:true,response};};
  }});
  try {
    const doc = dom.window.document;
    for (const question of ["What are my options?", "Explain the last option"]){
      doc.getElementById("question").value=question;
      doc.getElementById("question-form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    const previous=calls[1].history.find(message=>message.role==="assistant").content;
    assert.match(previous,/Option 0:/);
    assert.match(previous,/Option 7:/);
    assert.ok(previous.length<=2000);
  } finally {dom.window.close();}
});


test("help screenshots are visible inline with provenance and are omitted when unavailable", async () => {
  const source = {id:"help",site:"amplenote",title:"Note Agent",url:"https://www.amplenote.com/help/ample_agent_pro_quick_start_usage",
    screenshot_url:"https://images.amplenote.com/guide/note-agent.png",screenshot_caption:"From the help guide: Note Agent",quote:"Transform your note."};
  const dom = new JSDOM(loadPlugin().renderEmbed.run(), {runScripts:"dangerously",beforeParse(window){
    window.callAmplenotePlugin=async()=>({ok:true,response:{claims:[{text:"Use Note Agent.",supports:[{evidence_id:"help"}]}],sources:[source,{...source,id:"bad",screenshot_url:"https://images.amplenote.com.evil.invalid/image.png"}]}});
  }});
  try {
    const doc=dom.window.document;
    doc.getElementById("question").value="Help with AI";
    doc.getElementById("question-form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,15));
    assert.equal(doc.querySelectorAll(".answer-screenshot img").length,1);
    assert.match(doc.querySelector(".answer-screenshot figcaption").textContent,/Note Agent/);
    assert.equal(doc.querySelector(".answer-screenshot a").href,source.url);
    assert.equal(doc.querySelectorAll(".source-content img").length,0);
    doc.querySelector(".answer-screenshot img").dispatchEvent(new dom.window.Event("error"));
    assert.equal(doc.querySelector(".answer-screenshot"),null);
    assert.ok(doc.querySelector(".source-content a"));
  } finally {dom.window.close();}
});
