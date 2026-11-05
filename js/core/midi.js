// Entrée MIDI (Web MIDI). Appelle onNoteOn(note) / onNoteOff(note) et onStatus({ state, text }).

export class MidiInput {
  constructor({ onNoteOn, onNoteOff, onStatus }) {
    Object.assign(this, { onNoteOn, onNoteOff, onStatus });
  }

  get supported() { return typeof navigator.requestMIDIAccess === "function"; }

  connect() {
    if (!this.supported) {
      this.onStatus({ state: "err", text: "Ce navigateur ne gère pas le MIDI (utilise Chrome en https:// ou localhost). Le clavier à l'écran fonctionne." });
      return;
    }
    navigator.requestMIDIAccess().then(
      (access) => {
        this.access = access;
        this.refresh();
        access.onstatechange = () => this.refresh();
      },
      () => this.onStatus({ state: "err", text: "Accès MIDI refusé. Autorise le MIDI pour ce site dans les réglages du navigateur." })
    );
  }

  refresh() {
    const names = [];
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (ev) => this.handle(ev.data);
      names.push(input.name);
    });
    if (names.length) this.onStatus({ state: "on", text: "Connecté : " + names.join(", ") });
    else this.onStatus({ state: "off", text: "Aucun clavier MIDI détecté. Branche-le, il sera reconnu automatiquement." });
  }

  handle([status, note, vel]) {
    const type = status & 0xf0;
    if (type === 0x90 && vel > 0) this.onNoteOn(note);
    else if (type === 0x80 || (type === 0x90 && vel === 0)) this.onNoteOff(note);
  }
}
