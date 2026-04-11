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

  async start(onFrame: (base64Data: string) => void) {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user"
        }
      });

      this.videoElement = document.createElement("video");
      this.videoElement.srcObject = this.stream;
      this.videoElement.play();

      this.canvas = document.createElement("canvas");
      this.canvas.width = 320; // Reduced size for better performance
      this.canvas.height = 240;
      this.context = this.canvas.getContext("2d");

      this.interval = window.setInterval(() => {
        if (this.videoElement && this.context && this.canvas) {
          this.context.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
          const base64 = this.canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
          onFrame(base64);
        }
      }, 1000); // Send 1 frame per second for vision
    } catch (error) {
      console.error("Error starting video stream:", error);
      throw error;
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }
}
