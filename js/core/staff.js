// Dessin de la portée en SVG.
// Une "colonne" = un temps de l'exercice : une note seule ou plusieurs (accord).
//   column = { notes: [{ d, acc }], status: "" | "ok" | "bad", label?: string, groupStart?: boolean }
//   groupStart: false → pas de barre de mesure avant cette colonne (ex. notes d'un même arpège)

import { MIDDLE_C, noteName } from "./music.js";

const S = 12;                 // écart entre deux lignes de portée
const X0 = 92;                // début des notes (après la clé)
const DX_NOTE = 66;           // largeur d'une colonne (note seule)
const DX_CHORD = 96;          // largeur d'une colonne contenant un accord
const STAVES = {
  treble: { bottom: 30, top: 38, glyph: "\u{1D11E}", size: 48, glyphLine: 3 },
  bass:   { bottom: 18, top: 26, glyph: "\u{1D122}", size: 44, glyphLine: 3.75 },
};
const NS = "http://www.w3.org/2000/svg";

function el(name, attrs, text) {
  const e = document.createElementNS(NS, name);
  for (const a in attrs) {
    const v = String(attrs[a]);
    if (v.startsWith("var(")) e.style.setProperty(a, v); // les variables CSS ne passent qu'en style
    else e.setAttribute(a, v);
  }
  if (text != null) e.textContent = text;
  return e;
}

// Quelles portées afficher pour une clé et une fourchette de notes
function layout(clef, range) {
  const lowest = range ? range.min : 0, highest = range ? range.max : 60;
  const kinds = clef === "both" ? ["treble", "bass"] : [clef];
  const staves = [];
  // marge haute/basse selon les lignes supplémentaires nécessaires
  const first = STAVES[kinds[0]], last = STAVES[kinds[kinds.length - 1]];
  const above = Math.max(0, highest - first.top) * S / 2;
  const below = Math.max(0, last.bottom - lowest) * S / 2;
  let y = 30 + above;
  kinds.forEach((k, i) => {
    staves.push({ kind: k, y0: y });
    y += 4 * S + (i < kinds.length - 1 ? 7 * S : 0);
  });
  return { staves, height: y + below + 30 };
}

// n.staff ("treble" | "bass") force la portée (ex. main droite / main gauche d'un morceau)
function staffFor(n, lay) {
  if (lay.staves.length === 1) return lay.staves[0];
  if (n.staff) return lay.staves.find((s) => s.kind === n.staff) || lay.staves[0];
  return n.d >= MIDDLE_C ? lay.staves[0] : lay.staves[1];
}
const yOf = (d, st) => st.y0 + (STAVES[st.kind].top - d) * S / 2;

// scroll : { slots } → mode défilement : largeur fixe de `slots` colonnes, les colonnes sont placées
// selon col.k et le calque des notes se déplace avec setOffset(pos). Renvoie { setOffset }.
let clipId = 0;
export function renderStaff(svg, { clef, range, columns, current, showName, withOctave, scroll = null, tails = false }) {
  const lay = layout(clef, range);
  const DX = scroll?.dx ?? (columns.some((c) => c.notes.length > 1) ? DX_CHORD : DX_NOTE);
  const W = X0 + 20 + (scroll ? scroll.slots : columns.length) * DX;
  svg.setAttribute("viewBox", `0 0 ${W} ${lay.height}`);
  svg.replaceChildren();
  const line = "var(--staff)";

  for (const st of lay.staves) {
    for (let i = 0; i < 5; i++) {
      svg.append(el("line", { x1: 10, x2: W - 10, y1: st.y0 + i * S, y2: st.y0 + i * S, stroke: line, "stroke-width": 1.2 }));
    }
    const info = STAVES[st.kind];
    svg.append(el("text", { x: 14, y: st.y0 + info.glyphLine * S + 1, "font-size": info.size, fill: "var(--ink)", "font-family": "var(--font-music)" }, info.glyph));
  }
  if (lay.staves.length === 2) {
    const a = lay.staves[0].y0, b = lay.staves[1].y0 + 4 * S;
    svg.append(el("line", { x1: 10, x2: 10, y1: a, y2: b, stroke: line, "stroke-width": 1.5 }));
    svg.append(el("line", { x1: W - 10, x2: W - 10, y1: a, y2: b, stroke: line, "stroke-width": 1.5 }));
  }

  // calque des notes (déplacé en mode défilement, coupé avant la clé)
  let layer = svg;
  if (scroll) {
    const id = "notes-clip-" + ++clipId;
    const defs = el("defs", {});
    const cp = el("clipPath", { id });
    cp.append(el("rect", { x: X0 - 34, y: 0, width: W - X0 + 24, height: lay.height }));
    defs.append(cp);
    // ligne de lecture : la note doit être jouée avant de la dépasser
    const px = X0 + DX / 2;
    const playhead = el("rect", { x: px - DX / 2 + 4, y: 6, width: DX - 8, height: lay.height - 12, rx: 8, fill: "var(--accent)", "fill-opacity": 0.09 });
    const clipped = el("g", { "clip-path": `url(#${id})` });
    layer = el("g", {});
    clipped.append(layer);
    svg.append(defs, playhead, clipped);
  }

  columns.forEach((col, i) => {
    const slot = scroll ? col.k : i;
    const x = X0 + slot * DX + DX / 2;
    const isCur = i === current;
    let color = "var(--ink)";
    if (col.status === "ok" || col.status === "auto") color = "var(--done)";
    else if (isCur && col.status === "bad") color = "var(--bad)";
    else if (isCur) color = "var(--accent)";

    const g = el("g", {});
    if (isCur && !scroll) {
      g.append(el("rect", { x: x - DX / 2 + 4, y: 6, width: DX - 8, height: lay.height - 12, rx: 8, fill: "var(--accent)", "fill-opacity": 0.09 }));
    }
    // barre de mesure avant chaque nouveau groupe (par défaut chaque colonne est un groupe)
    if (i < columns.length - 1 && columns[i + 1].groupStart !== false) {
      for (const st of lay.staves) {
        g.append(el("line", { x1: x + DX / 2, x2: x + DX / 2, y1: st.y0, y2: st.y0 + 4 * S, stroke: line, "stroke-width": 0.8, "stroke-opacity": 0.6 }));
      }
    }
    // dans un accord, on décale les altérations voisines pour qu'elles ne se chevauchent pas
    const accX = new Map();
    let k = 0;
    [...col.notes].sort((a, b) => b.d - a.d).forEach((n) => { if (n.acc) accX.set(n, k++ % 2 ? -36 : -24); });
    for (const n of col.notes) {
      const st = staffFor(n, lay), info = STAVES[st.kind], y = yOf(n.d, st);
      const nColor = n.other ? "var(--done)" : color;   // notes de l'autre main : en gris
      // durée : un trait léger derrière la note (morceaux)
      if (tails && n.len > 0.6) {
        g.append(el("line", { x1: x + 9, x2: x + Math.max(10, n.len * DX - 8), y1: y, y2: y, stroke: nColor, "stroke-width": 4, "stroke-linecap": "round", "stroke-opacity": 0.22 }));
      }
      for (let d = info.bottom - 2; d >= n.d; d -= 2) {
        const yy = yOf(d, st);
        g.append(el("line", { x1: x - 13, x2: x + 13, y1: yy, y2: yy, stroke: line, "stroke-width": 1.2 }));
      }
      for (let d = info.top + 2; d <= n.d; d += 2) {
        const yy = yOf(d, st);
        g.append(el("line", { x1: x - 13, x2: x + 13, y1: yy, y2: yy, stroke: line, "stroke-width": 1.2 }));
      }
      if (n.acc) {
        g.append(el("text", { x: x + (accX.get(n) || -24), y: y + (n.acc < 0 ? 4 : 5), "font-size": n.acc < 0 ? 22 : 20, fill: nColor, "font-family": "var(--font-music)" }, n.acc < 0 ? "♭" : "♯"));
      }
      g.append(el("ellipse", { cx: x, cy: y, rx: 8, ry: 5.6, transform: `rotate(-20 ${x} ${y})`, fill: "none", stroke: nColor, "stroke-width": 2.6 }));
      if (showName(col) && !n.other) {
        g.append(el("text", { x: x + 12, y: y + 4, "font-size": 12, "font-weight": 700, fill: "var(--label)", "font-family": "var(--font-body)" }, noteName(n, withOctave)));
      }
    }
    if (col.label) {
      g.append(el("text", { x, y: lay.height - 10, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)", "font-family": "var(--font-body)" }, col.label));
    }
    layer.append(g);
  });

  return {
    setOffset(pos) { if (scroll) layer.setAttribute("transform", `translate(${(-pos * DX).toFixed(2)} 0)`); },
  };
}
