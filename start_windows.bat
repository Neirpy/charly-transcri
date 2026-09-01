@echo off
cd /d "%~dp0"

IF EXIST ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) ELSE (
    echo Création de l'environnement virtuel .venv...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
)

echo Lancement du serveur Charly Transcri PWA...
python server.py
pause
