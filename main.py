#!/usr/bin/env python3
"""
Charly Transcri - Point d'entrée principal.
Lance le serveur PWA moderne et ouvre automatiquement l'application dans le navigateur.
"""

import sys
import os
import time
import threading
import webbrowser
from pathlib import Path

# S'assurer que le répertoire racine est dans sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

import server

def open_browser(url: str):
    """Attend 1 seconde que le serveur démarre et ouvre le navigateur."""
    time.sleep(1.2)
    print(f"\n🌐 Ouverture automatique de l'application dans votre navigateur : {url}")
    webbrowser.open(url)

if __name__ == "__main__":
    # Support des arguments
    use_ssl = "--ssl" in sys.argv or os.environ.get("USE_SSL", "0") in ("1", "true", "True")
    port = int(os.environ.get("PORT", 8000))
    protocol = "https" if use_ssl else "http"
    local_url = f"{protocol}://localhost:{port}"

    # Lancer l'ouverture automatique du navigateur dans un thread séparé
    threading.Thread(target=open_browser, args=(local_url,), daemon=True).start()

    # Démarrer le serveur
    server.main()