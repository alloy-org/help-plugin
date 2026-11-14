const conversation = document.getElementById("conversation");
const form = document.getElementById("question-form");
const input = document.getElementById("question");
const newChat = document.getElementById("new-chat");
const send = document.getElementById("send");
const welcomeMarkup = conversation.innerHTML;
let history = [];
let busy = false;

form.addEventListener("submit", event => {
  event.preventDefault();
  submitQuestion();
});
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitQuestion();
  }
});
newChat.addEventListener("click", () => {
  if (busy) return;
  history = [];
  conversation.innerHTML = welcomeMarkup;
  input.value = "";
  input.focus();
});
conversation.addEventListener("click", event => {
  const suggestion = event.target.closest("button[data-question]");
  if (suggestion && !busy) {
    input.value = suggestion.dataset.question;
    submitQuestion();
  }
});
if (typeof window.setAmplenoteEmbedHeight === "function") window.setAmplenoteEmbedHeight(670);

// All server text goes through textContent. Links are limited to the two source sites.
function appendAnswer(container, response) {
  if (response.message) {
    const message = element("p", response.message);
    message.className = "notice";
    container.append(message);
  }
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const lookup = new Map(sources.map((source, index) => [source.id, { ...source, number: index + 1 }]));
  for (const claim of response.claims || []) {
    const paragraph = element("p", (claim.interpretation ? "Interpretation: " : "") + claim.text);
    const cited = new Set();
    for (const support of claim.supports || []) {
      const source = lookup.get(support.evidence_id);
      if (!source || cited.has(source.id)) continue;
      cited.add(source.id);
      const link = sourceLink(source.url, `[${source.number}]`);
      if (link) {
        link.className = "citation";
        link.setAttribute("aria-label", "Source " + source.number + ": " + source.title);
        paragraph.append(link);
      }
    }
    container.append(paragraph);
  }
  if (sources.length) {
    const list = element("div");
    list.className = "source-list";
    for (const [index, source] of sources.entries()) {
      const card = sourceCard(source, index + 1);
      if (card) list.append(card);
    }
    container.append(list);
  }
  if (!sources.length && !(response.claims || []).length && !response.message) {
    container.append(element("p", "I couldn't confirm that from the indexed sources. Try asking about a specific Amplenote feature."));
  }
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function messageContainer(role) {
  const article = element("article");
  article.className = "message " + role;
  const label = element("div", role === "user" ? "You" : "Amplenote help");
  label.className = "message-label";
  const content = element("div");
  content.className = "message-content";
  article.append(label, content);
  conversation.append(article);
  return content;
}

function sourceCard(source, number) {
  const link = sourceLink(source.url, "Open original page ↗");
  if (!link) return null;
  const card = element("details");
  card.className = "source-card";
  const summary = element("summary");
  summary.append(element("span", `[${number}] ${source.title}`));
  const content = element("div");
  content.className = "source-content";
  const badge = element("div", source.site === "noteapps" ? "NoteApps feature evidence" : "Amplenote help");
  badge.className = "source-badge";
  content.append(badge, link);
  if (source.availability_label) content.append(element("p", source.availability_label));
  if (source.quote) content.append(element("blockquote", source.quote));
  if (safeScreenshot(source.screenshot_url)) {
    const screenshotLink = document.createElement("a");
    screenshotLink.href = source.screenshot_url;
    screenshotLink.target = "_blank";
    screenshotLink.rel = "noopener noreferrer";
    screenshotLink.textContent = "View recorded screenshot ↗";
    const image = element("img");
    image.alt = "Recorded screenshot for " + source.title;
    image.src = source.screenshot_url;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      image.remove();
      const note = element("p", "This recorded screenshot is currently unavailable. The source-page link is still available.");
      note.className = "image-note";
      content.append(note);
    }, { once: true });
    content.append(screenshotLink, image);
  }
  card.append(summary, content);
  return card;
}

function safeScreenshot(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "da6jagld7tjfl.cloudfront.net" && !url.username && !url.password;
  } catch { return false; }
}

function sourceLink(value, text) {
  try {
    const url = new URL(value);
    const validHelp = url.hostname === "www.amplenote.com" && url.pathname.startsWith("/help/");
    const validFeature = url.hostname === "noteapps.info" && (url.pathname === "/apps/amplenote" || url.pathname === "/features");
    if (url.protocol !== "https:" || url.username || url.password || !(validHelp || validFeature)) return null;
    const link = element("a", text);
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch { return null; }
}

async function submitQuestion() {
  const question = input.value.trim();
  if (busy || !question || question.length > 2000) return;
  document.getElementById("welcome")?.remove();
  messageContainer("user").textContent = question;
  const content = messageContainer("assistant");
  const status = element("div");
  status.className = "status";
  const spinner = element("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  status.append(spinner, element("span", "Finding Amplenote help…"));
  content.append(status);
  const previous = history.slice(-6);
  busy = true;
  newChat.disabled = send.disabled = true;
  input.value = "";
  conversation.scrollTop = conversation.scrollHeight;
  let timeout;
  try {
    if (typeof window.callAmplenotePlugin !== "function") throw new Error("Open this plugin in Amplenote to ask a question.");
    const result = await Promise.race([
      window.callAmplenotePlugin("ask", { question, history: previous }),
      new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error("The request timed out. Please try again.")), 65000); }),
    ]);
    if (!result?.ok || !result.response) throw new Error(result?.error || "The help service did not return an answer. Please try again.");
    status.remove();
    appendAnswer(content, result.response);
    const answerText = [result.response.message || "", ...(result.response.claims || []).map(claim => claim.text)].join("\n").slice(0, 2000);
    history.push({ role: "user", content: question }, { role: "assistant", content: answerText });
    history = history.slice(-6);
  } catch (error) {
    status.remove();
    const notice = element("p", error.message || "Something went wrong. Please try again.");
    notice.className = "error";
    notice.setAttribute("role", "alert");
    content.append(notice);
    input.value = question;
  } finally {
    clearTimeout(timeout);
    busy = false;
    newChat.disabled = send.disabled = false;
    conversation.scrollTop = conversation.scrollHeight;
    input.focus();
  }
}
