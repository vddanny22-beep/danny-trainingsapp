import { muscleLabel, muscleHeat, formatSets } from "./muscles.js";
import { FRONT_PARTS, BACK_PARTS, FRONT_VIEWBOX, BACK_VIEWBOX } from "./body-paths.js";

// Front/back body map as inline SVG — anatomical outlines from MuscleMap
// (see body-paths.js for source and licence), no image files, so it renders
// offline at the gym. Each muscle region is filled by how much it was
// trained (or how recovered it is); colours come from css/style.css (.bm-*).

// MuscleMap slug → this app's muscle key (muscles.js). "base" = drawn as
// neutral body; null = skipped. MuscleMap also ships finer sub-regions
// (upper/lower chest, inner/outer quad, ...) that overlap their parent
// muscle; those are skipped, the parent region carries the colour.
// The deltoid is split the other way round: the whole deltoid is the side
// head, and the front/rear sub-region is drawn on top of it.
const FRONT_MAP = {
  chest: "chest", abs: "abs", obliques: "abs", biceps: "biceps", triceps: "triceps",
  deltoids: "sideDelts", frontDeltoid: "frontDelts", quadriceps: "quads", calves: "calves",
  trapezius: "upperBack", forearm: "forearms",
  adductors: "base", neck: "base", hands: "base", knees: "base", tibialis: "base", ankles: "base",
  feet: "base", head: "base", hair: "base", serratus: "base",
};
const BACK_MAP = {
  trapezius: "upperBack", upperBack: "lats", deltoids: "sideDelts", rearDeltoid: "rearDelts",
  triceps: "triceps", lowerBack: "lowerBack", forearm: "forearms", gluteal: "glutes",
  hamstring: "hamstrings", calves: "calves",
  adductors: "base", neck: "base", hands: "base", ankles: "base", feet: "base", head: "base", hair: "base",
  rhomboids: "base", rotatorCuff: "base",
};

const GAP = 40;
const CAPTION_SPACE = 70;
const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
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

// Draws one view, shifted so its viewBox starts at x = `dx`. Base parts go
// first so muscles sit on top; within muscles the source order is kept,
// which puts the front/rear deltoid sub-region over the whole deltoid.
function drawView(svg, parts, map, viewBox, dx, caption, paint) {
  const [vx, vy, vw, vh] = viewBox;
  const view = el("g", { transform: `translate(${dx - vx} ${-vy})` });
  const ordered = [...parts.filter((p) => map[p.slug] === "base"), ...parts.filter((p) => map[p.slug] && map[p.slug] !== "base")];
  ordered.forEach(({ slug, d }) => {
    const key = map[slug];
    const group = key === "base" ? el("g", { class: "bm-base" }) : el("g", paint(key));
    if (key !== "base") {
      const title = el("title", {});
      title.textContent = paint.title(key);
      group.appendChild(title);
    }
    d.forEach((path) => group.appendChild(el("path", { d: path })));
    view.appendChild(group);
  });
  svg.appendChild(view);
  const label = el("text", { x: dx + vw / 2, y: vh + CAPTION_SPACE - 18, "text-anchor": "middle", class: "bm-caption" });
  label.textContent = caption;
  svg.appendChild(label);
}

// `setsByMuscle`: { chest: 12, triceps: 9.5, ... }. Returns an <svg>.
// By default the heat is relative to each muscle's WEEKLY target; pass
// `fullAt` (sets) for a single workout, where ~4 sets for one muscle is
// already a full dose. `heat` (key → 0..1.5) and `describe` (key → tooltip)
// override both, e.g. for the recovery view.
export function renderBodyMap(setsByMuscle, { label = "Spierkaart", fullAt = null, heat = null, describe = null } = {}) {
  const heatOf = heat || (fullAt ? (key) => (setsByMuscle[key] || 0) / fullAt : (key) => muscleHeat(key, setsByMuscle[key] || 0));
  const paint = (key) => ({ class: `bm-muscle ${heatClass(heatOf(key))}`, "data-muscle": key });
  paint.title = describe || ((key) => `${muscleLabel(key)}: ${formatSets(setsByMuscle[key] || 0)} sets`);

  const width = FRONT_VIEWBOX[2] + GAP + BACK_VIEWBOX[2];
  const height = FRONT_VIEWBOX[3] + CAPTION_SPACE;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "body-map", role: "img", "aria-label": label });
  drawView(svg, FRONT_PARTS, FRONT_MAP, FRONT_VIEWBOX, 0, "Voor", paint);
  drawView(svg, BACK_PARTS, BACK_MAP, BACK_VIEWBOX, FRONT_VIEWBOX[2] + GAP, "Achter", paint);
  return svg;
}

// "weinig ■■■■ op doel" — bm-4 means the muscle reached the bottom of its
// weekly target range (or, in the recovery view, is fully recovered).
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
