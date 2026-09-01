/**
 * CHARLY TRANSCRI - Application PWA & Accessibilité (a11y)
 * Nouvelles fonctionnalités :
 * 1. Choix du Microphone spécifique (casques, AirPods, micros externes)
 * 2. Mode Fenêtre Flottante « Au-dessus de tout » (Picture-in-Picture pour PC & iPad)
 * 3. Multi-moteurs (Web Speech natif, Gemini Live JS, Serveur Local)
 */

class CharlyApp {
  constructor() {
    // Configuration & Préférences
    this.isRecording = false;
    this.selectedEngine = localStorage.getItem('charly_engine') || 'auto';
    this.activeEngine = 'webspeech';
    this.geminiApiKey = localStorage.getItem('charly_gemini_key') || '';
    this.selectedMicId = localStorage.getItem('charly_mic_device') || 'default';
    this.language = localStorage.getItem('charly_lang') || 'fr-FR';
    this.enableWakeLock = localStorage.getItem('charly_wakelock') !== 'false';
    
    // Données de transcription
    this.transcripts = []; // Blocs { id, timestamp, text }
    this.currentPartial = '';
    this.autoScrollEnabled = true;
    this.fontSize = parseInt(localStorage.getItem('charly_font_size') || '24', 10);
    this.theme = localStorage.getItem('charly_theme') || 'dark';

    // Objets Audio, Réseau & PiP
    this.audioRecorder = null;
    this.socket = null;
    this.speechRecognition = null;
    this.wakeLock = null;
    this.deferredInstallPrompt = null;
    
    // Picture-in-Picture
    this.pipWindow = null;
    this.isPipActive = false;
    this.pipCanvas = null;
    this.pipVideo = null;
    this.pipCanvasCtx = null;
    this.pipAnimId = null;
    this.lastAudioVolume = 0;

    // Éléments DOM
    this.dom = {
      transcriptWrapper: document.getElementById('transcriptWrapper'),
      transcriptContent: document.getElementById('transcriptContent'),
      emptyState: document.getElementById('emptyState'),
      partialContainer: document.getElementById('partialContainer'),
      partialText: document.getElementById('partialText'),
      resumeScrollBtn: document.getElementById('resumeScrollBtn'),
      micBtn: document.getElementById('micBtn'),
      micStatusLabel: document.getElementById('micStatusLabel'),
      vuBarFill: document.getElementById('vuBarFill'),
      engineBadge: document.getElementById('engineBadge'),
      fontSizeVal: document.getElementById('fontSizeVal'),
      btnFontDec: document.getElementById('btnFontDec'),
      btnFontInc: document.getElementById('btnFontInc'),
      btnCopy: document.getElementById('btnCopy'),
      btnDownload: document.getElementById('btnDownload'),
      btnClear: document.getElementById('btnClear'),
      btnInstallPwa: document.getElementById('btnInstallPwa'),
      btnSettings: document.getElementById('btnSettings'),
      btnPipOverlay: document.getElementById('btnPipOverlay'),
      
      // Modales & Formulaires
      settingsModal: document.getElementById('settingsModal'),
      closeSettingsBtn: document.getElementById('closeSettingsBtn'),
      saveSettingsBtn: document.getElementById('saveSettingsBtn'),
      engineSelect: document.getElementById('engineSelect'),
      micDeviceSelect: document.getElementById('micDeviceSelect'),
      geminiApiKeyInput: document.getElementById('geminiApiKeyInput'),
      languageSelect: document.getElementById('languageSelect'),
      wakeLockCheckbox: document.getElementById('wakeLockCheckbox'),

      installModal: document.getElementById('installModal'),
      installBody: document.getElementById('installBody'),
      closeInstallBtn: document.getElementById('closeInstallBtn'),
      installActionBtn: document.getElementById('installActionBtn'),

      micHelpModal: document.getElementById('micHelpModal'),
      closeMicHelpBtn: document.getElementById('closeMicHelpBtn'),
      micHelpOkBtn: document.getElementById('micHelpOkBtn'),

      modalBackdrop: document.getElementById('modalBackdrop'),
      modalTitle: document.getElementById('modalTitle'),
      modalBody: document.getElementById('modalBody'),
      modalConfirmBtn: document.getElementById('modalConfirmBtn'),
      modalCancelBtn: document.getElementById('modalCancelBtn'),
      toastContainer: document.getElementById('toastContainer')
    };

    this.init();
  }

  async init() {
    this.applyTheme(this.theme);
    this.applyFontSize(this.fontSize);
    this.loadSavedSession();
    this.setupEventListeners();
    this.registerServiceWorker();
    this.setupPwaInstall();
    this.initPipElements();
    await this.enumerateAudioDevices();
    await this.fetchServerStatus();
    this.updateActiveEngine();
  }

  // --- 1. ÉNUMÉRATION & CHOIX DU MICROPHONE ---
  async enumerateAudioDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      console.warn("Énumération des périphériques audio non supportée.");
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      
      const select = this.dom.micDeviceSelect;
      if (!select) return;

      select.innerHTML = '<option value="default">Microphone par défaut</option>';

      audioInputs.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        if (device.deviceId === this.selectedMicId) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      // Écouter les branchements/débranchements d'écouteurs ou micros
      navigator.mediaDevices.ondevicechange = () => this.enumerateAudioDevices();
    } catch (e) {
      console.warn("Impossible d'énumérer les micros :", e);
    }
  }

  // --- 2. GESTION DU MODE FENÊTRE FLOTTANTE (AU-DESSUS DE TOUT / PiP) ---
  initPipElements() {
    this.pipCanvas = document.getElementById('pipCanvas');
    this.pipVideo = document.getElementById('pipVideo');
    if (this.pipCanvas) {
      this.pipCanvasCtx = this.pipCanvas.getContext('2d');
      this.startPipCanvasAnimation();
    }

    if (this.pipVideo && this.pipCanvas) {
      // Préparer le flux vidéo dès le chargement
      try {
        if (this.pipCanvas.captureStream) {
          const stream = this.pipCanvas.captureStream(15);
          this.pipVideo.srcObject = stream;
        }
      } catch (e) {}

      // Écouteur pour iPadOS WebKit
      if ('webkitPresentationMode' in this.pipVideo) {
        this.pipVideo.addEventListener('webkitpresentationmodechanged', () => {
          this.isPipActive = (this.pipVideo.webkitPresentationMode === 'picture-in-picture');
          this.updatePipButtonState();
        });
      }

      // Détection standard de sortie du PiP
      this.pipVideo.addEventListener('leavepictureinpicture', () => {
        this.isPipActive = false;
        this.updatePipButtonState();
      });
    }
  }

  async togglePictureInPicture() {
    if (this.isPipActive) {
      this.exitPictureInPicture();
      return;
    }

    // 1. Priorité au Document Picture-in-Picture (PC Chrome / Edge sur Windows/Mac)
    if ('documentPictureInPicture' in window) {
      try {
        await this.openDocumentPip();
        return;
      } catch (err) {
        console.warn("Échec Document PiP, repli sur Canvas PiP :", err);
      }
    }

    // 2. Repli universel : Canvas Video PiP (iPad Safari / Mac / Mobile)
    await this.openCanvasVideoPip();
  }

  async openDocumentPip() {
    const width = 520;
    const height = 420;

    this.pipWindow = await window.documentPictureInPicture.requestWindow({
      width: width,
      height: height
    });

    // Copie des styles CSS dans la fenêtre flottante
    [...document.styleSheets].forEach((styleSheet) => {
      try {
        const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
        const style = document.createElement('style');
        style.textContent = cssRules;
        this.pipWindow.document.head.appendChild(style);
      } catch (e) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = styleSheet.type;
        link.media = styleSheet.media;
        link.href = styleSheet.href;
        this.pipWindow.document.head.appendChild(link);
      }
    });

    // Structure HTML complète de la fenêtre flottante
    const pipBody = this.pipWindow.document.body;
    pipBody.setAttribute('data-theme', this.theme);
    pipBody.style.margin = '0';
    pipBody.style.padding = '12px';
    pipBody.style.backgroundColor = 'var(--bg-primary, #0b0f19)';
    pipBody.style.color = 'var(--text-primary, #f8fafc)';
    pipBody.style.fontFamily = 'var(--font-family-base, sans-serif)';
    pipBody.style.overflow = 'hidden';
    pipBody.style.height = '100vh';
    pipBody.style.display = 'flex';
    pipBody.style.flexDirection = 'column';
    pipBody.style.boxSizing = 'border-box';

    pipBody.innerHTML = `
      <!-- Barre d'outils supérieure de la fenêtre flottante -->
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:6px; margin-bottom:6px; gap:8px; flex-shrink:0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <strong style="font-size:0.85rem; color:var(--accent-primary, #38bdf8);">🎙️ Charly Transcri</strong>
          <span id="pipStatusBadge" style="font-size:0.7rem; font-weight:700; background:var(--bg-tertiary, #1e293b); padding:2px 6px; border-radius:10px;">En direct</span>
        </div>

        <!-- Contrôles rapides en haut à droite -->
        <div style="display:flex; align-items:center; gap:4px;">
          <button id="pipFontDec" class="btn btn-icon-only" style="padding:2px 6px; font-size:0.75rem; min-height:26px; min-width:26px; border-radius:6px;" title="Réduire la police">A-</button>
          <button id="pipFontInc" class="btn btn-icon-only" style="padding:2px 6px; font-size:0.75rem; min-height:26px; min-width:26px; border-radius:6px;" title="Agrandir la police">A+</button>
          <button id="pipCopyBtn" class="btn btn-icon-only" style="padding:2px 6px; font-size:0.75rem; min-height:26px; min-width:26px; border-radius:6px;" title="Copier tout le texte">📋</button>
        </div>
      </div>

      <!-- Zone de transcription au centre -->
      <div id="pipTranscriptContainer" style="flex:1; overflow-y:auto; font-size:${this.fontSize}px; line-height:1.5; display:flex; flex-direction:column; gap:8px; padding-right:4px;">
        <!-- Contenu synchronisé en direct -->
      </div>

      <!-- BARRE DE CONTRÔLE BASSE : BOUTON MICRO AU MILIEU -->
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:6px 0 2px 0; border-top:1px solid rgba(255,255,255,0.1); margin-top:6px; flex-shrink:0;">
        <!-- Grand bouton micro circulaire centré -->
        <button id="pipMicBtn" style="width:48px; height:48px; border-radius:50%; border:none; color:#ffffff; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.2s ease; box-shadow:0 4px 14px rgba(0,0,0,0.4); flex-shrink:0;" title="Démarrer / Arrêter la transcription (Espace)">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" x2="12" y1="19" y2="22"/>
          </svg>
        </button>

        <!-- Libellé de statut et mini vumètre -->
        <div style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; max-width:260px;">
          <span id="pipMicStatusLabel" style="font-size:0.7rem; color:#94a3b8; font-weight:600; white-space:nowrap;">Micro en attente</span>
          <div style="flex:1; height:5px; background:rgba(255,255,255,0.12); border-radius:10px; overflow:hidden;">
            <div id="pipVuBar" style="height:100%; width:0%; background:linear-gradient(90deg, #10b981, #38bdf8, #ef4444); transition:width 0.08s ease-out; border-radius:10px;"></div>
          </div>
        </div>
      </div>
    `;

    // Écouteurs d'événements à l'intérieur de la fenêtre flottante
    const pipMicBtn = this.pipWindow.document.getElementById('pipMicBtn');
    if (pipMicBtn) {
      pipMicBtn.addEventListener('click', () => this.toggleRecording());
    }

    const pipFontDec = this.pipWindow.document.getElementById('pipFontDec');
    const pipFontInc = this.pipWindow.document.getElementById('pipFontInc');
    if (pipFontDec) pipFontDec.addEventListener('click', () => this.adjustFontSize(-2));
    if (pipFontInc) pipFontInc.addEventListener('click', () => this.adjustFontSize(2));

    const pipCopyBtn = this.pipWindow.document.getElementById('pipCopyBtn');
    if (pipCopyBtn) pipCopyBtn.addEventListener('click', () => this.copyToClipboard());

    // Raccourci barre d'espace dans la fenêtre flottante
    this.pipWindow.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.toggleRecording();
      }
    });

    this.pipWindow.addEventListener('pagehide', () => {
      this.pipWindow = null;
      this.isPipActive = false;
      this.updatePipButtonState();
    });

    this.isPipActive = true;
    this.syncPipContent();
    this.syncPipState();
    this.updatePipButtonState();
    this.showToast("Fenêtre flottante ouverte avec micro en bas au milieu");
  }

  async openCanvasVideoPip() {
    if (!this.pipCanvas || !this.pipVideo) {
      this.showToast("Fenêtre flottante non supportée sur ce navigateur", "warning");
      return;
    }

    try {
      this.startPipCanvasAnimation();

      if (!this.pipVideo.srcObject && this.pipCanvas.captureStream) {
        this.pipVideo.srcObject = this.pipCanvas.captureStream(15);
      }

      // Déclenchement synchrone dans le geste utilisateur
      const playPromise = this.pipVideo.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(() => {});
      }

      // 1. Détection et activation WebKit iPadOS
      if (typeof this.pipVideo.webkitSetPresentationMode === 'function') {
        this.pipVideo.webkitSetPresentationMode('picture-in-picture');
        this.isPipActive = true;
        this.updatePipButtonState();
        this.showToast("Fenêtre flottante active sur iPad");
        return;
      }

      // 2. Détection standard HTML5 requestPictureInPicture
      if (this.pipVideo.requestPictureInPicture) {
        await this.pipVideo.requestPictureInPicture();
        this.isPipActive = true;
        this.updatePipButtonState();
        this.showToast("Fenêtre flottante Picture-in-Picture active");
        return;
      }

      throw new Error("L'API Picture-in-Picture n'est pas disponible.");
    } catch (err) {
      console.warn("Échec activation PiP vidéo :", err);
      
      // Guide d'aide multitâche iPad
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIos) {
        this.showIpadMultitaskGuide();
      } else {
        this.showToast("Mode flottant restreint par le navigateur : " + err.message, "warning");
      }
    }
  }

  showIpadMultitaskGuide() {
    this.dom.modalTitle.textContent = "📱 Multitâche sur iPad";
    this.dom.modalBody.innerHTML = `
      <p>Pour garder Charly Transcri visible pendant que vous travaillez sur votre iPad (Word, Notes, etc.) :</p>
      <div class="guide-steps" style="margin-top:10px; text-align:left;">
        <div class="step-card">
          <strong>Option 1 : Slide Over (Fenêtre Flottante iPad)</strong>
          <p>Touchez les <strong>trois petits points (…)</strong> tout en haut de l'écran d'iPad, puis sélectionnez <strong>Slide Over</strong>. L'application devient un tiroir flottant que vous pouvez glisser par-dessus n'importe quelle application !</p>
        </div>
        <div class="step-card">
          <strong>Option 2 : Split View (Écran Partagé 50/50)</strong>
          <p>Touchez les <strong>trois petits points (…)</strong> et choisissez <strong>Split View</strong> pour afficher vos cours ou vos notes à gauche et la transcription en direct à droite.</p>
        </div>
      </div>
    `;
    this.dom.modalCancelBtn.style.display = 'none';
    this.dom.modalConfirmBtn.textContent = "J'ai compris";
    this.dom.modalConfirmBtn.onclick = () => {
      this.closeModal();
      this.dom.modalCancelBtn.style.display = 'inline-flex';
      this.dom.modalConfirmBtn.textContent = "Confirmer";
    };
    this.dom.modalBackdrop.classList.add('active');
  }

  exitPictureInPicture() {
    if (this.pipWindow) {
      this.pipWindow.close();
      this.pipWindow = null;
    }
    if (this.pipVideo) {
      if (typeof this.pipVideo.webkitSetPresentationMode === 'function') {
        this.pipVideo.webkitSetPresentationMode('inline');
      }
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
      }
    }
    this.isPipActive = false;
    this.updatePipButtonState();
  }

  updatePipButtonState() {
    const btn = this.dom.btnPipOverlay;
    if (!btn) return;
    if (this.isPipActive) {
      btn.classList.add('active');
      btn.querySelector('.btn-label').textContent = "Quitter Flottant";
    } else {
      btn.classList.remove('active');
      btn.querySelector('.btn-label').textContent = "Au-dessus de tout";
    }
  }

  syncPipContent() {
    if (!this.pipWindow) return;
    const container = this.pipWindow.document.getElementById('pipTranscriptContainer');
    if (!container) return;

    let html = '';
    this.transcripts.slice(-15).forEach((t) => {
      html += `
        <div style="background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:8px; border-left:3px solid var(--accent-primary, #38bdf8);">
          <small style="color:var(--accent-primary, #38bdf8); font-family:monospace;">[${t.timestamp}]</small>
          <div style="font-weight:500;">${this.escapeHtml(t.text)}</div>
        </div>
      `;
    });

    if (this.currentPartial.trim()) {
      html += `
        <div style="color:var(--text-secondary, #94a3b8); font-style:italic; padding:6px 10px; border:1px dashed var(--accent-primary, #38bdf8); border-radius:8px;">
          ✍️ ${this.escapeHtml(this.currentPartial)}
        </div>
      `;
    }

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
  }

  syncPipState() {
    if (!this.pipWindow) return;
    try {
      const doc = this.pipWindow.document;
      const micBtn = doc.getElementById('pipMicBtn');
      const micStatusLabel = doc.getElementById('pipMicStatusLabel');
      const badge = doc.getElementById('pipStatusBadge');
      const vuBar = doc.getElementById('pipVuBar');

      if (micBtn) {
        if (this.isRecording) {
          micBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
          micBtn.style.boxShadow = '0 0 16px rgba(239, 68, 68, 0.7)';
          micBtn.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect width="6" height="16" x="4" y="4" rx="2"/><rect width="6" height="16" x="14" y="4" rx="2"/></svg>
          `;
          micBtn.title = "Couper le microphone (Espace)";
        } else {
          micBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
          micBtn.style.boxShadow = '0 4px 14px rgba(16, 185, 129, 0.4)';
          micBtn.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          `;
          micBtn.title = "Activer le microphone (Espace)";
        }
      }

      if (micStatusLabel) {
        if (this.isRecording) {
          micStatusLabel.textContent = "● Écoute en cours...";
          micStatusLabel.style.color = "#ef4444";
        } else {
          micStatusLabel.textContent = "Micro en pause";
          micStatusLabel.style.color = "#94a3b8";
        }
      }

      if (badge) {
        if (this.isRecording) {
          badge.textContent = "● En direct";
          badge.style.color = "#10b981";
          badge.style.border = "1px solid #10b981";
        } else {
          badge.textContent = "○ En pause";
          badge.style.color = "#94a3b8";
          badge.style.border = "1px solid rgba(255,255,255,0.15)";
        }
      }

      if (vuBar) {
        vuBar.style.width = this.isRecording ? `${this.lastAudioVolume}%` : '0%';
      }
    } catch (e) {}
  }

  startPipCanvasAnimation() {
    if (this.pipAnimId) return;

    const render = () => {
      if (!this.pipCanvasCtx) return;
      const ctx = this.pipCanvasCtx;
      const w = this.pipCanvas.width;
      const h = this.pipCanvas.height;

      // Fond sombre OLED
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, w, h);

      // En-tête PiP
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, w, 44);
      
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('🎙️ CHARLY TRANSCRI', 16, 28);

      const nowStr = new Date().toTimeString().slice(0, 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px monospace';
      ctx.fillText(nowStr, w - 85, 28);

      // Derniers textes transcrits
      let y = 80;
      const lastEntries = this.transcripts.slice(-3);
      
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px sans-serif';

      lastEntries.forEach((entry) => {
        const text = `[${entry.timestamp}] ${entry.text}`;
        this.wrapCanvasText(ctx, text, 16, y, w - 32, 24);
        y += 55;
      });

      // Texte partiel en direct
      if (this.currentPartial.trim()) {
        ctx.fillStyle = '#ffff00';
        ctx.font = 'italic 18px sans-serif';
        this.wrapCanvasText(ctx, `✍️ ${this.currentPartial}`, 16, Math.min(y, h - 60), w - 32, 24);
      }

      // Indicateur visuel Micro en bas au milieu du Canvas PiP
      const cx = w / 2;
      const cy = h - 32;
      const radius = 20;

      // Cercle de fond du micro
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = this.isRecording ? '#ef4444' : '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Icône / Symbole Micro
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.isRecording ? '⏸' : '🎤', cx, cy + 5);

      // Texte de statut sous le micro
      ctx.font = '10px sans-serif';
      ctx.fillStyle = this.isRecording ? '#f87171' : '#94a3b8';
      ctx.fillText(this.isRecording ? 'ÉCOUTE EN DIRECT' : 'MICRO EN PAUSE', cx, h - 4);
      ctx.textAlign = 'left'; // Reset

      // Vumètre visuel tout en bas
      ctx.fillStyle = '#10b981';
      const barW = (this.lastAudioVolume / 100) * w;
      ctx.fillRect(0, h - 4, barW, 4);

      this.pipAnimId = requestAnimationFrame(render);
    };

    this.pipAnimId = requestAnimationFrame(render);
  }

  stopPipCanvasAnimation() {
    if (this.pipAnimId) {
      cancelAnimationFrame(this.pipAnimId);
      this.pipAnimId = null;
    }
  }

  wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
  }

  // --- 3. ENREGISTREMENT SERVICE WORKER PWA ---
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        console.log('[PWA] Service Worker actif, scope:', reg.scope);
      } catch (err) {
        console.warn('[PWA] Service Worker non disponible :', err);
      }
    }
  }

  // --- 4. INSTALLATION PWA ---
  setupPwaInstall() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isStandalone) {
      if (this.dom.btnInstallPwa) {
        this.dom.btnInstallPwa.style.display = 'none';
      }
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      if (this.dom.btnInstallPwa) {
        this.dom.btnInstallPwa.style.display = 'inline-flex';
      }
    });

    if (this.dom.btnInstallPwa) {
      this.dom.btnInstallPwa.addEventListener('click', () => {
        if (this.deferredInstallPrompt) {
          this.deferredInstallPrompt.prompt();
          this.deferredInstallPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
              this.showToast('Application en cours d’installation !');
              this.dom.btnInstallPwa.style.display = 'none';
            }
            this.deferredInstallPrompt = null;
          });
        } else if (isIos) {
          this.showIosInstallGuide();
        } else {
          this.showGenericInstallGuide();
        }
      });
    }
  }

  showIosInstallGuide() {
    this.dom.installBody.innerHTML = `
      <p>Pour installer Charly Transcri en application plein écran sur votre iPad :</p>
      <div class="guide-steps">
        <div class="step-card">
          <strong>1. Touchez le bouton Partager</strong>
          <p>En haut à droite de Safari, touchez l'icône de partage (le carré avec la flèche vers le haut ⎋).</p>
        </div>
        <div class="step-card">
          <strong>2. Touchez « Sur l'écran d'accueil »</strong>
          <p>Faites défiler le menu et sélectionnez l'option avec le symbole ➕.</p>
        </div>
        <div class="step-card">
          <strong>3. Touchez « Ajouter »</strong>
          <p>L'icône Charly Transcri s'ajoute sur votre bureau d'iPad et s'ouvrira en plein écran sans barre d'adresse.</p>
        </div>
      </div>
    `;
    this.dom.installModal.classList.add('active');
  }

  showGenericInstallGuide() {
    this.dom.installBody.innerHTML = `
      <p>Pour installer l'application sur votre ordinateur :</p>
      <div class="guide-steps">
        <div class="step-card">
          <strong>Sur Chrome ou Edge :</strong>
          <p>Cliquez sur la petite icône d'installation 📥 située à droite dans la barre d'adresse du navigateur, puis validez sur <strong>Installer</strong>.</p>
        </div>
      </div>
    `;
    this.dom.installModal.classList.add('active');
  }

  // --- 5. MAINTIEN DE L'ÉCRAN ALLUMÉ (WAKE LOCK) ---
  async requestWakeLock() {
    if (!this.enableWakeLock) return;
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Écran maintenu allumé.');
      } catch (err) {
        console.warn('[WakeLock] Erreur WakeLock :', err);
      }
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  // --- 6. GESTION DU SERVEUR / MOTEUR ---
  async fetchServerStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        this.serverStatus = await res.json();
      }
    } catch (e) {
      this.serverStatus = null;
    }
  }

  updateActiveEngine() {
    if (this.selectedEngine === 'webspeech') {
      this.activeEngine = 'webspeech';
      this.dom.engineBadge.textContent = '📱 Apple / Google Natif';
    } else if (this.selectedEngine === 'gemini_direct') {
      this.activeEngine = 'gemini_direct';
      this.dom.engineBadge.textContent = '✨ Gemini Live JS';
    } else if (this.selectedEngine === 'server' && this.serverStatus) {
      this.activeEngine = 'server';
      this.dom.engineBadge.textContent = '🖥️ Serveur Local';
    } else {
      if (this.geminiApiKey.trim()) {
        this.activeEngine = 'gemini_direct';
        this.dom.engineBadge.textContent = '✨ Gemini Cloud (Auto)';
      } else if (this.serverStatus && this.serverStatus.has_gemini) {
        this.activeEngine = 'server';
        this.dom.engineBadge.textContent = '✨ Gemini Serveur (Auto)';
      } else {
        this.activeEngine = 'webspeech';
        this.dom.engineBadge.textContent = '📱 Natif (Sans clé)';
      }
    }
  }

  // --- 7. ÉCOUTEURS D'ÉVÉNEMENTS UI ---
  setupEventListeners() {
    this.dom.micBtn.addEventListener('click', () => this.toggleRecording());

    // Bouton Fenêtre Flottante / PiP
    if (this.dom.btnPipOverlay) {
      this.dom.btnPipOverlay.addEventListener('click', () => this.togglePictureInPicture());
    }

    this.dom.transcriptWrapper.addEventListener('scroll', () => this.handleScroll());
    this.dom.resumeScrollBtn.addEventListener('click', () => this.resumeAutoScroll());

    this.dom.btnFontDec.addEventListener('click', () => this.adjustFontSize(-2));
    this.dom.btnFontInc.addEventListener('click', () => this.adjustFontSize(2));

    document.querySelectorAll('.theme-pill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const theme = e.target.dataset.theme;
        this.applyTheme(theme);
      });
    });

    this.dom.btnCopy.addEventListener('click', () => this.copyToClipboard());
    this.dom.btnDownload.addEventListener('click', () => this.downloadTranscriptTxt());
    this.dom.btnClear.addEventListener('click', () => this.confirmClearTranscript());

    this.dom.btnSettings.addEventListener('click', () => this.openSettingsModal());
    this.dom.closeSettingsBtn.addEventListener('click', () => this.closeSettingsModal());
    this.dom.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    this.dom.closeInstallBtn.addEventListener('click', () => this.dom.installModal.classList.remove('active'));
    this.dom.installActionBtn.addEventListener('click', () => this.dom.installModal.classList.remove('active'));

    this.dom.closeMicHelpBtn.addEventListener('click', () => this.dom.micHelpModal.classList.remove('active'));
    this.dom.micHelpOkBtn.addEventListener('click', () => {
      this.dom.micHelpModal.classList.remove('active');
      this.startRecording();
    });

    this.dom.modalCancelBtn.addEventListener('click', () => this.closeModal());
    this.dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.dom.modalBackdrop) this.closeModal();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.toggleRecording();
      }
    });

    document.addEventListener('visibilitychange', async () => {
      if (this.wakeLock !== null && document.visibilityState === 'visible' && this.isRecording) {
        await this.requestWakeLock();
      }
    });
  }

  // --- 8. DÉFILEMENT INTELLIGENT ---
  handleScroll() {
    const el = this.dom.transcriptWrapper;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    if (isAtBottom) {
      this.autoScrollEnabled = true;
      this.dom.resumeScrollBtn.classList.remove('visible');
    } else {
      this.autoScrollEnabled = false;
      this.dom.resumeScrollBtn.classList.add('visible');
    }
  }

  resumeAutoScroll() {
    this.autoScrollEnabled = true;
    this.dom.resumeScrollBtn.classList.remove('visible');
    this.scrollToBottom();
  }

  scrollToBottom() {
    if (!this.autoScrollEnabled) return;
    const el = this.dom.transcriptWrapper;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: 'smooth'
    });
  }

  // --- 9. ACCESSIBILITÉ & TYPOGRAPHIE ---
  applyFontSize(size) {
    this.fontSize = Math.min(48, Math.max(16, size));
    document.documentElement.style.setProperty('--transcript-font-size', `${this.fontSize}px`);
    this.dom.fontSizeVal.textContent = `${this.fontSize}px`;
    localStorage.setItem('charly_font_size', this.fontSize.toString());
    if (this.pipWindow) {
      this.pipWindow.document.getElementById('pipTranscriptContainer').style.fontSize = `${this.fontSize}px`;
    }
  }

  adjustFontSize(delta) {
    this.applyFontSize(this.fontSize + delta);
    this.showToast(`Taille du texte : ${this.fontSize}px`);
  }

  applyTheme(themeName) {
    this.theme = themeName;
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('charly_theme', themeName);
    if (this.pipWindow) {
      this.pipWindow.document.body.setAttribute('data-theme', themeName);
    }

    document.querySelectorAll('.theme-pill').forEach((pill) => {
      if (pill.dataset.theme === themeName) {
        pill.classList.add('active');
        pill.setAttribute('aria-pressed', 'true');
      } else {
        pill.classList.remove('active');
        pill.setAttribute('aria-pressed', 'false');
      }
    });
  }

  // --- 10. CAPTURE VOCALE & TRANSCRIPTION ---
  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    this.updateActiveEngine();
    this.dom.micStatusLabel.textContent = "Connexion...";
    this.dom.micBtn.classList.add('recording');
    this.dom.micBtn.setAttribute('aria-label', 'Arrêter la transcription');

    await this.requestWakeLock();

    try {
      if (this.activeEngine === 'gemini_direct' && this.geminiApiKey.trim()) {
        await this.startGeminiDirectStreaming();
      } else if (this.activeEngine === 'server') {
        await this.startWebSocketAudioStreaming();
      } else {
        this.startWebSpeechRecognition();
      }

      this.isRecording = true;
      this.dom.micStatusLabel.textContent = "Écoute en cours...";
      this.syncPipState();
      this.showToast("Transcription démarrée");
    } catch (err) {
      console.error("Erreur de démarrage :", err);
      this.stopRecording();
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || (err.message && err.message.includes('permission'))) {
        this.dom.micHelpModal.classList.add('active');
      } else {
        console.warn("Bascule automatique sur Web Speech API suite à l'erreur.");
        try {
          this.activeEngine = 'webspeech';
          this.startWebSpeechRecognition();
          this.isRecording = true;
          this.dom.micStatusLabel.textContent = "Écoute (Mode Natif)...";
          this.dom.engineBadge.textContent = "📱 Natif (Repli)";
          this.syncPipState();
          this.showToast("Transcription démarrée en mode natif");
        } catch (fallbackErr) {
          this.dom.micHelpModal.classList.add('active');
        }
      }
    }
  }

  stopRecording() {
    this.isRecording = false;
    this.releaseWakeLock();

    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }

    if (this.socket) {
      try {
        this.socket.send(JSON.stringify({ type: "stop" }));
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }

    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch (e) {}
      this.speechRecognition = null;
    }

    this.dom.micBtn.classList.remove('recording');
    this.dom.micBtn.setAttribute('aria-label', 'Démarrer la transcription');
    this.dom.micStatusLabel.textContent = "Micro en pause";
    this.dom.vuBarFill.style.width = '0%';
    this.lastAudioVolume = 0;
    this.syncPipState();
    this.clearPartial();
  }

  // --- 11. RECONNAISSANCE VOCALE NATIVE (SAFARI IPAD / CHROME PC) ---
  startWebSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      throw new Error("La reconnaissance vocale native n'est pas supportée par votre navigateur.");
    }

    this.speechRecognition = new SpeechRec();
    this.speechRecognition.continuous = true;
    this.speechRecognition.interimResults = true;
    this.speechRecognition.lang = this.language;
    this.speechRecognition.maxAlternatives = 1;

    let vuInterval = setInterval(() => {
      if (!this.isRecording) {
        clearInterval(vuInterval);
        return;
      }
      const randomVol = this.currentPartial ? Math.floor(Math.random() * 50) + 30 : Math.floor(Math.random() * 15) + 5;
      this.dom.vuBarFill.style.width = `${randomVol}%`;
      this.lastAudioVolume = randomVol;
      if (this.pipWindow) {
        const vuBar = this.pipWindow.document.getElementById('pipVuBar');
        if (vuBar) vuBar.style.width = `${randomVol}%`;
      }
    }, 150);

    this.speechRecognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const finalText = text.trim();
          if (finalText) {
            this.addTranscriptEntry(finalText);
          }
        } else {
          interim += text;
        }
      }
      if (interim.trim()) {
        this.setPartial(interim.trim());
      } else {
        this.clearPartial();
      }
    };

    this.speechRecognition.onerror = (event) => {
      console.warn("Événement erreur Web Speech :", event.error);
      if (event.error === 'not-allowed') {
        this.dom.micHelpModal.classList.add('active');
        this.stopRecording();
      }
    };

    this.speechRecognition.onend = () => {
      if (this.isRecording) {
        try {
          this.speechRecognition.start();
        } catch (e) {}
      }
    };

    this.speechRecognition.start();
  }

  // --- 12. GEMINI LIVE DIRECT JS ---
  async startGeminiDirectStreaming() {
    const apiKey = this.geminiApiKey.trim();
    if (!apiKey) {
      throw new Error("Clé API Gemini requise pour ce mode.");
    }

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = async () => {
        const setupMessage = {
          setup: {
            model: "models/gemini-2.0-flash-exp",
            generationConfig: {
              responseModalities: ["TEXT"],
              temperature: 0.0
            },
            systemInstruction: {
              parts: [{
                text: "Tu es un transcripteur vocal en direct pour une personne sourde ou malentendante. Transcris mot à mot en français avec une ponctuation claire et naturelle. Ne réponds pas aux questions, transcris fidèlement."
              }]
            }
          }
        };
        this.socket.send(JSON.stringify(setupMessage));

        try {
          this.audioRecorder = new AudioRecorderPCM({
            targetSampleRate: 16000,
            deviceId: this.selectedMicId,
            onAudioChunk: (chunk) => {
              if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                const bytes = new Uint8Array(chunk);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64Audio = btoa(binary);

                const realtimeMessage = {
                  realtimeInput: {
                    mediaChunks: [{
                      mimeType: "audio/pcm;rate=16000",
                      data: base64Audio
                    }]
                  }
                };
                this.socket.send(JSON.stringify(realtimeMessage));
              }
            },
            onVolumeChange: (volume) => {
              this.dom.vuBarFill.style.width = `${volume}%`;
              this.lastAudioVolume = volume;
              if (this.pipWindow) {
                const vuBar = this.pipWindow.document.getElementById('pipVuBar');
                if (vuBar) vuBar.style.width = `${volume}%`;
              }
            }
          });

          await this.audioRecorder.start();
          resolve();
        } catch (audioErr) {
          reject(audioErr);
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.serverContent && data.serverContent.modelTurn) {
            const parts = data.serverContent.modelTurn.parts;
            if (parts && parts.length > 0) {
              const text = parts.map((p) => p.text || '').join('');
              if (text) {
                this.setPartial(text);
              }
            }
          }
          if (data.serverContent && data.serverContent.turnComplete) {
            if (this.currentPartial.trim()) {
              this.addTranscriptEntry(this.currentPartial.trim());
              this.clearPartial();
            }
          }
        } catch (e) {
          console.error("Erreur parsing Gemini :", e);
        }
      };

      this.socket.onerror = (err) => {
        console.error("Erreur WebSocket Gemini :", err);
        if (!this.isRecording) {
          reject(new Error("Impossible de se connecter à l'API Google Gemini. Vérifiez votre clé."));
        }
      };

      this.socket.onclose = () => {
        if (this.isRecording) {
          this.stopRecording();
        }
      };
    });
  }

  // --- 13. SERVEUR LOCAL WEBSOCKET ---
  async startWebSocketAudioStreaming() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/transcribe`;

      this.socket = new WebSocket(wsUrl);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = async () => {
        this.socket.send(JSON.stringify({
          engine: "auto",
          sample_rate: 16000
        }));

        try {
          this.audioRecorder = new AudioRecorderPCM({
            targetSampleRate: 16000,
            deviceId: this.selectedMicId,
            onAudioChunk: (chunk) => {
              if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(chunk);
              }
            },
            onVolumeChange: (volume) => {
              this.dom.vuBarFill.style.width = `${volume}%`;
              this.lastAudioVolume = volume;
              if (this.pipWindow) {
                const vuBar = this.pipWindow.document.getElementById('pipVuBar');
                if (vuBar) vuBar.style.width = `${volume}%`;
              }
            }
          });

          await this.audioRecorder.start();
          resolve();
        } catch (audioErr) {
          reject(audioErr);
        }
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'partial' || data.type === 'delta') {
            const text = data.full_current || data.text || '';
            this.setPartial(text);
          } else if (data.type === 'final') {
            this.clearPartial();
            if (data.text && data.text.trim()) {
              this.addTranscriptEntry(data.text.trim(), data.timestamp);
            }
          } else if (data.type === 'error') {
            this.showToast(data.message, 'danger');
          }
        } catch (err) {
          console.error("Erreur de parsing serveur :", err);
        }
      };

      this.socket.onerror = (err) => {
        if (!this.isRecording) {
          reject(new Error("Serveur local non joignable."));
        }
      };

      this.socket.onclose = () => {
        if (this.isRecording) {
          this.stopRecording();
        }
      };
    });
  }

  // --- 14. GESTION DE L'AFFICHAGE DU TEXTE ---
  addTranscriptEntry(text, customTimestamp = null) {
    const now = new Date();
    const timestamp = customTimestamp || now.toTimeString().split(' ')[0];
    
    const entry = {
      id: Date.now().toString(),
      timestamp: timestamp,
      text: text
    };

    this.transcripts.push(entry);
    this.saveSession();

    if (this.dom.emptyState) {
      this.dom.emptyState.style.display = 'none';
    }

    const entryEl = document.createElement('article');
    entryEl.className = 'transcript-entry';
    entryEl.setAttribute('role', 'region');
    entryEl.setAttribute('aria-label', `Prise de parole à ${timestamp}`);

    entryEl.innerHTML = `
      <span class="timestamp" aria-hidden="true">${timestamp}</span>
      <p class="entry-text">${this.escapeHtml(text)}</p>
    `;

    this.dom.transcriptContent.appendChild(entryEl);
    this.scrollToBottom();
    this.syncPipContent();
  }

  setPartial(text) {
    if (!text.trim()) {
      this.clearPartial();
      return;
    }
    this.currentPartial = text;
    this.dom.partialText.textContent = text;
    this.dom.partialContainer.style.display = 'flex';
    this.scrollToBottom();
    this.syncPipContent();
  }

  clearPartial() {
    this.currentPartial = '';
    this.dom.partialContainer.style.display = 'none';
    this.dom.partialText.textContent = '';
    this.syncPipContent();
  }

  // --- 15. PERSISTANCE LOCALE ---
  saveSession() {
    try {
      localStorage.setItem('charly_transcripts', JSON.stringify(this.transcripts));
    } catch (e) {
      console.warn("Impossible de sauvegarder dans localStorage :", e);
    }
  }

  loadSavedSession() {
    try {
      const saved = localStorage.getItem('charly_transcripts');
      if (saved) {
        this.transcripts = JSON.parse(saved);
        if (this.transcripts.length > 0) {
          if (this.dom.emptyState) {
            this.dom.emptyState.style.display = 'none';
          }
          this.transcripts.forEach((entry) => {
            const entryEl = document.createElement('article');
            entryEl.className = 'transcript-entry';
            entryEl.innerHTML = `
              <span class="timestamp">${entry.timestamp}</span>
              <p class="entry-text">${this.escapeHtml(entry.text)}</p>
            `;
            this.dom.transcriptContent.appendChild(entryEl);
          });
          this.scrollToBottom();
        }
      }
    } catch (e) {
      console.warn("Erreur chargement session :", e);
    }
  }

  // --- 16. EXPORTATION & COPIE ---
  async copyToClipboard() {
    if (this.transcripts.length === 0) {
      this.showToast("Aucun texte à copier", "warning");
      return;
    }

    const fullText = this.transcripts
      .map((t) => `[${t.timestamp}] ${t.text}`)
      .join('\n\n');

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(fullText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = fullText;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.showToast("Texte copié dans le presse-papier !");
    } catch (err) {
      console.error("Échec copie :", err);
      this.showToast("Impossible de copier automatiquement", "danger");
    }
  }

  downloadTranscriptTxt() {
    if (this.transcripts.length === 0) {
      this.showToast("Aucun texte à télécharger", "warning");
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5).replace(':', '-');
    const filename = `transcription_${dateStr}_${timeStr}.txt`;

    const content = [
      "============================================================",
      `CHARLY TRANSCRI - TRANSCRIPTION DU ${dateStr} à ${now.toTimeString().slice(0, 8)}`,
      "============================================================\n",
      ...this.transcripts.map((t) => `[${t.timestamp}] ${t.text}`),
      "\n============================================================"
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    try {
      fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content })
      });
    } catch (e) {}

    this.showToast(`Fichier ${filename} téléchargé`);
  }

  confirmClearTranscript() {
    if (this.transcripts.length === 0) return;

    this.openModal(
      "Effacer la transcription ?",
      "Êtes-vous sûr de vouloir effacer la transcription actuelle ? Pensez à télécharger le fichier .txt au préalable si vous souhaitez la conserver.",
      () => {
        this.transcripts = [];
        localStorage.removeItem('charly_transcripts');
        this.dom.transcriptContent.innerHTML = '';
        if (this.dom.emptyState) {
          this.dom.emptyState.style.display = 'flex';
        }
        this.clearPartial();
        this.closeModal();
        this.showToast("Transcription effacée");
      }
    );
  }

  // --- 17. PARAMÈTRES ---
  openSettingsModal() {
    this.dom.engineSelect.value = this.selectedEngine;
    this.dom.geminiApiKeyInput.value = this.geminiApiKey;
    this.dom.languageSelect.value = this.language;
    this.dom.wakeLockCheckbox.checked = this.enableWakeLock;
    this.enumerateAudioDevices();
    this.dom.settingsModal.classList.add('active');
  }

  closeSettingsModal() {
    this.dom.settingsModal.classList.remove('active');
  }

  saveSettings() {
    this.selectedEngine = this.dom.engineSelect.value;
    this.geminiApiKey = this.dom.geminiApiKeyInput.value.trim();
    this.selectedMicId = this.dom.micDeviceSelect.value;
    this.language = this.dom.languageSelect.value;
    this.enableWakeLock = this.dom.wakeLockCheckbox.checked;

    localStorage.setItem('charly_engine', this.selectedEngine);
    localStorage.setItem('charly_gemini_key', this.geminiApiKey);
    localStorage.setItem('charly_mic_device', this.selectedMicId);
    localStorage.setItem('charly_lang', this.language);
    localStorage.setItem('charly_wakelock', this.enableWakeLock.toString());

    this.updateActiveEngine();
    this.closeSettingsModal();
    this.showToast("Paramètres enregistrés !");
  }

  // --- 18. MODALES & TOASTS ---
  openModal(title, bodyText, onConfirm) {
    this.dom.modalTitle.textContent = title;
    this.dom.modalBody.textContent = bodyText;
    this.dom.modalConfirmBtn.onclick = onConfirm;
    this.dom.modalBackdrop.classList.add('active');
  }

  closeModal() {
    this.dom.modalBackdrop.classList.remove('active');
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;

    this.dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialisation globale
document.addEventListener('DOMContentLoaded', () => {
  window.app = new CharlyApp();
});
