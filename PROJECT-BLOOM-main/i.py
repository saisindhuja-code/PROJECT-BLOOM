

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase8_frontend.py directly inside PROJECT-BLOOM-main.")

    # 1. Update Project type in frontend/src/lib/projects.ts
    patch(
        "frontend/src/lib/projects.ts",
        [
            (
                "  created_at: string;\n  updated_at: string;",
                "  version?: number;\n  online?: string[];\n  created_at: string;\n  updated_at: string;",
            ),
        ],
    )

    # 2. Upgrade frontend/src/pages/Project.tsx
    write_full(
        "frontend/src/pages/Project.tsx",
        r'''
/**
 * Bloom Together 2.0 project workspace:
 * - Real-time WebSocket sync (project:{id}), live presence & reconnect catch-up
 * - Twin Bloom live shared flower customization + draft preview
 * - Optimistic concurrency conflict handling (409 auto-refresh)
 * - Permission-linked Bloom Together Session Chat (<ChatView>)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "../components/CameraView";
import { ChatView } from "../components/ChatView";
import { Paints, WordField } from "../components/FlowerControls";
import { IconCamera, IconChat, IconJournal, IconPlus, IconTrash, IconUpload } from "../components/Icons";
import { OverlayControls } from "../components/OverlayControls";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { SlotEditor } from "../components/SlotEditor";
import { ThemeGallery } from "../components/ThemeGallery";
import { Avatar, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob } from "../flower/render";
import {
  LAYOUTS,
  defaultPhotoTransform,
  defaultPlacement,
  layoutSpec,
  renderComposition,
  type FlowerPlacement,
  type LayoutId,
} from "../imaging/compose";
import { context2d, renderThemed, toCanvas } from "../imaging/process";
import { themeById, type ThemeSettings } from "../imaging/themes";
import { ApiError, api, blobToImage, errorMessage, uploadImage } from "../lib/api";
import type { Conversation } from "../lib/chat";
import { localUid } from "../lib/ids";
import {
  MODES,
  compositionItems,
  fetchProject,
  loadProjectImage,
  photoFromJson,
  placementFromJson,
  placementToJson,
  projectTheme,
  sharedRecipe,
  type DraftItem,
  type Project,
} from "../lib/projects";
import { Link, useNavigationGuard, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useFriends } from "./Friends";
import { ModeDiagram } from "./Together";

export function ProjectPage({ id }: { id: number }) {
  const { user, toast, store, refreshInbox, recipe: grownRecipe, hasFlower, sendWs, subscribeWs } = useSession();
  const studioRecipe = hasFlower ? grownRecipe : null;
  const { navigate } = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [images, setImages] = useState<Map<number, HTMLImageElement>>(new Map());
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState(0);
  const [capturing, setCapturing] = useState<number | null>(null);
  const [livePlacement, setLivePlacement] = useState<FlowerPlacement>(defaultPlacement());
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [theme, setTheme] = useState<ThemeSettings | null>(null);

  const [onlinePeers, setOnlinePeers] = useState<string[]>([]);
  const [partnerDraft, setPartnerDraft] = useState<{ name: string; recipe: FlowerRecipe } | null>(null);
  const [sessionChat, setSessionChat] = useState<Conversation | null>(null);
  const [rightTab, setRightTab] = useState<"part" | "chat">("part");

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<number>(0);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const draftClearTimer = useRef<number>(0);
  const { data: friends } = useFriends();

  useNavigationGuard(dirty, "Your part has unsaved changes. Leave anyway?");

  const applyProject = useCallback((next: Project, resetDrafts: boolean) => {
    setProject(next);
    if (next.online) setOnlinePeers(next.online);
    if (next.my_status === "active") {
      setTheme((t) => (t && !resetDrafts ? t : projectTheme(next)));
      if (resetDrafts) {
        const mine = next.contributions?.find((c) => c.is_you);
        setDrafts(
          (mine?.items ?? []).map((item) => ({
            key: localUid(),
            mediaId: item.media_id,
            image: null,
            newPhoto: null,
            recipe: item.recipe,
            photo: photoFromJson(item.photo),
            flower: placementFromJson(item.flower),
          })),
        );
        setDirty(false);
      }
    }
  }, []);

  const load = useCallback(
    async (resetDrafts: boolean) => {
      try {
        applyProject(await fetchProject(id), resetDrafts);
        setError("");
      } catch (e) {
        setError(e instanceof ApiError && e.status === 404 ? "This project doesn't exist or you're no longer part of it." : errorMessage(e));
      }
    },
    [id, applyProject],
  );

  const loadChat = useCallback(() => {
    if (!user) return;
    api<Conversation>(`/api/projects/${id}/chat`)
      .then(setSessionChat)
      .catch(() => setSessionChat(null));
  }, [id, user]);

  useEffect(() => {
    if (user) void load(true);
  }, [user, load]);

  useEffect(() => {
    if (user && project?.my_status === "active") {
      loadChat();
    }
  }, [user, project?.my_status, loadChat]);

  // Real-time WebSocket synchronization for project:{id}
  useEffect(() => {
    if (!user || project?.my_status !== "active") return;
    const channel = `project:${id}`;
    sendWs({ type: "subscribe", channel });

    const unsub = subscribeWs((ev) => {
      if (ev.type === "ready") {
        sendWs({ type: "subscribe", channel });
        void load(false);
        return;
      }
      if (ev.channel !== channel && Number(ev.project_id) !== id) return;

      if (ev.type === "project.presence" && Array.isArray(ev.online)) {
        setOnlinePeers(ev.online.map(String));
      } else if (ev.type === "project.draft" && ev.bloom_id !== user.bloom_id && ev.recipe) {
        setPartnerDraft({ name: String(ev.display_name ?? "Partner"), recipe: normalizeRecipe(ev.recipe) });
        window.clearTimeout(draftClearTimer.current);
        draftClearTimer.current = window.setTimeout(() => setPartnerDraft(null), 4000);
      } else if (ev.type === "project.updated" || ev.type === "project.member") {
        if (ev.by !== user.bloom_id) {
          setPartnerDraft(null);
          void fetchProject(id)
            .then((next) => {
              setProject(next);
              setTheme(projectTheme(next));
              if (ev.type === "project.member") loadChat();
            })
            .catch(() => undefined);
        }
      } else if (ev.type === "project.closed") {
        toast("This project was closed.");
        navigate("/together");
      }
    });

    return () => {
      unsub();
      window.clearTimeout(draftClearTimer.current);
      sendWs({ type: "unsubscribe", channel });
    };
  }, [user, project?.my_status, id, sendWs, subscribeWs, load, loadChat, navigate, toast]);

  useEffect(() => {
    const ids = new Set<number>();
    project?.contributions?.forEach((c) => c.items.forEach((i) => i.media_id && i.media_url && ids.add(i.media_id)));
    ids.forEach((mediaId) => {
      if (images.has(mediaId)) return;
      const item = project!.contributions!.flatMap((c) => c.items).find((i) => i.media_id === mediaId)!;
      loadProjectImage(item.media_url!)
        .then((img) => setImages((m) => new Map(m).set(mediaId, img)))
        .catch(() => undefined);
    });
  }, [project, images]);

  useEffect(() => {
    if (!drafts) return;
    if (drafts.some((d) => d.mediaId && !d.image && images.has(d.mediaId))) {
      setDrafts((list) => list!.map((d) => (d.mediaId && !d.image && images.has(d.mediaId) ? { ...d, image: images.get(d.mediaId)! } : d)));
    }
  }, [images, drafts]);

  const layout: LayoutId = (project?.layout as LayoutId) ?? "side-by-side";
  const effectiveProject = useMemo(() => {
    if (!project || project.mode !== "twin" || !partnerDraft) return project;
    return { ...project, shared_recipe: partnerDraft.recipe };
  }, [project, partnerDraft]);

  const items = useMemo(
    () => (effectiveProject && effectiveProject.my_status === "active" ? compositionItems(effectiveProject, images, drafts) : []),
    [effectiveProject, images, drafts],
  );
  const spec = useMemo(() => layoutSpec(layout, items.length), [layout, items.length]);
  const composed = useMemo(() => (items.length ? renderComposition(layout, items, 0.5) : null), [layout, items]);

  const [gallerySource, setGallerySource] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setGallerySource(composed), 700);
    return () => window.clearTimeout(timer);
  }, [composed]);

  useEffect(() => {
    if (!composed || !theme) return;
    const timer = window.setTimeout(() => {
      const out = renderThemed(composed, theme, { maxSize: 1200, caption: project?.title ?? "" });
      const c = previewCanvas.current;
      if (!c) return;
      c.width = out.width;
      c.height = out.height;
      context2d(c).drawImage(out, 0, 0);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [composed, theme, project?.title]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Bloom Together" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="page">
        <p className="notice error">{error}</p>
        <p style={{ marginTop: 16 }}>
          <Link to="/together">Back to Bloom Together</Link>
        </p>
      </main>
    );
  }
  if (!project) {
    return (
      <main className="page">
        <Loading label="Opening the project" />
      </main>
    );
  }

  const modeInfo = MODES.find((m) => m.id === project.mode)!;

  if (project.my_status === "invited") {
    return (
      <main className="page">
        <div className="panel stack" style={{ maxWidth: 560 }}>
          <ModeDiagram mode={project.mode} />
          <p className="eyebrow">Invitation · {modeInfo.name}</p>
          <h1>{project.title}</h1>
          <p className="muted">
            {project.owner.display_name} would like to make this with you. {modeInfo.text} Once you join, you'll see each
            other's photos and session chat for this project.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                try {
                  applyProject(await api<Project>(`/api/projects/${id}/accept`, { method: "POST" }), true);
                  refreshInbox();
                  loadChat();
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              Join project
            </button>
            <button
              type="button"
              className="btn quiet"
              onClick={async () => {
                try {
                  await api(`/api/projects/${id}/decline`, { method: "POST" });
                  refreshInbox();
                  navigate("/together");
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              Decline
            </button>
          </div>
        </div>
      </main>
    );
  }

  const shared = sharedRecipe(effectiveProject ?? project);
  const myDrafts = drafts ?? [];
  const maxItems = modeInfo.max;
  const members = project.members ?? [];
  const others = members.filter((m) => !m.is_you);
  const partnerOnline = others.some((m) => onlinePeers.includes(m.bloom_id));

  let myFirstIndex = 0;
  for (const m of members.filter((mm) => mm.status === "active")) {
    if (m.is_you) break;
    const c = project.contributions?.find((cc) => cc.bloom_id === m.bloom_id);
    myFirstIndex += Math.max(1, c?.items.length ?? 0);
  }
  const slotFor = (draftIndex: number) => spec.slots[myFirstIndex + draftIndex] ?? spec.slots[0];

  const patchProject = async (body: Record<string, unknown>) => {
    try {
      const next = await api<Project>(`/api/projects/${id}`, {
        method: "PATCH",
        body: { ...body, expected_version: project.version },
      });
      setProject(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast("Synced with your partner's latest update.");
        await load(false);
      } else {
        toast(errorMessage(e), "error");
      }
    }
  };

  const broadcastTwinDraft = (recipe: FlowerRecipe) => {
    setProject((p) => (p ? { ...p, shared_recipe: recipe } : p));
    sendWs({ type: "project.draft", channel: `project:${id}`, recipe });
  };

  const updateDraft = (index: number, patchItem: Partial<DraftItem>) => {
    setDrafts((list) => list!.map((d, i) => (i === index ? { ...d, ...patchItem } : d)));
    setDirty(true);
  };

  const addDraft = (photo: HTMLCanvasElement | null, flower?: FlowerPlacement) => {
    const recipe: FlowerRecipe | null = project.mode === "twin" ? null : studioRecipe;
    setDrafts((list) => [
      ...(list ?? []),
      { key: localUid(), mediaId: null, image: photo, newPhoto: photo, recipe, photo: defaultPhotoTransform(), flower: flower ?? defaultPlacement() },
    ]);
    setSelected(myDrafts.length);
    setDirty(true);
  };

  const setPhotoFor = (index: number, photo: HTMLCanvasElement, flower?: FlowerPlacement) => {
    if (index >= myDrafts.length) addDraft(photo, flower);
    else updateDraft(index, { image: photo, newPhoto: photo, mediaId: null, photo: defaultPhotoTransform(), ...(flower ? { flower } : {}) });
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await blobToImage(file);
      setPhotoFor(uploadFor.current, toCanvas(img, 3000));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const saveMyPart = async () => {
    setSaving(true);
    try {
      const uploaded: DraftItem[] = [];
      for (const draft of myDrafts) {
        if (draft.newPhoto) {
          const media = await uploadImage(await canvasToBlob(draft.newPhoto, "image/jpeg", 0.92), "contribution", "photo.jpg");
          uploaded.push({ ...draft, mediaId: media.id, newPhoto: null });
        } else {
          uploaded.push(draft);
        }
      }
      const next = await api<Project>(`/api/projects/${id}/contribution`, {
        method: "PUT",
        body: {
          items: uploaded.map((d) => ({
            media_id: d.mediaId,
            recipe: project.mode === "twin" ? null : d.recipe,
            photo: { zoom: d.photo.zoom, panX: d.photo.panX, panY: d.photo.panY, rotation: d.photo.rotation },
            flower: placementToJson(d.flower),
          })),
        },
      });
      setProject(next);
      setDrafts(uploaded);
      setDirty(false);
      toast(others.length ? `Saved & synced with ${others[0].display_name}.` : "Saved.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const openSave = async () => {
    const full = renderThemed(renderComposition(layout, items, 1), theme!, { maxSize: 2400, caption: project.title });
    setPreview(await canvasToBlob(full, "image/jpeg", 0.9));
  };

  const saveToJournal = async (details: SaveDetails) => {
    const full = renderThemed(renderComposition(layout, items, 1), theme!, { maxSize: 2400, caption: project.title });
    const blob = await canvasToBlob(full, "image/jpeg", 0.92);
    const entry = await store.createEntry({
      entry_type: "composition",
      title: details.title,
      caption: details.caption,
      notes: details.notes,
      taken_at: isoFromLocalInput(details.takenAt),
      recipe: shared ?? myDrafts.find((d) => d.recipe)?.recipe ?? null,
      photo: blob,
      edit_state: { version: 1, layout, theme: { ...theme!, name: themeById(theme!.preset).name }, mode: project.mode },
      project_id: project.id,
      album_ids: details.albumIds,
    });
    setPreview(null);
    toast("Saved to your journal.");
    navigate(`/journal/${entry.id}`);
  };

  const membersPanel = (
    <section className="sheet-section">
      <header>
        <h3>People</h3>
        <span className="eyebrow">private to you two</span>
      </header>
      {members.map((m) => (
        <div key={m.bloom_id} className="person">
          <Avatar name={m.display_name} />
          <div className="who">
            <strong>
              {m.display_name} {m.is_you && <span className="muted small">(you)</span>}
            </strong>
            <span className="muted small">
              {m.role === "owner" ? "started this" : m.status === "invited" ? "invited, hasn't joined yet" : onlinePeers.includes(m.bloom_id) ? "here now" : "joined"}
            </span>
          </div>
          {project.is_owner && !m.is_you && (
            <button
              type="button"
              className="btn small quiet danger"
              onClick={async () => {
                if (!window.confirm(`Remove ${m.display_name}? They'll lose access to the project & session chat.`)) return;
                try {
                  await api(`/api/projects/${id}/members/${encodeURIComponent(m.bloom_id)}`, { method: "DELETE" });
                  await load(false);
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              {m.status === "invited" ? "Cancel invite" : "Remove"}
            </button>
          )}
        </div>
      ))}
      {project.is_owner && members.length < 2 && (
        <label className="field">
          <span>Invite a friend</span>
          <select
            value=""
            onChange={async (e) => {
              if (!e.target.value) return;
              try {
                setProject(await api<Project>(`/api/projects/${id}/invite`, { body: { bloom_id: e.target.value } }));
                toast("Invitation sent.");
              } catch (err) {
                toast(errorMessage(err), "error");
              }
            }}
          >
            <option value="">Choose a friend…</option>
            {friends?.friends.map((f) => (
              <option key={f.bloom_id} value={f.bloom_id}>
                {f.display_name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="btn-row">
        {project.is_owner ? (
          <button
            type="button"
            className="btn small quiet danger"
            onClick={async () => {
              if (!window.confirm("Close this project for everyone? Copies already saved in journals stay there.")) return;
              try {
                await api(`/api/projects/${id}`, { method: "DELETE" });
                navigate("/together");
              } catch (e) {
                toast(errorMessage(e), "error");
              }
            }}
          >
            <IconTrash /> Close project
          </button>
        ) : (
          <button
            type="button"
            className="btn small quiet danger"
            onClick={async () => {
              if (!window.confirm("Leave this project? Your photos will be removed from it.")) return;
              try {
                await api(`/api/projects/${id}/leave`, { method: "POST" });
                navigate("/together");
              } catch (e) {
                toast(errorMessage(e), "error");
              }
            }}
          >
            Leave project
          </button>
        )}
      </div>
    </section>
  );

  const current = myDrafts[selected];
  const currentRecipe = project.mode === "twin" ? shared : current?.recipe ?? null;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            04 · Together 2.0 · {modeInfo.name} · v{project.version ?? 1} · updated {formatDate(project.updated_at)}
          </p>
          <h1>{project.title}</h1>
        </div>
        <div className="btn-row">
          <span className={`status-pill ${partnerOnline ? "live" : "ok"}`}>
            <span className="dot" /> {partnerOnline ? "BOTH HERE · LIVE SYNC" : "SYNCED"}
          </span>
          <button type="button" className="btn primary" onClick={() => void saveMyPart()} disabled={!dirty || saving}>
            {saving && <span className="spinner" />} Save my part
          </button>
          <button type="button" className="btn" onClick={() => void openSave()} disabled={!theme}>
            <IconJournal /> Save to my journal
          </button>
        </div>
      </div>

      {partnerDraft && (
        <p className="notice" style={{ marginBottom: 16 }}>
          {partnerDraft.name} is updating the shared flower…
        </p>
      )}

      <div className="together">
        <div className="stack">
          <div className="plate composition-preview">
            <canvas ref={previewCanvas} aria-label="The combined picture" />
            <div className="plate-caption">
              <span>{spec.name}</span>
              <span className="lcd">{theme ? themeById(theme.preset).name : ""}</span>
            </div>
          </div>
          <section className="sheet">
            <div className="sheet-section">
              <header>
                <h3>Layout</h3>
                <span className="eyebrow">shared</span>
              </header>
              <div className="layout-picker">
                {LAYOUTS.map((l) => {
                  const unavailable =
                    (l.id === "diagonal" && items.length !== 2) ||
                    (l.id === "overlap" && items.length < 2);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={spec.id === l.id}
                      disabled={unavailable}
                      title={
                        unavailable
                          ? l.id === "diagonal"
                            ? "Diagonal works with 2 pictures"
                            : "Picture in picture needs at least 2 pictures"
                          : l.hint
                      }
                      onClick={() => void patchProject({ layout: l.id })}
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="sheet-section">
              <header>
                <h3>Photo filter</h3>
                <span className="eyebrow">shared</span>
              </header>
              {theme && (
                <ThemeGallery
                  source={gallerySource}
                  value={theme}
                  caption={project.title}
                  onChange={(next, commit) => {
                    setTheme(next);
                    if (commit) void patchProject({ theme_state: next });
                  }}
                />
              )}
            </div>
            {project.mode === "twin" && (
              <div className="sheet-section">
                <header>
                  <h3>The flower you both hold</h3>
                  <span className="eyebrow">synced live</span>
                </header>
                {shared && (
                  <div className="stack">
                    <WordField recipe={shared} onChange={broadcastTwinDraft} />
                    <Paints recipe={shared} onChange={broadcastTwinDraft} />
                    <button
                      type="button"
                      className="btn small primary"
                      style={{ justifySelf: "start" }}
                      onClick={() => void patchProject({ shared_recipe: shared })}
                    >
                      Save shared flower changes
                    </button>
                  </div>
                )}
                <RecipePicker value={shared} onChange={(recipe) => void patchProject({ shared_recipe: recipe })} />
              </div>
            )}
          </section>
        </div>

        <aside className="sheet">
          <div className="sheet-section">
            <div className="segmented" role="group" aria-label="Workspace panel">
              <button type="button" aria-pressed={rightTab === "part"} onClick={() => setRightTab("part")}>
                Your part &amp; people
              </button>
              <button type="button" aria-pressed={rightTab === "chat"} onClick={() => setRightTab("chat")}>
                <IconChat width={14} height={14} /> Session chat
                {sessionChat && sessionChat.unread_count > 0 ? ` (${sessionChat.unread_count})` : ""}
              </button>
            </div>
          </div>

          {rightTab === "chat" ? (
            <div className="together-chat-box">
              {sessionChat ? (
                <ChatView conversation={sessionChat} onUpdated={loadChat} />
              ) : (
                <Loading label="Opening session chat" />
              )}
            </div>
          ) : (
            <>
              <section className="sheet-section">
                <header>
                  <h3>Your part</h3>
                  <span className="eyebrow">{dirty ? "unsaved" : "saved"}</span>
                </header>
                {myDrafts.length > 1 && (
                  <div className="chips">
                    {myDrafts.map((d, i) => (
                      <button key={d.key} type="button" className="chip" aria-pressed={selected === i} onClick={() => setSelected(i)}>
                        Picture {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                {current ? (
                  <div className="slot-editor">
                    <SlotEditor
                      image={current.image}
                      recipe={currentRecipe}
                      photo={current.photo}
                      flower={current.flower}
                      aspect={slotFor(selected).w / slotFor(selected).h}
                      onPhoto={(photo) => updateDraft(selected, { photo })}
                      onFlower={(flower) => updateDraft(selected, { flower })}
                    />
                    <div className="btn-row">
                      <button type="button" className="btn small" onClick={() => setCapturing(selected)}>
                        <IconCamera /> {current.image ? "Retake" : "Take photo"}
                      </button>
                      <button
                        type="button"
                        className="btn small quiet"
                        onClick={() => {
                          uploadFor.current = selected;
                          fileInput.current?.click();
                        }}
                      >
                        <IconUpload /> Upload
                      </button>
                      <button
                        type="button"
                        className="btn small quiet danger"
                        onClick={() => {
                          setDrafts((list) => list!.filter((_, i) => i !== selected));
                          setSelected(0);
                          setDirty(true);
                        }}
                      >
                        <IconTrash /> Remove
                      </button>
                    </div>
                    {currentRecipe && <OverlayControls value={current.flower} onChange={(flower) => updateDraft(selected, { flower })} />}
                    {project.mode !== "twin" && (
                      <div className="stack tight">
                        <span className="label">Your flower</span>
                        <RecipePicker value={current.recipe} onChange={(recipe) => updateDraft(selected, { recipe })} />
                        {current.recipe && (
                          <button type="button" className="btn small quiet" style={{ justifySelf: "start" }} onClick={() => updateDraft(selected, { recipe: null })}>
                            No flower on this picture
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted">Add your photo{project.mode === "moment" ? "s and flowers" : ""}. Your friend sees it once you save your part.</p>
                )}
                {myDrafts.length < maxItems && (
                  <div className="btn-row">
                    <button type="button" className="btn small" onClick={() => setCapturing(myDrafts.length)}>
                      <IconCamera /> Take a photo
                    </button>
                    <button
                      type="button"
                      className="btn small quiet"
                      onClick={() => {
                        uploadFor.current = myDrafts.length;
                        fileInput.current?.click();
                      }}
                    >
                      <IconUpload /> Upload
                    </button>
                    {project.mode === "moment" && (
                      <button type="button" className="btn small quiet" onClick={() => addDraft(null)}>
                        <IconPlus /> Flower only
                      </button>
                    )}
                  </div>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void onUpload(file);
                  }}
                />
              </section>
              <section className="sheet-section">
                <header>
                  <h3>Their part</h3>
                </header>
                {others.length === 0 && <p className="muted small">Nobody else yet. Invite a friend below.</p>}
                {others.map((m) => {
                  const c = project.contributions?.find((cc) => cc.bloom_id === m.bloom_id);
                  return (
                    <p key={m.bloom_id} className="muted small">
                      {m.status === "invited"
                        ? `${m.display_name} hasn't accepted the invitation yet.`
                        : c && c.items.length
                          ? `${m.display_name} added ${c.items.length} picture${c.items.length > 1 ? "s" : ""} · ${formatDate(c.updated_at)}`
                          : `Waiting for ${m.display_name}'s photo.`}
                    </p>
                  );
                })}
              </section>
              {membersPanel}
            </>
          )}
        </aside>
      </div>

      {capturing !== null && (
        <Modal title="Take your photo" onClose={() => setCapturing(null)} wide>
          <CameraView
            recipe={project.mode === "twin" ? shared : myDrafts[capturing]?.recipe ?? null}
            placement={livePlacement}
            onPlacement={setLivePlacement}
            autoStart
            onCapture={(photo, placement) => {
              setPhotoFor(capturing, photo, placement);
              setCapturing(null);
            }}
          />
        </Modal>
      )}

      {preview && (
        <SaveDialog
          heading="Save to your journal"
          preview={preview}
          defaultTitle={project.title}
          date={new Date()}
          allowKeepOriginal={false}
          onClose={() => setPreview(null)}
          onSave={saveToJournal}
          extra={
            others.some((m) => m.status === "active" && !project.contributions?.some((c) => c.bloom_id === m.bloom_id && c.items.length)) ? (
              <p className="notice">Your friend hasn't added their part yet. You can save now, or wait for the complete picture.</p>
            ) : undefined
          }
        />
      )}
    </main>
  );
}
''',
    )

    # 3. Add together-chat-box CSS in app.css
    app_css = ROOT / "frontend" / "src" / "styles" / "app.css"
    css_text = app_css.read_text(encoding="utf-8")
    extra_css = r'''
.together-chat-box {
  height: 540px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--night);
  margin-top: 12px;
}
'''
    if ".together-chat-box {" not in css_text:
        css_text += "\n" + extra_css.lstrip("\n")
        app_css.write_text(css_text, encoding="utf-8")
        print("Patched frontend/src/styles/app.css")
    else:
        print("Skipped frontend/src/styles/app.css (already present)")

    print("\nPhase 8B (Frontend Bloom Together 2.0 & Session Chat) applied successfully.")


if __name__ == "__main__":
    main()
```

---

### Step 2: Build, Verify & Save Phase 8 Git Checkpoint

```powershell
python apply_phase8_frontend.py
del apply_phase8_frontend.py -ErrorAction SilentlyContinue
cd frontend
npm run typecheck
npm run build
cd ..
```

Once `typecheck` and `build` pass with **0 errors**, commit Phase 8:
```powershell
git add -A
git commit -m "phase 8: bloom together 2.0 real-time ws sync, twin flower live editing, conflict handling & session chat"
```

Paste the build output here, and we'll move right into **PHASE 9 — Complete UI Integration & Responsive Navigation**!
# PHASE 9 — Complete UI Integration & Responsive Navigation

### 1. Affected Files Inspected
* `frontend/src/components/Icons.tsx`
* `frontend/src/pages/Chat.tsx`
* `frontend/src/pages/Home.tsx`
* `frontend/src/App.tsx`
* `frontend/src/styles/app.css`

### 2. Implementation Plan
1. **Complete Navigation Coverage (`App.tsx`, `Icons.tsx`):**
   * Desktop header cleanly links **Studio**, **Cam**, **Journal**, **Together**, **Live**, **Chat** (with live unread badge), and **Friends**, plus header tools for **Notifications** (`/notifications` with unread count), **Inbox** modal, **Website Themes**, and an **Account & Profile Menu** (`My Profile`, `Account & Settings`, `Shared Feed`, `Studio Chat`, `New Scrapbook`, `Sign out`).
   * Tablet/Mobile (`<= 860px`): 5-item bottom tab bar (`Studio`, `Cam`, `Journal`, `Together`, `Chat`) plus a clean **Menu drawer** giving 1-tap access to all 11 Bloom areas (Home, Studio, Cam, Journal, Scrapbook, Together, Live, Messages, Studio Chat, Friends, Feed, Notifications, Profile, Settings, Themes).
2. **Direct Tab Deep-Linking (`Chat.tsx`):**
   * Supports `/chat?tab=dm`, `/chat?tab=group`, and `/chat?tab=studio` so clicking **Studio Chat** or **Messages** opens directly to that area.
3. **Home Page Integration (`Home.tsx`):**
   * Updates the feature overview cards to reflect Bloom 2.0 (Flower Studio 2.0, Bloom Cam 2.0, Scrapbook & Journal, Bloom Together & Live, Unified Bloom Chat, Profiles & Community) while preserving Bloom's editorial visual identity.

---

### Step 1: Create and Run `apply_phase9_ui.py`

Create **`apply_phase9_ui.py`** inside **`PROJECT-BLOOM-main`**, paste this script, save, and run `python apply_phase9_ui.py`:

```python
"""Phase 9 (Complete UI Integration & Responsive Navigation) for Bloom 2.0."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase9_ui.py directly inside PROJECT-BLOOM-main.")

    # 1. Add IconMenu to Icons.tsx
    patch(
        "frontend/src/components/Icons.tsx",
        [
            (
                "export function BloomMark(p: IconProps) {",
                r'''export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export function BloomMark(p: IconProps) {''',
            ),
        ],
    )

    # 2. Support ?tab=dm|group|studio in Chat.tsx
    patch(
        "frontend/src/pages/Chat.tsx",
        [
            (
                '  const { navigate } = useRouter();',
                '  const { navigate, query } = useRouter();',
            ),
            (
                '  const [kindFilter, setKindFilter] = useState<ChatKind | "all">("all");',
                '  const tabParam = query.get("tab");\n'
                '  const initialKind: ChatKind | "all" =\n'
                '    tabParam === "dm" || tabParam === "group" || tabParam === "studio" ? tabParam : "all";\n'
                '  const [kindFilter, setKindFilter] = useState<ChatKind | "all">(initialKind);\n\n'
                '  useEffect(() => {\n'
                '    if (tabParam === "dm" || tabParam === "group" || tabParam === "studio") {\n'
                '      setKindFilter(tabParam);\n'
                '    }\n'
                '  }, [tabParam]);',
            ),
        ],
    )

    # 3. Update Home.tsx feature cards for Bloom 2.0
    write_full(
        "frontend/src/pages/Home.tsx",
        r'''
import { FlowerPreview } from "../components/FlowerPreview";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

const FEATURES = [
  { to: "/studio", num: "01", title: "Studio", text: "Grow custom petal shapes, spiral blooms, inscriptions and themes from any word." },
  { to: "/cam", num: "02", title: "Bloom Cam", text: "Multi-flower overlays, hand-tracking, photo crop, Polaroids, strips and contact sheets." },
  { to: "/journal", num: "03", title: "Journal & Scrapbook", text: "Compose digital scrapbook pages with stickers, tape, doodles, drawings and collections." },
  { to: "/together", num: "04", title: "Bloom Together", text: "Collaborate live on Twin Bloom, Two Blooms or Our Moment with built-in session chat." },
  { to: "/live", num: "05", title: "Live Bloom", text: "See each other on camera, pick a flower together and capture the shot at once." },
  { to: "/chat", num: "06", title: "Bloom Chat", text: "Private DMs, voice notes, group chats and Studio Chat rooms with friends." },
  { to: "/activity", num: "07", title: "Friends & Feed", text: "Share flowers and journal pages on your profile, follow friends and react together." },
];

export function HomePage() {
  const { recipe, user, ready, serverOnline, deviceMode, useThisDevice, hasFlower } = useSession();
  const { navigate } = useRouter();
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">A creative &amp; social journal of flowers grown from words</p>
          <h1>
            Say it with <span className="flourish">a flower</span> made of your own words.
          </h1>
          <p className="lede">
            Bloom writes your word along every petal of a hand-coded flower, lets you photograph and scrapbook it,
            and share creations privately or live with the people you care about.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => navigate("/studio")}>
              Grow a flower
            </button>
            <Link to="/scrapbook" className="btn">
              Open Scrapbook
            </Link>
            {ready && !user && serverOnline && !deviceMode && (
              <>
                <Link to="/signup" className="btn">
                  Create an account
                </Link>
                <button type="button" className="btn quiet" onClick={useThisDevice}>
                  Just use this device
                </button>
              </>
            )}
            {user && (
              <Link to="/journal" className="btn">
                Open {user.display_name}'s journal
              </Link>
            )}
          </div>
        </div>
        <div className="plate">
          <FlowerPreview recipe={recipe} />
          <div className="plate-caption">
            <span>{hasFlower ? `Plate I · “${recipe.word}”` : "A sample flower"}</span>
            <span className="lcd">{hasFlower ? "your last bloom" : "grow your own in the studio"}</span>
          </div>
        </div>
      </section>
      <section className="feature-row" aria-label="What you can do">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="feature">
            <span className="num">{f.num}</span>
            <h3>{f.title}</h3>
            <span>{f.text}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
''',
    )

    # 4. Update App.tsx with complete responsive navigation (desktop + mobile drawer + account menu)
    write_full(
        "frontend/src/App.tsx",
        r'''
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BloomMark,
  IconBell,
  IconCamera,
  IconChat,
  IconFlower,
  IconInbox,
  IconJournal,
  IconLive,
  IconMenu,
  IconTogether,
  IconUsers,
} from "./components/Icons";
import { Avatar, Loading, Modal, Toasts } from "./components/ui";
import { api, errorMessage } from "./lib/api";
import { Link, RouterProvider, matchPath, useRouter } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { AccountPage } from "./pages/Account";
import { ActivityPage } from "./pages/Activity";
import { AuthPage } from "./pages/Auth";
import { CamPage } from "./pages/Cam";
import { ChatPage } from "./pages/Chat";
import { EntryPage } from "./pages/Entry";
import { FriendsPage } from "./pages/Friends";
import { HomePage } from "./pages/Home";
import { JournalPage } from "./pages/Journal";
import { LivePage } from "./pages/Live";
import { LiveRoomPage } from "./pages/LiveRoom";
import { NotificationsPage } from "./pages/Notifications";
import { ProfilePage } from "./pages/Profile";
import { ProjectPage } from "./pages/Project";
import { ScrapbookEditorPage } from "./pages/ScrapbookEditor";
import { StudioPage } from "./pages/Studio";
import { ThemesPage } from "./pages/Themes";
import { TogetherPage } from "./pages/Together";
import { ThemeDecor } from "./theme/ThemeDecor";
import { ThemeMenu } from "./theme/ThemeMenu";
import { ThemeProvider } from "./theme/ThemeProvider";

const NAV = [
  { to: "/studio", label: "Studio", num: "01", icon: IconFlower },
  { to: "/cam", label: "Cam", num: "02", icon: IconCamera },
  { to: "/journal", label: "Journal", num: "03", icon: IconJournal },
  { to: "/together", label: "Together", num: "04", icon: IconTogether },
  { to: "/live", label: "Live", num: "05", icon: IconLive },
  { to: "/chat", label: "Chat", num: "06", icon: IconChat },
  { to: "/friends", label: "Friends", num: "07", icon: IconUsers },
];

const TABBAR_NAV = [
  { to: "/studio", label: "Studio", icon: IconFlower },
  { to: "/cam", label: "Cam", icon: IconCamera },
  { to: "/journal", label: "Journal", icon: IconJournal },
  { to: "/together", label: "Together", icon: IconTogether },
  { to: "/chat", label: "Chat", icon: IconChat },
];

const ROUTES: Array<{ path: string; render: (params: Record<string, string>) => ReactNode }> = [
  { path: "/", render: () => <HomePage /> },
  { path: "/studio", render: () => <StudioPage /> },
  { path: "/cam", render: () => <CamPage /> },
  { path: "/journal", render: () => <JournalPage /> },
  { path: "/journal/:id", render: (p) => <EntryPage id={p.id} /> },
  { path: "/scrapbook", render: () => <ScrapbookEditorPage /> },
  { path: "/scrapbook/:id", render: (p) => <ScrapbookEditorPage id={p.id} /> },
  { path: "/friends", render: () => <FriendsPage /> },
  { path: "/activity", render: () => <ActivityPage /> },
  { path: "/notifications", render: () => <NotificationsPage /> },
  { path: "/chat", render: () => <ChatPage /> },
  { path: "/chat/:id", render: (p) => <ChatPage conversationId={p.id} /> },
  { path: "/together", render: () => <TogetherPage /> },
  { path: "/together/:id", render: (p) => <ProjectPage id={Number(p.id)} /> },
  { path: "/live", render: () => <LivePage /> },
  { path: "/live/:id", render: (p) => <LiveRoomPage id={p.id} /> },
  { path: "/signin", render: () => <AuthPage mode="signin" /> },
  { path: "/signup", render: () => <AuthPage mode="signup" /> },
  { path: "/account", render: () => <AccountPage /> },
  { path: "/profile", render: () => <ProfilePage /> },
  { path: "/profile/:bloomId", render: (p) => <ProfilePage bloomId={p.bloomId} /> },
  { path: "/themes", render: () => <ThemesPage /> },
];

function Routes() {
  const { path } = useRouter();
  const { ready } = useSession();
  if (!ready) {
    return (
      <main className="page">
        <Loading label="Opening Bloom" />
      </main>
    );
  }
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (params) return <>{route.render(params)}</>;
  }
  return (
    <main className="page">
      <h1>This page wandered off</h1>
      <p className="lede" style={{ marginTop: 12 }}>
        <Link to="/">Back to Bloom</Link>
      </p>
    </main>
  );
}

function InboxDialog({ onClose }: { onClose: () => void }) {
  const { inbox, refreshInbox, toast } = useSession();
  const { navigate } = useRouter();
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message);
      refreshInbox();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  const empty = !inbox || inbox.count === 0;
  return (
    <Modal title="Inbox" onClose={onClose}>
      {empty && <p className="muted">Nothing waiting for you. Friend requests and invitations appear here.</p>}
      {inbox?.live_invites.map((room) => (
        <div key={room.id} className="person">
          <span className="status-pill live">
            <span className="dot" /> LIVE
          </span>
          <div className="who">
            <strong>{room.friend.display_name}</strong>
            <span className="muted small">is waiting in a Live Bloom room</span>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              onClose();
              navigate(`/live/${room.id}`);
            }}
          >
            Join
          </button>
        </div>
      ))}
      {inbox?.project_invites.map((invite) => (
        <div key={invite.id} className="person">
          <div className="who">
            <strong>{invite.title}</strong>
            <span className="muted small">
              {invite.owner} invited you to a {invite.mode === "twin" ? "Twin Bloom" : invite.mode === "two" ? "Two Blooms" : "Our Moment"} project
            </span>
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              onClose();
              navigate(`/together/${invite.id}`);
            }}
          >
            View
          </button>
        </div>
      ))}
      {inbox?.friend_requests.map((request) => (
        <div key={request.request_id} className="person">
          <div className="who">
            <strong>{request.display_name}</strong>
            <span className="bloom-id">{request.bloom_id}</span>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/accept`, { method: "POST" }), `You and ${request.display_name} are friends now.`)}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn small quiet"
            onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/decline`, { method: "POST" }), "Request declined.")}
          >
            Decline
          </button>
        </div>
      ))}
    </Modal>
  );
}

function Shell() {
  const { path, navigate } = useRouter();
  const { user, inbox, unreadNotifications, unreadChat, serverOnline, deviceMode, ready, signOut } = useSession();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);

  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !userMenuRef.current?.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [userMenuOpen]);

  return (
    <>
      <ThemeDecor />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="watercolor">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="6" />
        </filter>
      </svg>
      <header className="app-header">
        <Link to="/" className="wordmark" aria-label="Bloom home">
          <BloomMark />
          bloom
        </Link>
        <nav className="main-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
              <span className="num">{item.num}</span>
              {item.label}
              {item.to === "/chat" && unreadChat > 0 && <span className="nav-dot-badge">{unreadChat}</span>}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <ThemeMenu />
          {ready && !serverOnline && (
            <span className="status-pill warn optional" title="The Bloom server can't be reached. Things are saved on this device.">
              <span className="dot" /> OFFLINE · THIS DEVICE
            </span>
          )}
          {ready && serverOnline && deviceMode && (
            <span className="status-pill optional">
              <span className="dot" /> THIS DEVICE
            </span>
          )}
          {user && (
            <>
              <Link to="/notifications" className="btn icon quiet inbox-button" aria-label={`Notifications, ${unreadNotifications} unread`}>
                <IconBell />
                {unreadNotifications > 0 && <span className="badge">{unreadNotifications}</span>}
              </Link>
              <button type="button" className="btn icon quiet inbox-button optional-desktop" onClick={() => setInboxOpen(true)} aria-label={`Inbox, ${inbox?.count ?? 0} waiting`}>
                <IconInbox />
                {inbox && inbox.count > 0 && <span className="badge">{inbox.count}</span>}
              </button>
              <div className="appearance" ref={userMenuRef}>
                <button
                  type="button"
                  className="btn small quiet user-menu-trigger"
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((o) => !o)}
                >
                  <Avatar name={user.display_name} src={user.avatar_url} />
                  <span className="optional-text">{user.display_name}</span>
                </button>
                {userMenuOpen && (
                  <div className="appearance-menu user-dropdown" role="menu">
                    <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                    <Link to="/account" className="menu-item-link">Account &amp; Settings</Link>
                    <Link to="/scrapbook" className="menu-item-link">New Scrapbook Page</Link>
                    <Link to="/activity" className="menu-item-link">Shared Feed</Link>
                    <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
                    <Link to="/themes" className="menu-item-link">Website Themes</Link>
                    <div className="divider" />
                    <button
                      type="button"
                      className="menu-item-link danger"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                        navigate("/");
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {!user && ready && serverOnline && (
            <Link to="/signin" className="btn small">
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="btn icon quiet mobile-menu-btn"
            aria-label="Open navigation menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <IconMenu />
          </button>
        </div>
      </header>
      <Routes />
      <nav className="tabbar" aria-label="Main">
        {TABBAR_NAV.map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <item.icon />
              {item.to === "/chat" && unreadChat > 0 && <span className="tabbar-badge">{unreadChat}</span>}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      {inboxOpen && <InboxDialog onClose={() => setInboxOpen(false)} />}
      {mobileMenuOpen && (
        <Modal title="Bloom Navigation" onClose={() => setMobileMenuOpen(false)}>
          <div className="mobile-nav-grid">
            <Link to="/" className="menu-item-link">Home</Link>
            <Link to="/studio" className="menu-item-link">Flower Studio</Link>
            <Link to="/cam" className="menu-item-link">Bloom Cam</Link>
            <Link to="/journal" className="menu-item-link">Journal</Link>
            <Link to="/scrapbook" className="menu-item-link">Scrapbook Editor</Link>
            <Link to="/together" className="menu-item-link">Bloom Together</Link>
            <Link to="/live" className="menu-item-link">Live Bloom</Link>
            <Link to="/chat?tab=dm" className="menu-item-link">Messages (Personal &amp; Groups)</Link>
            <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
            <Link to="/friends" className="menu-item-link">Friends</Link>
            <Link to="/activity" className="menu-item-link">Shared Feed</Link>
            <Link to="/notifications" className="menu-item-link">Notifications ({unreadNotifications})</Link>
            {user && (
              <>
                <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                <Link to="/account" className="menu-item-link">Settings &amp; Privacy</Link>
              </>
            )}
            <Link to="/themes" className="menu-item-link">Website Themes</Link>
          </div>
        </Modal>
      )}
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
''',
    )

    # 5. Update styles/app.css with nav dropdown, badges, mobile menu, and tablet nav responsiveness
    app_css = ROOT / "frontend" / "src" / "styles" / "app.css"
    css_text = app_css.read_text(encoding="utf-8")
    extra_nav_css = r'''
/* ---------------------------------------------------------------------
   Phase 9 Navigation & Responsive Polish
   --------------------------------------------------------------------- */

.nav-dot-badge {
  display: inline-grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--rose);
  color: var(--on-accent);
  font: 600 10px/1 var(--body);
}

.tabbar-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--rose);
  color: var(--on-accent);
  font: 600 9px/15px var(--body);
  text-align: center;
}

.user-menu-trigger {
  padding: 2px 10px 2px 4px;
  gap: 8px;
}

.user-menu-trigger .avatar {
  width: 28px;
  height: 28px;
  font-size: 13px;
}

.user-dropdown {
  width: 220px;
  gap: 4px;
  padding: 10px;
}

.menu-item-link {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-s);
  border: none;
  background: transparent;
  color: var(--ink);
  text-decoration: none;
  font: 500 14px var(--body);
  cursor: pointer;
  text-align: left;
}

.menu-item-link:hover {
  background: var(--plum-800);
  color: var(--cream);
}

.menu-item-link.danger {
  color: var(--danger);
}

.mobile-menu-btn {
  display: none;
}

.mobile-nav-grid {
  display: grid;
  gap: 4px;
}

@media (max-width: 1120px) {
  .app-header {
    gap: 14px;
    padding: 0 18px;
  }
  .main-nav a {
    padding: 7px 9px;
    font-size: 13px;
  }
  .main-nav a .num {
    display: none;
  }
}

@media (max-width: 860px) {
  .mobile-menu-btn {
    display: inline-flex;
  }
  .optional-text,
  .optional-desktop {
    display: none;
  }
}
'''
    if ".nav-dot-badge {" not in css_text:
        css_text += "\n" + extra_nav_css.lstrip("\n")
        app_css.write_text(css_text, encoding="utf-8")
        print("Patched frontend/src/styles/app.css")
    else:
        print("Skipped frontend/src/styles/app.css (already present)")

    print("\nPhase 9 (Complete UI Integration & Responsive Navigation) applied successfully.")


if __name__ == "__main__":
    main()
```

---

### Step 2: Build, Verify & Save Phase 9 Git Checkpoint

```powershell
python apply_phase9_ui.py
del apply_phase9_ui.py -ErrorAction SilentlyContinue
cd frontend
npm run typecheck
npm run build
cd ..
```

Once `typecheck` and `build` pass with **0 errors**, commit Phase 9:
```powershell
git add -A
git commit -m "phase 9: complete responsive navigation, account menu, mobile drawer & home 2.0 integration"
```

Paste the build output here, and we'll move to the final step: **PHASE 10 — QA, Security Verification, Optimization & Complete Documentation (`PROJECT_ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `SECURITY.md`, `TESTING.md`, `CHANGELOG.md`, `README.md`)**!
# PHASE 9 — Complete UI Integration & Responsive Navigation

### 1. Affected Files Inspected
* `frontend/src/components/Icons.tsx`
* `frontend/src/pages/Chat.tsx`
* `frontend/src/pages/Home.tsx`
* `frontend/src/App.tsx`
* `frontend/src/styles/app.css`

### 2. Implementation Plan
1. **Complete Navigation Coverage (`App.tsx`, `Icons.tsx`):**
   * Desktop header cleanly links **Studio**, **Cam**, **Journal**, **Together**, **Live**, **Chat** (with live unread badge), and **Friends**, plus header tools for **Notifications** (`/notifications` with unread count), **Inbox** modal, **Website Themes**, and an **Account & Profile Menu** (`My Profile`, `Account & Settings`, `New Scrapbook Page`, `Shared Feed`, `Studio Chat`, `Website Themes`, `Sign out`).
   * Tablet/Mobile (`<= 860px`): 5-item bottom tab bar (`Studio`, `Cam`, `Journal`, `Together`, `Chat`) plus a responsive **Menu drawer** giving 1-tap access to all 11 Bloom areas.
2. **Direct Tab Deep-Linking (`Chat.tsx`):**
   * Supports `/chat?tab=dm`, `/chat?tab=group`, and `/chat?tab=studio` so clicking **Studio Chat** or **Messages** opens directly into that section.
3. **Home Page Integration (`Home.tsx`):**
   * Updates the feature overview cards to reflect Bloom 2.0 while preserving Bloom's editorial visual identity.

---

### Step 1: Create and Run `apply_phase9_ui.py`

Create **`apply_phase9_ui.py`** inside **`PROJECT-BLOOM-main`**, paste this script, save, and run `python apply_phase9_ui.py`:

```python
"""Phase 9 (Complete UI Integration & Responsive Navigation) for Bloom 2.0."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase9_ui.py directly inside PROJECT-BLOOM-main.")

    # 1. Add IconMenu to Icons.tsx
    patch(
        "frontend/src/components/Icons.tsx",
        [
            (
                "export function BloomMark(p: IconProps) {",
                r'''export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export function BloomMark(p: IconProps) {''',
            ),
        ],
    )

    # 2. Support ?tab=dm|group|studio in Chat.tsx
    patch(
        "frontend/src/pages/Chat.tsx",
        [
            (
                '  const { navigate } = useRouter();',
                '  const { navigate, query } = useRouter();',
            ),
            (
                '  const [kindFilter, setKindFilter] = useState<ChatKind | "all">("all");',
                '  const tabParam = query.get("tab");\n'
                '  const initialKind: ChatKind | "all" =\n'
                '    tabParam === "dm" || tabParam === "group" || tabParam === "studio" ? tabParam : "all";\n'
                '  const [kindFilter, setKindFilter] = useState<ChatKind | "all">(initialKind);\n\n'
                '  useEffect(() => {\n'
                '    if (tabParam === "dm" || tabParam === "group" || tabParam === "studio") {\n'
                '      setKindFilter(tabParam);\n'
                '    }\n'
                '  }, [tabParam]);',
            ),
        ],
    )

    # 3. Update Home.tsx feature cards for Bloom 2.0
    write_full(
        "frontend/src/pages/Home.tsx",
        r'''
import { FlowerPreview } from "../components/FlowerPreview";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

const FEATURES = [
  { to: "/studio", num: "01", title: "Studio", text: "Grow custom petal shapes, spiral blooms, inscriptions and themes from any word." },
  { to: "/cam", num: "02", title: "Bloom Cam", text: "Multi-flower overlays, hand-tracking, photo crop, Polaroids, strips and contact sheets." },
  { to: "/journal", num: "03", title: "Journal & Scrapbook", text: "Compose digital scrapbook pages with stickers, tape, doodles, drawings and collections." },
  { to: "/together", num: "04", title: "Bloom Together", text: "Collaborate live on Twin Bloom, Two Blooms or Our Moment with built-in session chat." },
  { to: "/live", num: "05", title: "Live Bloom", text: "See each other on camera, pick a flower together and capture the shot at once." },
  { to: "/chat", num: "06", title: "Bloom Chat", text: "Private DMs, voice notes, group chats and Studio Chat rooms with friends." },
  { to: "/activity", num: "07", title: "Friends & Feed", text: "Share flowers and journal pages on your profile, follow friends and react together." },
];

export function HomePage() {
  const { recipe, user, ready, serverOnline, deviceMode, useThisDevice, hasFlower } = useSession();
  const { navigate } = useRouter();
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">A creative &amp; social journal of flowers grown from words</p>
          <h1>
            Say it with <span className="flourish">a flower</span> made of your own words.
          </h1>
          <p className="lede">
            Bloom writes your word along every petal of a hand-coded flower, lets you photograph and scrapbook it,
            and share creations privately or live with the people you care about.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => navigate("/studio")}>
              Grow a flower
            </button>
            <Link to="/scrapbook" className="btn">
              Open Scrapbook
            </Link>
            {ready && !user && serverOnline && !deviceMode && (
              <>
                <Link to="/signup" className="btn">
                  Create an account
                </Link>
                <button type="button" className="btn quiet" onClick={useThisDevice}>
                  Just use this device
                </button>
              </>
            )}
            {user && (
              <Link to="/journal" className="btn">
                Open {user.display_name}'s journal
              </Link>
            )}
          </div>
        </div>
        <div className="plate">
          <FlowerPreview recipe={recipe} />
          <div className="plate-caption">
            <span>{hasFlower ? `Plate I · “${recipe.word}”` : "A sample flower"}</span>
            <span className="lcd">{hasFlower ? "your last bloom" : "grow your own in the studio"}</span>
          </div>
        </div>
      </section>
      <section className="feature-row" aria-label="What you can do">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="feature">
            <span className="num">{f.num}</span>
            <h3>{f.title}</h3>
            <span>{f.text}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
''',
    )

    # 4. Update App.tsx with complete responsive navigation
    write_full(
        "frontend/src/App.tsx",
        r'''
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BloomMark,
  IconBell,
  IconCamera,
  IconChat,
  IconFlower,
  IconInbox,
  IconJournal,
  IconLive,
  IconMenu,
  IconTogether,
  IconUsers,
} from "./components/Icons";
import { Avatar, Loading, Modal, Toasts } from "./components/ui";
import { api, errorMessage } from "./lib/api";
import { Link, RouterProvider, matchPath, useRouter } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { AccountPage } from "./pages/Account";
import { ActivityPage } from "./pages/Activity";
import { AuthPage } from "./pages/Auth";
import { CamPage } from "./pages/Cam";
import { ChatPage } from "./pages/Chat";
import { EntryPage } from "./pages/Entry";
import { FriendsPage } from "./pages/Friends";
import { HomePage } from "./pages/Home";
import { JournalPage } from "./pages/Journal";
import { LivePage } from "./pages/Live";
import { LiveRoomPage } from "./pages/LiveRoom";
import { NotificationsPage } from "./pages/Notifications";
import { ProfilePage } from "./pages/Profile";
import { ProjectPage } from "./pages/Project";
import { ScrapbookEditorPage } from "./pages/ScrapbookEditor";
import { StudioPage } from "./pages/Studio";
import { ThemesPage } from "./pages/Themes";
import { TogetherPage } from "./pages/Together";
import { ThemeDecor } from "./theme/ThemeDecor";
import { ThemeMenu } from "./theme/ThemeMenu";
import { ThemeProvider } from "./theme/ThemeProvider";

const NAV = [
  { to: "/studio", label: "Studio", num: "01", icon: IconFlower },
  { to: "/cam", label: "Cam", num: "02", icon: IconCamera },
  { to: "/journal", label: "Journal", num: "03", icon: IconJournal },
  { to: "/together", label: "Together", num: "04", icon: IconTogether },
  { to: "/live", label: "Live", num: "05", icon: IconLive },
  { to: "/chat", label: "Chat", num: "06", icon: IconChat },
  { to: "/friends", label: "Friends", num: "07", icon: IconUsers },
];

const TABBAR_NAV = [
  { to: "/studio", label: "Studio", icon: IconFlower },
  { to: "/cam", label: "Cam", icon: IconCamera },
  { to: "/journal", label: "Journal", icon: IconJournal },
  { to: "/together", label: "Together", icon: IconTogether },
  { to: "/chat", label: "Chat", icon: IconChat },
];

const ROUTES: Array<{ path: string; render: (params: Record<string, string>) => ReactNode }> = [
  { path: "/", render: () => <HomePage /> },
  { path: "/studio", render: () => <StudioPage /> },
  { path: "/cam", render: () => <CamPage /> },
  { path: "/journal", render: () => <JournalPage /> },
  { path: "/journal/:id", render: (p) => <EntryPage id={p.id} /> },
  { path: "/scrapbook", render: () => <ScrapbookEditorPage /> },
  { path: "/scrapbook/:id", render: (p) => <ScrapbookEditorPage id={p.id} /> },
  { path: "/friends", render: () => <FriendsPage /> },
  { path: "/activity", render: () => <ActivityPage /> },
  { path: "/notifications", render: () => <NotificationsPage /> },
  { path: "/chat", render: () => <ChatPage /> },
  { path: "/chat/:id", render: (p) => <ChatPage conversationId={p.id} /> },
  { path: "/together", render: () => <TogetherPage /> },
  { path: "/together/:id", render: (p) => <ProjectPage id={Number(p.id)} /> },
  { path: "/live", render: () => <LivePage /> },
  { path: "/live/:id", render: (p) => <LiveRoomPage id={p.id} /> },
  { path: "/signin", render: () => <AuthPage mode="signin" /> },
  { path: "/signup", render: () => <AuthPage mode="signup" /> },
  { path: "/account", render: () => <AccountPage /> },
  { path: "/profile", render: () => <ProfilePage /> },
  { path: "/profile/:bloomId", render: (p) => <ProfilePage bloomId={p.bloomId} /> },
  { path: "/themes", render: () => <ThemesPage /> },
];

function Routes() {
  const { path } = useRouter();
  const { ready } = useSession();
  if (!ready) {
    return (
      <main className="page">
        <Loading label="Opening Bloom" />
      </main>
    );
  }
  for (const route of ROUTES) {
    const params = matchPath(route.path, path);
    if (params) return <>{route.render(params)}</>;
  }
  return (
    <main className="page">
      <h1>This page wandered off</h1>
      <p className="lede" style={{ marginTop: 12 }}>
        <Link to="/">Back to Bloom</Link>
      </p>
    </main>
  );
}

function InboxDialog({ onClose }: { onClose: () => void }) {
  const { inbox, refreshInbox, toast } = useSession();
  const { navigate } = useRouter();
  const act = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      toast(message);
      refreshInbox();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  const empty = !inbox || inbox.count === 0;
  return (
    <Modal title="Inbox" onClose={onClose}>
      {empty && <p className="muted">Nothing waiting for you. Friend requests and invitations appear here.</p>}
      {inbox?.live_invites.map((room) => (
        <div key={room.id} className="person">
          <span className="status-pill live">
            <span className="dot" /> LIVE
          </span>
          <div className="who">
            <strong>{room.friend.display_name}</strong>
            <span className="muted small">is waiting in a Live Bloom room</span>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              onClose();
              navigate(`/live/${room.id}`);
            }}
          >
            Join
          </button>
        </div>
      ))}
      {inbox?.project_invites.map((invite) => (
        <div key={invite.id} className="person">
          <div className="who">
            <strong>{invite.title}</strong>
            <span className="muted small">
              {invite.owner} invited you to a {invite.mode === "twin" ? "Twin Bloom" : invite.mode === "two" ? "Two Blooms" : "Our Moment"} project
            </span>
          </div>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              onClose();
              navigate(`/together/${invite.id}`);
            }}
          >
            View
          </button>
        </div>
      ))}
      {inbox?.friend_requests.map((request) => (
        <div key={request.request_id} className="person">
          <div className="who">
            <strong>{request.display_name}</strong>
            <span className="bloom-id">{request.bloom_id}</span>
          </div>
          <button
            type="button"
            className="btn small primary"
            onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/accept`, { method: "POST" }), `You and ${request.display_name} are friends now.`)}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn small quiet"
            onClick={() => void act(() => api(`/api/friends/requests/${request.request_id}/decline`, { method: "POST" }), "Request declined.")}
          >
            Decline
          </button>
        </div>
      ))}
    </Modal>
  );
}

function Shell() {
  const { path, navigate } = useRouter();
  const { user, inbox, unreadNotifications, unreadChat, serverOnline, deviceMode, ready, signOut } = useSession();
  const [inboxOpen, setInboxOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isActive = (to: string) => path === to || path.startsWith(`${to}/`);

  useEffect(() => {
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !userMenuRef.current?.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [userMenuOpen]);

  return (
    <>
      <ThemeDecor />
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="watercolor">
          <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="6" />
        </filter>
      </svg>
      <header className="app-header">
        <Link to="/" className="wordmark" aria-label="Bloom home">
          <BloomMark />
          bloom
        </Link>
        <nav className="main-nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
              <span className="num">{item.num}</span>
              {item.label}
              {item.to === "/chat" && unreadChat > 0 && <span className="nav-dot-badge">{unreadChat}</span>}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <ThemeMenu />
          {ready && !serverOnline && (
            <span className="status-pill warn optional" title="The Bloom server can't be reached. Things are saved on this device.">
              <span className="dot" /> OFFLINE · THIS DEVICE
            </span>
          )}
          {ready && serverOnline && deviceMode && (
            <span className="status-pill optional">
              <span className="dot" /> THIS DEVICE
            </span>
          )}
          {user && (
            <>
              <Link to="/notifications" className="btn icon quiet inbox-button" aria-label={`Notifications, ${unreadNotifications} unread`}>
                <IconBell />
                {unreadNotifications > 0 && <span className="badge">{unreadNotifications}</span>}
              </Link>
              <button type="button" className="btn icon quiet inbox-button optional-desktop" onClick={() => setInboxOpen(true)} aria-label={`Inbox, ${inbox?.count ?? 0} waiting`}>
                <IconInbox />
                {inbox && inbox.count > 0 && <span className="badge">{inbox.count}</span>}
              </button>
              <div className="appearance" ref={userMenuRef}>
                <button
                  type="button"
                  className="btn small quiet user-menu-trigger"
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((o) => !o)}
                >
                  <Avatar name={user.display_name} src={user.avatar_url} />
                  <span className="optional-text">{user.display_name}</span>
                </button>
                {userMenuOpen && (
                  <div className="appearance-menu user-dropdown" role="menu">
                    <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                    <Link to="/account" className="menu-item-link">Account &amp; Settings</Link>
                    <Link to="/scrapbook" className="menu-item-link">New Scrapbook Page</Link>
                    <Link to="/activity" className="menu-item-link">Shared Feed</Link>
                    <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
                    <Link to="/themes" className="menu-item-link">Website Themes</Link>
                    <div className="divider" />
                    <button
                      type="button"
                      className="menu-item-link danger"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                        navigate("/");
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {!user && ready && serverOnline && (
            <Link to="/signin" className="btn small">
              Sign in
            </Link>
          )}
          <button
            type="button"
            className="btn icon quiet mobile-menu-btn"
            aria-label="Open navigation menu"
            onClick={() => setMobileMenuOpen(true)}
          >
            <IconMenu />
          </button>
        </div>
      </header>
      <Routes />
      <nav className="tabbar" aria-label="Main">
        {TABBAR_NAV.map((item) => (
          <Link key={item.to} to={item.to} className={isActive(item.to) ? "active" : ""}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <item.icon />
              {item.to === "/chat" && unreadChat > 0 && <span className="tabbar-badge">{unreadChat}</span>}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>
      {inboxOpen && <InboxDialog onClose={() => setInboxOpen(false)} />}
      {mobileMenuOpen && (
        <Modal title="Bloom Navigation" onClose={() => setMobileMenuOpen(false)}>
          <div className="mobile-nav-grid">
            <Link to="/" className="menu-item-link">Home</Link>
            <Link to="/studio" className="menu-item-link">Flower Studio</Link>
            <Link to="/cam" className="menu-item-link">Bloom Cam</Link>
            <Link to="/journal" className="menu-item-link">Journal</Link>
            <Link to="/scrapbook" className="menu-item-link">Scrapbook Editor</Link>
            <Link to="/together" className="menu-item-link">Bloom Together</Link>
            <Link to="/live" className="menu-item-link">Live Bloom</Link>
            <Link to="/chat?tab=dm" className="menu-item-link">Messages (Personal &amp; Groups)</Link>
            <Link to="/chat?tab=studio" className="menu-item-link">Studio Chat</Link>
            <Link to="/friends" className="menu-item-link">Friends</Link>
            <Link to="/activity" className="menu-item-link">Shared Feed</Link>
            <Link to="/notifications" className="menu-item-link">Notifications ({unreadNotifications})</Link>
            {user && (
              <>
                <Link to={`/profile/${user.bloom_id}`} className="menu-item-link">My Profile</Link>
                <Link to="/account" className="menu-item-link">Settings &amp; Privacy</Link>
              </>
            )}
            <Link to="/themes" className="menu-item-link">Website Themes</Link>
          </div>
        </Modal>
      )}
      <Toasts />
    </>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </RouterProvider>
    </ThemeProvider>
  );
}
''',
    )

    # 5. Update styles/app.css with Phase 9 navigation styles
    app_css = ROOT / "frontend" / "src" / "styles" / "app.css"
    css_text = app_css.read_text(encoding="utf-8")
    extra_nav_css = r'''
/* ---------------------------------------------------------------------
   Phase 9 Navigation & Responsive Polish
   --------------------------------------------------------------------- */

.nav-dot-badge {
  display: inline-grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--rose);
  color: var(--on-accent);
  font: 600 10px/1 var(--body);
}

.tabbar-badge {
  position: absolute;
  top: -4px;
  right: -8px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--rose);
  color: var(--on-accent);
  font: 600 9px/15px var(--body);
  text-align: center;
}

.user-menu-trigger {
  padding: 2px 10px 2px 4px;
  gap: 8px;
}

.user-menu-trigger .avatar {
  width: 28px;
  height: 28px;
  font-size: 13px;
}

.user-dropdown {
  width: 220px;
  gap: 4px;
  padding: 10px;
}

.menu-item-link {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-s);
  border: none;
  background: transparent;
  color: var(--ink);
  text-decoration: none;
  font: 500 14px var(--body);
  cursor: pointer;
  text-align: left;
}

.menu-item-link:hover {
  background: var(--plum-800);
  color: var(--cream);
}

.menu-item-link.danger {
  color: var(--danger);
}

.mobile-menu-btn {
  display: none;
}

.mobile-nav-grid {
  display: grid;
  gap: 4px;
}

@media (max-width: 1120px) {
  .app-header {
    gap: 14px;
    padding: 0 18px;
  }
  .main-nav a {
    padding: 7px 9px;
    font-size: 13px;
  }
  .main-nav a .num {
    display: none;
  }
}

@media (max-width: 860px) {
  .mobile-menu-btn {
    display: inline-flex;
  }
  .optional-text,
  .optional-desktop {
    display: none;
  }
}
'''
    if ".nav-dot-badge {" not in css_text:
        css_text += "\n" + extra_nav_css.lstrip("\n")
        app_css.write_text(css_text, encoding="utf-8")
        print("Patched frontend/src/styles/app.css")
    else:
        print("Skipped frontend/src/styles/app.css (already present)")

    print("\nPhase 9 applied successfully.")


if __name__ == "__main__":
    main()