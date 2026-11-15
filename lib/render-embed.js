import payload from "chat-payload";

// Base64 keeps closing-script text in the client bundle outside the HTML tokenizer.
export function buildEmbedHTML(target = "prompt") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amplenote Help</title><style>${payload.styles}</style></head><body>
<main class="chat-shell" data-view="${target === "prompt" ? "prompt" : "full"}">
  <header class="chat-header"><div><span class="eyebrow">AMPLENOTE</span><h1>How can we help?</h1></div>
    <button id="new-chat" class="quiet-button" type="button">New chat</button></header>
  <div id="conversation" class="conversation is-welcome" role="log" aria-label="Help conversation" aria-live="polite" aria-relevant="additions">
    <section id="welcome" class="welcome"><p>Ask about a feature or how to get something done.<br>Answers link to the original help pages.</p>
      <div class="suggestions">
        <button type="button" data-question="How do Rich Footnotes work?">Rich Footnotes <span>↗</span></button>
        <button type="button" data-question="How can I schedule recurring tasks?">Recurring tasks <span>↗</span></button>
        <button type="button" data-question="How do I connect a calendar?">Connect calendar <span>↗</span></button>
      </div></section>
  </div>
  <form id="question-form" class="composer"><label for="question">Your question</label>
    <div class="input-row"><textarea id="question" name="question" rows="2" maxlength="2000" placeholder="Ask about Amplenote…" required></textarea>
      <button id="send" type="submit" aria-label="Send question">Send <span aria-hidden="true">↑</span></button></div>
    <div class="composer-footer"><span>Questions and feedback are saved to improve help.</span><span>Enter to send · Shift+Enter for a new line</span></div>
  </form>
</main>
<script>const client=document.createElement('script');client.textContent=atob('${payload.clientBase64}');document.body.appendChild(client);</script>
</body></html>`;
}
