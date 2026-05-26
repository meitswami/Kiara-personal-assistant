/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class VideoStreamer {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private interval: number | null = null;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private onFrameCallback: ((base64Data: string) => void) | null = null;
  private previewElement: HTMLVideoElement | null = null;
  private isActive: boolean = false;
  private framesSent: number = 0;
  private lastFrameTime: number = 0;

  async start(onFrame: (base64Data: string) => void, previewElement?: HTMLVideoElement) {
    this.onFrameCallback = onFrame;
    this.previewElement = previewElement || null;
    this.isActive = true;
    this.retryCount = 0;
    
    await this.initializeStream();
  }

  private async initializeStream(): Promise<void> {
    try {
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera access not supported in this browser. Please use Chrome or Edge on HTTPS.");
      }

      // Enumerate video devices first
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      
      if (videoDevices.length === 0) {
        throw new Error("No camera detected. Please connect a camera and try again.");
      }

      console.log(`VideoStreamer: Found ${videoDevices.length} camera(s):`, videoDevices.map(d => d.label || 'Unnamed'));

      // Try multiple constraint configurations
      const constraintPatterns = [
        { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } },
        { video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: "user" } },
        { video: { facingMode: "user" } },
        { video: true }
      ];

      let lastError: any = null;
      for (const constraints of constraintPatterns) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (this.stream) {
            console.log("VideoStreamer: Camera access granted with:", JSON.stringify(constraints));
            break;
          }
        } catch (e) {
          lastError = e;
          console.warn("VideoStreamer: Failed with constraints:", constraints, e);
        }
      }

      if (!this.stream) {
        throw lastError || new Error("Could not access camera with any configuration.");
      }

      // Set up video element
      if (this.previewElement) {
        this.videoElement = this.previewElement;
      } else {
        this.videoElement = document.createElement("video");
      }
      
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute('playsinline', 'true');
      this.videoElement.muted = true;
      
      await new Promise<void>((resolve, reject) => {
        if (!this.videoElement) return reject("No video element");
        this.videoElement.onloadedmetadata = () => {
          this.videoElement?.play().then(resolve).catch(reject);
        };
        // Timeout if video never loads
        setTimeout(() => reject("Video metadata timeout"), 5000);
      });

      // Set up canvas for frame capture
      this.canvas = document.createElement("canvas");
      this.canvas.width = 640;
      this.canvas.height = 480;
      this.context = this.canvas.getContext("2d", { alpha: false });

      // Start frame capture loop (1 fps for quota efficiency)
      this.startFrameCapture();
      this.retryCount = 0;

      // Monitor stream health
      this.monitorStreamHealth();

    } catch (error: any) {
      console.error("VideoStreamer: Error starting:", error);
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error("Camera permission denied. Please allow camera access in your browser settings (click the lock icon).");
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error("No camera found. Please connect a camera and try again.");
      } else if (error.name === 'NotReadableError') {
        throw new Error("Camera is in use by another application. Please close other apps and try again.");
      }
      
      throw error;
    }
  }

  private startFrameCapture(): void {
    if (this.interval) clearInterval(this.interval);

    this.interval = window.setInterval(() => {
      if (!this.isActive || !this.videoElement || !this.context || !this.canvas) return;

      try {
        // Check if video is actually playing
        if (this.videoElement.readyState < 2) {
          console.warn("VideoStreamer: Video not ready yet, skipping frame");
          return;
        }

        this.context.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
        
        // Validate frame isn't all black (camera not ready)
        const imageData = this.context.getImageData(0, 0, 10, 10);
        const isBlack = imageData.data.every((val, idx) => idx % 4 === 3 || val < 5);
        
        if (isBlack) {
          console.warn("VideoStreamer: Black frame detected, camera may not be ready");
          return;
        }

        const base64 = this.canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
        
        if (this.onFrameCallback) {
          this.onFrameCallback(base64);
          this.framesSent++;
          this.lastFrameTime = Date.now();
        }
      } catch (err) {
        console.warn("VideoStreamer: Frame capture error:", err);
      }
    }, 1000); // 1 fps
  }

  private monitorStreamHealth(): void {
    if (!this.stream) return;

    // Listen for track ended events (camera disconnected)
    const videoTrack = this.stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        console.warn("VideoStreamer: Camera track ended unexpectedly");
        this.handleStreamLoss();
      });

      videoTrack.addEventListener('mute', () => {
        console.warn("VideoStreamer: Camera track muted");
      });

      videoTrack.addEventListener('unmute', () => {
        console.log("VideoStreamer: Camera track unmuted");
      });
    }
  }

  private async handleStreamLoss(): Promise<void> {
    if (!this.isActive) return;

    this.retryCount++;
    console.log(`VideoStreamer: Attempting reconnection (${this.retryCount}/${this.maxRetries})`);

    if (this.retryCount > this.maxRetries) {
      console.error("VideoStreamer: Max retries exceeded. Vision disabled.");
      this.stop();
      // Dispatch event to notify UI
      window.dispatchEvent(new CustomEvent('kiara-vision-error', { 
        detail: { error: 'Camera disconnected and reconnection failed.' } 
      }));
      return;
    }

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, 2000 * this.retryCount));

    try {
      this.cleanup();
      await this.initializeStream();
      console.log("VideoStreamer: Reconnection successful");
    } catch (err) {
      console.error("VideoStreamer: Reconnection failed:", err);
      this.handleStreamLoss(); // Retry
    }
  }

  private cleanup(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement && !this.previewElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement = null;
    } else if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
  }

  stop() {
    this.isActive = false;
    this.cleanup();
    this.onFrameCallback = null;
    console.log(`VideoStreamer: Stopped. Total frames sent: ${this.framesSent}`);
    this.framesSent = 0;
  }

  getStats(): { isActive: boolean; framesSent: number; lastFrameTime: number } {
    return {
      isActive: this.isActive,
      framesSent: this.framesSent,
      lastFrameTime: this.lastFrameTime
    };
  }
}
