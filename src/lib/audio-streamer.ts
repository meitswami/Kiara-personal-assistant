/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class AudioStreamer {
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;

  constructor(private sampleRate: number = 16000) {}

  async startRecording(onAudioData: (base64Data: string) => void) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support microphone access. Please use a modern browser like Chrome or Edge.");
      }

      // Check available devices first
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      console.log("Detected audio input devices:", audioInputs);

      if (audioInputs.length === 0) {
        throw new Error("No microphone detected. Please ensure your microphone is plugged in and recognized by your system.");
      }

      // Try multiple constraint patterns from most specific to least
      const constraintPatterns = [
        { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
        { audio: { echoCancellation: true } },
        { audio: true }
      ];

      let lastError = null;
      for (const constraints of constraintPatterns) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (this.stream) {
            console.log("Microphone access granted with constraints:", constraints);
            break;
          }
        } catch (e) {
          lastError = e;
          console.warn(`Failed to get audio with constraints ${JSON.stringify(constraints)}:`, e);
        }
      }

      if (!this.stream) {
        throw lastError || new Error("Could not access microphone.");
      }

      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: this.sampleRate 
      });
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      // ScriptProcessorNode is used for broad compatibility
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = this.floatToPcm16(inputData);
        const base64 = this.arrayBufferToBase64(pcm16.buffer);
        onAudioData(base64);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      console.error("Detailed Error starting recording:", error);
      if (error instanceof Error) {
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          throw new Error("No microphone found. Please plug in a microphone and try again.");
        } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          throw new Error("Microphone permission denied. Please allow microphone access in your browser settings (click the lock icon in the address bar).");
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
          throw new Error("Microphone is already in use by another application or tab. Please close other apps and try again.");
        }
      }
      throw error;
    }
  }

  stopRecording() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  async playAudioChunk(base64Data: string) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const arrayBuffer = this.base64ToArrayBuffer(base64Data);
    const pcmData = new Int16Array(arrayBuffer);
    const floatData = this.pcm16ToFloat(pcmData);

    const audioBuffer = this.audioContext.createBuffer(1, floatData.length, 24000);
    audioBuffer.getChannelData(0).set(floatData);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;
    this.isPlaying = true;
    
    source.onended = () => {
      if (this.audioContext && this.audioContext.currentTime >= this.nextStartTime) {
        this.isPlaying = false;
      }
    };
  }

  stopPlayback() {
    this.nextStartTime = 0;
    this.isPlaying = false;
    // We don't necessarily want to close the context here, just stop the queue
  }

  private floatToPcm16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  private pcm16ToFloat(pcm16Array: Int16Array): Float32Array {
    const float32 = new Float32Array(pcm16Array.length);
    for (let i = 0; i < pcm16Array.length; i++) {
      float32[i] = pcm16Array[i] / 32768;
    }
    return float32;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
