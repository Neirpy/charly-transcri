# Charly Transcri

Une application de transcription vocale locale (Speech-to-Text) avec un affichage en surimpression (overlay) transparent. Conçue spécialement pour les présentations, cours ou streams nécessitant des sous-titres en direct qui restent toujours au premier plan, tout en enregistrant un historique de la transcription.

## Fonctionnalités
- 🎤 **Transcription hors ligne** : Utilise le puissant moteur local Vosk et ne nécessite aucune connexion internet.
- 🪟 **Overlay (Surimpression)** : L'application s'affiche au-dessus de toutes vos fenêtres avec un fond transparent. Parfait pour sous-titrer des cours ou des démonstrations.
- 💾 **Sauvegarde Automatique** : Génère automatiquement un fichier texte avec l'historique complet de votre transcription lorsque vous arrêtez l'enregistrement.
- ⚙️ **Interface Personnalisable** :
  - Choix du microphone
  - Modification de la couleur et de la taille du texte
  - Masquage des contrôles pour un affichage minimaliste
  - Déplacement et redimensionnement libres

## Prérequis et Configurations Minimales (PC/Mac)

L'application utilise un modèle d'Intelligence Artificielle de ~1.4 Go qui est chargé en mémoire.

- **Système d'exploitation** : Windows 10/11, macOS ou Linux.
- **Processeur (CPU)** : Processeur moderne (Intel Core i5/Ryzen 5 ou Apple Silicon M1/M2/M3). La transcription Vosk repose uniquement sur le CPU, un bon processeur garantit une transcription fluide et sans décalage.
- **Mémoire vive (RAM)** : 8 Go minimum (l'application consommera environ 1.5 à 2.5 Go de RAM une fois le modèle chargé).
- **Espace Disque** : ~2 Go d'espace libre (pour le modèle Vosk et les dépendances Python).

## Installation

1. Clonez ce dépôt.
2. Créez un environnement virtuel Python et installez les dépendances (PyQt5, vosk, sounddevice).
3. Téléchargez le grand modèle Vosk en langue française :
   ```bash
   python download_model.py
   ```
   *Ce script téléchargera le fichier de 1.4 Go et l'extraira automatiquement dans un dossier `model`.*

## Utilisation

**Pour lancer l'application facilement (recommandé) :**
- **Sur Mac** : Double-cliquez simplement sur le fichier `start_mac.command`.
- **Sur Windows** : Double-cliquez simplement sur le fichier `start_windows.bat`.

*Si vous préférez utiliser le terminal :*
```bash
python main.py
```
- Choisissez votre microphone dans la liste déroulante.
- Cliquez sur **Démarrer**.
- Vous pouvez masquer les options avec le bouton **⚙️ Menu**, déplacer la fenêtre avec **✥ Déplacer**, ou la redimensionner avec **↘ Étirer**.
- Cliquez sur **Arrêter** pour stopper le microphone. Votre transcription complète sera automatiquement sauvegardée dans le dossier `transcriptions/` avec la date et l'heure.
