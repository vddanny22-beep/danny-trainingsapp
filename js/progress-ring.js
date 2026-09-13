// Shared hand-rolled SVG progress-ring renderer — no charting library, same
// lightweight style as sparkline.js: geometry and structure live here,
// colors/typography come from css/style.css. `fraction` is 0–1; callers that
// need it to update live (e.g. today-view.js as sets get filled in) should
// keep the returned element and call updateProgressRing() on it rather than
// re-rendering from scratch.
const SIZE = 64;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Each ring gets its own gradient id — <defs> ids are global to the document,
// so two rings on screen at once (unlikely today, but cheap to guard against)
// would otherwise silently share (and fight over) one gradient.
let ringInstance = 0;

export function renderProgressRing(fraction, label = "") {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("class", "progress-ring");

  const gradientId = `progress-ring-track-${ringInstance++}`;
  const defs = document.createElementNS(svgNS, "defs");
  const gradient = document.createElementNS(svgNS, "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "1");
  gradient.setAttribute("y2", "1");
  // Brushed-metal look for the unfilled track, in place of a flat fill.
  gradient.innerHTML = '<stop offset="0" stop-color="#33373f"/><stop offset="1" stop-color="#1c1f24"/>';
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const track = document.createElementNS(svgNS, "circle");
  track.setAttribute("class", "progress-ring-track");
  track.setAttribute("cx", SIZE / 2);
  track.setAttribute("cy", SIZE / 2);
  track.setAttribute("r", RADIUS);
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", `url(#${gradientId})`);
  track.setAttribute("stroke-width", STROKE);
  svg.appendChild(track);

  const fill = document.createElementNS(svgNS, "circle");
  fill.setAttribute("class", "progress-ring-fill");
  fill.setAttribute("cx", SIZE / 2);
  fill.setAttribute("cy", SIZE / 2);
  fill.setAttribute("r", RADIUS);
  fill.setAttribute("fill", "none");
  fill.setAttribute("stroke-width", STROKE);
  fill.setAttribute("stroke-linecap", "round");
  fill.setAttribute("stroke-dasharray", CIRCUMFERENCE.toFixed(2));
  // Rotated so the fill starts at 12 o'clock instead of the default 3 o'clock.
  fill.setAttribute("transform", `rotate(-90 ${SIZE / 2} ${SIZE / 2})`);
  svg.appendChild(fill);

  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("class", "progress-ring-label");
  text.setAttribute("x", "50%");
  text.setAttribute("y", "50%");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  svg.appendChild(text);

  updateProgressRing(svg, fraction, label);
  return svg;
}

// Mutates an already-mounted ring in place, so a caller re-counting on every
// input event doesn't have to rebuild (and re-insert) the whole SVG each time.
export function updateProgressRing(svg, fraction, label = "") {
  const clamped = Math.max(0, Math.min(1, fraction || 0));
  const fill = svg.querySelector(".progress-ring-fill");
  fill.setAttribute("stroke-dashoffset", (CIRCUMFERENCE * (1 - clamped)).toFixed(2));
  svg.querySelector(".progress-ring-label").textContent = label;
}
