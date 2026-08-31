import * as storage from "./storage.js";
import { getApiKey, setApiKey, sendChatMessage } from "./ai-chat.js";

// Coach tab: a chat UI for the AI coach, scoped to sports/krachttraining,
// fitness and voeding (see the system prompt in ai-chat.js). Full history is
// kept in IndexedDB so it survives reloads; only the last MAX_HISTORY_SENT
// messages are sent to the API on each turn to keep requests small.
const MAX_HISTORY_SENT = 20;

export async function renderChatView(container) {
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "AI Coach";
  container.appendChild(heading);

  const intro = document.createElement("p");
  intro.className = "sync-help";
  intro.textContent = "Stel vragen over krachttraining, sporten, voeding of herstel. De coach kent je huidige schema en blijft bij dat onderwerp.";
  container.appendChild(intro);

  container.appendChild(renderApiKeySettings(container));

  if (!getApiKey()) return;

  const chatBox = document.createElement("div");
  chatBox.className = "chat-box";
  container.appendChild(chatBox);

  const messageList = document.createElement("div");
  messageList.className = "chat-messages";
  chatBox.appendChild(messageList);

  const messages = await storage.getChatMessages();
  messages.forEach((m) => messageList.appendChild(renderBubble(m.role, m.content)));
  scrollToBottom(messageList);

  const form = document.createElement("form");
  form.className = "chat-input-form";

  const textarea = document.createElement("textarea");
  textarea.className = "chat-input";
  textarea.placeholder = "Bijv. 'Hoeveel eiwit heb ik nodig op een trainingsdag?'";
  textarea.rows = 2;
  form.appendChild(textarea);

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "btn btn-primary";
  sendBtn.textContent = "Versturen";
  form.appendChild(sendBtn);

  const status = document.createElement("p");
  status.className = "save-status";
  form.appendChild(status);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;

    const userMessage = { id: crypto.randomUUID(), role: "user", content: text, createdAt: new Date().toISOString() };
    await storage.saveChatMessage(userMessage);
    messageList.appendChild(renderBubble("user", text));
    scrollToBottom(messageList);
    textarea.value = "";

    sendBtn.disabled = true;
    status.textContent = "De coach denkt na...";

    // The same bubble that shows the placeholder fills in as the answer
    // streams, so there is no flash of removing and re-adding it at the end.
    const answerBubble = renderBubble("assistant", "…");
    messageList.appendChild(answerBubble);
    scrollToBottom(messageList);

    const history = (await storage.getChatMessages()).slice(-MAX_HISTORY_SENT);
    const result = await sendChatMessage(history, (partial) => {
      // Checked before the text grows: only keep pinning to the bottom if the
      // user was already there, so scrolling up to re-read isn't yanked back.
      const stick = isNearBottom(messageList);
      answerBubble.textContent = partial;
      status.textContent = "";
      if (stick) scrollToBottom(messageList);
    });

    sendBtn.disabled = false;

    if (!result.ok) {
      // Left in place instead of removed: silently vanishing gave no sign a
      // message had failed, which is exactly what led to someone resending
      // the same question several times over — every attempt looked like
      // nothing had happened at all.
      answerBubble.classList.add("chat-msg-error");
      answerBubble.textContent = `⚠️ ${result.message}`;
      status.textContent = "";
      status.classList.remove("warn");
      scrollToBottom(messageList);
      return;
    }
    status.textContent = "";
    status.classList.remove("warn");

    answerBubble.textContent = result.text;
    await storage.saveChatMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      content: result.text,
      createdAt: new Date().toISOString(),
    });
    scrollToBottom(messageList);
  });

  container.appendChild(form);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-secondary btn-danger";
  clearBtn.textContent = "Gesprek wissen";
  clearBtn.addEventListener("click", async () => {
    if (!confirm("Hele gesprek met de AI Coach verwijderen?")) return;
    await storage.clearChatMessages();
    renderChatView(container);
  });
  container.appendChild(clearBtn);
}

function renderApiKeySettings(rootContainer) {
  const section = document.createElement("section");
  section.className = "sync-settings";

  const heading = document.createElement("h3");
  heading.textContent = "AI Coach-instellingen";
  section.appendChild(heading);

  const hasKey = !!getApiKey();

  const help = document.createElement("p");
  help.className = "sync-help";
  help.textContent = hasKey
    ? "API-key is ingesteld. Vul hieronder een nieuwe key in om te wijzigen."
    : "Plak hier je gratis Gemini API-key (aistudio.google.com, geen betaalpas nodig) om de AI Coach te gebruiken. De key wordt alleen lokaal op dit toestel bewaard en gaat rechtstreeks naar Google — nooit via een eigen server. Het gratis tier heeft een dag- en snelheidslimiet.";
  section.appendChild(help);

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.placeholder = "AIzaSy...";
  keyInput.className = "sync-url-input";
  section.appendChild(keyInput);

  const status = document.createElement("p");
  status.className = "sync-status";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn btn-small";
  saveBtn.textContent = "Opslaan";
  saveBtn.addEventListener("click", () => {
    if (!keyInput.value.trim()) return;
    setApiKey(keyInput.value);
    status.textContent = "API-key opgeslagen.";
    renderChatView(rootContainer);
  });
  section.appendChild(saveBtn);
  section.appendChild(status);

  return section;
}

function renderBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-msg chat-msg-${role}`;
  bubble.textContent = text;
  return bubble;
}

function scrollToBottom(messageList) {
  messageList.scrollTop = messageList.scrollHeight;
}

function isNearBottom(messageList) {
  return messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 60;
}
