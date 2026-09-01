/**
 * AudioRecorderPCM : Capture audio micro, ré-échantillonnage 16 kHz et conversion en PCM 16-bit Mono.
 * Compatible iPadOS (Safari WebKit) et PC (Chrome/Edge/Firefox).
 */

class AudioRecorderPCM {
  constructor(options = {}) {
    this.targetSampleRate = options.targetSampleRate || 16000;
    this.deviceId = options.deviceId || null;
    this.onAudioChunk = options.onAudioChunk || (() => {});
    this.onVolumeChange = options.onVolumeChange || (() => {});
    
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.analyserNode = null;
    this.animFrameId = null;
    this.isRecording = false;
  }

  /**
   * Démarre la capture du microphone.
   */
  async start() {
    if (this.isRecording) return;

    // Déblocage AudioContext sur iOS / iPadOS (nécessite une interaction utilisateur)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("L'API Web Audio n'est pas supportée par votre navigateur.");
    }

    this.audioContext = new AudioContextClass();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    // Demande d'accès au micro avec suppression du bruit, d'écho et choix du micro
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };

    if (this.deviceId && this.deviceId !== 'default') {
      audioConstraints.deviceId = { exact: this.deviceId };
    }

    const constraints = {
      audio: audioConstraints,
      video: false
    };

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } else if (navigator.getUserMedia || navigator.webkitGetUserMedia) {
        const getUserMediaLegacy = (navigator.getUserMedia || navigator.webkitGetUserMedia).bind(navigator);
        this.mediaStream = await new Promise((res, rej) => getUserMediaLegacy(constraints, res, rej));
      } else {
        throw new Error("L'accès micro via Web Audio requiert HTTPS sur iPad.");
      }
    } catch (err) {
      console.error("Erreur d'accès au micro :", err);
      throw err;
    }

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // Analyseur pour le Vumètre / Visualiseur d'onde
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.sourceNode.connect(this.analyserNode);

    // Buffer size pour le processeur
    const bufferSize = 4096;
    if (this.audioContext.createScriptProcessor) {
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    } else if (this.audioContext.createJavaScriptNode) {
      this.processorNode = this.audioContext.createJavaScriptNode(bufferSize, 1, 1);
    } else {
      throw new Error("Aucun processeur audio disponible.");
    }

    const inputSampleRate = this.audioContext.sampleRate;

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isRecording) return;

      const inputData = event.inputBuffer.getChannelData(0);
      
      // 1. Ré-échantillonnage vers 16 kHz
      const downsampledData = this._downsampleBuffer(inputData, inputSampleRate, this.targetSampleRate);
      
      // 2. Conversion Float32 vers Int16 PCM
      const pcm16Data = this._floatToInt16(downsampledData);

      // 3. Callback avec le buffer PCM binaire
      this.onAudioChunk(pcm16Data.buffer);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    this.isRecording = true;
    this._startVolumeMeter();
  }

  /**
   * Arrête la capture audio et libère les ressources micro.
   */
  stop() {
    this.isRecording = false;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.onVolumeChange(0);
  }

  /**
   * Boucle d'animation pour le vumètre (calcul du volume RMS).
   */
  _startVolumeMeter() {
    if (!this.analyserNode) return;
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const checkVolume = () => {
      if (!this.isRecording || !this.analyserNode) return;

      this.analyserNode.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalisation 0 - 100
      const volumeLevel = Math.min(100, Math.round((average / 128) * 100));
      this.onVolumeChange(volumeLevel);

      this.animFrameId = requestAnimationFrame(checkVolume);
    };

    this.animFrameId = requestAnimationFrame(checkVolume);
  }

  /**
   * Ré-échantillonne un buffer Float32 à la fréquence cible (16000 Hz).
   */
  _downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) {
      return buffer;
    }
    if (outSampleRate > sampleRate) {
      return buffer;
    }
    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  /**
   * Convertit un tableau Float32Array [-1.0, 1.0] en Int16Array [-32768, 32767].
   */
  _floatToInt16(floatArray) {
    const l = floatArray.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      const s = Math.max(-1, Math.min(1, floatArray[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }
}

// Exposer globalement
window.AudioRecorderPCM = AudioRecorderPCM;
