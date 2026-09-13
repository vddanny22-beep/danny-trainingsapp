import * as storage from "./storage.js";
import { getApiKey, setApiKey, sendChatMessage } from "./ai-chat.js";
import { confirmDialog } from "./ui-dialog.js";
import { showToast } from "./ui-toast.js";

// Coach tab: a chat UI for the AI coach, scoped to sports/krachttraining,
// fitness and voeding (see the system prompt in ai-chat.js). Full history is
// kept in IndexedDB so it survives reloads; only the last MAX_HISTORY_SENT
// messages are sent to the API on each turn to keep requests small.
const MAX_HISTORY_SENT = 20;

// A handful of common questions to get someone started without having to
// think of a question first — tapping one fills the input rather than
// sending straight away, so a wrong guess doesn't cost an API call.
const QUICK_QUESTIONS = ["Hoeveel eiwit heb ik nodig?", "Wat eet ik op een rustdag?", "Ben ik aan het stagneren?"];

export async function renderChatView(container) {
  container.innerHTML = "";

  container.appendChild(renderChatHeader());

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

  const inputRow = document.createElement("div");
  inputRow.className = "chat-input-row";

  const textarea = document.createElement("textarea");
  textarea.className = "chat-input";
  textarea.placeholder = "Bijv. 'Hoeveel eiwit heb ik nodig op een trainingsdag?'";
  textarea.rows = 2;
  inputRow.appendChild(textarea);

  container.appendChild(renderQuickChips(textarea));

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "chat-send-btn";
  sendBtn.setAttribute("aria-label", "Versturen");
  sendBtn.innerHTML =
    '<svg class="chat-send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  inputRow.appendChild(sendBtn);

  form.appendChild(inputRow);

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
    const confirmed = await confirmDialog({
      title: "Gesprek wissen",
      body: "Hele gesprek met de AI Coach verwijderen?",
      confirmLabel: "Wissen",
      danger: true,
    });
    if (!confirmed) return;
    navigator.vibrate?.(20);
    await storage.clearChatMessages();
    showToast("Gesprek gewist");
    renderChatView(container);
  });
  container.appendChild(clearBtn);
}

function renderChatHeader() {
  const header = document.createElement("div");
  header.className = "chat-header";

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14a3 3 0 0 1-3 3H8.5L4.5 20.5V6a3 3 0 0 1 3-3h9.5a3 3 0 0 1 3 3z"/></svg>';
  header.appendChild(avatar);

  const text = document.createElement("div");
  const name = document.createElement("p");
  name.className = "chat-header-name";
  name.textContent = "AI Coach";
  text.appendChild(name);
  const sub = document.createElement("p");
  sub.className = "chat-header-sub";
  sub.textContent = "Sport, voeding & krachttraining";
  text.appendChild(sub);
  header.appendChild(text);

  return header;
}

// Tapping a chip fills the textarea rather than sending straight away, so a
// question that isn't quite what you meant doesn't cost an API call — same
// reason the send button stays a separate, deliberate tap.
function renderQuickChips(textarea) {
  const row = document.createElement("div");
  row.className = "quick-chips";

  QUICK_QUESTIONS.forEach((question) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "quick-chip";
    chip.textContent = question;
    chip.addEventListener("click", () => {
      textarea.value = question;
      textarea.focus();
    });
    row.appendChild(chip);
  });

  return row;
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
