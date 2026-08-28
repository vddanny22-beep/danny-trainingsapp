import * as storage from "./storage.js";

// AI Coach: calls the Anthropic API directly from the browser with a key the
// user pastes in themselves and which never leaves this device (localStorage
// only). That's only reasonable because this is a single-user personal app —
// see README.md. `anthropic-dangerous-direct-browser-access` is required for
// any browser-origin call to the Messages API.

const API_KEY_STORAGE_KEY = "trainingsapp.aiApiKey";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5";
const MAX_TOKENS = 1536;

// Keeps the coach on-topic and safe: fitness/strength-training/nutrition
// only, no medical diagnoses, grounded in the user's own schema so advice is
// concrete rather than generic.
const SYSTEM_PROMPT = `Je bent de AI-coach in een persoonlijke trainingsapp. Je helpt uitsluitend met vragen over krachttraining, sporten/beweging, voeding en herstel in de context van fitness.

Richtlijnen:
- Geef praktische, concrete adviezen (bijv. concrete sets/reps/gewicht-aanpassingen, voedingsvoorbeelden, hersteltips), gebaseerd op gangbare, veilige trainings- en voedingsprincipes.
- Als de gebruiker een vraag stelt die niets te maken heeft met sporten, krachttraining, fitness of voeding, leg dan vriendelijk uit dat je daar niet mee kan helpen en verwijs terug naar het onderwerp van deze app. Maak geen uitzondering, ook niet als erom wordt gevraagd.
- Bij blessures, pijn of medische klachten: stel geen diagnose en verwijs door naar een arts of fysiotherapeut. Je mag wel algemene, voorzichtige trainingsaanpassingen suggereren (bijv. "vermijd belasting die pijn doet").
- Antwoord bondig en in het Nederlands, tenzij de gebruiker in een andere taal schrijft.`;

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
async function buildScheduleContext() {
  const days = await storage.getDays();
  if (!days.length) return "";
  const lines = days.map((day) => {
    const exerciseNames = day.exercises.map((e) => e.name).join(", ") || "geen oefeningen";
    return `- ${day.name}: ${exerciseNames}`;
  });
  return `\n\nHet huidige trainingsschema van de gebruiker:\n${lines.join("\n")}`;
}

// `history` is an array of { role: "user"|"assistant", content: string },
// oldest first. Returns { ok: true, text } or { ok: false, message } — never
// throws, so callers can render the message straight into the chat.
export async function sendChatMessage(history) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, message: "Stel eerst je API-key in bij AI Coach-instellingen." };
  }

  const scheduleContext = await buildScheduleContext();

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
        system: SYSTEM_PROMPT + scheduleContext,
        output_config: { effort: "medium" },
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

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "AI-aanvraag mislukt: geen geldig antwoord ontvangen." };
  }
  if (payload.stop_reason === "refusal") {
    return { ok: false, message: "De AI kon deze vraag niet beantwoorden." };
  }
  const text = (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) {
    return { ok: false, message: "De AI gaf geen antwoord terug. Probeer het opnieuw." };
  }
  return { ok: true, text };
}
