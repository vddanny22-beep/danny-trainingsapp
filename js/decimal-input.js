// Decimal entry that doesn't depend on the browser's locale.
//
// <input type="number"> parses the decimal separator according to the
// browser's UI locale, which varies per device: on one phone "28,1" is 28.1,
// on another the comma is simply dropped and you silently get 281 — a tenfold
// error in a logged weight, with nothing to flag it. Its `step` attribute is
// the other half of the problem: gym plates marked in pounds convert to
// awkward kilos (10 lb = 4.5 kg, 45 lb = 20.4 kg), so any fixed step refuses
// the values a real machine actually has.
//
// A text field with inputmode="decimal" still brings up the numeric keypad on
// both iOS and Android, but hands us the raw string so we can accept either
// separator ourselves.

export function makeDecimalInput(className, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = className;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

// Accepts "28,1" and "28.1" alike. Returns NaN for anything that isn't a
// number, so callers can keep using the same Number.isNaN checks.
export function parseDecimal(value) {
  if (typeof value !== "string") return NaN;
  const normalised = value.trim().replace(",", ".");
  if (!normalised) return NaN;
  // parseFloat would happily read "12abc" as 12; a full match keeps a typo
  // from being silently accepted as a weight.
  return /^-?\d*\.?\d+$/.test(normalised) ? Number(normalised) : NaN;
}
