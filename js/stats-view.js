// Fenêtre "Statistiques" : vue générale, par exercice, par préréglage.

import { allEvents, bySession, summarize, clearStats, loadStats, flush } from "./core/stats.js";
import { lineChart } from "./core/chart.js";
import { store } from "./core/store.js";
import { openAccount } from "./account.js";

const pct = (v) => Math.round(v) + " %";
const sec = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace(".", ",") + " s";
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const view = { tab: "all", period: "30" };

export function setupStatsView({ exercises, presets }) {
  const dialog = document.getElementById("stats-view");
  const body = document.getElementById("stats-body");

  document.getElementById("open-stats").addEventListener("click", async () => {
    flush();
    await loadStats();
    dialog.showModal(); // ouvert d'abord : les graphiques ont besoin de leur largeur
    render();
  });
  document.getElementById("close-stats").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  dialog.querySelectorAll("[data-stats-tab]").forEach((b) =>
    b.addEventListener("click", () => { view.tab = b.dataset.statsTab; render(); }));
  const periodSel = document.getElementById("stats-period");
  let resizeTimer;
  addEventListener("resize", () => {
    if (!dialog.open) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => body.querySelectorAll(".stats-card").forEach((c) => c.drawCharts()), 150);
  });
  periodSel.addEventListener("change", () => { view.period = periodSel.value; render(); });

  const clearBtn = document.getElementById("stats-clear");
  clearBtn.addEventListener("click", async () => {
    if (!clearBtn.dataset.armed) {
      clearBtn.dataset.armed = "1";
      clearBtn.textContent = "Confirmer : tout effacer ?";
      setTimeout(() => { delete clearBtn.dataset.armed; clearBtn.textContent = "Effacer les statistiques"; }, 3000);
      return;
    }
    await clearStats();
    delete clearBtn.dataset.armed;
    clearBtn.textContent = "Effacer les statistiques";
    render();
  });

  function filtered() {
    const days = view.period === "all" ? Infinity : Number(view.period);
    const since = Date.now() - days * 86400000;
    return allEvents().filter((e) => e.t >= since);
  }

  function render() {
    dialog.querySelectorAll("[data-stats-tab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.statsTab === view.tab)));
    periodSel.value = view.period;
    body.replaceChildren();
    const list = filtered();

    if (!store.user) {
      const p = document.createElement("p");
      p.className = "stats-empty";
      p.textContent = "Les statistiques sont gardées dans ton compte. Connecte-toi (ou crée un compte) pour enregistrer tes progrès et les retrouver ici.";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = "Se connecter";
      b.addEventListener("click", () => { dialog.close(); openAccount(); });
      const wrap = document.createElement("div");
      wrap.className = "stats-login";
      wrap.append(p, b);
      body.append(wrap);
      return;
    }

    if (!list.length) {
      const p = document.createElement("p");
      p.className = "stats-empty";
      p.textContent = allEvents().length
        ? "Aucune réponse sur cette période."
        : "Aucune statistique pour l'instant. Active « Stats » à côté du score, puis joue : chaque réponse sera enregistrée.";
      body.append(p);
      return;
    }

    const add = (card) => { body.append(card); card.drawCharts(); };
    if (view.tab === "all") {
      add(block("Toutes les réponses", list, false));
    } else if (view.tab === "exercise") {
      for (const ex of exercises) {
        const items = list.filter((e) => e.ex === ex.id);
        if (items.length) add(block(ex.name, items, true));
      }
    } else if (view.tab === "song") {
      const songs = list.filter((e) => e.s);
      if (!songs.length) {
        const p = document.createElement("p");
        p.className = "stats-empty";
        p.textContent = "Aucun morceau joué sur cette période, avec « Stats » activé.";
        body.append(p);
      }
      const names = {};
      for (const e of songs) names[e.s] = e.sn || names[e.s] || "Morceau";
      const ids = Object.keys(names).sort((a, b) => names[a].localeCompare(names[b], "fr"));
      for (const id of ids) add(block(names[id], songs.filter((e) => e.s === id), true));
    } else {
      const ids = [...new Set(list.map((e) => e.p || ""))];
      const names = Object.fromEntries(presets().map((p) => [p.id, p.name]));
      ids.sort((a, b) => (names[a] || "~").localeCompare(names[b] || "~"));
      for (const id of ids) {
        const name = id === "" ? "Sans préréglage" : names[id] || "Préréglage supprimé";
        add(block(name, list.filter((e) => (e.p || "") === id), true));
      }
    }
  }
}

// Un bloc : chiffres clés + deux graphiques (réussite, rapidité) + tableau
function block(title, items, compact) {
  const sessions = bySession(items);
  const sum = summarize(items);
  const last = sessions[sessions.length - 1];

  const card = document.createElement("section");
  card.className = "stats-card" + (compact ? " compact" : "");
  const h = document.createElement("h3");
  h.textContent = title;
  card.append(h);

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  tiles.append(
    tile("Réussite du 1er coup", pct(sum.rate), sessions.length > 1 ? "Dernière séance : " + pct(last.rate) : ""),
    tile("Temps de réponse moyen", sec(sum.avgSec), sessions.length > 1 ? "Dernière séance : " + sec(last.avgSec) : ""),
    tile("Réponses", String(sum.count), sessions.length + " séance" + (sessions.length > 1 ? "s" : "")),
  );
  card.append(tiles);

  const charts = document.createElement("div");
  charts.className = "charts";
  const rateBox = chartBox("Taux de réussite par séance", "Plus haut = mieux");
  const timeBox = chartBox("Temps de réponse moyen par séance", "Plus bas = plus rapide");
  charts.append(rateBox.box, timeBox.box);
  card.append(charts);
  // dessinés une fois la carte affichée (pour connaître leur largeur)
  card.drawCharts = () => {
    lineChart(rateBox.plot, sessions.map((s) => ({ x: s.start, y: s.rate, count: s.count })), { yMax: 100, format: pct, label: "Taux de réussite par séance", compact });
    lineChart(timeBox.plot, sessions.map((s) => ({ x: s.start, y: s.avgSec, count: s.count })), { format: sec, label: "Temps de réponse moyen par séance", compact });
  };

  // tableau (accessible sans survol)
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Voir le détail des séances";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Séance</th><th>Réponses</th><th>Réussite</th><th>Temps moyen</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for (const s of [...sessions].reverse()) {
    const tr = document.createElement("tr");
    for (const v of [dateFmt.format(s.start), s.count, pct(s.rate), sec(s.avgSec)]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  details.append(summary, wrap);
  card.append(details);
  return card;
}

function tile(label, value, sub) {
  const t = document.createElement("div");
  t.className = "tile";
  const v = document.createElement("strong");
  v.textContent = value;
  const l = document.createElement("span");
  l.textContent = label;
  t.append(v, l);
  if (sub) {
    const s = document.createElement("small");
    s.textContent = sub;
    t.append(s);
  }
  return t;
}

function chartBox(title, hint) {
  const box = document.createElement("figure");
  box.className = "chart-box";
  const cap = document.createElement("figcaption");
  const b = document.createElement("b");
  b.textContent = title;
  const s = document.createElement("span");
  s.textContent = hint;
  cap.append(b, s);
  const plot = document.createElement("div");
  box.append(cap, plot);
  return { box, plot };
}
