// Shared hand-rolled SVG line-chart renderer — no charting library. Used by
// history-view.js (per-exercise weight trend) and progress-view.js (body
// weight/waist trend). Takes a chronological (oldest-first) array of numbers.
export function renderSparkline(values) {
  const width = 240;
  const height = 40;
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
  svg.setAttribute("class", "sparkline");

  const polyline = document.createElementNS(svgNS, "polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke-width", "2");
  // Stroke color comes from .sparkline polyline in style.css, not set here.
  svg.appendChild(polyline);

  return svg;
}
