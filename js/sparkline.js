// Shared hand-rolled SVG line-chart renderer — no charting library. Used by
// history-view.js (per-exercise weight trend) and progress-view.js (body
// weight/waist trend). Takes a chronological (oldest-first) array of numbers.
// `area` adds a filled gradient under the line (the Voortgang headline
// charts); `height` lets a caller ask for a taller chart — the viewBox scales
// with it so the line's proportions stay correct instead of being stretched
// by CSS.
export function renderSparkline(values, { area = false, height = 40 } = {}) {
  const width = 240;
  const padding = 4;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // avoid divide-by-zero when every value is equal

  const points = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : padding + (i / (values.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", area ? "sparkline sparkline-area" : "sparkline");
  // The viewBox's height only sets its internal coordinate system — without
  // this, a caller asking for a taller chart just gets its proportions
  // squashed back down to .sparkline's fixed 40px CSS height.
  svg.style.height = `${height}px`;

  if (area) {
    // Unique per instance — <defs> ids are document-global, and two area
    // charts on screen at once would otherwise fight over one gradient.
    const gradientId = `sparkline-fill-${Math.random().toString(36).slice(2)}`;
    const defs = document.createElementNS(svgNS, "defs");
    const gradient = document.createElementNS(svgNS, "linearGradient");
    gradient.setAttribute("id", gradientId);
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y2", "1");
    gradient.innerHTML =
      '<stop offset="0" class="sparkline-fill-stop-top"/><stop offset="1" class="sparkline-fill-stop-bottom"/>';
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const fillPoints = [`${padding},${height}`, ...points, `${width - padding},${height}`];
    const polygon = document.createElementNS(svgNS, "polygon");
    polygon.setAttribute("points", fillPoints.join(" "));
    polygon.setAttribute("fill", `url(#${gradientId})`);
    svg.appendChild(polygon);
  }

  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke-width", "2");
  // Stroke color comes from .sparkline polyline in style.css, not set here.
  svg.appendChild(polyline);

  return svg;
}
