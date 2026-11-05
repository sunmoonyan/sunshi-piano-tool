#!/usr/bin/env python3
"""Sunshi's Piano Tool : petit serveur local avec comptes.

- Sert le site sur le réseau local (port 8000 par défaut).
- Comptes ultra simples : pseudo + mot de passe (stocké haché, jamais en clair).
- Chaque compte a ses réglages, préréglages et statistiques dans data/users/<pseudo>/.
- Sans compte, on peut jouer librement mais rien n'est enregistré.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")
USERS_DIR = os.path.join(DATA_DIR, "users")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
MAX_BODY = 12 * 1024 * 1024  # un gros morceau MIDI peut peser quelques Mo
SONG_RE = re.compile(r"^s[a-z0-9]{4,40}$")
SESSION_DAYS = 30
COOKIE = "spt_session"
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{3,20}$")
PBKDF2_ITERS = 200_000

lock = threading.Lock()
failures = {}  # ip -> [horodatages des échecs de connexion]


# ---------- fichiers ----------
def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def user_dir(uid):
    return os.path.join(USERS_DIR, uid)


def songs_dir(uid):
    return os.path.join(user_dir(uid), "songs")


def song_route(route):
    """/api/songs/<id> -> id valide, sinon None"""
    if not route.startswith("/api/songs/"):
        return None
    sid = route[len("/api/songs/"):]
    return sid if SONG_RE.match(sid) else None


# ---------- mots de passe et sessions ----------
def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERS).hex()
    return salt, digest


def new_session(uid):
    token = secrets.token_urlsafe(32)
    with lock:
        sessions = read_json(SESSIONS_FILE, {})
        now = time.time()
        sessions = {t: s for t, s in sessions.items() if s.get("exp", 0) > now}
        sessions[token] = {"user": uid, "exp": now + SESSION_DAYS * 86400}
        write_json(SESSIONS_FILE, sessions)
    return token


def too_many_failures(ip):
    now = time.time()
    recent = [t for t in failures.get(ip, []) if now - t < 60]
    failures[ip] = recent
    return len(recent) >= 5


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- utilitaires ---
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, code, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("taille")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _token(self):
        cookie = SimpleCookie(self.headers.get("Cookie") or "")
        return cookie[COOKIE].value if COOKIE in cookie else None

    def _user(self):
        """Pseudo (identifiant) du compte connecté, ou None."""
        token = self._token()
        if not token:
            return None
        s = read_json(SESSIONS_FILE, {}).get(token)
        if not s or s.get("exp", 0) < time.time():
            return None
        return s["user"]

    def _session_cookie(self, token, max_age):
        return f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"

    def _route(self):
        return self.path.split("?")[0]

    # --- GET ---
    def do_GET(self):
        route = self._route()
        if route == "/api/me":
            uid = self._user()
            users = read_json(USERS_FILE, {})
            return self._json(200, {"user": users.get(uid, {}).get("name") if uid else None})
        if route == "/api/state":
            uid = self._user()
            if not uid:
                return self._json(401, {"error": "Connexion requise"})
            return self._json(200, read_json(os.path.join(user_dir(uid), "state.json"), {}))
        if route == "/api/stats":
            uid = self._user()
            if not uid:
                return self._json(401, {"error": "Connexion requise"})
            events = []
            try:
                with open(os.path.join(user_dir(uid), "stats.jsonl"), encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                events.append(json.loads(line))
                            except ValueError:
                                pass
            except FileNotFoundError:
                pass
            return self._json(200, events)
        if route == "/api/songs" or route.startswith("/api/songs/"):
            uid = self._user()
            if not uid:
                return self._json(401, {"error": "Connexion requise"})
            if route == "/api/songs":
                return self._json(200, read_json(os.path.join(songs_dir(uid), "index.json"), []))
            sid = song_route(route)
            song = read_json(os.path.join(songs_dir(uid), f"{sid}.json"), None) if sid else None
            return self._json(200, song) if song else self._json(404, {"error": "Morceau introuvable"})
        if route.startswith("/data") or route.endswith(".py") or route.startswith("/__pycache__"):
            return self.send_error(404)
        return super().do_GET()

    # --- POST ---
    def do_POST(self):
        route = self._route()
        ip = self.client_address[0]

        if route in ("/api/register", "/api/login"):
            if too_many_failures(ip):
                return self._json(429, {"error": "Trop d'essais. Attends une minute."})
            try:
                data = self._body()
                name = str(data.get("username", "")).strip()
                password = str(data.get("password", ""))
            except (ValueError, AttributeError):
                return self._json(400, {"error": "Requête invalide"})
            uid = name.lower()

            if route == "/api/register":
                if not NAME_RE.match(name):
                    return self._json(400, {"error": "Pseudo : 3 à 20 caractères (lettres, chiffres, - ou _)."})
                if len(password) < 4:
                    return self._json(400, {"error": "Mot de passe : au moins 4 caractères."})
                with lock:
                    users = read_json(USERS_FILE, {})
                    if uid in users:
                        return self._json(409, {"error": "Ce pseudo est déjà pris."})
                    salt, digest = hash_password(password)
                    first_account = not users
                    users[uid] = {"name": name, "salt": salt, "hash": digest, "created": int(time.time())}
                    write_json(USERS_FILE, users)
                    os.makedirs(user_dir(uid), exist_ok=True)
                    # premier compte : il récupère les réglages / stats enregistrés avant les comptes
                    if first_account:
                        for old, new in (("state.json", "state.json"), ("stats.jsonl", "stats.jsonl")):
                            src = os.path.join(DATA_DIR, old)
                            if os.path.exists(src):
                                shutil.move(src, os.path.join(user_dir(uid), new))
            else:
                users = read_json(USERS_FILE, {})
                user = users.get(uid)
                ok = False
                if user:
                    _, digest = hash_password(password, user["salt"])
                    ok = hmac.compare_digest(digest, user["hash"])
                else:
                    hash_password(password)  # même durée, qu'il existe ou non
                if not ok:
                    failures.setdefault(ip, []).append(time.time())
                    return self._json(401, {"error": "Pseudo ou mot de passe incorrect."})
                name = user["name"]

            token = new_session(uid)
            return self._json(200, {"user": name}, cookie=self._session_cookie(token, SESSION_DAYS * 86400))

        if route == "/api/logout":
            token = self._token()
            if token:
                with lock:
                    sessions = read_json(SESSIONS_FILE, {})
                    sessions.pop(token, None)
                    write_json(SESSIONS_FILE, sessions)
            return self._json(200, {"ok": True}, cookie=self._session_cookie("", 0))

        if route == "/api/stats":
            uid = self._user()
            if not uid:
                return self._json(401, {"error": "Connexion requise"})
            try:
                events = self._body()
                if not isinstance(events, list):
                    raise ValueError
            except ValueError:
                return self._json(400, {"error": "Requête invalide"})
            os.makedirs(user_dir(uid), exist_ok=True)
            with lock, open(os.path.join(user_dir(uid), "stats.jsonl"), "a", encoding="utf-8") as f:
                for ev in events:
                    if isinstance(ev, dict):
                        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
            return self._json(200, {"ok": True})

        return self.send_error(404)

    # --- PUT : réglages + préréglages du compte ---
    def do_PUT(self):
        sid = song_route(self._route())
        if sid:
            return self._put_song(sid)
        if self._route() != "/api/state":
            return self.send_error(404)
        uid = self._user()
        if not uid:
            return self._json(401, {"error": "Connexion requise"})
        try:
            data = self._body()
            if not isinstance(data, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "Requête invalide"})
        with lock:
            write_json(os.path.join(user_dir(uid), "state.json"), data)
        return self._json(200, {"ok": True})

    # --- morceaux MIDI du compte ---
    def _put_song(self, sid):
        uid = self._user()
        if not uid:
            return self._json(401, {"error": "Connexion requise"})
        try:
            song = self._body()
            if not isinstance(song, dict) or song.get("id") != sid:
                raise ValueError
        except ValueError:
            return self._json(400, {"error": "Requête invalide"})
        with lock:
            write_json(os.path.join(songs_dir(uid), f"{sid}.json"), song)
            index = [s for s in read_json(os.path.join(songs_dir(uid), "index.json"), []) if s.get("id") != sid]
            notes = sum(int(p.get("count", 0)) for p in song.get("parts", []) if isinstance(p, dict))
            index.append({"id": sid, "name": str(song.get("name", "Morceau"))[:120], "notes": notes})
            write_json(os.path.join(songs_dir(uid), "index.json"), index)
        return self._json(200, {"ok": True})

    # --- DELETE : effacer ses statistiques ou un morceau ---
    def do_DELETE(self):
        sid = song_route(self._route())
        if sid:
            uid = self._user()
            if not uid:
                return self._json(401, {"error": "Connexion requise"})
            with lock:
                try:
                    os.remove(os.path.join(songs_dir(uid), f"{sid}.json"))
                except FileNotFoundError:
                    pass
                index = [s for s in read_json(os.path.join(songs_dir(uid), "index.json"), []) if s.get("id") != sid]
                write_json(os.path.join(songs_dir(uid), "index.json"), index)
            return self._json(200, {"ok": True})
        if self._route() != "/api/stats":
            return self.send_error(404)
        uid = self._user()
        if not uid:
            return self._json(401, {"error": "Connexion requise"})
        try:
            os.remove(os.path.join(user_dir(uid), "stats.jsonl"))
        except FileNotFoundError:
            pass
        return self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        pass  # terminal silencieux


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "IP-du-PC"


if __name__ == "__main__":
    os.makedirs(USERS_DIR, exist_ok=True)
    print()
    print("  Sunshi's Piano Tool")
    print(f"  Sur ce PC        : http://localhost:{PORT}")
    print(f"  Sur le téléphone : http://{local_ip()}:{PORT}")
    print(f"  Comptes : {len(read_json(USERS_FILE, {}))}  (données dans data/)")
    print()
    print("  (Ctrl+C pour arrêter)")
    try:
        ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n  Arrêté.")
