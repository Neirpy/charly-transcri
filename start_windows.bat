@echo off
cd /d "%~dp0"

IF EXIST ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
    python main.py
) ELSE (
    echo L'environnement virtuel .venv n'a pas été trouvé.
    echo Veuillez d'abord installer le projet correctement.
    pause
)
