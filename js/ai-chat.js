import * as storage from "./storage.js";

// AI Coach: calls the Anthropic API directly from the browser with a key the
// user pastes in themselves and which never leaves this device (localStorage
// only). That's only reasonable because this is a single-user personal app —
// see README.md. `anthropic-dangerous-direct-browser-access` is required for
// any browser-origin call to the Messages API.

const API_KEY_STORAGE_KEY = "trainingsapp.aiApiKey";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
// Streaming removes the request-timeout pressure that kept this low, so the
// ceiling is now only there to bound cost. The system prompt is what keeps
// answers short; max_tokens only ever truncates mid-sentence.
const MAX_TOKENS = 4096;

// Keeps the coach on-topic and safe: fitness/strength-training/nutrition
// only, no medical diagnoses, grounded in the user's own schema, recent
// sessions and body metrics so advice is concrete rather than generic.
const SYSTEM_PROMPT = `Je bent de AI-coach in een persoonlijke trainingsapp. Je helpt uitsluitend met vragen over krachttraining, sporten/beweging, voeding en herstel in de context van fitness.

Richtlijnen:
- Geef praktische, concrete adviezen (bijv. concrete sets/reps/gewicht-aanpassingen, voedingsvoorbeelden, hersteltips), gebaseerd op gangbare, veilige trainings- en voedingsprincipes.
- Gebruik het meegegeven trainingsschema, de recente sessies en lichaamsmetingen hieronder om advies te personaliseren (bijv. stagnatie signaleren, progressie beoordelen, voeding afstemmen op trainingsvolume) — vraag niet om gegevens die al meegegeven zijn.
- Als de gebruiker een vraag stelt die niets te maken heeft met sporten, krachttraining, fitness of voeding, leg dan vriendelijk uit dat je daar niet mee kan helpen en verwijs terug naar het onderwerp van deze app. Maak geen uitzondering, ook niet als erom wordt gevraagd.
- Bij blessures, pijn of medische klachten: stel geen diagnose en verwijs door naar een arts of fysiotherapeut. Je mag wel algemene, voorzichtige trainingsaanpassingen suggereren (bijv. "vermijd belasting die pijn doet").
- Antwoord bondig en in het Nederlands, tenzij de gebruiker in een andere taal schrijft.`;

// How many recent sessions/logs to include — enough for the coach to spot a
// trend without ballooning every request's token count.
const RECENT_SESSIONS_COUNT = 5;
const RECENT_BODY_LOGS_COUNT = 5;

export function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
}

export function setApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
}

export function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

// Short, non-identifying summary of the user's own schema so the coach can
// give advice grounded in what they actually train — never sent anywhere
// except as part of this prompt to the AI provider.
function buildScheduleContext(days) {
  if (!days.length) return "";
  const lines = days.map((day) => {
    const exerciseNames = day.exercises.map((e) => e.name).join(", ") || "geen oefeningen";
    return `- ${day.name}: ${exerciseNames}`;
  });
  return `\n\nHet huidige trainingsschema van de gebruiker:\n${lines.join("\n")}`;
}

// Recent logged sessions (newest first, as storage.getSessions() already
// returns them) so the coach can see actual weights/reps, not just the plan.
function buildSessionsContext(sessions) {
  if (!sessions.length) return "";
  const lines = sessions.slice(0, RECENT_SESSIONS_COUNT).map((session) => {
    const dateLabel = new Date(session.date).toLocaleDateString("nl-NL");
    const entryLines = session.entries
      .map((entry) => {
        const setsStr = entry.sets.map((set) => `${set.weight}kg x ${set.reps}`).join(", ");
        return `${entry.exerciseName}: ${setsStr}`;
      })
      .join("; ");
    return `- ${dateLabel} (${session.dayName}): ${entryLines || "geen sets gelogd"}`;
  });
  return `\n\nRecent gelogde trainingssessies van de gebruiker (nieuwste eerst):\n${lines.join("\n")}`;
}

// Recent body metrics (weight/waist/note), same recency ordering as sessions.
function buildBodyLogsContext(bodyLogs) {
  if (!bodyLogs.length) return "";
  const lines = bodyLogs.slice(0, RECENT_BODY_LOGS_COUNT).map((log) => {
    const dateLabel = new Date(log.date).toLocaleDateString("nl-NL");
    const parts = [];
    if (log.weightKg != null) parts.push(`${log.weightKg}kg`);
    if (log.waistCm != null) parts.push(`${log.waistCm}cm taille`);
    if (log.note) parts.push(`notitie: ${log.note}`);
    return `- ${dateLabel}: ${parts.join(", ") || "geen meting"}`;
  });
  return `\n\nRecente lichaamsmetingen van de gebruiker (nieuwste eerst):\n${lines.join("\n")}`;
}

async function buildUserContext() {
  const [days, sessions, bodyLogs] = await Promise.all([
    storage.getDays(),
    storage.getSessions(),
    storage.getBodyLogs(),
  ]);
  return buildScheduleContext(days) + buildSessionsContext(sessions) + buildBodyLogsContext(bodyLogs);
}

// Yields each parsed SSE payload from a streaming response body. Events are
// separated by a blank line, so whatever trails the last separator is a
// partial event that has to wait for more bytes before it can be parsed.
async function* readServerSentEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop();

    for (const event of events) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // ignore a malformed frame rather than killing the stream
        }
        yield parsed;
      }
    }
  }
}

// `history` is an array of { role: "user"|"assistant", content: string },
// oldest first. `onDelta` is called with the answer so far as it streams in.
// Returns { ok: true, text } or { ok: false, message } — never throws, so
// callers can render the message straight into the chat.
export async function sendChatMessage(history, onDelta) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, message: "Stel eerst je API-key in bij AI Coach-instellingen." };
  }

  const userContext = await buildUserContext();

  let response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT + userContext,
        output_config: { effort: "medium" },
        stream: true,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (err) {
    return { ok: false, message: `Kon geen verbinding maken met de AI: ${err.message}` };
  }

  if (!response.ok) {
    if (response.status === 401) {
      return { ok: false, message: "Ongeldige API-key. Controleer je key bij AI Coach-instellingen." };
    }
    if (response.status === 429) {
      return { ok: false, message: "Te veel aanvragen bij de AI-provider. Probeer het zo weer." };
    }
    let detail = "";
    try {
      const errBody = await response.json();
      detail = errBody.error?.message || "";
    } catch {
      // response body wasn't JSON — ignore, fall back to the generic message below
    }
    return { ok: false, message: `AI-aanvraag mislukt (${response.status}). ${detail}`.trim() };
  }

  if (!response.body) {
    return { ok: false, message: "AI-aanvraag mislukt: geen antwoordstroom ontvangen." };
  }

  let text = "";
  let stopReason = null;
  let streamError = null;

  try {
    for await (const event of readServerSentEvents(response.body)) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        // Only text_delta: with adaptive thinking the stream also carries
        // thinking deltas, which are not part of the answer.
        text += event.delta.text;
        onDelta?.(text);
      } else if (event.type === "message_delta" && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      } else if (event.type === "error") {
        streamError = event.error?.message || "onbekende fout";
      }
    }
  } catch (err) {
    // A connection dropped mid-answer still leaves usable text on screen;
    // only report failure when nothing arrived at all.
    if (!text) {
      return { ok: false, message: `Verbinding met de AI verbroken: ${err.message}` };
    }
  }

  if (streamError && !text) {
    return { ok: false, message: `AI-aanvraag mislukt: ${streamError}` };
  }
  if (stopReason === "refusal") {
    return { ok: false, message: "De AI kon deze vraag niet beantwoorden." };
  }
  if (!text.trim()) {
    return { ok: false, message: "De AI gaf geen antwoord terug. Probeer het opnieuw." };
  }
  return { ok: true, text: text.trim() };
}
