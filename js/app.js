// Sunshi's Piano Tool : assemble les modules (réglages, portée, clavier, MIDI, exercices).

import { midiOf, midiName, noteName, setNotation } from "./core/music.js";
import { Settings, renderFields } from "./core/settings.js";
import { store } from "./core/store.js";
import { record, flush } from "./core/stats.js";
import { setupStatsView } from "./stats-view.js";
import { setupAccount, openAccount } from "./account.js";
import { renderStaff } from "./core/staff.js";
import { Keyboard, beep, unlockAudio } from "./core/keyboard.js";
import * as keyboardMod from "./core/keyboard.js";
import { MicInput } from "./core/mic.js";
import { MidiInput } from "./core/midi.js";
import { EXERCISES } from "./exercises/index.js";
import { songColumns, songRange, makeClock, keyLabel as songKeyLabel, spellMidi } from "./core/song.js";
import { setupSongUI } from "./song-ui.js";

// ---------- Réglages ----------
const DEFAULTS = {
  exercise: EXERCISES[0].id,
  clef: "treble",
  range: {
    treble: { min: 30, max: 38 }, // mi4 → fa5
    bass:   { min: 18, max: 26 }, // sol2 → la3
    both:   { min: 18, max: 38 }, // sol2 → fa5
  },
  melodic: false,         // mode mélodique
  keyMode: "both",        // major | minor | both
  keyAcc: 1,              // nombre max d'altérations à la clé
  names: "always",        // always | afterMiss | never
  notation: "latin",      // latin (do ré mi) | english (C D E)
  nameOctave: false,
  showKeyboard: true,
  keyLabels: true,
  keySound: true,
  perRow: "auto",
  theme: "auto",
  accent: "green",
  octaveExact: true,
  skipOnMiss: false,
  playMode: "wait",       // wait (à mon rythme) | scroll (défilement)
  tempo: 40,              // défilement : notes par minute
  autoPlay: false,
  syncSound: false,       // ▶ en défilement / morceaux : les notes sonnent au moment où il faut les jouer
  statsOn: false,         // enregistrer les réponses pour les statistiques
  exercises: Object.fromEntries(EXERCISES.map((ex) => [ex.id, ex.defaults || {}])),
};
await store.init();
const settings = new Settings(DEFAULTS, store.state.settings);

// ---------- Préréglages ----------
// Préréglages proposés au premier lancement (modifiables / supprimables)
const STARTER_PRESETS = [
  { name: "Clé de sol – débutant", values: { exercise: "notes", clef: "treble", melodic: false, names: "always", exercises: { notes: { acc: "none" } } } },
  { name: "Clé de fa – débutant", values: { exercise: "notes", clef: "bass", melodic: false, names: "always", exercises: { notes: { acc: "none" } } } },
  { name: "Mélodies à l'oreille", values: { exercise: "notes", clef: "treble", melodic: true, keyAcc: 1, names: "afterMiss", autoPlay: true } },
  { name: "Triades mélodiques", values: { exercise: "triads", clef: "treble", melodic: true, keyAcc: 2, range: { treble: { min: 28, max: 40 } },
    exercises: { triads: { inv0: true, inv1: true, inv2: true, mode: "block" } } } },
];
if (!Array.isArray(store.state.presets)) {
  store.state.presets = STARTER_PRESETS.map((p, i) => ({ id: "p" + (i + 1), name: p.name, values: p.values }));
  store.save();
}
const presets = () => store.state.presets;

// les morceaux MIDI et le visualisateur ont leur propre portée : ces réglages ne les concernent pas
const notSong = (s) => s.get("exercise") !== "midi";
const notViewer = (s) => s.get("exercise") !== "viewer";
const generated = (s) => notSong(s) && notViewer(s);
const GENERAL_FIELDS = [
  {
    key: "clef", label: "Clé", type: "choice", when: generated,
    options: [
      { value: "treble", label: "Clé de sol" },
      { value: "bass", label: "Clé de fa" },
      { value: "both", label: "Les deux" },
    ],
  },
  {
    key: "range", label: "Fourchette de notes", type: "noteRange", perClef: true, min: 7, max: 49, when: generated,
    help: "Note la plus grave et la plus aiguë de l'exercice. Une fourchette est gardée pour chaque clé.",
  },
  {
    key: "melodic", label: "Mode mélodique", type: "toggle", when: generated,
    help: "Les exercices suivent une tonalité et une suite d'accords : la mélodie ou les accords sonnent toujours bien et finissent sur la tonique.",
  },
  {
    key: "keyMode", label: "Tonalités", type: "choice", when: (s) => generated(s) && s.get("melodic"),
    options: [{ value: "major", label: "Majeures" }, { value: "minor", label: "Mineures" }, { value: "both", label: "Les deux" }],
  },
  {
    key: "keyAcc", label: "Altérations à la clé (au plus)", type: "choice", when: (s) => generated(s) && s.get("melodic"),
    options: [{ value: 0, label: "0" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 5, label: "5" }],
    help: "0 : do majeur / la mineur. 1 : ajoute sol, fa, mi mineur, ré mineur. Etc.",
  },
];
const DISPLAY_FIELDS = [
  {
    key: "names", label: "Nom des notes sur la portée", type: "choice",
    options: [
      { value: "always", label: "Toujours" },
      { value: "afterMiss", label: "Après une erreur" },
      { value: "never", label: "Jamais" },
    ],
  },
  {
    key: "notation", label: "Notation", type: "choice",
    options: [{ value: "latin", label: "do ré mi" }, { value: "english", label: "C D E" }],
  },
  { key: "nameOctave", label: "Ajouter l'octave au nom (do4)", type: "toggle" },
  {
    key: "perRow", label: "Notes par ligne", type: "choice",
    options: [{ value: "auto", label: "Auto" }, { value: "4", label: "4" }, { value: "6", label: "6" }, { value: "8", label: "8" }, { value: "12", label: "12" }],
  },
];
const LOOK_FIELDS = [
  {
    key: "accent", label: "Couleur", type: "swatch",
    options: [
      { value: "green", label: "Vert", light: "#1f7a4d", dark: "#5fcf92" },
      { value: "teal", label: "Turquoise", light: "#0f7480", dark: "#52cfdc" },
      { value: "blue", label: "Bleu", light: "#2357c6", dark: "#7ea6ff" },
      { value: "violet", label: "Violet", light: "#6b46c1", dark: "#b49dff" },
      { value: "pink", label: "Rose", light: "#b8326c", dark: "#ff8fbe" },
      { value: "orange", label: "Orange", light: "#b9560f", dark: "#ffa45e" },
      { value: "slate", label: "Ardoise", light: "#3f4d5c", dark: "#aab8c7" },
    ],
  },
  {
    key: "theme", label: "Mode", type: "choice",
    options: [{ value: "auto", label: "Auto" }, { value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }],
  },
];
const KEYBOARD_FIELDS = [
  { key: "showKeyboard", label: "Afficher le clavier à l'écran", type: "toggle" },
  { key: "keyLabels", label: "Noms sur les touches", type: "toggle", when: (s) => s.get("showKeyboard") },
  { key: "keySound", label: "Son des touches à l'écran", type: "toggle", when: (s) => s.get("showKeyboard") },
];
const PLAY_FIELDS = [
  {
    key: "playMode", label: "Mode de jeu", type: "choice", when: notViewer,
    options: [{ value: "wait", label: "À mon rythme" }, { value: "scroll", label: "Défilement" }],
    help: "Défilement : les notes avancent toutes seules vers la gauche. Joue chaque note avant qu'elle ne sorte de la zone colorée.",
  },
  {
    key: "tempo", label: "Vitesse (notes par minute)", type: "number", min: 10, max: 240, step: 5,
    when: (s) => generated(s) && s.get("playMode") === "scroll",
  },
  {
    key: "syncSound", label: "Le son suit la partition (bouton ▶)", type: "toggle", when: notViewer,
    help: "En défilement, chaque note sonne au moment où elle doit être jouée. Dans les morceaux « à mon rythme », le morceau sonne au rythme de tes touches. Sans défilement, ▶ fait écouter la ligne d'un coup.",
  },
  { key: "octaveExact", label: "Exiger la bonne octave", type: "toggle", when: notViewer, help: "Décoché : la bonne note dans n'importe quelle octave est acceptée." },
  { key: "skipOnMiss", label: "Passer à la note suivante après une erreur", type: "toggle", when: notViewer },
  {
    key: "autoPlay", label: "Écouter chaque nouvelle ligne avant de jouer", type: "toggle", when: generated,
    help: "Pour entraîner l'oreille : la ligne est jouée au début de chaque exercice. Le navigateur demande de toucher la page une fois avant le premier son.",
  },
];

const exercise = () => EXERCISES.find((e) => e.id === settings.get("exercise")) || EXERCISES[0];
const exOpts = () => settings.get("exercises." + exercise().id) || {};
const range = () => settings.get("range." + settings.get("clef"));

// Les champs d'un exercice utilisent des clés relatives : on les préfixe
function exerciseFields(ex) {
  return (ex.fields || []).map((f) => ({ ...f, key: `exercises.${ex.id}.${f.key}` }));
}

// ---------- État de la partie ----------
const $ = (id) => document.getElementById(id);
let columns = [], cur = 0, hits = 0, misses = 0;
let colStart = performance.now();   // début de la colonne en cours (pour mesurer la rapidité)
const held = new Set();     // notes tenues sur le clavier MIDI
const tapped = new Set();   // notes touchées à l'écran (gardées jusqu'à la colonne suivante, utile pour les accords)
const columnCount = () => {
  const p = settings.get("perRow");
  if (p !== "auto") return Number(p);
  return window.innerWidth < 560 ? 4 : 8;
};

function newRow() {
  $("song-empty").hidden = true;
  if (isSong()) return startSong();
  if (isViewer()) return startViewer();
  cancelAnimationFrame(sg.raf);
  if (isScroll()) return startScroll();
  stopScroll();
  const melodic = { on: settings.get("melodic"), mode: settings.get("keyMode"), maxAcc: Number(settings.get("keyAcc")) };
  columns = exercise().generate({ count: columnCount(), range: range(), clef: settings.get("clef"), opts: exOpts(), melodic });
  $("key-label").textContent = columns.keyLabel ? "Tonalité : " + columns.keyLabel : "";
  stopPlayback();
  if (settings.get("autoPlay")) setTimeout(playRow, 400);
  cur = 0;
  colStart = performance.now();
  tapped.clear();
  draw();
}

function draw() {
  if (isSong()) return drawSong();
  if (isViewer()) return drawViewer();
  staffView = renderStaff($("staff"), {
    clef: settings.get("clef"),
    range: range(),
    columns,
    current: cur,
    showName: (col) => settings.get("names") === "always" || (settings.get("names") === "afterMiss" && col.revealed),
    withOctave: settings.get("nameOctave"),
    scroll: isScroll() ? { slots: columnCount() } : null,
  });
  if (isScroll()) {
    staffView.setOffset(scrollPos());
    const label = columns[cur]?.keyLabel;
    $("key-label").textContent = label ? "Tonalité : " + label : "";
  }
  $("hits").textContent = hits;
  $("misses").textContent = misses;
}

function accStyle() {
  const ex = exercise();
  return ex.accidentalStyle ? ex.accidentalStyle(exOpts()) : "both";
}

function buildKeyboard() {
  const r = isSong() ? songRangeCached || { min: 21, max: 38 } : isViewer() ? VIEWER_RANGE : range();
  keyboard.build(r.min, r.max, { accMode: accStyle(), labels: settings.get("keyLabels") });
}

function feedback(text, cls = "") {
  const f = $("feedback");
  f.textContent = text;
  f.className = "feedback " + cls;
}

// ---------- Vérification (commune à tous les exercices) ----------
const same = (a, b) => (settings.get("octaveExact") ? a === b : a % 12 === b % 12);

function onNote(m) {
  if (isViewer()) return viewerNote(m);
  const col = columns[cur];
  if (!col || (isSong() && sg.done)) return;
  const expected = col.notes.filter((n) => !n.other).map(midiOf);
  if (!expected.some((e) => same(m, e))) {
    misses++;
    if (isSong()) sg.misses++;
    col.status = "bad";
    col.revealed = true;
    col.missed = true;
    tapped.clear();
    keyboard.flash(m, false);
    const pref = accStyle() === "flat" ? "flat" : "sharp";
    feedback(`Tu as joué ${midiName(m, pref, settings.get("octaveExact"))}, ce n'est pas ça`, "bad");
    if (settings.get("skipOnMiss")) { recordAnswer(col); advance(); }
    draw();
    return;
  }
  keyboard.flash(m, true);
  const playing = [...held, ...tapped];
  if (expected.every((e) => playing.some((p) => same(p, e)))) {
    hits++;
    if (isSong() && !col.missed) sg.hits++;
    if (isSong() && !isScroll()) { playColumn(col); sg.autoAt = 0; }
    col.status = "ok";
    const notesText = col.notes.filter((n) => !n.other).map((n) => noteName(n, settings.get("nameOctave"))).join(" – ");
    feedback("Bravo : " + (col.notes.length > 1 && col.title ? `${col.title} (${notesText})` : notesText), "ok");
    recordAnswer(col);
    advance();
  }
  draw();
}

// Statistiques : une réponse = une colonne terminée
function recordAnswer(col) {
  if (!store.user || !settings.get("statsOn")) return;
  record({
    t: Date.now(),
    ex: exercise().id,
    p: activePreset()?.id || "",
    ok: col.missed ? 0 : 1,
    ms: performance.now() - colStart,
    n: col.notes.length,
    ...(isSong() && song ? { s: song.id, sn: song.name } : {}),
  });
}

function advance() {
  cur++;
  colStart = performance.now();
  tapped.clear();
  if (!isScroll() && !isSong() && cur >= columns.length) setTimeout(newRow, 350);
}

// ---------- Morceaux (lecteur MIDI) ----------
// Les colonnes du morceau ont une position col.k (en croches). L'horloge du morceau avance
// selon le tempo × la vitesse choisie ; on n'affiche que les colonnes visibles.
const isSong = () => !!exercise().song;
let song = null, songClock = null, songRangeCached = null;
const sg = { sec: 0, last: 0, view: 0, snd: 0, autoAt: 0, raf: 0, paused: false, done: false, hits: 0, misses: 0, a: -1, b: -1, dirty: true };
const SONG_TOL = 1;     // on peut jouer une note jusqu'à une croche après la zone de lecture
const SONG_DX = 58;     // largeur d'une croche
const songSlots = () => (window.innerWidth < 560 ? 7 : 15);
const songSpeed = () => Math.min(2, Math.max(0.1, Number(exOpts().speed) || 1));

function startSong() {
  stopPlayback();
  cancelAnimationFrame(scroll.raf);
  cancelAnimationFrame(sg.raf);
  scroll.pausedAt = null;
  sg.paused = false;
  $("song-empty").hidden = !!song;
  if (!song) {
    columns = []; cur = 0; songRangeCached = null;
    $("key-label").textContent = "";
    setPauseButton();
    drawSong(0);
    return;
  }
  columns = songColumns(song, exOpts().hands || "both");
  songClock = makeClock(song);
  songRangeCached = songRange(columns);
  Object.assign(sg, { sec: 0, view: 0, snd: 0, autoAt: 0, done: false, hits: 0, misses: 0, dirty: true, last: performance.now() });
  cur = 0;
  tapped.clear();
  colStart = performance.now();
  const k = songKeyLabel(song);
  $("key-label").textContent = k ? "Tonalité : " + k : "";
  buildKeyboard();
  setPauseButton();
  sg.raf = requestAnimationFrame(songTick);
}

// Écoute du morceau (bouton ▶) : le morceau sonne au rythme de ce que l'on joue
// un seul réglage pour tous les exercices : le son suit la partition (bouton ▶)
const songListen = () => !!settings.get("syncSound");
const syncMode = () => isSong() || isScroll();   // ▶ = interrupteur ; sinon ▶ = écouter la ligne d'un coup
function playColumn(col) {
  if (!songListen() || !col) return;
  col.notes.forEach((n) => beep(midiOf(n), col.notes.length > 2 ? 0.1 : 0.16));
}
// délai réel (ms) entre deux colonnes du morceau, selon le tempo et la vitesse
function songDelay(prev, col) {
  if (!prev || !songClock) return 0;
  return ((songClock.tickToSec(col.tick) - songClock.tickToSec(prev.tick)) * 1000) / songSpeed();
}
function syncListenButton() {
  const b = $("listen");
  if (!syncMode()) {
    b.classList.remove("playing");
    b.setAttribute("aria-label", "Écouter la ligne");
    b.title = "Écouter la ligne";
    b.removeAttribute("aria-pressed");
    return;
  }
  const on = songListen();
  b.classList.toggle("playing", on);
  b.setAttribute("aria-pressed", String(on));
  const t = on ? "Couper le son de la partition"
    : isSong() && !isScroll() ? "Écouter le morceau au rythme de mes touches" : "Entendre chaque note au moment de la jouer";
  b.setAttribute("aria-label", t);
  b.title = t;
}

function songSlice(pos) {
  let a = sg.a >= 0 && sg.a < columns.length && columns[sg.a].k < pos - 2 ? sg.a : 0;
  while (a < columns.length && columns[a].k < pos - 2) a++;
  let b = a;
  while (b < columns.length && columns[b].k <= pos + songSlots() + 1) b++;
  return [a, b];
}

function drawSong(pos = sg.view) {
  const [a, b] = songSlice(pos);
  sg.a = a; sg.b = b; sg.dirty = false;
  staffView = renderStaff($("staff"), {
    clef: "both",
    range: songRangeCached || { min: 21, max: 38 },
    columns: columns.slice(a, b),
    current: cur - a,
    showName: (col) => settings.get("names") === "always" || (settings.get("names") === "afterMiss" && col.revealed),
    withOctave: settings.get("nameOctave"),
    scroll: { slots: songSlots(), dx: SONG_DX },
    tails: exOpts().tails,
  });
  staffView.setOffset(pos);
  $("hits").textContent = hits;
  $("misses").textContent = misses;
}

function songTick(now) {
  if (!isSong() || !song) return;
  const dt = Math.min(100, now - sg.last);
  sg.last = now;
  const scrolling = isScroll();
  if (scrolling && !sg.paused && document.querySelector("dialog[open]")) { scroll.autoPaused = true; togglePause(true); }

  // les colonnes sans note à jouer (autre main) passent toutes seules.
  // À mon rythme avec l'écoute : elles s'enchaînent au tempo du morceau, comme un accompagnement.
  if (!scrolling && songListen()) {
    while (columns[cur]?.auto) {
      if (!sg.autoAt) sg.autoAt = now + songDelay(columns[cur - 1], columns[cur]);
      if (now < sg.autoAt) break;
      sg.autoAt = 0;
      playColumn(columns[cur]);
      columns[cur].status = "auto"; advance(); sg.dirty = true;
    }
  } else {
    sg.autoAt = 0;
    while (columns[cur]?.auto) { columns[cur].status = "auto"; advance(); sg.dirty = true; }
  }

  let pos;
  if (scrolling) {
    if (!sg.paused && !sg.done) sg.sec += (dt / 1000) * songSpeed();
    pos = songClock.posAt(sg.sec);
    // note dépassée sans être jouée
    while (columns[cur] && pos > columns[cur].k + SONG_TOL) {
      const col = columns[cur];
      misses++; sg.misses++;
      col.status = "bad"; col.missed = true; col.revealed = true;
      feedback("Trop tard : " + col.title, "bad");
      recordAnswer(col);
      advance();
      while (columns[cur]?.auto) { columns[cur].status = "auto"; advance(); }
      sg.dirty = true;
    }
  } else {
    // à mon rythme : la partition glisse jusqu'à la note à jouer
    const target = columns[cur] ? columns[cur].k : (columns.at(-1)?.k ?? 0) + 2;
    sg.view += (target - sg.view) * Math.min(1, dt / 140);
    pos = sg.view;
  }
  sg.view = pos;

  // défilement : le morceau sonne quand ses notes passent la zone de lecture
  if (scrolling) {
    while (sg.snd < columns.length && columns[sg.snd].k <= pos) { playColumn(columns[sg.snd]); sg.snd++; }
  } else {
    sg.snd = cur;
  }

  if (cur >= columns.length && !sg.done && (!scrolling || pos > (columns.at(-1)?.k ?? 0) + 2)) finishSong();

  const [a, b] = songSlice(pos);
  if (sg.dirty || a !== sg.a || b !== sg.b) drawSong(pos); else staffView.setOffset(pos);
  sg.raf = requestAnimationFrame(songTick);
}

function finishSong() {
  sg.done = true;
  const total = sg.hits + sg.misses;
  const pct = total ? Math.round((sg.hits / total) * 100) : 0;
  feedback(`Morceau terminé : ${pct} % de notes justes du premier coup. ↺ pour recommencer.`, "ok");
  flush();
}

// ---------- Visualisateur de notes ----------
// Affiche simplement les notes jouées, toujours au même endroit (pas de défilement).
// Deux boutons choisissent les clés actives : une seule clé active → toutes les notes
// s'y affichent (avec lignes supplémentaires), même les notes de l'autre main.
const isViewer = () => !!exercise().viewer;
const VIEWER_GROUP_MS = 60;   // notes jouées à quelques ms d'intervalle → affichées en accord
const VIEWER_RANGE = { min: 7, max: 49 };   // toute l'étendue du clavier, quelle que soit la clé
let viewerCol = null, viewerLastT = 0;

const viewerClef = () => {
  const o = exOpts();
  const left = o.left !== false, right = o.right !== false;
  if (left && !right) return "bass";
  if (right && !left) return "treble";
  return "both";
};

function startViewer() {
  stopPlayback();
  cancelAnimationFrame(scroll.raf);
  cancelAnimationFrame(sg.raf);
  stopScroll();
  viewerCol = null;
  hits = 0; misses = 0;
  $("hits").textContent = 0;
  $("misses").textContent = 0;
  syncViewerBar();
  drawViewer();
}

function drawViewer() {
  staffView = renderStaff($("staff"), {
    clef: viewerClef(),
    range: VIEWER_RANGE,
    columns: viewerCol ? [viewerCol] : [],
    current: -1,
    showName: () => settings.get("names") === "always",
    withOctave: settings.get("nameOctave"),
  });
}

function viewerNote(m) {
  const note = spellMidi(m);
  const now = performance.now();
  if (viewerCol && now - viewerLastT < VIEWER_GROUP_MS) viewerCol.notes.push(note);
  else viewerCol = { notes: [note], status: "" };
  viewerLastT = now;
  drawViewer();
}

function syncViewerBar() {
  $("viewer-bar").hidden = !isViewer();
  if (!isViewer()) return;
  const o = exOpts();
  $("viewer-left").setAttribute("aria-pressed", String(o.left !== false));
  $("viewer-right").setAttribute("aria-pressed", String(o.right !== false));
}
$("viewer-left").addEventListener("click", () => settings.set("exercises.viewer.left", !(exOpts().left !== false)));
$("viewer-right").addEventListener("click", () => settings.set("exercises.viewer.right", !(exOpts().right !== false)));

// ---------- Mode défilement ----------
// Les colonnes ont une position fixe col.k ; la position de lecture `pos` avance d'une colonne
// par temps (60 000 / tempo ms). Une colonne doit être jouée avant que pos dépasse col.k + 0,5.
const isScroll = () => settings.get("playMode") === "scroll";
const beatMs = () => 60000 / Math.max(10, Number(settings.get("tempo")) || 40);
const LEAD_IN = 2;            // la première note part à 2 colonnes de la zone de lecture
let staffView = null;
const scroll = { k: 0, t0: 0, beat: 1500, pausedAt: null, raf: 0, autoPaused: false };

function scrollPos(now = performance.now()) {
  const t = scroll.pausedAt ?? now;
  return (t - scroll.t0) / scroll.beat;
}

function scrollBatch() {
  const melodic = { on: settings.get("melodic"), mode: settings.get("keyMode"), maxAcc: Number(settings.get("keyAcc")) };
  const batch = exercise().generate({ count: Math.max(4, columnCount()), range: range(), clef: settings.get("clef"), opts: exOpts(), melodic });
  batch.forEach((c) => { c.k = scroll.k++; c.keyLabel = batch.keyLabel; });
  return batch;
}

function startScroll() {
  stopPlayback();
  cancelAnimationFrame(scroll.raf);
  scroll.k = 0;
  columns = scrollBatch();
  cur = 0;
  tapped.clear();
  scroll.pausedAt = null;
  scroll.beat = beatMs();
  scroll.t0 = performance.now() + LEAD_IN * scroll.beat;
  colStart = scroll.t0;
  setPauseButton();
  draw();
  scroll.raf = requestAnimationFrame(tick);
}

function stopScroll() {
  cancelAnimationFrame(scroll.raf);
  scroll.raf = 0;
  scroll.pausedAt = null;
  setPauseButton();
}

function tick() {
  if (!isScroll()) return;
  // une fenêtre (réglages, stats, compte) est ouverte : pause automatique
  if (document.querySelector("dialog[open]")) { scroll.autoPaused = true; return togglePause(true); }
  const pos = scrollPos();
  let changed = false;
  // note dépassée sans être jouée : comptée comme erreur
  while (columns[cur] && pos > columns[cur].k + 0.5) {
    const col = columns[cur];
    misses++;
    col.status = "bad";
    col.missed = true;
    col.revealed = true;
    feedback("Trop tard : " + col.notes.map((n) => noteName(n, settings.get("nameOctave"))).join(" – "), "bad");
    recordAnswer(col);
    advance();
    changed = true;
  }
  // toujours des notes en réserve à droite
  if (columns.length - cur < columnCount() + 3) { columns.push(...scrollBatch()); changed = true; }
  // on oublie les colonnes sorties à gauche
  const gone = columns.findIndex((c) => c.k >= pos - 1.5);
  if (gone > 0 && gone <= cur) { columns.splice(0, gone); cur -= gone; changed = true; }
  // le son suit la partition : chaque colonne sonne en arrivant dans la zone de lecture
  if (songListen()) for (const c of columns) if (!c.sounded && c.k <= pos) { c.sounded = true; c.notes.forEach((n) => beep(midiOf(n), c.notes.length > 2 ? 0.1 : 0.16)); }
  if (changed) draw(); else staffView.setOffset(pos);
  if (scroll.pausedAt == null) scroll.raf = requestAnimationFrame(tick);
}

function togglePause(force) {
  if (!isScroll()) return;
  if (isSong()) {
    sg.paused = force ?? !sg.paused;
    sg.last = performance.now();
    return setPauseButton();
  }
  const pause = force ?? scroll.pausedAt == null;
  if (pause && scroll.pausedAt == null) {
    scroll.pausedAt = performance.now();
    cancelAnimationFrame(scroll.raf);
  } else if (!pause && scroll.pausedAt != null) {
    const paused = performance.now() - scroll.pausedAt;
    scroll.t0 += paused;
    colStart += paused;
    scroll.pausedAt = null;
    scroll.raf = requestAnimationFrame(tick);
  }
  setPauseButton();
}

function setPauseButton() {
  const b = $("pause");
  b.hidden = !isScroll();
  const paused = isSong() ? sg.paused : scroll.pausedAt != null;
  b.setAttribute("aria-label", paused ? "Reprendre" : "Pause");
  b.title = paused ? "Reprendre" : "Pause";
  b.classList.toggle("playing", paused);
  b.querySelector(".i-pause").hidden = paused;
  b.querySelector(".i-play").hidden = !paused;
}

// ---------- Entrées ----------
const keyboard = new Keyboard($("kbd-scroll"), {
  onPress(m) { if (settings.get("keySound")) beep(m); tapped.add(m); onNote(m); },
});

const midi = new MidiInput({
  onNoteOn(m) { held.add(m); onNote(m); },
  onNoteOff(m) { held.delete(m); },
  onStatus({ state, text }) {
    $("midi").className = "midi " + state;
    $("midi-text").textContent = text;
    $("midi-btn").hidden = state === "on" || !midi.supported;
  },
});
$("midi-btn").addEventListener("click", () => midi.connect());

// ---------- Micro (piano acoustique) ----------
const micNote = $("mic-note");
const mic = new MicInput({
  onNoteOn(m) {
    held.add(m);
    micNote.textContent = midiName(m, accStyle() === "flat" ? "flat" : "sharp", true);
    onNote(m);
  },
  onNoteOff(m) { held.delete(m); },
  onStatus({ state, text }) {
    const b = $("mic");
    const on = state === "on";
    b.classList.toggle("playing", on);
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Couper le micro" : "Jouer sur un vrai piano (micro)";
    b.setAttribute("aria-label", b.title);
    micNote.hidden = !on;
    if (!on) micNote.textContent = "";
    if (text) feedback(text, state === "err" ? "bad" : "");
  },
  ignoreUntil: () => keyboardMod.soundUntil,
});
$("mic").addEventListener("click", () => (mic.running ? mic.stop() : mic.start()));
midi.connect();

// ---------- Préréglages : interface ----------
function activePreset() { return presets().find((p) => settings.matches(p.values)); }

function renderPresetPicker() {
  const sel = $("preset-pick");
  sel.replaceChildren(new Option("Préréglages…", ""));
  for (const p of presets()) sel.append(new Option(p.name, p.id));
  sel.value = activePreset()?.id || "";
  sel.hidden = presets().length === 0;
}
$("preset-pick").addEventListener("change", (e) => {
  const p = presets().find((x) => x.id === e.target.value);
  if (p) settings.apply(p.values);
});

function savePresets() { store.save(); renderPresetPicker(); renderPresets(); }

function renderPresets() {
  const box = $("presets");
  box.replaceChildren();
  const active = activePreset();
  if (presets().length) {
    const list = document.createElement("ul");
    list.className = "preset-list";
    for (const p of presets()) {
      const li = document.createElement("li");
      li.className = "preset-row" + (active === p ? " active" : "");
      const load = document.createElement("button");
      load.type = "button";
      load.className = "preset-name";
      load.textContent = p.name;
      load.title = "Charger ce préréglage";
      load.addEventListener("click", () => settings.apply(p.values));
      const upd = document.createElement("button");
      upd.type = "button";
      upd.className = "mini";
      upd.textContent = "Mettre à jour";
      upd.title = "Remplacer par les réglages actuels";
      upd.addEventListener("click", () => { p.values = settings.snapshot(); savePresets(); });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "mini danger";
      del.textContent = "Supprimer";
      del.addEventListener("click", () => {
        if (del.dataset.armed) { store.state.presets = presets().filter((x) => x !== p); savePresets(); return; }
        del.dataset.armed = "1";
        del.textContent = "Confirmer ?";
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "Supprimer"; } }, 3000);
      });
      li.append(load, upd, del);
      list.append(li);
    }
    box.append(list);
  }
  const form = document.createElement("form");
  form.className = "preset-form";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "preset-new-name";
  input.placeholder = "Nom du nouveau préréglage";
  input.maxLength = 40;
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn";
  btn.textContent = "Enregistrer";
  form.append(input, btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim() || exercise().name + " " + (presets().length + 1);
    presets().push({ id: "p" + Date.now().toString(36), name, values: settings.snapshot() });
    savePresets();
  });
  const help = document.createElement("p");
  help.className = "field-help";
  help.textContent = "Un préréglage garde l'exercice choisi et tous ses réglages (sauf la couleur et le mode clair/sombre). "
    + (store.user ? `Ils sont enregistrés dans ton compte (${store.user}).` : "Tu n'es pas connecté : ils seront perdus en fermant la page. Connecte-toi pour les garder.");
  box.append(form, help);
}

// ---------- Panneau de réglages ----------
const dialog = $("settings");
function renderSettings() {
  renderPresets();
  renderFields($("fields-general"), GENERAL_FIELDS, settings, renderSettings);
  renderFields($("fields-look"), LOOK_FIELDS, settings, renderSettings);
  renderFields($("fields-display"), DISPLAY_FIELDS, settings, renderSettings);
  renderFields($("fields-keyboard"), KEYBOARD_FIELDS, settings, renderSettings);
  renderFields($("fields-play"), PLAY_FIELDS, settings, renderSettings);
  const ex = exercise();
  $("exercise-title").textContent = "Exercice : " + ex.name;
  renderFields($("fields-exercise"), exerciseFields(ex), settings, renderSettings);
  $("fields-exercise").closest("section").hidden = !$("fields-exercise").children.length;
}
$("open-settings").addEventListener("click", () => { renderSettings(); dialog.showModal(); });
$("close-settings").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

// Onglets d'exercice
const tabs = $("exercise-tabs");
for (const ex of EXERCISES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = ex.name;
  b.dataset.id = ex.id;
  b.title = ex.description || "";
  b.addEventListener("click", () => settings.set("exercise", ex.id));
  tabs.append(b);
}
function syncTabs() {
  tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === exercise().id)));
}

// Écouter la ligne en cours (bouton ▶ ou automatiquement au début)
let playToken = 0;
function stopPlayback() { playToken++; if (!syncMode()) $("listen").classList.remove("playing"); }
async function playRow() {
  const token = ++playToken;
  $("listen").classList.add("playing");
  const row = columns;
  for (const col of row) {
    if (token !== playToken) return;
    col.notes.forEach((n) => beep(midiOf(n), col.notes.length > 1 ? 0.16 : 0.25));
    await new Promise((r) => setTimeout(r, col.notes.length > 1 ? 800 : 480));
  }
  if (token === playToken) {
    $("listen").classList.remove("playing");
    if (cur === 0) colStart = performance.now(); // le chrono démarre après l'écoute
  }
}
$("listen").addEventListener("click", () => {
  if (isViewer()) return;
  if (syncMode()) { unlockAudio(); return settings.set("syncSound", !songListen()); }
  $("listen").classList.contains("playing") ? stopPlayback() : playRow();
});
// débloque le son au premier geste, puis joue la ligne si l'écoute auto est active et rien n'a encore été joué
let firstGesture = true;
const onFirstGesture = () => {
  unlockAudio();
  if (firstGesture && settings.get("autoPlay") && cur === 0 && !isViewer()) playRow();
  firstGesture = false;
};
window.addEventListener("pointerdown", onFirstGesture, { once: true });
window.addEventListener("keydown", onFirstGesture, { once: true });

$("pause").addEventListener("click", () => { scroll.autoPaused = false; togglePause(); });
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("close", () => {
  if (scroll.autoPaused && !document.querySelector("dialog[open]")) { scroll.autoPaused = false; togglePause(false); }
}));
document.addEventListener("visibilitychange", () => { if (document.hidden) togglePause(true); });

$("restart").addEventListener("click", () => { hits = 0; misses = 0; feedback(""); newRow(); });

// Réagir aux changements de réglages
settings.onChange((key) => {
  renderPresetPicker();
  if (key === "*") return refreshAll();
  if (["names", "nameOctave"].includes(key)) return draw();
  if (["octaveExact", "skipOnMiss", "keySound"].includes(key)) return;
  if (key === "tempo") {
    // nouvelle vitesse sans faire sauter les notes : on garde la position actuelle
    const now = scroll.pausedAt ?? performance.now();
    const pos = (now - scroll.t0) / scroll.beat;
    scroll.beat = beatMs();
    scroll.t0 = now - pos * scroll.beat;
    return;
  }
  if (["exercises.midi.speed", "exercises.midi.songId", "exercises.midi.lastSound"].includes(key)) return;
  if (key === "syncSound") return syncListenButton();
  if (key === "playMode") syncListenButton();
  if (key === "exercises.midi.tails") return draw();
  if (key === "statsOn") { $("stats-on").checked = settings.get("statsOn"); return; }
  if (key === "autoPlay") { if (settings.get("autoPlay")) playRow(); return; }
  if (key === "showKeyboard") { applyKeyboardVisibility(); return renderSettings(); }
  if (key === "melodic") renderSettings();
  if (key === "keyLabels") return buildKeyboard();
  if (key === "theme" || key === "accent") return applyTheme();
  if (key === "notation") { setNotation(settings.get("notation")); buildKeyboard(); renderSettings(); return draw(); }
  if (key === "exercise") { syncTabs(); syncSongBar(); syncViewerBar(); renderSettings(); }
  feedback("");
  buildKeyboard();
  newRow();
});

// Après le chargement d'un préréglage : tout remettre à jour
function refreshAll() {
  setNotation(settings.get("notation"));
  applyTheme();
  applyKeyboardVisibility();
  syncTabs();
  feedback("");
  buildKeyboard();
  newRow();
  if (dialog.open) renderSettings();
}

function applyTheme() {
  const t = settings.get("theme");
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  document.documentElement.setAttribute("data-accent", settings.get("accent"));
}

function applyKeyboardVisibility() {
  const show = settings.get("showKeyboard");
  $("kbd-zone").hidden = !show;
}

let lastCount = columnCount();
window.addEventListener("resize", () => {
  if (columnCount() !== lastCount) {
    lastCount = columnCount();
    if (isSong()) { sg.dirty = true; drawSong(); } else newRow();  // un morceau ne redémarre pas
  }
});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);

// ---------- Statistiques ----------
setupAccount();
const statsSwitch = $("stats-on");
statsSwitch.checked = !!store.user && settings.get("statsOn");
statsSwitch.addEventListener("change", () => {
  if (!store.user) {
    statsSwitch.checked = false;
    openAccount("Connecte-toi pour enregistrer tes statistiques.");
    return;
  }
  settings.set("statsOn", statsSwitch.checked);
});
setupStatsView({ exercises: EXERCISES, presets });
addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

// ---------- Morceaux : interface ----------
function syncSongBar() { $("song-bar").hidden = !isSong(); syncListenButton(); }
const songUI = setupSongUI({ settings, onSong: (s) => { song = s; if (isSong()) startSong(); } });

// ---------- Démarrage ----------
setNotation(settings.get("notation"));
applyTheme();
syncTabs();
renderPresetPicker();
applyKeyboardVisibility();
syncSongBar();
syncViewerBar();
await songUI.load();
buildKeyboard();
newRow();
