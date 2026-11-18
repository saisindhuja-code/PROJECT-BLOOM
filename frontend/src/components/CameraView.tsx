/**
 * Live camera with the flower floating on top.
 * - The camera starts only when you press "Start camera".
 * - The flower can be dragged, or follow your hand (MediaPipe, optional).
 * - "Upload a photo" works without any camera.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { flowerSticker } from "../flower/render";
import { captureFrame, cameraProblem, cameraSupported, hasMultipleCameras, startCamera, stopStream, type Facing } from "../cam/camera";
import { handGeometry, placementFromHand, smoothPlacement } from "../cam/handPose";
import { createHandTracker, type HandTracker } from "../cam/handTracker";
import { drawFlowerOn, placementCorners, stemEnd, type FlowerPlacement } from "../imaging/compose";
import { context2d, makeCanvas, renderThemed, toCanvas } from "../imaging/process";
import { THEMES, defaultSettings, type ThemeSettings } from "../imaging/themes";
import { blobToImage } from "../lib/api";
import { handlePosition, useOverlayGestures } from "../hooks/useOverlayGestures";
import { IconCamera, IconFlip, IconHand, IconUpload } from "./Icons";

type HandStatus = "off" | "loading" | "searching" | "tracking" | "error";

export function CameraView({
  recipe,
  placement,
  onPlacement,
  onCapture,
  autoStart = false,
  theme,
  onTheme,
}: {
  recipe: FlowerRecipe | null;
  placement: FlowerPlacement;
  onPlacement: (next: FlowerPlacement, commit: boolean) => void;
  onCapture: (photo: HTMLCanvasElement, placement: FlowerPlacement, source: "camera" | "upload", theme: ThemeSettings) => void;
  autoStart?: boolean;
  /** Live digicam filter shown on the camera (optional). */
  theme?: ThemeSettings;
  onTheme?: (theme: ThemeSettings) => void;
}) {
  const filter = theme ?? defaultSettings();
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const filtered = filter.preset !== "natural";
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const layer = useRef<HTMLCanvasElement>(null);
  const look = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [problem, setProblem] = useState("");
  const [facing, setFacing] = useState<Facing>("user");
  const [canFlip, setCanFlip] = useState(false);
  const [aspect, setAspect] = useState(4 / 3);
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [flash, setFlash] = useState(0);
  const [hand, setHand] = useState<HandStatus>("off");
  const [handError, setHandError] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const tracker = useRef<HandTracker | null>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const mirrored = facing === "user";

  const start = useCallback(async (which: Facing) => {
    setStatus("starting");
    setProblem("");
    try {
      const s = await startCamera(which);
      setStream((old) => {
        stopStream(old);
        return s;
      });
      setStatus("live");
      setCanFlip(await hasMultipleCameras());
    } catch (error) {
      setProblem(cameraProblem(error));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (autoStart && cameraSupported()) void start("user");
  }, [autoStart, start]);

  // Stop the camera when leaving the page.
  useEffect(() => () => stopStream(stream), [stream]);

  useEffect(() => {
    const v = video.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    const onMeta = () => v.videoWidth && setAspect(v.videoWidth / v.videoHeight);
    v.addEventListener("loadedmetadata", onMeta);
    v.play().catch(() => undefined);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [stream]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Draw the flower layer (and follow the hand when tracking is on).
  useEffect(() => {
    let frame = 0;
    let lastDetect = 0;
    let missed = 0;
    const draw = (now: number) => {
      const canvas = layer.current;
      const v = video.current;
      if (canvas && size.w) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(size.w * ratio)) {
          canvas.width = Math.round(size.w * ratio);
          canvas.height = Math.round(size.h * ratio);
        }
        if (tracker.current && v && status === "live" && now - lastDetect > 45) {
          lastDetect = now;
          try {
            const landmarks = tracker.current.detect(v, now);
            const geometry = landmarks && handGeometry(landmarks, v.videoWidth, v.videoHeight, mirrored);
            if (geometry && recipe) {
              missed = 0;
              const target = placementFromHand(
                geometry,
                stemEnd(recipe),
                flowerSticker(recipe).height,
                { width: v.videoWidth, height: v.videoHeight },
                placementRef.current,
              );
              onPlacement(smoothPlacement(placementRef.current, target), false);
              setHand("tracking");
            } else if (++missed > 8) {
              setHand("searching");
            }
          } catch {
            setHand("error");
            setHandError("Hand tracking stopped unexpectedly.");
            tracker.current?.close();
            tracker.current = null;
          }
        }
        const ctx = context2d(canvas);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (recipe && status === "live") drawFlowerOn(ctx, recipe, placementRef.current, { x: 0, y: 0, w: canvas.width, h: canvas.height });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recipe, size, status, mirrored, onPlacement]);

  // Live digicam filter: a small copy of each frame goes through the same
  // theme renderer used for the final photo (about 15 frames a second).
  useEffect(() => {
    if (!filtered || status !== "live") return;
    let frame = 0;
    let last = 0;
    const small = makeCanvas(1, 1);
    const today = new Date();
    const draw = (now: number) => {
      const v = video.current;
      const out = look.current;
      if (v && out && v.videoWidth && now - last > 66) {
        last = now;
        const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * scale);
        const h = Math.round(v.videoHeight * scale);
        if (small.width !== w || small.height !== h) {
          small.width = w;
          small.height = h;
        }
        const sctx = context2d(small);
        sctx.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? w : 0, 0);
        sctx.drawImage(v, 0, 0, w, h);
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        const graded = renderThemed(small, { ...filterRef.current, frame: false }, { maxSize: 480, date: today, seed: Math.floor(now) });
        if (out.width !== graded.width || out.height !== graded.height) {
          out.width = graded.width;
          out.height = graded.height;
        }
        context2d(out).drawImage(graded, 0, 0);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [filtered, status, mirrored]);

  useEffect(() => () => tracker.current?.close(), []);

  const toggleHand = async () => {
    if (hand !== "off" && hand !== "error") {
      tracker.current?.close();
      tracker.current = null;
      setHand("off");
      onPlacement(placementRef.current, true);
      return;
    }
    setHand("loading");
    setHandError("");
    try {
      tracker.current = await createHandTracker();
      setHand("searching");
    } catch (error) {
      setHand("error");
      setHandError((error as Error).message);
    }
  };

  useOverlayGestures({
    container: stage,
    recipe,
    placement,
    enabled: status === "live" && (hand === "off" || hand === "error"),
    onChange: onPlacement,
  });

  const shoot = () => {
    const v = video.current;
    if (!v || status !== "live" || !v.videoWidth) return;
    const go = () => {
      setFlash((f) => f + 1);
      onCapture(captureFrame(v, mirrored), placementRef.current, "camera", filterRef.current);
    };
    if (!timer) return go();
    let left = timer;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (left <= 0) {
        window.clearInterval(tick);
        go();
      }
    }, 1000);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProblem("Please choose an image file (JPEG, PNG or WebP).");
      return;
    }
    try {
      const image = await blobToImage(file);
      onCapture(toCanvas(image, 4096), placementRef.current, "upload", filterRef.current);
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const corners = recipe && status === "live" && placement.visible && size.w ? placementCorners(recipe, placement, size) : null;
  const handleAt = corners && (hand === "off" || hand === "error") ? handlePosition(corners) : null;

  return (
    <div>
      <div ref={stage} className="viewfinder" style={{ aspectRatio: String(aspect) }} tabIndex={status === "live" ? 0 : -1}>
        <video ref={video} playsInline muted style={{ transform: mirrored ? "scaleX(-1)" : undefined, display: status === "live" ? "block" : "none" }} />
        {filtered && status === "live" && <canvas ref={look} className="stage" aria-hidden="true" />}
        <canvas ref={layer} className="stage" style={{ pointerEvents: "none" }} />
        {status === "live" && <div className="grid-lines" />}
        {handleAt && (
          <svg width={size.w} height={size.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <circle cx={handleAt[0]} cy={handleAt[1]} r={10} fill="var(--cream)" stroke="var(--night)" strokeWidth={2} />
          </svg>
        )}
        {status === "live" && (
          <div className="hud">
            <div className="hud-row">
              <span>
                <span className="lcd">●</span> {facing === "user" ? "FRONT" : "BACK"} · {video.current?.videoWidth ?? 0}×{video.current?.videoHeight ?? 0}
              </span>
              <span>
                {hand === "tracking" && "HAND ✓"}
                {hand === "searching" && "SHOW YOUR HAND"}
                {hand === "loading" && "LOADING HAND MODEL…"}
              </span>
            </div>
            <div className="hud-row">
              <span>{timer ? `TIMER ${timer}S` : "TIMER OFF"}</span>
              {!(filtered && filter.dateStamp) && (
                <span className="lcd">{new Date().toLocaleDateString(undefined, { year: "2-digit", month: "2-digit", day: "2-digit" })}</span>
              )}
            </div>
          </div>
        )}
        {status !== "live" && (
          <div className="empty-state">
            <div>
              <IconCamera width={44} height={44} style={{ color: "var(--rose)" }} />
              {status === "starting" ? (
                <p>Waiting for camera permission…</p>
              ) : (
                <>
                  <p>
                    {cameraSupported()
                      ? "Bloom Cam asks for your camera only when you press start. Nothing is recorded or sent until you save."
                      : "This browser can't open a camera here. You can still upload a photo."}
                  </p>
                  {problem && <p className="notice error">{problem}</p>}
                </>
              )}
              <div className="btn-row" style={{ justifyContent: "center" }}>
                {cameraSupported() && (
                  <button type="button" className="btn primary" disabled={status === "starting"} onClick={() => void start(facing)}>
                    <IconCamera /> Start camera
                  </button>
                )}
                <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                  <IconUpload /> Upload a photo
                </button>
              </div>
            </div>
          </div>
        )}
        {countdown > 0 && <div className="countdown">{countdown}</div>}
        <div key={flash} className={`flash-overlay${flash ? " fire" : ""}`} />
      </div>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void upload(e.target.files?.[0])} />

      {status === "live" && (
        <div className="cam-controls">
          <div className="side-tools">
            <button type="button" className="btn small quiet" onClick={() => fileInput.current?.click()}>
              <IconUpload /> Upload
            </button>
            <button type="button" className="btn small quiet" onClick={() => setTimer((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}>
              Timer {timer ? `${timer}s` : "off"}
            </button>
          </div>
          <button type="button" className="shutter" onClick={shoot} disabled={countdown > 0} aria-label="Take photo">
            <span />
          </button>
          <div className="side-tools">
            <button
              type="button"
              className="btn small quiet"
              aria-pressed={hand !== "off" && hand !== "error"}
              onClick={() => void toggleHand()}
              disabled={!recipe || hand === "loading"}
            >
              <IconHand /> {hand === "off" || hand === "error" ? "Hold with hand" : "Stop hand"}
            </button>
            {canFlip && (
              <button
                type="button"
                className="btn small quiet"
                onClick={() => {
                  const next = facing === "user" ? "environment" : "user";
                  setFacing(next);
                  void start(next);
                }}
              >
                <IconFlip /> Flip
              </button>
            )}
          </div>
        </div>
      )}
      {onTheme && (
        <div className="filter-strip" role="group" aria-label="Camera filter">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="filter-chip"
              aria-pressed={filter.preset === t.id}
              onClick={() => onTheme(defaultSettings(t.id))}
              title={t.blurb}
            >
              <span className="lens" style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
              {t.name}
            </button>
          ))}
        </div>
      )}
      {handError && <p className="notice" style={{ marginTop: 12 }}>{handError} You can still place the flower by dragging it.</p>}
    </div>
  );
}
