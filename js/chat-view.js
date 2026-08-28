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
    const typingBubble = renderBubble("assistant", "…");
    messageList.appendChild(typingBubble);
    scrollToBottom(messageList);

    const history = (await storage.getChatMessages()).slice(-MAX_HISTORY_SENT);
    const result = await sendChatMessage(history);

    typingBubble.remove();
    sendBtn.disabled = false;

    if (!result.ok) {
      status.textContent = result.message;
      status.classList.add("warn");
      return;
    }
    status.textContent = "";
    status.classList.remove("warn");

    const assistantMessage = { id: crypto.randomUUID(), role: "assistant", content: result.text, createdAt: new Date().toISOString() };
    await storage.saveChatMessage(assistantMessage);
    messageList.appendChild(renderBubble("assistant", result.text));
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
    : "Plak hier je Anthropic API-key (console.anthropic.com) om de AI Coach te gebruiken. De key wordt alleen lokaal op dit toestel bewaard en gaat rechtstreeks naar Anthropic — nooit via een eigen server.";
  section.appendChild(help);

  const keyInput = document.createElement("input");
  keyInput.type = "password";
  keyInput.placeholder = "sk-ant-...";
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
