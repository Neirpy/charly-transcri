#!/bin/bash
cd "$(dirname "$0")"

# Vérifie si l'environnement virtuel existe
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    echo "L'environnement virtuel .venv n'a pas été trouvé."
    echo "Veuillez d'abord installer le projet correctement."
    exit 1
fi

# Lance l'application
python main.py
