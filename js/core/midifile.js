// Lecture d'un fichier MIDI standard (.mid) — formats 0 et 1.
// Renvoie {
//   ppq, tracks: [{ index, name, channels:[...], program, notes:[{ midi, tick, dur, vel, ch }] }],
//   tempos: [{ tick, uspq }], timeSigs: [{ tick, num, den }], keySig: { sf, minor } | null, endTick
// }

export function parseMidi(buffer) {
  const data = new DataView(buffer);
  let p = 0;
  const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(data.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = data.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = data.getUint16(p); p += 2; return v; };

  if (buffer.byteLength < 14 || str(4) !== "MThd") throw new Error("Ce fichier n'est pas un fichier MIDI.");
  const headerLen = u32();
  const format = u16();
  const ntracks = u16();
  const division = u16();
  p = 8 + headerLen;
  if (division & 0x8000) throw new Error("Ce fichier MIDI utilise un minutage SMPTE, non pris en charge.");
  if (format > 1) throw new Error("Format MIDI 2 non pris en charge.");
  const ppq = division;

  const tracks = [], tempos = [], timeSigs = [];
  let keySig = null, endTick = 0;
  const decoder = new TextDecoder("latin1");

  for (let t = 0; t < ntracks && p + 8 <= buffer.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = Math.min(p + len, buffer.byteLength);
    if (id !== "MTrk") { p = end; t--; continue; }

    const track = { index: tracks.length, name: "", channels: new Set(), programs: {}, notes: [] };
    const open = new Map(); // "ch:note" -> [note en cours, ...]
    let tick = 0, status = 0;

    const vlq = () => { let v = 0, b; do { b = data.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };

    while (p < end) {
      tick += vlq();
      let b = data.getUint8(p);
      if (b & 0x80) { status = b; p++; } else if (!status) { p++; continue; } // statut implicite (running status)
      const type = status & 0xf0, ch = status & 0x0f;

      if (status === 0xff) {                 // méta-événement
        const metaType = data.getUint8(p++);
        const mlen = vlq();
        const start = p;
        if (metaType === 0x03 && !track.name) track.name = decoder.decode(new Uint8Array(buffer, start, mlen)).trim();
        else if (metaType === 0x51 && mlen === 3) tempos.push({ tick, uspq: (data.getUint8(start) << 16) | (data.getUint8(start + 1) << 8) | data.getUint8(start + 2) });
        else if (metaType === 0x58 && mlen >= 2) timeSigs.push({ tick, num: data.getUint8(start), den: 2 ** data.getUint8(start + 1) });
        else if (metaType === 0x59 && mlen === 2 && !keySig) keySig = { sf: data.getInt8(start), minor: data.getUint8(start + 1) === 1 };
        p = start + mlen;
        status = 0; // pas de statut implicite après un méta
      } else if (status === 0xf0 || status === 0xf7) { // sysex
        const slen = vlq();
        p += slen;
        status = 0;
      } else if (type === 0x90 || type === 0x80) {
        const note = data.getUint8(p++), vel = data.getUint8(p++);
        const key = ch + ":" + note;
        if (type === 0x90 && vel > 0) {
          const n = { midi: note, tick, dur: 0, vel, ch };
          track.notes.push(n);
          track.channels.add(ch);
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(n);
        } else {
          const list = open.get(key);
          if (list && list.length) { const n = list.shift(); n.dur = Math.max(1, tick - n.tick); }
        }
      } else if (type === 0xc0) {
        const prog = data.getUint8(p++);
        if (track.programs[ch] == null) track.programs[ch] = prog;
      } else if (type === 0xd0) {
        p += 1;
      } else {                                // 0xA0, 0xB0, 0xE0 : deux octets
        p += 2;
      }
      endTick = Math.max(endTick, tick);
    }
    // notes jamais relâchées : durée d'une noire
    for (const list of open.values()) for (const n of list) if (!n.dur) n.dur = ppq;
    track.channels = [...track.channels];
    tracks.push(track);
    p = end;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, uspq: 500000 }); // 120 bpm par défaut
  timeSigs.sort((a, b) => a.tick - b.tick);
  if (!timeSigs.length || timeSigs[0].tick > 0) timeSigs.unshift({ tick: 0, num: 4, den: 4 });

  return { ppq, tracks, tempos, timeSigs, keySig, endTick };
}

// Nom court d'un instrument General MIDI (familles de 8)
const FAMILIES = ["Piano", "Percussions chromatiques", "Orgue", "Guitare", "Basse", "Cordes", "Ensemble", "Cuivres",
  "Anches", "Flûtes", "Synthé (lead)", "Synthé (nappe)", "Effets synthé", "Instrument ethnique", "Percussions", "Effets sonores"];
export function instrumentName(track, ch) {
  if (ch === 9) return "Batterie";
  const prog = track.programs[ch];
  return prog == null ? "" : FAMILIES[Math.floor(prog / 8)] || "";
}
