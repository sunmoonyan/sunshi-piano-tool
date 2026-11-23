// Clavier de piano à l'écran.

import { names, degree, octaveOf, midiOf } from "./music.js";
import { SplendidGrandPiano } from "https://unpkg.com/smplr@1.2.0/dist/index.mjs";

const WHITE_W = 44;

export class Keyboard {
  constructor(scrollBox, { onPress }) {
    this.scrollBox = scrollBox;
    this.el = document.createElement("div");
    this.el.className = "kbd";
    scrollBox.append(this.el);
    this.keys = {};
    this.el.addEventListener("pointerdown", (e) => {
      const k = e.target.closest("[data-midi]");
      if (!k) return;
      e.preventDefault();
      onPress(Number(k.dataset.midi));
    });
  }

  // Construit les touches pour couvrir [minD, maxD] (octaves complètes)
  build(minD, maxD, { accMode = "both", labels = true } = {}) {
    const NOMS = names();
    this.el.classList.toggle("no-labels", !labels);
    this.el.replaceChildren();
    this.keys = {};
    const from = minD - degree(minD), to = maxD + (6 - degree(maxD));
    let wi = 0;
    for (let d = from; d <= to; d++) {
      const m = midiOf(d), deg = degree(d);
      const w = document.createElement("div");
      w.className = "wkey";
      w.dataset.midi = m;
      w.innerHTML = NOMS[deg] + (deg === 0 ? `<small>${octaveOf(d)}</small>` : "");
      this.el.append(w);
      this.keys[m] = w;
      if (deg !== 2 && deg !== 6 && d !== to) {
        const b = document.createElement("div");
        b.className = "bkey";
        b.style.left = (wi + 1) * WHITE_W - 14 + "px";
        b.dataset.midi = m + 1;
        const up = NOMS[deg] + "♯", down = NOMS[(deg + 1) % 7] + "♭";
        b.innerHTML = accMode === "flat" ? down : accMode === "sharp" ? up : `${up}<br>${down}`;
        this.el.append(b);
        this.keys[m + 1] = b;
      }
      wi++;
    }
    requestAnimationFrame(() => {
      this.scrollBox.scrollLeft = (this.el.scrollWidth - this.scrollBox.clientWidth) / 2;
    });
  }

  flash(m, ok) {
    const k = this.keys[m];
    if (!k) return;
    k.classList.add(ok ? "hit" : "miss");
    setTimeout(() => k.classList.remove("hit", "miss"), 250);
  }
}

// Son des touches à l'écran : un vrai piano échantillonné (Steinway, via smplr).
let actx = null, piano = null, masterGain = null;
const VOLUME_BOOST = 2;    // le rendu par défaut de la librairie est trop faible
let volumePct = 100;       // réglage utilisateur, 0 à 200 %
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur :
// on débloque l'audio au premier toucher / clic / touche.
export function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (!piano) {
      masterGain = actx.createGain();
      masterGain.gain.value = VOLUME_BOOST * (volumePct / 100);
      masterGain.connect(actx.destination);
      piano = SplendidGrandPiano(actx, { destination: masterGain });
    }
    if (actx.state === "suspended") actx.resume();
  } catch (e) {}
}
// Volume du piano, en % (0 à 200), réglable dans les options
export function setPianoVolume(pct) {
  volumePct = Math.max(0, Math.min(200, pct));
  if (masterGain) masterGain.gain.value = VOLUME_BOOST * (volumePct / 100);
}
// fin du dernier son joué par l'appli (le micro ne l'écoute pas, pour ne pas s'entendre lui-même)
export let soundUntil = 0;
export function beep(m, volume = 0.25) {
  soundUntil = Math.max(soundUntil, performance.now() + 1500);
  try {
    unlockAudio();
    // l'ancien synthé prenait un gain 0-0.25 : on le reporte sur une vélocité MIDI (0-127)
    piano.start({ note: m, velocity: Math.max(1, Math.min(127, Math.round(volume * 400))) });
  } catch (e) {}
}
