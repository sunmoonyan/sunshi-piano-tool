#!/bin/bash
# Sunshi's Piano Tool : lance le serveur local (site + réglages enregistrés sur ce PC)
cd "$(dirname "$0")"
python3 serveur.py 8000
