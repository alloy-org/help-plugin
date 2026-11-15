import { buildEmbedHTML } from "./render-embed.js";

const API_URL = __HELP_API_URL__;
const REQUEST_TIMEOUT_MS = 60000;
const MAXIMUM_QUESTION_LENGTH = 2000;

// Keep the host side small. It never reads notes, settings, or account credentials.
const plugin = {
  appOption: {
    "Help": async function(app) {
      return app.prompt("", {
        inputs: [{ type: "embed", value: { view: "helpChat" } }],
        primaryAction: { label: "Close" },
      });
    },
  },
  renderEmbed: {
    check(app) {
      return app.context.renderEmbedTarget === "prompt";
    },
    run() {
      return buildEmbedHTML();
    },
  },
  async onEmbedCall(app, action, payload) {
    if (!["ask", "feedback"].includes(action)) return { ok: false, error: "Unknown help action." };
    let path, body;
    if (action === "feedback") {
      if (!/^[a-f0-9]{32}$/.test(payload?.interaction_id || "") ||
          !/^[A-Za-z0-9_-]{43}$/.test(payload?.feedback_token || "") || typeof payload?.helpful !== "boolean") {
        return { ok: false, error: "This answer cannot receive feedback." };
      }
      path = "/feedback";
      body = { interaction_id: payload.interaction_id, feedback_token: payload.feedback_token,
        helpful: payload.helpful, comment: String(payload.comment || "").slice(0, 1000) };
    } else {
      const question = typeof payload?.question === "string" ? payload.question.trim() : "";
      if (!question || question.length > MAXIMUM_QUESTION_LENGTH) {
        return { ok: false, error: "Enter a question of up to 2,000 characters." };
      }
      const history = Array.isArray(payload.history) ? payload.history.slice(-6).map(message => ({
        role: message.role, content: String(message.content || "").slice(0, MAXIMUM_QUESTION_LENGTH),
      })) : [];
      path = "/chat";
      body = { question, history };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_URL + path, {
        method: "POST", signal: controller.signal, credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = response.status === 429 ? "The help service is busy. Please try again shortly."
          : "The help service could not complete that request. Please try again.";
        return { ok: false, error: message, retryAfter: response.headers.get("Retry-After") };
      }
      return { ok: true, response: await response.json() };
    } catch (error) {
      // Returning an envelope also resolves mobile bridges that leave thrown calls pending.
      return { ok: false, error: error.name === "AbortError" ? "The request timed out. Please try again."
        : "Could not reach the help service. Check your connection and try again." };
    } finally {
      clearTimeout(timer);
    }
  },
};

export default plugin;
