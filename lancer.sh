#!/bin/bash
# Sunshi's Piano Tool : lance un petit serveur local pour tester le site
# (le navigateur bloque les modules JS ouverts directement en fichier local)
cd "$(dirname "$0")"
python3 -c '
import http.server
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
http.server.ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
'
