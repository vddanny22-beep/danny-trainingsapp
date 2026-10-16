import { muscleLabel, muscleHeat, formatSets } from "./muscles.js";

// Hand-drawn front/back body figure as inline SVG — no image files or
// libraries, so it renders offline at the gym. Each muscle region is filled
// by how much it was trained; colours come from css/style.css (.bm-*).
//
// Coordinates: each figure is drawn in a 100 × 222 box, left half only for
// paired muscles; the right half is mirrored around x = 50.

const W = 100;
const H = 222;
const GAP = 16;

const mirrorX = (x) => W - x;

// Non-muscle silhouette, drawn first.
const BASE = [
  ["circle", { cx: 50, cy: 14, r: 10 }],
  ["rect", { x: 45, y: 23, width: 10, height: 9, rx: 3 }],
  ["rect", { x: 33, y: 33, width: 34, height: 68, rx: 11 }],
  ["rect", { x: 19, y: 39, width: 12, height: 37, rx: 6, pair: true }],
  ["rect", { x: 16, y: 73, width: 11, height: 35, rx: 5, pair: true }],
  ["ellipse", { cx: 21.5, cy: 113, rx: 4.5, ry: 6, pair: true }],
  ["rect", { x: 35, y: 96, width: 30, height: 19, rx: 7 }],
  ["rect", { x: 33, y: 110, width: 15, height: 54, rx: 7, pair: true }],
  ["rect", { x: 35, y: 163, width: 11, height: 45, rx: 5, pair: true }],
  ["ellipse", { cx: 40.5, cy: 212, rx: 6, ry: 3.5, pair: true }],
];

const FRONT = [
  ["frontDelts", "ellipse", { cx: 31, cy: 44, rx: 6.5, ry: 6, pair: true }],
  ["sideDelts", "ellipse", { cx: 23.5, cy: 47, rx: 4, ry: 6.5, pair: true }],
  ["chest", "polygon", { points: [[35, 42], [42, 38.5], [49.4, 39.5], [49.4, 57.5], [42, 60], [35, 55]], pair: true }],
  ["biceps", "ellipse", { cx: 25, cy: 62, rx: 4.8, ry: 10, pair: true }],
  ["forearms", "ellipse", { cx: 21.5, cy: 90, rx: 4.2, ry: 13, pair: true }],
  ["abs", "rect", { x: 41, y: 62, width: 18, height: 34, rx: 5 }],
  ["quads", "ellipse", { cx: 40.5, cy: 135, rx: 7.3, ry: 24, pair: true }],
  ["calves", "ellipse", { cx: 40.5, cy: 184, rx: 4.5, ry: 15, pair: true }],
];

const BACK = [
  ["upperBack", "polygon", { points: [[40, 33], [60, 33], [66, 44], [50, 60], [34, 44]] }],
  ["rearDelts", "ellipse", { cx: 30.5, cy: 44.5, rx: 6.5, ry: 6, pair: true }],
  ["sideDelts", "ellipse", { cx: 23.5, cy: 47, rx: 4, ry: 6.5, pair: true }],
  ["lats", "polygon", { points: [[34, 50], [48, 60], [48, 84], [39, 80], [35, 66]], pair: true }],
  ["triceps", "ellipse", { cx: 25, cy: 62, rx: 4.8, ry: 10, pair: true }],
  ["forearms", "ellipse", { cx: 21.5, cy: 90, rx: 4.2, ry: 13, pair: true }],
  ["lowerBack", "rect", { x: 42, y: 80, width: 16, height: 17, rx: 4 }],
  ["glutes", "ellipse", { cx: 42, cy: 106, rx: 8.5, ry: 9, pair: true }],
  ["hamstrings", "ellipse", { cx: 40.5, cy: 138, rx: 7, ry: 21, pair: true }],
  ["calves", "ellipse", { cx: 40.5, cy: 181, rx: 5.5, ry: 15, pair: true }],
];

const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

// One shape (plus its mirrored twin when `pair`), offset by `dx`.
function shapes(tag, { pair, points, ...attrs }, dx) {
  const make = (mirror) => {
    if (tag === "polygon") {
      const pts = points.map(([x, y]) => `${(mirror ? mirrorX(x) : x) + dx},${y}`).join(" ");
      return el("polygon", { points: pts });
    }
    const a = { ...attrs };
    if ("cx" in a) a.cx = (mirror ? mirrorX(a.cx) : a.cx) + dx;
    if ("x" in a) a.x = (mirror ? W - a.x - a.width : a.x) + dx;
    return el(tag, a);
  };
  return pair ? [make(false), make(true)] : [make(false)];
}

// Five heat steps — discrete classes keep the colours consistent with CSS
// and readable on the dark theme, instead of arbitrary opacities.
function heatClass(heat) {
  if (heat <= 0) return "bm-0";
  if (heat < 0.35) return "bm-1";
  if (heat < 0.7) return "bm-2";
  if (heat < 1) return "bm-3";
  return "bm-4";
}

function drawFigure(svg, muscles, setsByMuscle, dx, caption, heatOf) {
  BASE.forEach(([tag, attrs]) => shapes(tag, attrs, dx).forEach((node) => {
    node.setAttribute("class", "bm-base");
    svg.appendChild(node);
  }));
  muscles.forEach(([key, tag, attrs]) => {
    const sets = setsByMuscle[key] || 0;
    const group = el("g", { class: `bm-muscle ${heatClass(heatOf(key, sets))}`, "data-muscle": key });
    const title = el("title", {});
    title.textContent = `${muscleLabel(key)}: ${formatSets(sets)} sets`;
    group.appendChild(title);
    shapes(tag, attrs, dx).forEach((node) => group.appendChild(node));
    svg.appendChild(group);
  });
  const label = el("text", { x: dx + W / 2, y: H - 1, "text-anchor": "middle", class: "bm-caption" });
  label.textContent = caption;
  svg.appendChild(label);
}

// `setsByMuscle`: { chest: 12, triceps: 9.5, ... }. Returns an <svg>.
// By default the heat is relative to each muscle's WEEKLY target; pass
// `fullAt` (sets) for a single workout, where ~4 sets for one muscle is already a full dose.
export function renderBodyMap(setsByMuscle, { label = "Spierkaart", fullAt = null } = {}) {
  const heatOf = fullAt ? (key, sets) => sets / fullAt : muscleHeat;
  const svg = el("svg", { viewBox: `0 0 ${W * 2 + GAP} ${H + 6}`, class: "body-map", role: "img", "aria-label": label });
  drawFigure(svg, FRONT, setsByMuscle, 0, "Voor", heatOf);
  drawFigure(svg, BACK, setsByMuscle, W + GAP, "Achter", heatOf);
  return svg;
}

// "weinig ■■■■ op doel" — bm-4 means the muscle reached the bottom of its
// weekly target range.
export function renderBodyMapLegend(lowText = "weinig", highText = "op doel") {
  const legend = document.createElement("div");
  legend.className = "bm-legend";
  const text = (t) => {
    const span = document.createElement("span");
    span.textContent = t;
    return span;
  };
  legend.appendChild(text(lowText));
  ["bm-1", "bm-2", "bm-3", "bm-4"].forEach((cls) => {
    const swatch = document.createElement("span");
    swatch.className = `bm-swatch ${cls}`;
    legend.appendChild(swatch);
  });
  legend.appendChild(text(highText));
  return legend;
}
