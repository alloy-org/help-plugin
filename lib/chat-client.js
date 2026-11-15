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
  conversation.classList.add("is-welcome");
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
// outerHeight is available inside cross-origin frames and follows the browser window.
// Reserve browser chrome, the host dialog header/footer, and its content padding.
function sizePrompt() {
  if (document.querySelector(".chat-shell").dataset.view !== "prompt" || typeof window.setAmplenoteEmbedHeight !== "function") return;
  const outer = window.outerHeight || window.screen?.availHeight || 840;
  window.setAmplenoteEmbedHeight(Math.max(180, Math.min(520, outer - 480)));
}
sizePrompt();
window.addEventListener("resize", sizePrompt);
function showLinkError(container, text, url) {
  container.querySelector(".link-error")?.remove();
  const notice = element("div", text);
  notice.className = "link-error notice";
  notice.setAttribute("role", "status");
  if (url) {
    const address = element("input");
    address.readOnly = true;
    address.value = url;
    address.setAttribute("aria-label", "Source URL to copy");
    notice.append(address);
    address.addEventListener("focus", () => address.select());
  }
  container.append(notice);
}
function bindSourceNavigation(link) {
  link.addEventListener("click", async event => {
    event.preventDefault();
    try {
      const result = await window.callAmplenotePlugin("navigate", { url: link.href });
      if (!result?.ok) showLinkError(link.parentElement, result?.error || "Could not open this source.", link.href);
    } catch { showLinkError(link.parentElement, "Could not open this source. Copy its address to your browser.", link.href); }
  });
  return link;
}

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
  const articles = Array.isArray(response.articles) ? response.articles : [];
  if (articles.length) {
    const section = element("section");
    section.className = "related-help";
    section.append(element("h2", "Related Amplenote help"));
    const list = element("ul");
    list.className = "article-list";
    const seen = new Set();
    for (const article of articles) {
      const link = sourceLink(article.url, article.title);
      if (!link || new URL(link.href).hostname !== "www.amplenote.com" || seen.has(link.href)) continue;
      seen.add(link.href);
      const item = element("li");
      item.append(link);
      if (article.snippet) item.append(element("p", article.snippet));
      list.append(item);
      if (seen.size === 5) break;
    }
    section.append(list);
    if (seen.size) container.append(section);
  }
  if (sources.length) {
    const heading = element("h2", response.claims?.length ? "Sources cited above" : "Retrieved source excerpts");
    heading.className = "evidence-heading";
    container.append(heading);
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
  if (response.interaction_id && response.feedback_token) appendFeedback(container, response);
}

function appendFeedback(container, response) {
  const section = element("section");
  section.className = "feedback";
  section.setAttribute("aria-label", "Answer feedback");
  section.append(element("p", "Did this answer your question?"));
  const actions = element("div");
  actions.className = "feedback-actions";
  const yes = element("button", "Yes, this answers my question");
  const no = element("button", "No, this doesn't answer");
  for (const button of [yes, no]) {
    button.type = "button";
    button.className = "quiet-button";
    button.setAttribute("aria-pressed", "false");
    actions.append(button);
  }
  const details = element("details");
  details.append(element("summary", "Add detail (optional)"));
  const comment = element("textarea");
  comment.maxLength = 1000;
  comment.rows = 2;
  comment.setAttribute("aria-label", "Optional feedback detail");
  comment.placeholder = "What helped, or what is missing?";
  details.append(comment);
  const status = element("p");
  status.className = "feedback-status";
  status.setAttribute("role", "status");
  async function vote(helpful) {
    yes.disabled = no.disabled = true;
    status.textContent = "Saving feedback…";
    try {
      const result = await window.callAmplenotePlugin("feedback", {
        interaction_id: response.interaction_id, feedback_token: response.feedback_token,
        helpful, comment: comment.value.trim().slice(0, 1000),
      });
      if (!result?.ok) throw new Error(result?.error || "Could not save feedback. Please retry.");
      yes.setAttribute("aria-pressed", String(helpful));
      no.setAttribute("aria-pressed", String(!helpful));
      status.textContent = "Thanks — feedback saved. You can change your vote.";
    } catch (error) {
      status.textContent = error.message || "Could not save feedback. Please retry.";
    } finally { yes.disabled = no.disabled = false; }
  }
  yes.addEventListener("click", () => vote(true));
  no.addEventListener("click", () => vote(false));
  section.append(actions, details, status);
  container.append(section);
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
    bindSourceNavigation(screenshotLink);
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
    link.rel = "noopener noreferrer";
    return bindSourceNavigation(link);
  } catch { return null; }
}

async function submitQuestion() {
  const question = input.value.trim();
  if (busy || !question || question.length > 2000) return;
  document.getElementById("welcome")?.remove();
  conversation.classList.remove("is-welcome");
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
    conversation.scrollTop = content.parentElement.offsetTop - conversation.offsetTop;
    input.focus();
  }
}
