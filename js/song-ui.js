// Interface des morceaux : choix du morceau, import d'un fichier MIDI, pistes → mains.
import { songFromMidi, guessHands, keyLabel, bpmOf } from "./core/song.js";
import { listSongs, getSong, saveSong, deleteSong } from "./core/library.js";
import { midiName } from "./core/music.js";

const ROLES = [
  { value: "right", label: "Main droite" },
  { value: "left", label: "Main gauche" },
  { value: "split", label: "Les deux (séparées)" },
  { value: "ignore", label: "Ignorer" },
];

export function setupSongUI({ settings, onSong }) {
  const $ = (id) => document.getElementById(id);
  const pick = $("song-pick"), file = $("song-file"), dialog = $("song-dialog");
  let current = null;     // morceau affiché
  let editing = null;     // morceau dans la fenêtre de configuration
  let isNew = false;

  const midiNameText = (m) => midiName(m, "sharp", true);

  async function refreshList(selectId) {
    const songs = await listSongs();
    pick.replaceChildren(new Option(songs.length ? "Choisir un morceau…" : "Aucun morceau", ""));
    for (const s of songs) pick.append(new Option(s.name, s.id));
    pick.value = songs.some((s) => s.id === selectId) ? selectId : "";
    $("song-config").disabled = !pick.value;
  }

  async function select(id) {
    current = id ? await getSong(id) : null;
    if (settings.get("exercises.midi.songId") !== (current?.id || "")) settings.set("exercises.midi.songId", current?.id || "");
    pick.value = current?.id || "";
    $("song-config").disabled = !current;
    onSong(current);
  }

  pick.addEventListener("change", () => select(pick.value));
  const openFile = () => file.click();
  $("song-import").addEventListener("click", openFile);
  $("song-empty-import").addEventListener("click", openFile);
  $("song-config").addEventListener("click", () => { if (current) openConfig(structuredClone(current), false); });

  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    try {
      const song = songFromMidi(await f.arrayBuffer(), f.name);
      openConfig(song, true);
    } catch (err) {
      showError(err.message || "Impossible de lire ce fichier MIDI.");
    }
  });

  function showError(text) {
    const e = $("song-error");
    e.textContent = text;
    e.hidden = false;
    setTimeout(() => { e.hidden = true; }, 6000);
  }

  // ---------- Fenêtre « Pistes et mains » ----------
  function openConfig(song, fresh) {
    editing = song;
    isNew = fresh;
    $("song-name").value = song.name;
    const bits = [`${bpmOf(song)} à la noire`];
    const ts = song.timeSigs[0];
    if (ts) bits.push(`mesure ${ts.num}/${ts.den}`);
    const k = keyLabel(song);
    if (k) bits.push(k);
    $("song-info").textContent = bits.join(", ");
    $("song-delete").hidden = fresh;
    $("song-save").textContent = fresh ? "Ajouter le morceau" : "Enregistrer";
    renderParts();
    dialog.showModal();
  }

  function renderParts() {
    const box = $("song-parts");
    box.replaceChildren();
    for (const part of editing.parts) {
      const row = document.createElement("div");
      row.className = "part-row";
      const head = document.createElement("div");
      head.className = "part-head";
      const name = document.createElement("strong");
      name.textContent = part.name;
      const meta = document.createElement("span");
      meta.textContent = [part.instrument, `${part.count} notes`, `${midiNameText(part.min)} → ${midiNameText(part.max)}`].filter(Boolean).join(", ");
      head.append(name, meta);
      const seg = document.createElement("div");
      seg.className = "seg";
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", "Main pour " + part.name);
      for (const r of ROLES) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = r.label;
        b.setAttribute("aria-pressed", String(editing.config.hands[part.id] === r.value));
        b.addEventListener("click", () => { editing.config.hands[part.id] = r.value; renderParts(); });
        seg.append(b);
      }
      row.append(head, seg);
      box.append(row);
    }
    // point de séparation si une piste est partagée entre les deux mains
    const anySplit = Object.values(editing.config.hands).includes("split");
    $("song-split-row").hidden = !anySplit;
    if (anySplit) {
      const sel = $("song-split");
      if (!sel.options.length) for (let m = 36; m <= 84; m++) sel.append(new Option(midiNameText(m), m));
      sel.value = editing.config.split;
    }
    const none = !Object.values(editing.config.hands).some((v) => v !== "ignore");
    $("song-save").disabled = none;
    $("song-parts-hint").textContent = none ? "Choisis au moins une piste pour la main droite ou la main gauche." : "";
  }

  $("song-split").addEventListener("change", (e) => { editing.config.split = Number(e.target.value); });
  $("song-guess").addEventListener("click", () => { editing.config.hands = guessHands(editing.parts); renderParts(); });
  $("song-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  $("song-save").addEventListener("click", async () => {
    editing.name = $("song-name").value.trim() || editing.name;
    try {
      await saveSong(editing);
    } catch (err) {
      $("song-parts-hint").textContent = err.message;
      return;
    }
    dialog.close();
    await refreshList(editing.id);
    await select(editing.id);
  });

  const del = $("song-delete");
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = "Confirmer la suppression ?";
      setTimeout(() => { delete del.dataset.armed; del.textContent = "Supprimer le morceau"; }, 3000);
      return;
    }
    delete del.dataset.armed;
    del.textContent = "Supprimer le morceau";
    await deleteSong(editing.id);
    dialog.close();
    await refreshList("");
    await select("");
  });

  return {
    async load() {
      const id = settings.get("exercises.midi.songId") || "";
      await refreshList(id);
      await select(pick.value);
    },
    current: () => current,
  };
}
