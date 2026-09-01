# 🎙️ Charly Transcri - PWA de Transcription Vocale Accessible

**Charly Transcri** est une application web progressive (PWA) de transcription de la parole en direct, pensée spécifiquement pour accompagner une **personne sourde ou malentendante** au quotidien (cours, réunions, rendez-vous).

Elle est conçue pour fonctionner comme une **véritable application installée** sur **iPad (iPadOS / Safari)** et sur **PC portable (Lenovo / Windows / Chrome)**.

---

## 🌟 Nouvelles Fonctionnalités Majeures

### 1. 🪟 Mode « Au-dessus de tout » (Fenêtre Flottante / Picture-in-Picture)
- Un bouton bleu **« Au-dessus de tout »** en haut de page permet de détacher la transcription dans une **fenêtre flottante toujours au premier plan**.
- **Sur PC (Windows / Mac)** : Utilisez Word, PowerPoint, vos emails ou naviguez sur le web tout en gardant la transcription en surimpression au-dessus de toutes vos fenêtres.
- **Sur iPad (iPadOS)** : S'ouvre en mode Picture-in-Picture natif flottant au-dessus de vos applications de prise de notes. Vous pouvez aussi utiliser le mode **Split View** ou **Slide Over** d'iPadOS.

### 2. 🎤 Choix du Microphone
- Dans les **⚙️ Paramètres**, vous pouvez sélectionner le microphone de votre choix :
  - Microphone intégré (ordinateur ou tablette)
  - Écouteurs sans fil (AirPods, casques Bluetooth)
  - Micro-cravate USB ou micro directionnel de conférence

---

## 🚀 2 Façons Simples de l'Utiliser

### Option A : Déploiement Gratuit sur Vercel (Recommandé pour un usage nomade)
1. Importez ce dépôt sur **[Vercel](https://vercel.com)** (le fichier `vercel.json` est déjà configuré).
2. Vous obtenez un lien sécurisé en HTTPS (ex: `https://charly-transcri.vercel.app`).
3. La personne l'ouvre sur son iPad ou son PC :
   - **Microphone 100% autorisé immédiatement**
   - **Installation en 1 clic** (bouton *« 📲 Installer l'app »*)
   - Fonctionne partout (Wi-Fi, 4G, 5G) sans serveur allumé.

### Option B : Lancement Local sur votre Ordinateur
1. **Sur Windows (Lenovo)** : Double-cliquez sur `start_windows.bat` (ou lancez `python main.py`).
2. Votre navigateur s'ouvre automatiquement sur `http://localhost:8000`.
3. Cliquez sur **« 📲 Installer l'app »** pour créer le raccourci Windows.

---

## 🎯 Moteurs de Transcription Intégrés

- **Par défaut (Sans clé d'API - 100% Gratuit)** : Utilise la reconnaissance vocale native du système (dictée Siri sur iPad, Google Speech sur Chrome).
- **Optionnel (Haute précision par IA)** : Collez une clé Google Gemini gratuite dans les **⚙️ Paramètres** de l'application pour bénéficier de la transcription Gemini Live ultra-rapide avec filtrage des bruits.

---

## ♿ Accessibilité (a11y) & Ergonomie

| Fonctionnalité | Description |
| :--- | :--- |
| **🪟 Fenêtre Flottante** | Bouton *« Au-dessus de tout »* pour garder la transcription visible pendant que vous travaillez. |
| **🎤 Choix du Micro** | Sélection facile du micro externe / AirPods dans les réglages. |
| **📜 Défilement Intelligent** | Auto-scroll continu qui se fige si l'on remonte relire un passage. |
| **👁️ Vumètre Visuel** | Onde sonore pour vérifier en direct si le micro capte bien la voix. |
| **🔠 Taille de Police Ajustable** | Boutons `A-` / `A+` de 16px à 48px pour une lecture sans fatigue. |
| **🎨 4 Thèmes de Contraste** | Sombre OLED, Clair, Jaune sur Noir (malvoyants), Sépia. |
| **💡 Maintien de l'Écran Allumé** | Empêche l'iPad ou le PC de se mettre en veille. |
| **💾 Export .txt & Copie** | Téléchargement horodaté compatible avec l'application *Fichiers* d'iPadOS et Windows. |
