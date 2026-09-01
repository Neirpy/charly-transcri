#!/usr/bin/env python3
"""
Charly Transcri - Backend Server (FastAPI + WebSockets)
Relais audio temps réel vers Google Gemini Live API / Vosk Local pour PWA Accessible.
"""

import os
import sys
import json
import socket
import asyncio
import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Charger les variables d'environnement (.env)
load_dotenv()

# Chemins de base
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TRANSCRIPTIONS_DIR = BASE_DIR / "transcriptions"
MODEL_DIR = BASE_DIR / "model" / "vosk-model-fr-0.22"

TRANSCRIPTIONS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# Google GenAI
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
DEFAULT_GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash-exp")

# Modèle Vosk (chargé à la demande pour un démarrage instantané)
_vosk_model = None

def get_vosk_model():
    global _vosk_model
    if _vosk_model is None and MODEL_DIR.exists():
        try:
            from vosk import Model as VoskModel
            print(f"Chargement du modèle local Vosk depuis {MODEL_DIR}...")
            _vosk_model = VoskModel(str(MODEL_DIR))
            print("Modèle Vosk prêt.")
        except Exception as e:
            print(f"⚠️ Erreur lors du chargement de Vosk : {e}")
    return _vosk_model

# Initialisation FastAPI
app = FastAPI(title="Charly Transcri API", version="2.0.0")


def get_local_ip() -> str:
    """Récupère l'adresse IP locale du serveur pour faciliter la connexion depuis l'iPad."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Ne crée pas de connexion réelle mais permet d'identifier l'interface locale
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/api/status")
async def get_status():
    """Renvoie l'état du serveur et les moteurs de transcription disponibles."""
    has_gemini = bool(GEMINI_API_KEY)
    has_vosk = MODEL_DIR.exists()
    local_ip = get_local_ip()

    return {
        "status": "online",
        "has_gemini": has_gemini,
        "has_vosk": has_vosk,
        "default_engine": "gemini" if has_gemini else ("vosk" if has_vosk else "webspeech"),
        "local_ip": local_ip,
        "port": int(os.environ.get("PORT", 8000)),
        "network_url": f"http://{local_ip}:{os.environ.get('PORT', 8000)}",
    }


@app.post("/api/save")
async def save_transcription(data: dict):
    """Sauvegarde une transcription côté serveur dans le dossier transcriptions/."""
    try:
        text = data.get("text", "").strip()
        if not text:
            return {"status": "error", "message": "Texte vide"}
        
        now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        filename = f"transcription_{now}.txt"
        file_path = TRANSCRIPTIONS_DIR / filename
        
        file_path.write_text(text, encoding="utf-8")
        return {"status": "success", "filename": filename, "path": str(file_path)}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def handle_gemini_transcription(websocket: WebSocket, sample_rate: int = 16000):
    """Gère la transcription en temps réel avec l'API Google Gemini Live."""
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        await websocket.send_json({
            "type": "error",
            "message": "Clé GEMINI_API_KEY non configurée sur le serveur. Veuillez définir la variable dans .env."
        })
        return

    client = genai.Client(
        http_options={"api_version": "v1beta"},
        api_key=api_key,
    )

    system_prompt = (
        "Tu es un transcripteur vocal en direct ultra-rapide et précis, conçu pour accompagner "
        "une personne sourde ou malentendante. "
        "Règles strictes : "
        "1. Transcris fidèlement la parole en direct en français (ou la langue parlée). "
        "2. Ajoute une ponctuation et des majuscules claires et naturelles. "
        "3. Ne réponds JAMAIS aux questions posées, ne fais aucun commentaire, ne génère QUE la transcription mot à mot. "
        "4. Ignore les bruits de fond et les hésitations parasites."
    )

    config = types.LiveConnectConfig(
        response_modalities=["TEXT"],
        system_instruction=types.Content(
            parts=[types.Part.from_text(text=system_prompt)]
        ),
    )

    model_name = DEFAULT_GEMINI_MODEL

    await websocket.send_json({
        "type": "info",
        "message": f"Connexion à Google Gemini ({model_name})..."
    })

    audio_queue: asyncio.Queue[bytes] = asyncio.Queue()
    stop_event = asyncio.Event()

    async def receive_from_browser():
        try:
            while not stop_event.is_set():
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    await audio_queue.put(message["bytes"])
                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    if data.get("type") == "stop":
                        stop_event.set()
                        break
        except WebSocketDisconnect:
            stop_event.set()
        except Exception as e:
            stop_event.set()

    async def send_to_gemini(session):
        try:
            while not stop_event.is_set():
                try:
                    data = await asyncio.wait_for(audio_queue.get(), timeout=0.1)
                    # Envoi du chunk PCM 16kHz vers Gemini Live
                    await session.send(
                        input={"data": data, "mime_type": f"audio/pcm;rate={sample_rate}"}
                    )
                except asyncio.TimeoutError:
                    continue
        except Exception as e:
            pass

    async def receive_from_gemini(session):
        try:
            accumulated_sentence = ""
            while not stop_event.is_set():
                turn = session.receive()
                async for response in turn:
                    if stop_event.is_set():
                        break

                    # Texte partiel ou final reçu de Gemini
                    if response.text:
                        text_chunk = response.text
                        accumulated_sentence += text_chunk
                        await websocket.send_json({
                            "type": "delta",
                            "text": text_chunk,
                            "full_current": accumulated_sentence
                        })
                    
                    if response.server_content and response.server_content.turn_complete:
                        if accumulated_sentence.strip():
                            now_str = datetime.datetime.now().strftime("%H:%M:%S")
                            await websocket.send_json({
                                "type": "final",
                                "text": accumulated_sentence.strip(),
                                "timestamp": now_str
                            })
                            accumulated_sentence = ""
        except Exception as e:
            if not stop_event.is_set():
                await websocket.send_json({
                    "type": "error",
                    "message": f"Erreur de flux Gemini : {str(e)}"
                })

    try:
        async with client.aio.live.connect(model=model_name, config=config) as session:
            await websocket.send_json({
                "type": "ready",
                "engine": "gemini",
                "model": model_name,
                "message": "Gemini Live prêt. Parlez au micro..."
            })
            
            browser_task = asyncio.create_task(receive_from_browser())
            send_task = asyncio.create_task(send_to_gemini(session))
            receive_task = asyncio.create_task(receive_from_gemini(session))

            done, pending = await asyncio.wait(
                [browser_task, send_task, receive_task],
                return_when=asyncio.FIRST_COMPLETED
            )
            
            stop_event.set()
            for task in pending:
                task.cancel()
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": f"Impossible d'établir la session Gemini Live : {str(e)}"
        })


async def handle_vosk_transcription(websocket: WebSocket, sample_rate: int = 16000):
    """Gère la transcription locale avec Vosk."""
    model = get_vosk_model()
    if model is None:
        await websocket.send_json({
            "type": "error",
            "message": "Modèle Vosk non installé sur le serveur (dossier ./model/vosk-model-fr-0.22 manquant)."
        })
        return

    from vosk import KaldiRecognizer
    recognizer = KaldiRecognizer(model, sample_rate)
    recognizer.SetWords(True)

    await websocket.send_json({
        "type": "ready",
        "engine": "vosk",
        "message": "Moteur Vosk local prêt. Parlez au micro..."
    })

    try:
        while True:
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                data = message["bytes"]
                if recognizer.AcceptWaveform(data):
                    res = json.loads(recognizer.Result())
                    text = res.get("text", "").strip()
                    if text:
                        now_str = datetime.datetime.now().strftime("%H:%M:%S")
                        await websocket.send_json({
                            "type": "final",
                            "text": text,
                            "timestamp": now_str
                        })
                else:
                    partial = json.loads(recognizer.PartialResult())
                    p_text = partial.get("partial", "").strip()
                    if p_text:
                        await websocket.send_json({
                            "type": "partial",
                            "text": p_text
                        })
            elif "text" in message and message["text"]:
                data = json.loads(message["text"])
                if data.get("type") == "stop":
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": f"Erreur Vosk : {str(e)}"
        })


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """Point d'entrée WebSocket pour le flux audio streaming."""
    await websocket.accept()
    
    try:
        # Premier message attendu : configuration
        init_message = await websocket.receive_text()
        init_data = json.loads(init_message)
        
        engine = init_data.get("engine", "auto")
        sample_rate = int(init_data.get("sample_rate", 16000))
        
        # Déterminer le moteur
        if engine == "auto":
            if GEMINI_API_KEY:
                engine = "gemini"
            elif MODEL_DIR.exists():
                engine = "vosk"
            else:
                engine = "webspeech"

        if engine == "gemini":
            await handle_gemini_transcription(websocket, sample_rate)
        elif engine == "vosk":
            await handle_vosk_transcription(websocket, sample_rate)
        elif engine == "webspeech":
            await websocket.send_json({
                "type": "ready",
                "engine": "webspeech",
                "message": "Mode Web Speech API (reconnaissance native du navigateur)."
            })
            # Pour Web Speech API, tout se passe côté client, on maintient la connexion
            while True:
                msg = await websocket.receive_text()
                # Écho / keep-alive
                await websocket.send_json({"type": "ping", "data": msg})
        else:
            await websocket.send_json({
                "type": "error",
                "message": f"Moteur inconnu: {engine}"
            })
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# Montage des fichiers statiques de la PWA (compatible chemins / et /static)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
if (STATIC_DIR / "css").exists():
    app.mount("/css", StaticFiles(directory=str(STATIC_DIR / "css")), name="css")
if (STATIC_DIR / "js").exists():
    app.mount("/js", StaticFiles(directory=str(STATIC_DIR / "js")), name="js")
if (STATIC_DIR / "icons").exists():
    app.mount("/icons", StaticFiles(directory=str(STATIC_DIR / "icons")), name="icons")


@app.get("/")
async def serve_index():
    """Sert la page d'accueil de la PWA."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return HTMLResponse("<h1>Charly Transcri - Fichiers de la PWA en cours de création...</h1>")


@app.get("/manifest.json")
async def serve_manifest():
    """Sert le manifest PWA à la racine pour compatibilité standard."""
    return FileResponse(str(STATIC_DIR / "manifest.json"), media_type="application/manifest+json")


@app.get("/service-worker.js")
async def serve_sw():
    """Sert le Service Worker à la racine pour avoir le scope '/' complet."""
    return FileResponse(str(STATIC_DIR / "service-worker.js"), media_type="application/javascript")


def generate_self_signed_cert(cert_path: Path, key_path: Path, hostname: str = "localhost"):
    """Génère un certificat SSL auto-signé pour activer HTTPS en réseau local."""
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        import ipaddress

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        key_path.write_bytes(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            )
        )

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "FR"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Charly Transcri"),
            x509.NameAttribute(NameOID.COMMON_NAME, hostname),
        ])

        # Support IP locale et localhost dans les noms alternatifs (SAN)
        alt_names = [x509.DNSName("localhost"), x509.DNSName(hostname)]
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(hostname)))
        except ValueError:
            pass

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
            .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
            .sign(key, hashes.SHA256())
        )

        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        print(f"✓ Certificat SSL auto-signé généré : {cert_path}")
        return True
    except Exception as e:
        print(f"⚠️ Impossible de générer le certificat SSL : {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Charly Transcri - Serveur Web PWA")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)), help="Port d'écoute")
    parser.add_argument("--host", type=str, default=os.environ.get("HOST", "0.0.0.0"), help="Hôte d'écoute")
    parser.add_argument("--ssl", action="store_true", help="Activer HTTPS avec certificat auto-signé")
    args = parser.parse_args()

    port = args.port
    host = args.host
    use_ssl = args.ssl or os.environ.get("USE_SSL", "0") in ("1", "true", "True")
    local_ip = get_local_ip()

    ssl_certfile = None
    ssl_keyfile = None

    if use_ssl:
        cert_dir = BASE_DIR / ".ssl"
        cert_dir.mkdir(exist_ok=True)
        cert_file = cert_dir / "cert.pem"
        key_file = cert_dir / "key.pem"

        if not cert_file.exists() or not key_file.exists():
            generate_self_signed_cert(cert_file, key_file, local_ip)

        if cert_file.exists() and key_file.exists():
            ssl_certfile = str(cert_file)
            ssl_keyfile = str(key_file)

    protocol = "https" if ssl_certfile else "http"
    
    print("=" * 65)
    print("🚀  CHARLY TRANSCRI - Progressive Web App (PWA) Temps Réel")
    print("=" * 65)
    print(f"💻 Accès PC local  : {protocol}://localhost:{port}")
    print(f"📱 Accès iPad (Wi-Fi): {protocol}://{local_ip}:{port}")
    print("-" * 65)
    if GEMINI_API_KEY:
        print(f"✨ Moteur Cloud    : Google Gemini Live ({DEFAULT_GEMINI_MODEL}) [ACTIF]")
    else:
        print("⚠️  Moteur Cloud    : Clé GEMINI_API_KEY absente dans .env (Mode Web Speech direct)")
    if MODEL_DIR.exists():
        print("📦 Moteur Local    : Vosk Kaldi (Français) [DISPONIBLE]")
    else:
        print("ℹ️  Moteur Local    : Vosk non installé (Web Speech API utilisé en repli)")
    print("=" * 65)
    print("📱 Sur iPad : Ouvrez Safari > Partager > 'Sur l'écran d'accueil'")
    print("=" * 65 + "\n")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        ssl_certfile=ssl_certfile,
        ssl_keyfile=ssl_keyfile,
        log_level="info"
    )


if __name__ == "__main__":
    main()
