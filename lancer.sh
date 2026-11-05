#!/bin/bash
# Sunshi's Piano Tool : lance un petit serveur local pour tester le site
# (le navigateur bloque les modules JS ouverts directement en fichier local)
cd "$(dirname "$0")"
python3 -m http.server 8000
