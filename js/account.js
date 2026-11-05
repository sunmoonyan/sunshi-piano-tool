// Fenêtre "Compte" : se connecter, créer un compte, se déconnecter.
import { store } from "./core/store.js";
import { flush } from "./core/stats.js";

let openFn = null;

// Ouvre la fenêtre de compte, avec un message facultatif (ex. "Connecte-toi pour …")
export function openAccount(message = "") { openFn && openFn(message); }

export function setupAccount() {
  const dialog = document.getElementById("account");
  const btn = document.getElementById("open-account");
  const label = document.getElementById("account-label");
  const form = document.getElementById("account-form");
  const connected = document.getElementById("account-connected");
  const msg = document.getElementById("account-msg");
  const error = document.getElementById("account-error");
  const submit = document.getElementById("account-submit");
  const nameInput = document.getElementById("account-name");
  const passInput = document.getElementById("account-pass");
  let mode = "login";

  label.textContent = store.user || "Se connecter";
  btn.classList.toggle("signed-in", !!store.user);
  btn.setAttribute("aria-label", store.user ? "Compte : " + store.user : "Se connecter");

  const setMode = (m) => {
    mode = m;
    dialog.querySelectorAll("[data-account-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.accountMode === m)));
    submit.textContent = m === "login" ? "Se connecter" : "Créer mon compte";
    passInput.autocomplete = m === "login" ? "current-password" : "new-password";
    error.textContent = "";
  };
  dialog.querySelectorAll("[data-account-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.accountMode)));

  openFn = (message) => {
    msg.textContent = message;
    msg.hidden = !message;
    form.hidden = !!store.user;
    connected.hidden = !store.user;
    document.getElementById("account-who").textContent = store.user || "";
    error.textContent = "";
    setMode("login");
    dialog.showModal();
    if (!store.user) nameInput.focus();
  };
  btn.addEventListener("click", () => openAccount());
  document.getElementById("close-account").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    try {
      await store.login(nameInput.value.trim(), passInput.value, mode === "create");
      location.reload(); // recharge avec les réglages, préréglages et stats du compte
    } catch (err) {
      error.textContent = err.message;
      submit.disabled = false;
    }
  });

  document.getElementById("account-logout").addEventListener("click", async () => {
    flush();
    await store.logout();
    location.reload();
  });
}
