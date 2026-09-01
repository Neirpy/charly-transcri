#!/bin/bash
cd "$(dirname "$0")"

# Vérifie si l'environnement virtuel existe
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    echo "Création de l'environnement virtuel..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
fi

# Lance le serveur PWA
echo "Lancement du serveur Charly Transcri PWA..."
python server.py
