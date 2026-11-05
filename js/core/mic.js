// Entrée micro : détecte la note jouée sur un piano acoustique (une note à la fois).
// Méthode : algorithme YIN (autocorrélation normalisée) ~40 fois par seconde,
// puis une petite logique d'attaque : une note est validée quand la même hauteur est stable
// sur 3 mesures ; une même note rejouée est détectée par la remontée du volume.

const BUF = 2048;
const FMIN = 50, FMAX = 1600;        // ~sol1 → sol6
const YIN_THRESHOLD = 0.15;
const STABLE_FRAMES = 3;

export class MicInput {
  constructor({ onNoteOn, onNoteOff, onStatus, ignoreUntil = () => 0 }) {
    Object.assign(this, { onNoteOn, onNoteOff, onStatus, ignoreUntil });
    this.active = null;
    this.running = false;
  }

  get supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  async start() {
    if (!this.supported) {
      this.onStatus({ state: "err", text: "Micro indisponible : il faut Chrome en https:// ou localhost." });
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      this.onStatus({ state: "err", text: "Accès au micro refusé. Autorise le micro pour ce site dans le navigateur." });
      return false;
    }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    const hp = this.ctx.createBiquadFilter();       // coupe les grondements graves
    hp.type = "highpass";
    hp.frequency.value = 40;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = BUF;
    src.connect(hp).connect(this.analyser);
    this.buf = new Float32Array(BUF);
    this.diff = new Float32Array(BUF / 2);
    Object.assign(this, { noise: 0.004, cand: null, count: 0, miss: 0, peak: 0, trough: 1, armed: false, active: null });
    this.running = true;
    this.timer = setInterval(() => this.frame(), 25);
    this.onStatus({ state: "on", text: "Micro activé : joue une note à la fois." });
    return true;
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    if (this.active != null) { this.onNoteOff(this.active); this.active = null; }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.onStatus({ state: "off", text: "" });
  }

  frame() {
    const x = this.buf;
    this.analyser.getFloatTimeDomainData(x);
    let rms = 0;
    for (let i = 0; i < x.length; i++) rms += x[i] * x[i];
    rms = Math.sqrt(rms / x.length);

    // pendant que l'appli joue elle-même un son, on n'écoute pas (sinon elle s'entendrait)
    const muted = performance.now() < this.ignoreUntil();
    const gate = !muted && rms > Math.max(0.01, this.noise * 4);
    let midi = null;
    if (gate) {
      const r = yin(x, this.ctx.sampleRate, this.diff);
      if (r && r.conf > 0.8) midi = Math.round(69 + 12 * Math.log2(r.freq / 440));
    } else {
      this.noise = this.noise * 0.95 + rms * 0.05; // bruit de fond de la pièce
    }

    if (midi == null) {
      this.count = 0;
      this.cand = null;
      if (++this.miss >= 4 && this.active != null) { this.onNoteOff(this.active); this.active = null; }
      return;
    }
    this.miss = 0;
    if (midi === this.cand) this.count++; else { this.cand = midi; this.count = 1; }
    if (this.count < STABLE_FRAMES) return;

    if (midi !== this.active) {
      if (this.active != null) this.onNoteOff(this.active);
      this.active = midi;
      this.peak = rms; this.trough = rms; this.armed = false;
      this.onNoteOn(midi);
      return;
    }
    // même note : rejouée si le son était retombé puis remonte nettement
    this.peak = Math.max(this.peak, rms);
    if (rms < this.peak * 0.45) { this.armed = true; this.trough = Math.min(this.trough, rms); }
    if (this.armed && rms > this.trough * 2.2) {
      this.onNoteOff(midi);
      this.onNoteOn(midi);
      this.peak = rms; this.trough = rms; this.armed = false;
    }
  }
}

// YIN : renvoie { freq, conf } ou null
function yin(x, sr, d) {
  const tauMin = Math.floor(sr / FMAX), tauMax = Math.min(Math.floor(sr / FMIN), d.length - 1);
  const W = x.length - tauMax;
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const v = x[j] - x[j + tau]; s += v * v; }
    running += s;
    d[tau] = running ? (s * tau) / running : 1;   // différence moyenne normalisée
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < YIN_THRESHOLD) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // interpolation parabolique pour une hauteur plus précise
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const den = a + c - 2 * b;
  const shift = den ? (a - c) / (2 * den) : 0;
  return { freq: sr / (tau + shift), conf: 1 - b };
}
