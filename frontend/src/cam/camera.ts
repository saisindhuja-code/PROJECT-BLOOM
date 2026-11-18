/** Camera access helpers with clear, human error messages. */

import { context2d, makeCanvas } from "../imaging/process";

export type Facing = "user" | "environment";

export function cameraSupported(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function cameraProblem(error: unknown): string {
  const name = (error as { name?: string })?.name ?? "";
  if (!window.isSecureContext) {
    return "Cameras only work on secure pages (https:// or localhost). Open Bloom from localhost or an https address.";
  }
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was declined. Allow the camera in your browser's site settings, or upload a photo instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device. You can upload a photo instead.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy in another app. Close that app and try again.";
    default:
      return "The camera could not be started. You can upload a photo instead.";
  }
}

export async function startCamera(facing: Facing, withAudio = false): Promise<MediaStream> {
  if (!cameraSupported()) throw new Error("This browser cannot use a camera. Please upload a photo instead.");
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: withAudio,
    });
  } catch (error) {
    // Some devices reject the ideal resolution: retry with defaults.
    if ((error as { name?: string })?.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio });
    }
    throw error;
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Takes a still frame from a playing video. Front-camera frames are mirrored to match the preview. */
export function captureFrame(video: HTMLVideoElement, mirrored: boolean): HTMLCanvasElement {
  const canvas = makeCanvas(video.videoWidth, video.videoHeight);
  const ctx = context2d(canvas);
  if (mirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function hasMultipleCameras(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").length > 1;
  } catch {
    return false;
  }
}
