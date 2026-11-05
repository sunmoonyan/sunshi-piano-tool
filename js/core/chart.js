// Petit graphique en ligne (SVG) avec info-bulle au survol.
// points : [{ x: date (ms), y: valeur, count }]

const NS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

export function lineChart(container, points, { yMax, format, label, compact = false }) {
  container.replaceChildren();
  container.classList.add("chart");
  if (!points.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "Pas encore de données.";
    container.append(empty);
    return;
  }
  // on dessine à la taille réelle du conteneur : le texte garde sa taille sur téléphone
  const W = Math.max(260, Math.round(container.clientWidth || 600)), H = compact ? 170 : 220;
  const P = { l: 44, r: 14, t: 12, b: 26 };
  const top = yMax ?? niceMax(Math.max(...points.map((p) => p.y)) * 1.1);
  const n = points.length;
  const xAt = (i) => (n === 1 ? (P.l + W - P.r) / 2 : P.l + (i * (W - P.l - P.r)) / (n - 1));
  const yAt = (v) => H - P.b - (v / top) * (H - P.t - P.b);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label, tabindex: "0" });

  // grille et axe Y (3 graduations)
  for (const f of [0, 0.5, 1]) {
    const v = top * f, y = yAt(v);
    svg.append(el("line", { x1: P.l, x2: W - P.r, y1: y, y2: y, class: f === 0 ? "axis" : "grid" }));
    const t = el("text", { x: P.l - 8, y: y + 4, "text-anchor": "end", class: "tick" });
    t.textContent = format(v);
    svg.append(t);
  }
  // axe X : première et dernière séance seulement (pas de chevauchement)
  const xLabels = n === 1 ? [0] : [0, n - 1];
  for (const i of xLabels) {
    const t = el("text", { x: xAt(i), y: H - 6, "text-anchor": n === 1 ? "middle" : i === 0 ? "start" : "end", class: "tick" });
    t.textContent = dateFmt.format(points[i].x);
    svg.append(t);
  }

  // ligne + points
  if (n > 1) {
    const d = points.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(" ");
    svg.append(el("path", { d, class: "line" }));
  }
  const showDots = n <= 40;
  points.forEach((p, i) => {
    if (showDots || i === n - 1) svg.append(el("circle", { cx: xAt(i), cy: yAt(p.y), r: 4, class: "dot" + (i === n - 1 ? " last" : "") }));
  });
  // dernière valeur en étiquette directe
  const last = points[n - 1];
  const lab = el("text", { x: Math.min(xAt(n - 1), W - P.r), y: Math.max(P.t + 10, yAt(last.y) - 10), "text-anchor": n === 1 ? "middle" : "end", class: "value-label" });
  lab.textContent = format(last.y);
  svg.append(lab);

  // survol : réticule vertical + info-bulle
  const cross = el("line", { y1: P.t, y2: H - P.b, class: "crosshair", visibility: "hidden" });
  const ring = el("circle", { r: 6, class: "focus-dot", visibility: "hidden" });
  svg.append(cross, ring);
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  container.append(svg, tip);

  let shown = -1;
  const show = (i) => {
    shown = i;
    const p = points[i], x = xAt(i), y = yAt(p.y);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    ring.setAttribute("cx", x); ring.setAttribute("cy", y); ring.setAttribute("visibility", "visible");
    tip.replaceChildren();
    const v = document.createElement("strong"); v.textContent = format(p.y);
    const s = document.createElement("span"); s.textContent = `${fullFmt.format(p.x)} · ${p.count} réponse${p.count > 1 ? "s" : ""}`;
    tip.append(v, s);
    tip.hidden = false;
    const box = svg.getBoundingClientRect(), scale = box.width / W;
    const left = Math.min(Math.max(x * scale - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
    tip.style.left = left + "px";
    tip.style.top = Math.max(0, y * scale - tip.offsetHeight - 12) + "px";
  };
  const hide = () => { shown = -1; tip.hidden = true; cross.setAttribute("visibility", "hidden"); ring.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(xAt(i) - x) < Math.abs(xAt(best) - x)) best = i; });
    show(best);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("focus", () => show(n - 1));
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && shown > 0) show(shown - 1);
    if (e.key === "ArrowRight" && shown < n - 1) show(shown + 1);
  });
}
