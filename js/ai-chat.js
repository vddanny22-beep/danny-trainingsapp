import * as storage from "./storage.js";

// AI Coach: calls the Gemini API directly from the browser with a key the
// user pastes in themselves and which never leaves this device (localStorage
// only). That's only reasonable because this is a single-user personal app —
// see README.md. Google's Generative Language API is designed for direct
// client-side use like this, no special browser-access header required.
//
// Uses Gemini's free tier (Google AI Studio, no card needed) rather than a
// paid Anthropic key, since that was the blocker for actually using this tab.

const API_KEY_STORAGE_KEY = "trainingsapp.aiApiKey";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// The "-latest" alias auto-follows Google's current Flash release rather than
// a dated model ID, so this doesn't need updating every time a model is
// deprecated (Flash/Flash-Lite are the models actually included in the free
// tier; Pro is paid-only).
const MODEL = "gemini-flash-latest";
// The system prompt is what keeps answers short; this only bounds cost/keeps
// a runaway response from truncating mid-sentence rather than shaping length.
const MAX_OUTPUT_TOKENS = 4096;

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
    // The note carries the subjective side — poor sleep, a niggling shoulder —
    // that the numbers alone don't show but that changes the advice.
    const noteSuffix = session.note ? ` [notitie: ${session.note}]` : "";
    return `- ${dateLabel} (${session.dayName}): ${entryLines || "geen sets gelogd"}${noteSuffix}`;
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

// Gemini's chat roles are "user" and "model" (not "assistant"), and history
// storage/chat-view.js stay provider-agnostic, so the mapping happens only
// here at the API boundary.
function toGeminiContents(history) {
  return history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

// A response can fail before any body streams (bad key, no quota) or partway
// through (network drop, a safety block). Returns a friendly Dutch message
// for the first case; the caller decides what to do with partial text in the
// second.
async function friendlyErrorMessage(response) {
  let detail = "";
  let status = "";
  try {
    const errBody = await response.json();
    detail = errBody.error?.message || "";
    status = errBody.error?.status || "";
  } catch {
    // response body wasn't JSON — ignore, fall back to the generic message below
  }

  // Gemini reports a bad key as 400 INVALID_ARGUMENT, not 401 — unlike most
  // APIs, so the status code alone can't distinguish it from any other bad request.
  if (response.status === 400 && (status === "INVALID_ARGUMENT" || /api key/i.test(detail))) {
    return "Ongeldige API-key. Controleer je key bij AI Coach-instellingen.";
  }
  if (response.status === 403) {
    return "Geen toegang met deze API-key. Controleer of de Gemini API voor deze key is ingeschakeld in Google AI Studio.";
  }
  if (response.status === 429) {
    return "Daglimiet of snelheidslimiet van het gratis Gemini-tier bereikt. Probeer het over een minuut opnieuw, of morgen als de daglimiet op is.";
  }
  if (response.status === 503) {
    return "Het gratis Gemini-model is momenteel overbelast bij Google (niet aan deze app te wijten). Er is net automatisch opnieuw geprobeerd; probeer het anders over een minuutje nog eens.";
  }
  return `AI-aanvraag mislukt (${response.status}). ${detail}`.trim();
}

// Free-tier Flash capacity spikes are common and usually resolve within
// seconds, per Google's own "please try again later" wording on the 503 —
// so one short retry before surfacing an error saves the user from having to
// notice the failure and resend it themselves.
const RETRY_DELAY_MS = 1500;

function buildRequestBody(history, userContext, { includeThinkingConfig }) {
  const generationConfig = { maxOutputTokens: MAX_OUTPUT_TOKENS };
  // Current Gemini Flash models think before answering by default, which adds
  // a real multi-second delay before the first token even for a simple
  // question like "how much protein do I need". Coaching chat doesn't need
  // deep reasoning, so this trades some of that away for a faster reply.
  if (includeThinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT + userContext }] },
    contents: toGeminiContents(history),
    generationConfig,
  };
}

function requestGemini(apiKey, body) {
  return fetch(`${API_BASE}/models/${MODEL}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
}

// "thinkingLevel" is only understood by newer (Gemini 3-generation) models;
// older ones (2.5-era) use a differently-shaped "thinkingBudget" field
// instead and reject an unrecognized thinkingLevel outright. Since the
// "-latest" alias can point at either generation depending on what Google
// currently ships, this can't be hardcoded one way — it's detected from the
// actual rejection and never surfaced to the user as if the API were broken.
async function isRejectedThinkingConfig(response) {
  if (response.status !== 400) return false;
  let errBody;
  try {
    errBody = await response.clone().json();
  } catch {
    return false;
  }
  const message = (errBody?.error?.message || "").toLowerCase();
  return errBody?.error?.status === "INVALID_ARGUMENT" && message.includes("thinking");
}

async function requestWithFallbacks(apiKey, history, userContext) {
  let body = buildRequestBody(history, userContext, { includeThinkingConfig: true });
  let response = await requestGemini(apiKey, body);

  if (await isRejectedThinkingConfig(response)) {
    body = buildRequestBody(history, userContext, { includeThinkingConfig: false });
    response = await requestGemini(apiKey, body);
  }

  if (response.status === 503) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await requestGemini(apiKey, body);
  }

  return response;
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
    response = await requestWithFallbacks(apiKey, history, userContext);
  } catch (err) {
    return { ok: false, message: `Kon geen verbinding maken met de AI: ${err.message}` };
  }

  if (!response.ok) {
    return { ok: false, message: await friendlyErrorMessage(response) };
  }
  if (!response.body) {
    return { ok: false, message: "AI-aanvraag mislukt: geen antwoordstroom ontvangen." };
  }

  let text = "";
  let finishReason = null;

  try {
    for await (const event of readServerSentEvents(response.body)) {
      const candidate = event.candidates?.[0];
      // Each chunk's text is new content, not the running total — Gemini
      // streams deltas here, unlike its cumulative usageMetadata field.
      for (const part of candidate?.content?.parts || []) {
        if (part.text) {
          text += part.text;
          onDelta?.(text);
        }
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    }
  } catch (err) {
    // A connection dropped mid-answer still leaves usable text on screen;
    // only report failure when nothing arrived at all.
    if (!text) {
      return { ok: false, message: `Verbinding met de AI verbroken: ${err.message}` };
    }
  }

  // SAFETY/RECITATION/PROHIBITED_CONTENT etc. — anything other than a normal
  // stop or the (harmless) length cap counts as the model declining to answer.
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    return { ok: false, message: "De AI kon deze vraag niet beantwoorden." };
  }
  if (!text.trim()) {
    return { ok: false, message: "De AI gaf geen antwoord terug. Probeer het opnieuw." };
  }
  return { ok: true, text: text.trim() };
}
