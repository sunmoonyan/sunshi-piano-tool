// Éditeur de partition : on pose les notes directement sur la portée (comme dans un vrai logiciel
// de notation) — clé de sol = main droite, clé de fa = main gauche, la ligne/l'espace cliqué donne
// la hauteur. + portée en direct, écoute, export MIDI/PDF, enregistrement dans la bibliothèque des
// morceaux (le document édité a la même forme qu'un morceau importé : deux parties fixes « Main
// droite » / « Main gauche »).

import { songColumns, songRange, makeClock, keySigLabel, spellMidiInKey, LEAD_SLOTS, SLOTS_PER_BEAT } from "./core/song.js";
import { chordName, midiOf, degree } from "./core/music.js";
import { renderStaff, layout, STAVES, S, X0 } from "./core/staff.js";
import { listSongs, getSong, saveSong } from "./core/library.js";
import { downloadMidi } from "./core/midiwriter.js";
import { beep, unlockAudio } from "./core/keyboard.js";

const NS = "http://www.w3.org/2000/svg";
const EDITOR_DX = 56;                      // largeur d'une croche sur la portée de l'éditeur
const EDITOR_RANGE = { min: 4, max: 42 };  // fourchette fixe (de la clé de fa à la clé de sol, avec de la marge)
const SYSTEM_GAP = 40;                     // espace vertical entre deux lignes de portée
// Zoom fixe (pixels d'écran par unité SVG), indépendant de la largeur du conteneur : sans ça,
// plus il y a de lignes/mesures, plus tout rétrécit pour tenir dans la largeur disponible.
const PX_PER_UNIT = 1.3;
const DUR_DEFS = [
  { label: "𝅝", title: "Ronde", mult: 4 },
  { label: "𝅗𝅥", title: "Blanche", mult: 2 },
  { label: "♩", title: "Noire", mult: 1 },
  { label: "♪", title: "Croche", mult: 0.5 },
  { label: "𝅘𝅥𝅯", title: "Double-croche", mult: 0.25 },
];
// Altération imposée par l'armure pour un degré (do=0 … si=6) : dièse si parmi les premiers
// `sf` degrés dans l'ordre des dièses, bémol si parmi les premiers `-sf` dans l'ordre des bémols.
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // fa do sol ré la mi si
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];  // si mi la ré sol do fa
function keyAccidental(deg, sf) {
  if (sf > 0) return SHARP_ORDER.slice(0, sf).includes(deg) ? 1 : 0;
  if (sf < 0) return FLAT_ORDER.slice(0, -sf).includes(deg) ? -1 : 0;
  return 0;
}

export function setupEditorUI({ settings }) {
  const $ = (id) => document.getElementById(id);
  const svg = $("editor-staff");

  let doc = null;
  let durMult = 1, dotted = false;
  let selected = null;     // { hand, note } — note = la référence [midi, tick, dur] dans doc.parts
  let dragging = null;     // { hand, note }
  let previewToken = 0;

  // ---------- Document ----------
  function emptyDoc() {
    return {
      id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: "Nouvelle partition",
      ppq: 480,
      tempos: [{ tick: 0, uspq: 500000 }],
      timeSigs: [{ tick: 0, num: 4, den: 4 }],
      keySig: { sf: 0, minor: false },
      measures: 16,
      measuresPerLine: 4,
      parts: [
        { id: "right", name: "Main droite", notes: [] },
        { id: "left", name: "Main gauche", notes: [] },
      ],
      config: { hands: { right: "right", left: "left" }, split: 60 },
    };
  }

  // Un morceau importé (pistes quelconques) → un document à 2 mains, pour le modifier ici.
  // Toujours un nouvel id : enregistrer ne touche jamais le morceau d'origine.
  function flattenSong(song) {
    const right = [], left = [];
    for (const part of song.parts) {
      const role = song.config.hands[part.id] || "ignore";
      if (role === "ignore") continue;
      for (const n of part.notes) {
        const h = role === "split" ? (n[0] >= song.config.split ? "right" : "left") : role;
        (h === "right" ? right : left).push([...n]);
      }
    }
    const byTick = (a, b) => a[1] - b[1];
    return {
      id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: song.name,
      ppq: song.ppq,
      tempos: [song.tempos[0] || { tick: 0, uspq: 500000 }],
      timeSigs: [song.timeSigs[0] || { tick: 0, num: 4, den: 4 }],
      keySig: song.keySig || { sf: 0, minor: false },
      measures: Math.max(1, Math.ceil((song.endTick || 0) / barTicks({ ppq: song.ppq, timeSigs: song.timeSigs || [{ num: 4, den: 4 }] })) + 1),
      measuresPerLine: 4,
      parts: [
        { id: "right", name: "Main droite", notes: right.sort(byTick) },
        { id: "left", name: "Main gauche", notes: left.sort(byTick) },
      ],
      config: { hands: { right: "right", left: "left" }, split: 60 },
    };
  }

  const barTicks = (d) => { const ts = d.timeSigs[0] || { num: 4, den: 4 }; return (d.ppq * 4 * ts.num) / ts.den; };
  const refreshEndTick = () => { doc.endTick = Math.round(doc.measures * barTicks(doc)); };

  // ---------- Portée ↔ coordonnées ----------
  // La partition est coupée en « lignes » (systèmes) de `measuresPerLine` mesures, empilées
  // verticalement, comme une vraie partition imprimée — plutôt qu'une seule portée qui défile
  // à l'infini vers la droite.
  const systemHeight = () => layout("both", EDITOR_RANGE).height + SYSTEM_GAP;
  const systemTicks = () => doc.measuresPerLine * barTicks(doc);
  const systemsCount = () => Math.max(1, Math.ceil((doc.measures * barTicks(doc)) / systemTicks()));

  // d'une note (main, hauteur MIDI, tick) vers sa position sur la portée (espace SVG)
  function dataToXY(hand, midi, tick) {
    const { d } = spellMidiInKey(midi, doc.keySig.sf);
    const kind = hand === "right" ? "treble" : "bass";
    const lay = layout("both", EDITOR_RANGE);
    const sTicks = systemTicks();
    const sys = Math.floor(tick / sTicks);
    const localTick = tick - sys * sTicks;
    const st = lay.staves.find((s) => s.kind === kind);
    const y = sys * systemHeight() + st.y0 + (STAVES[kind].top - d) * S / 2;
    const slot = LEAD_SLOTS + (localTick / doc.ppq) * SLOTS_PER_BEAT;
    const x = X0 + slot * EDITOR_DX + EDITOR_DX / 2;
    return { x, y, kind };
  }
  // d'un point cliqué (espace SVG) vers (main, degré naturel, tick arrondi à la double-croche)
  function xyToData(x, y) {
    const lay = layout("both", EDITOR_RANGE);
    const rowH = systemHeight();
    const sys = Math.max(0, Math.min(systemsCount() - 1, Math.floor(y / rowH)));
    const localY = y - sys * rowH;
    const mid = (lay.staves[0].y0 + 4 * S + lay.staves[1].y0) / 2;
    const kind = localY < mid ? "treble" : "bass";
    const hand = kind === "treble" ? "right" : "left";
    const st = lay.staves.find((s) => s.kind === kind);
    const d = Math.round(STAVES[kind].top - ((localY - st.y0) * 2) / S);
    const slot = (x - X0 - EDITOR_DX / 2) / EDITOR_DX;
    const grid = doc.ppq / 4; // quadrillage : double-croche
    const sTicks = systemTicks();
    const localTick = Math.max(0, Math.min(sTicks - grid, Math.round(((slot - LEAD_SLOTS) / SLOTS_PER_BEAT) * doc.ppq / grid) * grid));
    return { hand, d, tick: sys * sTicks + localTick };
  }
  function clientToSvg(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function hitTest(x, y) {
    let best = null, bestDist = 18; // tolérance en unités SVG
    for (const hand of ["right", "left"]) {
      const part = doc.parts.find((p) => p.id === hand);
      for (const note of part.notes) {
        const p = dataToXY(hand, note[0], note[1]);
        const dist = Math.hypot(p.x - x, p.y - y);
        if (dist < bestDist) { bestDist = dist; best = { hand, note }; }
      }
    }
    return best;
  }

  // ---------- Rendu ----------
  // renderStaff dessine une seule portée (un seul système) : on l'appelle une fois par ligne,
  // dans un <svg> jetable, puis on transplante son contenu dans un <g> décalé verticalement.
  function render() {
    refreshEndTick();
    const cols = songColumns(doc, "both");
    const pref = doc.keySig && doc.keySig.sf < 0 ? "flat" : "sharp";
    const withLabels = settings.get("showChords")
      ? cols.map((c) => (c.label !== undefined ? c : { ...c, label: chordName(c.notes.map((n) => n.midi), pref) }))
      : cols;
    const sTicks = systemTicks(), nSystems = systemsCount(), lay = layout("both", EDITOR_RANGE);
    const slots = LEAD_SLOTS + (sTicks / doc.ppq) * SLOTS_PER_BEAT + 3;

    svg.replaceChildren();
    let maxWidth = 0;
    for (let s = 0; s < nSystems; s++) {
      const lo = s * sTicks, hi = lo + sTicks;
      // groupStart: false partout — les barres de mesure sont dessinées nous-mêmes (drawMeasureLines),
      // toujours exactement à la bonne position ; celles de renderStaff ne sont correctes que si les
      // colonnes sont régulièrement espacées, ce qui n'est pas le cas ici (notes de durées variées).
      const lineCols = withLabels
        .filter((c) => c.tick >= lo && c.tick < hi)
        .map((c) => ({ ...c, k: c.k - (lo / doc.ppq) * SLOTS_PER_BEAT, groupStart: false }));
      const temp = document.createElementNS(NS, "svg");
      renderStaff(temp, {
        clef: "both",
        range: EDITOR_RANGE,
        columns: lineCols,
        current: -1,
        showName: () => settings.get("names") === "always",
        withOctave: settings.get("nameOctave"),
        scroll: { slots, dx: EDITOR_DX },
        noteShapes: true,
      });
      maxWidth = Math.max(maxWidth, Number((temp.getAttribute("viewBox") || "0 0 0 0").split(" ")[2]) || 0);
      const g = document.createElementNS(NS, "g");
      g.setAttribute("transform", `translate(0, ${s * systemHeight()})`);
      g.append(...temp.childNodes);
      svg.append(g);
      drawMeasureLines(s, lo, hi, lay);
    }
    const totalHeight = nSystems * systemHeight() - SYSTEM_GAP;
    svg.setAttribute("viewBox", `0 0 ${maxWidth} ${totalHeight}`);
    svg.style.width = maxWidth * PX_PER_UNIT + "px";
    svg.style.height = totalHeight * PX_PER_UNIT + "px";
    drawTimeSignature(lay);
    if (selected) drawSelectionMarker();
    renderLineControls(nSystems);
  }

  // Ajouter/retirer une ligne (= `measuresPerLine` mesures) facilement, sans passer par le champ
  // « Mesures ». Retirer une ligne au milieu supprime ses notes et décale les suivantes.
  function renderLineControls(nSystems) {
    const box = $("editor-lines-row");
    box.replaceChildren();
    for (let s = 0; s < nSystems; s++) {
      const chip = document.createElement("span");
      chip.className = "editor-line-chip";
      const label = document.createElement("span");
      label.textContent = `Ligne ${s + 1}`;
      const del = document.createElement("button");
      del.type = "button"; del.className = "editor-line-btn"; del.textContent = "−";
      del.title = `Supprimer la ligne ${s + 1}`;
      del.setAttribute("aria-label", del.title);
      del.addEventListener("click", () => removeLine(s));
      chip.append(label, del);
      box.append(chip);
    }
    const add = document.createElement("button");
    add.type = "button"; add.className = "editor-line-btn"; add.textContent = "+";
    add.title = "Ajouter une ligne"; add.setAttribute("aria-label", add.title);
    add.addEventListener("click", addLine);
    box.append(add);
  }
  function addLine() {
    doc.measures += doc.measuresPerLine;
    $("editor-measures").value = doc.measures;
    render();
  }
  function removeLine(sys) {
    const sTicks = systemTicks();
    const lo = sys * sTicks, hi = lo + sTicks;
    for (const part of doc.parts) {
      part.notes = part.notes
        .filter((n) => n[1] < lo || n[1] >= hi)
        .map((n) => (n[1] >= hi ? [n[0], n[1] - sTicks, n[2]] : n));
    }
    doc.measures = Math.max(doc.measuresPerLine, doc.measures - doc.measuresPerLine);
    $("editor-measures").value = doc.measures;
    selected = null;
    render();
  }

  // Barres de mesure sur toute la ligne, même sans notes — pour que les mesures se voient
  // avant même d'y poser des notes.
  function drawMeasureLines(sys, lo, hi, lay) {
    const bt = barTicks(doc);
    const yBase = sys * systemHeight();
    const last = Math.min(hi, doc.measures * bt);
    for (let tick = lo + bt; tick <= last + 0.01; tick += bt) {
      const slot = LEAD_SLOTS + ((tick - lo) / doc.ppq) * SLOTS_PER_BEAT;
      const x = X0 + slot * EDITOR_DX;
      for (const st of lay.staves) appendLine(x, yBase + st.y0, x, yBase + st.y0 + 4 * S);
    }
  }

  // Chiffrage des temps (les deux nombres), une seule fois, au tout début de la partition.
  function drawTimeSignature(lay) {
    const ts = doc.timeSigs[0];
    for (const st of lay.staves) {
      appendText(60, st.y0 + S * 1.7, String(ts.num));
      appendText(60, st.y0 + S * 3.7, String(ts.den));
    }
  }

  // Les variables CSS (var(--...)) ne passent qu'en `style`, jamais en attribut SVG brut
  // (sinon la couleur retombe sur le noir par défaut — invisible sur fond sombre).
  function appendLine(x1, y1, x2, y2) {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.style.setProperty("stroke", "var(--staff)"); l.setAttribute("stroke-width", "1.3"); l.setAttribute("stroke-opacity", "0.85");
    l.style.pointerEvents = "none";
    svg.append(l);
  }
  function appendText(x, y, text) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "20"); t.setAttribute("font-weight", "700"); t.style.setProperty("fill", "var(--ink)");
    t.style.pointerEvents = "none";
    t.textContent = text;
    svg.append(t);
  }

  function drawSelectionMarker() {
    const part = doc.parts.find((p) => p.id === selected.hand);
    if (!part.notes.includes(selected.note)) { selected = null; return; }
    const { x, y } = dataToXY(selected.hand, selected.note[0], selected.note[1]);
    const marker = document.createElementNS(NS, "ellipse");
    marker.setAttribute("cx", x);
    marker.setAttribute("cy", y);
    marker.setAttribute("rx", 12);
    marker.setAttribute("ry", 9);
    marker.setAttribute("fill", "none");
    marker.style.setProperty("stroke", "var(--accent)");
    marker.setAttribute("stroke-width", "2.5");
    marker.style.pointerEvents = "none";
    svg.append(marker);
  }

  function syncToolbar() {
    $("editor-name").value = doc.name;
    $("editor-tempo").value = Math.round(60000000 / (doc.tempos[0]?.uspq || 500000));
    $("editor-tsnum").value = String(doc.timeSigs[0].num);
    $("editor-tsden").value = String(doc.timeSigs[0].den);
    $("editor-keysig").value = String(doc.keySig.sf);
    $("editor-minor").checked = !!doc.keySig.minor;
    $("editor-measures").value = doc.measures;
    $("editor-lines").value = doc.measuresPerLine;
    $("editor-names").checked = settings.get("names") === "always";
    $("editor-chords").checked = !!settings.get("showChords");
  }

  // ---------- Notes : ajout / sélection / déplacement / altération / suppression ----------
  function addNoteAt(x, y) {
    const { hand, d, tick } = xyToData(x, y);
    const acc = keyAccidental(degree(d), doc.keySig.sf);
    const midi = midiOf({ d, acc });
    const durTicks = Math.round(durMult * doc.ppq * (dotted ? 1.5 : 1));
    const part = doc.parts.find((p) => p.id === hand);
    const note = [midi, tick, durTicks];
    part.notes.push(note);
    part.notes.sort((a, b) => a[1] - b[1]);
    selected = { hand, note };
    render();
  }

  function deleteSelected() {
    if (!selected) return;
    const part = doc.parts.find((p) => p.id === selected.hand);
    const i = part.notes.indexOf(selected.note);
    if (i >= 0) part.notes.splice(i, 1);
    selected = null;
    render();
  }

  svg.addEventListener("pointerdown", (e) => {
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (hit) {
      selected = hit;
      dragging = hit;
      svg.setPointerCapture(e.pointerId);
      render();
    } else {
      addNoteAt(x, y);
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    const { hand, d, tick } = xyToData(x, y);
    if (hand !== dragging.hand) return; // on ne change pas de main en glissant
    const acc = keyAccidental(degree(d), doc.keySig.sf);
    dragging.note[0] = midiOf({ d, acc });
    dragging.note[1] = tick;
    render();
  });
  svg.addEventListener("pointerup", () => {
    if (!dragging) return;
    doc.parts.find((p) => p.id === dragging.hand).notes.sort((a, b) => a[1] - b[1]);
    dragging = null;
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (!selected || $("editor-view").hidden) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selected.note[0]++; render(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); selected.note[0]--; render(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const part = doc.parts.find((p) => p.id === selected.hand);
      selected.note[1] = Math.max(0, selected.note[1] + (e.key === "ArrowRight" ? 1 : -1) * (doc.ppq / 4));
      part.notes.sort((a, b) => a[1] - b[1]);
      render();
    }
  });
  $("editor-delete").addEventListener("click", deleteSelected);

  // ---------- Barre d'outils : contenu statique ----------
  function buildStaticOptions() {
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 12].forEach((n) => $("editor-tsnum").append(new Option(String(n), String(n))));
    [1, 2, 4, 8, 16].forEach((n) => $("editor-tsden").append(new Option(String(n), String(n))));
    for (let sf = -7; sf <= 7; sf++) $("editor-keysig").append(new Option(keySigLabel(sf, false).replace(" majeur", ""), String(sf)));
    const durBox = $("editor-dur");
    DUR_DEFS.forEach((d, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = d.label; b.title = d.title;
      b.setAttribute("aria-pressed", String(i === 2));
      b.addEventListener("click", () => {
        durMult = d.mult;
        durBox.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
      durBox.append(b);
    });
  }

  async function refreshSongList() {
    const songs = await listSongs();
    const sel = $("editor-song-pick");
    sel.replaceChildren(new Option("Nouvelle partition", ""));
    for (const s of songs) sel.append(new Option(s.name, s.id));
    sel.value = doc && songs.some((s) => s.id === doc.id) ? doc.id : "";
  }

  // ---------- Barre d'outils : événements ----------
  $("editor-song-pick").addEventListener("change", async () => {
    const id = $("editor-song-pick").value;
    const song = id ? await getSong(id) : null;
    doc = song ? flattenSong(song) : emptyDoc();
    selected = null;
    syncToolbar();
    render();
  });
  $("editor-new").addEventListener("click", () => {
    doc = emptyDoc();
    selected = null;
    $("editor-song-pick").value = "";
    syncToolbar();
    render();
  });
  $("editor-name").addEventListener("input", () => { doc.name = $("editor-name").value; });
  $("editor-tempo").addEventListener("change", () => {
    const bpm = Math.min(300, Math.max(20, Number($("editor-tempo").value) || 120));
    doc.tempos[0].uspq = Math.round(60000000 / bpm);
    $("editor-tempo").value = bpm;
  });
  $("editor-tsnum").addEventListener("change", () => { doc.timeSigs[0].num = Number($("editor-tsnum").value); render(); });
  $("editor-tsden").addEventListener("change", () => { doc.timeSigs[0].den = Number($("editor-tsden").value); render(); });
  $("editor-keysig").addEventListener("change", () => { doc.keySig.sf = Number($("editor-keysig").value); render(); });
  $("editor-minor").addEventListener("change", () => { doc.keySig.minor = $("editor-minor").checked; render(); });
  $("editor-measures").addEventListener("change", () => {
    doc.measures = Math.min(99, Math.max(1, Number($("editor-measures").value) || 16));
    $("editor-measures").value = doc.measures;
    render();
  });
  $("editor-lines").addEventListener("change", () => {
    doc.measuresPerLine = Math.min(16, Math.max(1, Number($("editor-lines").value) || 4));
    $("editor-lines").value = doc.measuresPerLine;
    render();
  });
  $("editor-dotted").addEventListener("change", () => { dotted = $("editor-dotted").checked; });
  $("editor-names").addEventListener("change", () => settings.set("names", $("editor-names").checked ? "always" : "never"));
  $("editor-chords").addEventListener("change", () => settings.set("showChords", $("editor-chords").checked));

  function flashButton(btn, text) {
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { if (btn.isConnected) btn.textContent = orig; }, 1800);
  }
  $("editor-save").addEventListener("click", async () => {
    refreshEndTick();
    try {
      await saveSong(doc);
      await refreshSongList();
      flashButton($("editor-save"), "Enregistré !");
    } catch (err) {
      flashButton($("editor-save"), err.message || "Erreur à l'enregistrement");
    }
  });
  $("editor-export-midi").addEventListener("click", () => { refreshEndTick(); downloadMidi(doc); });
  $("editor-export-pdf").addEventListener("click", () => {
    document.body.classList.add("printing-score");
    const done = () => { document.body.classList.remove("printing-score"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
  });

  // ---------- Écoute ----------
  function stopPreview() { previewToken++; $("editor-play").classList.remove("playing"); }
  function playPreview() {
    const token = ++previewToken;
    $("editor-play").classList.add("playing");
    refreshEndTick();
    const clock = makeClock(doc);
    for (const c of songColumns(doc, "both")) {
      setTimeout(() => { if (token === previewToken) c.notes.forEach((n) => beep(n.midi, 0.2)); }, clock.tickToSec(c.tick) * 1000);
    }
    setTimeout(() => { if (token === previewToken) stopPreview(); }, clock.duration * 1000 + 300);
  }
  $("editor-play").addEventListener("click", () => {
    unlockAudio();
    $("editor-play").classList.contains("playing") ? stopPreview() : playPreview();
  });

  settings.onChange((key) => {
    if (!["names", "nameOctave", "showChords"].includes(key)) return;
    $("editor-names").checked = settings.get("names") === "always";
    $("editor-chords").checked = !!settings.get("showChords");
    render();
  });

  buildStaticOptions();
  doc = emptyDoc();
  refreshSongList();
  syncToolbar();
  render();

  return {
    activate() {
      refreshSongList();
    },
  };
}
