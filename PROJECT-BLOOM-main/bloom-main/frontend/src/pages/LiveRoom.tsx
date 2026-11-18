/**
 * A Live Bloom room. Camera and microphone stay off until you switch them on.
 * Flower, theme and layout are chosen together; capture is either together
 * (a shared countdown) or just you. Nothing is saved until you confirm.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconJournal, IconMic, IconMicOff, IconVideo, IconVideoOff } from "../components/Icons";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { Loading, SignInNeeded } from "../components/ui";
import { cameraProblem, captureFrame } from "../cam/camera";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob } from "../flower/render";
import { useOverlayGestures } from "../hooks/useOverlayGestures";
import { LAYOUTS, defaultPhotoTransform, defaultPlacement, drawFlowerOn, renderComposition, type CompositionItem, type FlowerPlacement, type LayoutId } from "../imaging/compose";
import { context2d, renderThemed } from "../imaging/process";
import { THEMES, defaultSettings, normalizeSettings, themeById, type ThemeSettings } from "../imaging/themes";
import { api, errorMessage, uploadImage } from "../lib/api";
import { localUid } from "../lib/ids";
import { LiveSession, webrtcSupported, type CapturedPhoto, type LiveStatus, type PeerInfo } from "../lib/liveSession";
import { loadProjectImage, placementFromJson, placementToJson } from "../lib/projects";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface RoomInfo {
  id: string;
  status: string;
  is_host: boolean;
  friend: PeerInfo;
}

const STATUS_TEXT: Record<LiveStatus, string> = {
  connecting: "Connecting…",
  waiting: "Waiting for your friend",
  negotiating: "Connecting video…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  failed: "Connection problem",
  closed: "Room closed",
  denied: "Not available",
};

const LIVE_LAYOUTS = LAYOUTS.filter((l) => l.id !== "stacked");

export function LiveRoomPage({ id }: { id: string }) {
  const { user, toast, store, recipe: studioRecipe } = useSession();
  const { navigate } = useRouter();
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState("");
  const [peer, setPeer] = useState<PeerInfo | null>(null);
  const [me, setMe] = useState<PeerInfo | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [peerDevices, setPeerDevices] = useState({ camera: false, mic: false });
  const [deviceError, setDeviceError] = useState("");
  const [shared, setShared] = useState<Record<string, unknown>>({});
  const [placement, setPlacement] = useState<FlowerPlacement>(() => ({ ...defaultPlacement(), x: 0.5, y: 0.45, size: 0.8 }));
  const [captures, setCaptures] = useState<CapturedPhoto[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [images, setImages] = useState<Map<number, HTMLImageElement>>(new Map());
  const [preview, setPreview] = useState<Blob | null>(null);
  const session = useRef<LiveSession | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localTile = useRef<HTMLDivElement>(null);
  const localLayer = useRef<HTMLCanvasElement>(null);
  const remoteLayer = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const camOnRef = useRef(camOn);
  camOnRef.current = camOn;
  // The session outlives renders; it calls the latest capture handler through this ref.
  const runCaptureRef = useRef<(roundId: string, seconds: number, together: boolean, by: string) => void>(() => undefined);

  const recipe: FlowerRecipe = useMemo(() => (shared.recipe ? normalizeRecipe(shared.recipe) : studioRecipe), [shared.recipe, studioRecipe]);
  const theme: ThemeSettings = useMemo(() => (shared.theme ? normalizeSettings(shared.theme) : defaultSettings("y2k")), [shared.theme]);
  const layout: LayoutId = (shared.layout as LayoutId) ?? "side-by-side";
  const peerPlacement = peer ? (shared[`placement:${peer.bloom_id}`] as Record<string, number> | undefined) : undefined;

  // --- room + connection ----------------------------------------------------
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<RoomInfo>(`/api/live/rooms/${encodeURIComponent(id)}`)
      .then((info) => {
        if (cancelled) return;
        if (info.status !== "open") {
          setError("This room has been closed. Start a new one from Live Bloom.");
          return;
        }
        setRoom(info);
        const s = new LiveSession(id, {
          onStatus: (st, detail) => {
            setStatus(st);
            setStatusDetail(detail ?? "");
          },
          onWelcome: (info2) => {
            setMe(info2.you);
            setShared(info2.state);
            setCaptures(info2.captures);
          },
          onPeer: (p) => {
            setPeer(p);
            if (!p) setPeerDevices({ camera: false, mic: false });
          },
          onRemoteStream: (stream) => setRemoteStream(stream ? new MediaStream(stream.getTracks()) : null),
          onState: (state) => setShared(state),
          onCapture: (message) => runCaptureRef.current(message.round_id, message.seconds, message.together, message.by),
          onCaptured: (capture) => setCaptures((list) => [...list.filter((c) => !(c.round_id === capture.round_id && c.bloom_id === capture.bloom_id)), capture]),
          onDevices: (d) => setPeerDevices({ camera: d.camera, mic: d.mic }),
        });
        session.current = s;
        void s.start();
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      session.current?.close();
      session.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user]);

  // Your own tracks live in a ref so quick on/off clicks never lose one.
  const tracks = useRef<{ audio: MediaStreamTrack | null; video: MediaStreamTrack | null }>({ audio: null, video: null });

  // Release the camera and microphone only when leaving the room.
  useEffect(
    () => () => {
      tracks.current.audio?.stop();
      tracks.current.video?.stop();
    },
    [],
  );

  useEffect(() => {
    const v = localVideo.current;
    if (!v) return;
    v.srcObject = localStream;
    v.play().catch(() => undefined);
  }, [localStream, camOn]);

  useEffect(() => {
    if (remoteVideo.current) {
      remoteVideo.current.srcObject = remoteStream;
      remoteVideo.current.play().catch(() => undefined);
    }
  }, [remoteStream]);

  // --- devices --------------------------------------------------------------
  const busyDevice = useRef({ audio: false, video: false });
  const toggleDevice = async (kind: "video" | "audio") => {
    if (busyDevice.current[kind]) return;
    busyDevice.current[kind] = true;
    setDeviceError("");
    try {
      const current = tracks.current[kind];
      if (current) {
        current.stop();
        tracks.current[kind] = null;
        await session.current?.setTrack(kind, null);
      } else {
        try {
          const media = await navigator.mediaDevices.getUserMedia(
            kind === "video"
              ? { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } }
              : { audio: { echoCancellation: true, noiseSuppression: true } },
          );
          tracks.current[kind] = media.getTracks()[0];
          await session.current?.setTrack(kind, tracks.current[kind]);
        } catch (e) {
          setDeviceError(kind === "video" ? cameraProblem(e) : "The microphone couldn't be started. Check your browser's permission for this site.");
        }
      }
      // Your own preview shows only the camera (never play your own microphone back).
      setLocalStream(tracks.current.video ? new MediaStream([tracks.current.video]) : null);
      setCamOn(Boolean(tracks.current.video));
      setMicOn(Boolean(tracks.current.audio));
    } finally {
      busyDevice.current[kind] = false;
    }
  };

  // --- flower layers on the videos -----------------------------------------
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      for (const [canvas, p, on] of [
        [localLayer.current, placementRef.current, camOn],
        [remoteLayer.current, peerPlacement ? placementFromJson(peerPlacement) : null, peerDevices.camera],
      ] as Array<[HTMLCanvasElement | null, FlowerPlacement | null, boolean]>) {
        if (!canvas) continue;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = context2d(canvas);
        ctx.clearRect(0, 0, w, h);
        if (on && p) drawFlowerOn(ctx, recipe, p, { x: 0, y: 0, w, h });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recipe, camOn, peerPlacement, peerDevices.camera]);

  const onPlacement = useCallback((next: FlowerPlacement, commit: boolean) => {
    setPlacement(next);
    if (commit && me) session.current?.sendState({ [`placement:${me.bloom_id}`]: placementToJson(next) });
  }, [me]);

  useOverlayGestures({ container: localTile, recipe, placement, enabled: camOn, onChange: onPlacement });

  // --- capture --------------------------------------------------------------
  const runCapture = (roundId: string, seconds: number, together: boolean, by: string) => {
    const mine = by === me?.bloom_id;
    if (!together && !mine) {
      toast("Your friend took a photo of themselves.");
      return;
    }
    let left = seconds;
    setCountdown(left);
    const tick = window.setInterval(() => {
      left -= 1;
      setCountdown(Math.max(0, left));
      if (left <= 0) {
        window.clearInterval(tick);
        void takeMyPhoto(roundId);
      }
    }, 1000);
  };

  const takeMyPhoto = async (roundId: string) => {
    const video = localVideo.current;
    if (!camOnRef.current || !video || !video.videoWidth) {
      toast("Your camera is off, so you're not in this photo.", "error");
      return;
    }
    try {
      const shot = captureFrame(video, true);
      const media = await uploadImage(await canvasToBlob(shot, "image/jpeg", 0.92), "capture", "capture.jpg");
      session.current?.sendCaptured(roundId, media.id, placementToJson(placementRef.current));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const capture = (together: boolean) => {
    const roundId = localUid().slice(0, 12);
    session.current?.startCapture(roundId, together, together ? 3 : 2);
  };

  runCaptureRef.current = runCapture;

  // Latest photo from each person.
  const latest = useMemo(() => {
    const byPerson = new Map<string, CapturedPhoto>();
    for (const c of captures) byPerson.set(c.bloom_id, c);
    return byPerson;
  }, [captures]);

  useEffect(() => {
    latest.forEach((c) => {
      if (images.has(c.media_id)) return;
      loadProjectImage(c.media_url)
        .then((img) => setImages((m) => new Map(m).set(c.media_id, img)))
        .catch(() => undefined);
    });
  }, [latest, images]);

  const compositionItemsList: CompositionItem[] = useMemo(() => {
    const order = [me?.bloom_id, peer?.bloom_id ?? room?.friend.bloom_id].filter(Boolean) as string[];
    return order.map((bloomId) => {
      const c = latest.get(bloomId);
      const img = c ? images.get(c.media_id) ?? null : null;
      const name = bloomId === me?.bloom_id ? "you" : room?.friend.display_name ?? "your friend";
      return {
        photo: img,
        photoTransform: defaultPhotoTransform(),
        recipe: img ? recipe : null,
        flower: placementFromJson(c?.placement ?? undefined),
        label: c ? "Loading…" : `No photo from ${name} yet`,
      };
    });
  }, [latest, images, me, peer, room, recipe]);

  const hasAnyCapture = compositionItemsList.some((i) => i.photo);

  useEffect(() => {
    if (!hasAnyCapture) return;
    const timer = window.setTimeout(() => {
      const out = renderThemed(renderComposition(layout, compositionItemsList, 0.45), theme, { maxSize: 1000, caption: recipe.word });
      const c = previewCanvas.current;
      if (!c) return;
      c.width = out.width;
      c.height = out.height;
      context2d(c).drawImage(out, 0, 0);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [compositionItemsList, layout, theme, recipe.word, hasAnyCapture]);

  const finalRender = () => renderThemed(renderComposition(layout, compositionItemsList, 1), theme, { maxSize: 2400, caption: recipe.word });

  const save = async (details: SaveDetails) => {
    const blob = await canvasToBlob(finalRender(), "image/jpeg", 0.92);
    const entry = await store.createEntry({
      entry_type: "composition",
      title: details.title,
      caption: details.caption,
      notes: details.notes,
      taken_at: isoFromLocalInput(details.takenAt),
      recipe,
      photo: blob,
      edit_state: {
        version: 1,
        live: true,
        layout,
        theme: { ...theme, name: themeById(theme.preset).name },
        participants: [me, peer ?? room?.friend].filter(Boolean) as PeerInfo[],
      },
      album_ids: details.albumIds,
    });
    setPreview(null);
    toast("Saved to your journal.");
    navigate(`/journal/${entry.id}`);
  };

  // --- render ---------------------------------------------------------------
  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Live Bloom" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <p className="notice error">{error}</p>
        <p style={{ marginTop: 16 }}>
          <Link to="/live">Back to Live Bloom</Link>
        </p>
      </main>
    );
  }
  if (!room) {
    return (
      <main className="page">
        <Loading label="Opening the room" />
      </main>
    );
  }

  const pillClass = status === "connected" ? "live" : status === "failed" || status === "denied" || status === "closed" ? "bad" : status === "waiting" ? "" : "warn";
  const ended = status === "closed" || status === "denied";

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">05 · Live Bloom · private room</p>
          <h1>
            With <span className="flourish">{room.friend.display_name}</span>
          </h1>
        </div>
        <div className="btn-row">
          <span className={`status-pill ${pillClass}`} role="status" aria-live="polite">
            <span className="dot" /> {STATUS_TEXT[status].toUpperCase()}
          </span>
          <button type="button" className="btn small quiet" onClick={() => navigate("/live")}>
            Leave
          </button>
          <button
            type="button"
            className="btn small quiet danger"
            onClick={async () => {
              if (!window.confirm("End this room for both of you?")) return;
              try {
                await api(`/api/live/rooms/${encodeURIComponent(id)}/close`, { method: "POST" });
              } catch {
                /* already closed */
              }
              navigate("/live");
            }}
          >
            End room
          </button>
        </div>
      </div>

      {statusDetail && <p className={`notice ${status === "failed" || ended ? "error" : ""}`} style={{ marginBottom: 18 }}>{statusDetail}</p>}
      {!webrtcSupported() && (
        <p className="notice error" style={{ marginBottom: 18 }}>
          This browser can't do live video. You can still choose flowers together and capture your own photo.
        </p>
      )}

      <div className="live-room">
        <div className="stack">
          <div className="video-pair">
            <div ref={localTile} className="video-tile" tabIndex={camOn ? 0 : -1} style={{ touchAction: "none" }}>
              {camOn ? (
                <video ref={localVideo} autoPlay playsInline muted style={{ transform: "scaleX(-1)" }} />
              ) : (
                <div className="placeholder">
                  Your camera is off.
                  <br />
                  Nothing is sent until you switch it on.
                </div>
              )}
              <canvas ref={localLayer} className="flower-layer" />
              {countdown > 0 && <div className="countdown">{countdown}</div>}
              <span className="tile-label">You {micOn ? "" : "· muted"}</span>
            </div>
            <div className="video-tile">
              <video ref={remoteVideo} autoPlay playsInline style={{ opacity: peerDevices.camera && status === "connected" ? 1 : 0 }} />
              <canvas ref={remoteLayer} className="flower-layer" />
              {!(peerDevices.camera && status === "connected") && (
                <div className="placeholder">
                  {!peer ? `Waiting for ${room.friend.display_name} to join…` : !peerDevices.camera ? `${room.friend.display_name}'s camera is off` : STATUS_TEXT[status]}
                </div>
              )}
              <span className="tile-label">
                {room.friend.display_name} {peer && !peerDevices.mic ? "· muted" : ""}
              </span>
            </div>
          </div>
          <div className="device-buttons">
            <button type="button" className="round-btn" aria-pressed={camOn} onClick={() => void toggleDevice("video")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} title={camOn ? "Turn camera off" : "Turn camera on"} disabled={ended}>
              {camOn ? <IconVideo /> : <IconVideoOff />}
            </button>
            <button type="button" className="round-btn" aria-pressed={micOn} onClick={() => void toggleDevice("audio")} aria-label={micOn ? "Mute microphone" : "Turn microphone on"} title={micOn ? "Mute microphone" : "Turn microphone on"} disabled={ended}>
              {micOn ? <IconMic /> : <IconMicOff />}
            </button>
          </div>
          {deviceError && <p className="notice error">{deviceError}</p>}
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn primary" disabled={!camOn || !peer || ended || countdown > 0} onClick={() => capture(true)} title={!peer ? "Your friend needs to be in the room" : undefined}>
              Capture together · 3s
            </button>
            <button type="button" className="btn" disabled={!camOn || ended || countdown > 0} onClick={() => capture(false)}>
              Just me
            </button>
          </div>
          <p className="muted small" style={{ textAlign: "center" }}>
            Drag the flower on your picture to place it. Each of you takes your own photo; Bloom puts them together below.
          </p>

          <section className="stack" style={{ marginTop: 18 }}>
            <header className="row between">
              <h2>Together</h2>
              <button type="button" className="btn" disabled={!hasAnyCapture} onClick={async () => setPreview(await canvasToBlob(finalRender(), "image/jpeg", 0.9))}>
                <IconJournal /> Save to my journal
              </button>
            </header>
            {hasAnyCapture ? (
              <div className="plate composition-preview">
                <canvas ref={previewCanvas} aria-label="Your photos together" />
                <div className="plate-caption">
                  <span>{LAYOUTS.find((l) => l.id === layout)?.name}</span>
                  <span className="lcd">{themeById(theme.preset).name}</span>
                </div>
              </div>
            ) : (
              <p className="muted">Your photos appear here after you capture.</p>
            )}
          </section>
        </div>

        <aside className="sheet">
          <div className="sheet-section">
            <header>
              <h3>Flower</h3>
              <span className="eyebrow">chosen together</span>
            </header>
            <RecipePicker value={recipe} onChange={(r) => session.current?.sendState({ recipe: r })} />
          </div>
          <div className="sheet-section">
            <header>
              <h3>Photo filter</h3>
              <span className="eyebrow">chosen together</span>
            </header>
            <div className="chips">
              {THEMES.map((t) => (
                <button key={t.id} type="button" className="chip" aria-pressed={theme.preset === t.id} onClick={() => session.current?.sendState({ theme: defaultSettings(t.id) })}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="sheet-section">
            <header>
              <h3>Layout</h3>
            </header>
            <div className="layout-picker">
              {LIVE_LAYOUTS.map((l) => (
                <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => session.current?.sendState({ layout: l.id })}>
                  {l.name}
                </button>
              ))}
            </div>
          </div>
          <div className="sheet-section">
            <p className="muted small">
              Video goes directly between your two browsers when possible. Photos are only shared with {room.friend.display_name} when you capture, and
              nothing is saved to a journal until you choose to save it.
            </p>
          </div>
        </aside>
      </div>

      {preview && (
        <SaveDialog
          heading="Save this moment"
          preview={preview}
          defaultTitle={`With ${room.friend.display_name}`}
          date={new Date()}
          allowKeepOriginal={false}
          onClose={() => setPreview(null)}
          onSave={save}
        />
      )}
    </main>
  );
}
