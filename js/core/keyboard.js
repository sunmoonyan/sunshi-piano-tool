// Clavier de piano à l'écran.

import { names, degree, octaveOf, midiOf } from "./music.js";

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

// Petit son pour les touches à l'écran
let actx = null;
// Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur :
// on débloque l'audio au premier toucher / clic / touche.
export function unlockAudio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
  } catch (e) {}
}
// fin du dernier son joué par l'appli (le micro ne l'écoute pas, pour ne pas s'entendre lui-même)
export let soundUntil = 0;
export function beep(m, volume = 0.25) {
  soundUntil = Math.max(soundUntil, performance.now() + 700);
  try {
    unlockAudio();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = "triangle";
    o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(t + 0.65);
  } catch (e) {}
}
