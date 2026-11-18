/**
 * Phase 8: Bloom Together 2.0
 * Real-time WebSocket synchronization (`project:{id}`), live partner presence &
 * cursor indicators, plus built-in Session Chat alongside Twin / Two / Moment slots.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraView } from "../components/CameraView";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconCamera, IconChat, IconFlower, IconJournal, IconPlus, IconSend, IconTrash, IconUpload } from "../components/Icons";
import { OverlayControls } from "../components/OverlayControls";
import { ReactionsBar } from "../components/ReactionsBar";
import { RecipePicker } from "../components/RecipePicker";
import { SaveDialog, isoFromLocalInput, type SaveDetails } from "../components/SaveDialog";
import { SlotEditor } from "../components/SlotEditor";
import { ThemeGallery } from "../components/ThemeGallery";
import { Avatar, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob } from "../flower/render";
import { LAYOUTS, defaultPhotoTransform, defaultPlacement, layoutSpec, renderComposition, type FlowerPlacement, type LayoutId } from "../imaging/compose";
import { context2d, renderThemed, toCanvas } from "../imaging/process";
import { themeById, type ThemeSettings } from "../imaging/themes";
import { ApiError, api, blobToImage, errorMessage, uploadImage, type ChatMessage, type ChatThread } from "../lib/api";
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
  const { user, toast, store, refreshInbox, recipe: grownRecipe, hasFlower, ws, growFlower } = useSession();
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
  const [onlineMembers, setOnlineMembers] = useState<string[]>([]);
  const [partnerCursor, setPartnerCursor] = useState<{ display_name: string; slot: number | null } | null>(null);

  // Session Chat state
  const [chatThread, setChatThread] = useState<ChatThread | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [sendingChat, setSendingChat] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<number>(0);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const { data: friends } = useFriends();

  useNavigationGuard(dirty, "Your part has unsaved changes. Leave anyway?");

  const applyProject = useCallback((next: Project, resetDrafts: boolean) => {
    setProject(next);
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

  useEffect(() => {
    if (user) void load(true);
  }, [user, load]);

  // Load Session Chat for this project
  useEffect(() => {
    if (!user || project?.my_status !== "active") return;
    let cancelled = false;
    api<ChatThread>(`/api/chats/project/${id}`)
      .then((thread) => {
        if (cancelled) return;
        setChatThread(thread);
        return api<ChatMessage[]>(`/api/chats/${thread.id}/messages`).then((msgs) => {
          if (!cancelled) setChatMessages(msgs);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, project?.my_status, id]);

  // Real-time WebSocket sync for project state, presence, cursor, and session chat
  useEffect(() => {
    if (!user || project?.my_status !== "active") return;
    const projectChannel = `project:${id}`;
    ws.subscribe(projectChannel);
    const chatChannel = chatThread ? `chat:${chatThread.id}` : null;
    if (chatChannel) ws.subscribe(chatChannel);

    const off = ws.onEvent((ev) => {
      if (ev.type === "subscribed" && ev.channel === projectChannel && Array.isArray(ev.online)) {
        setOnlineMembers(ev.online.map(String));
      } else if (ev.type === "project:presence" && ev.projectId === id && Array.isArray(ev.online)) {
        setOnlineMembers(ev.online.map(String));
      } else if (ev.type === "project:cursor" && ev.projectId === id) {
        setPartnerCursor({
          display_name: String(ev.display_name ?? "Partner"),
          slot: typeof ev.slot === "number" ? ev.slot : null,
        });
      } else if (ev.type === "project:updated" && ev.projectId === id && ev.project) {
        const incoming = ev.project as Project;
        setProject(incoming);
        setTheme(projectTheme(incoming));
        const by = ev.by as { bloom_id?: string; display_name?: string } | undefined;
        if (by && by.bloom_id !== user.bloom_id) {
          toast(`${by.display_name ?? "Partner"} updated the project live.`);
        }
      } else if (ev.type === "chat:message" && chatThread && ev.chatId === chatThread.id && ev.message) {
        const msg = ev.message as ChatMessage;
        setChatMessages((list) => (list.some((m) => m.id === msg.id) ? list : [...list, msg]));
      }
    });

    return () => {
      off();
      ws.unsubscribe(projectChannel);
      if (chatChannel) ws.unsubscribe(chatChannel);
    };
  }, [user, project?.my_status, id, ws, chatThread, toast]);

  // Broadcast active slot cursor when user switches slots
  useEffect(() => {
    if (user && project?.my_status === "active") {
      ws.sendProjectCursor(id, selected);
    }
  }, [user, project?.my_status, id, selected, ws]);

  // Load everyone's photos (private, fetched with your session).
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

  // My drafts that point at saved photos get their image once it loads.
  useEffect(() => {
    if (!drafts) return;
    if (drafts.some((d) => d.mediaId && !d.image && images.has(d.mediaId))) {
      setDrafts((list) => list!.map((d) => (d.mediaId && !d.image && images.has(d.mediaId) ? { ...d, image: images.get(d.mediaId)! } : d)));
    }
  }, [images, drafts]);

  const layout: LayoutId = (project?.layout as LayoutId) ?? "side-by-side";
  const items = useMemo(() => (project && project.my_status === "active" ? compositionItems(project, images, drafts) : []), [project, images, drafts]);
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
            other's photos for this project only.
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                try {
                  applyProject(await api<Project>(`/api/projects/${id}/accept`, { method: "POST" }), true);
                  refreshInbox();
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

  const shared = sharedRecipe(project);
  const myDrafts = drafts ?? [];
  const maxItems = modeInfo.max;
  const members = project.members ?? [];
  const others = members.filter((m) => !m.is_you);
  const partnerOnline = others.some((m) => onlineMembers.includes(m.bloom_id));

  let myFirstIndex = 0;
  for (const m of members.filter((mm) => mm.status === "active")) {
    if (m.is_you) break;
    const c = project.contributions?.find((cc) => cc.bloom_id === m.bloom_id);
    myFirstIndex += Math.max(1, c?.items.length ?? 0);
  }
  const slotFor = (draftIndex: number) => spec.slots[myFirstIndex + draftIndex] ?? spec.slots[0];

  const patchProject = async (body: Record<string, unknown>) => {
    try {
      const next = await api<Project>(`/api/projects/${id}`, { method: "PATCH", body });
      setProject(next);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const updateDraft = (index: number, patch: Partial<DraftItem>) => {
    setDrafts((list) => list!.map((d, i) => (i === index ? { ...d, ...patch } : d)));
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
      toast("Part saved & synced.");
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

  const sendProjectMessage = async (attachFlower = false) => {
    if (!chatThread || (!chatText.trim() && !attachFlower)) return;
    setSendingChat(true);
    try {
      const msg = await api<ChatMessage>(`/api/chats/${chatThread.id}/messages`, {
        body: {
          text: chatText.trim(),
          flower_recipe: attachFlower ? grownRecipe : undefined,
        },
      });
      setChatMessages((list) => [...list, msg]);
      setChatText("");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSendingChat(false);
    }
  };

  const membersPanel = (
    <section className="sheet-section">
      <header>
        <h3>People</h3>
        <span className="eyebrow">real-time sync</span>
      </header>
      {members.map((m) => (
        <div key={m.bloom_id} className="person">
          <Avatar name={m.display_name} />
          <div className="who">
            <strong>
              {m.display_name} {m.is_you && <span className="muted small">(you)</span>}
              {onlineMembers.includes(m.bloom_id) && <span className="online-dot" title="Online in project" />}
            </strong>
            <span className="muted small">
              {m.role === "owner" ? "started this" : m.status === "invited" ? "invited, hasn't joined yet" : "joined"}
            </span>
          </div>
          {project.is_owner && !m.is_you && (
            <button
              type="button"
              className="btn small quiet danger"
              onClick={async () => {
                if (!window.confirm(`Remove ${m.display_name}? They'll lose access, and their photos leave this project.`)) return;
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
            04 · Together · {modeInfo.name} · updated {formatDate(project.updated_at)}
            {partnerOnline && (
              <span className="status-pill live" style={{ marginLeft: 10 }}>
                <span className="dot" /> Partner live
              </span>
            )}
          </p>
          <h1>{project.title}</h1>
        </div>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void saveMyPart()} disabled={!dirty || saving}>
            {saving && <span className="spinner" />} Save my part
          </button>
          <button type="button" className="btn" onClick={() => void openSave()} disabled={!theme}>
            <IconJournal /> Save to my journal
          </button>
        </div>
      </div>

      <div className="together">
        <div className="stack">
          <div className="plate composition-preview">
            <canvas ref={previewCanvas} aria-label="The combined picture" />
            <div className="plate-caption">
              <span>{spec.name}</span>
              <span className="lcd">{theme ? themeById(theme.preset).name : ""}</span>
            </div>
          </div>

          <ReactionsBar targetType="project" targetId={project.id} />

          <section className="sheet">
            <div className="sheet-section">
              <header>
                <h3>Layout</h3>
                <span className="eyebrow">shared · real-time</span>
              </header>
              <div className="layout-picker">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" aria-pressed={layout === l.id} title={l.hint} onClick={() => void patchProject({ layout: l.id })}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="sheet-section">
              <header>
                <h3>Photo filter</h3>
                <span className="eyebrow">shared · real-time</span>
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
                  <span className="eyebrow">shared</span>
                </header>
                <RecipePicker value={shared} onChange={(recipe) => void patchProject({ shared_recipe: recipe })} />
              </div>
            )}
          </section>
        </div>

        <aside className="sheet">
          <section className="sheet-section">
            <header>
              <h3>Your part</h3>
              <span className="eyebrow">{dirty ? "unsaved" : "saved"}</span>
            </header>
            {partnerCursor && partnerOnline && partnerCursor.slot !== null && (
              <p className="muted small" style={{ marginBottom: 8 }}>
                {partnerCursor.display_name} is looking at frame #{partnerCursor.slot + 1}
              </p>
            )}
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
              <p className="muted">Add your photo{project.mode === "moment" ? "s and flowers" : ""}. Save to sync live with your partner.</p>
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
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void onUpload(e.target.files?.[0])} />
          </section>

          <section className="sheet-section">
            <header>
              <h3>
                <IconChat width={16} height={16} /> Session Chat
              </h3>
              {chatThread && (
                <Link to={`/chat/${chatThread.id}`} className="eyebrow">
                  Open full view
                </Link>
              )}
            </header>
            <div className="project-chat-list">
              {chatMessages.length === 0 ? (
                <p className="muted small">Talk about poses, flowers, or framing right here while you build together.</p>
              ) : (
                chatMessages.slice(-20).map((m) => (
                  <div key={m.id} className={`mini-msg${m.is_you ? " you" : ""}`}>
                    <strong>{m.is_you ? "You" : m.sender.display_name}</strong>
                    {m.text && <p>{m.text}</p>}
                    {m.flower_recipe && (
                      <button
                        type="button"
                        className="btn small quiet"
                        style={{ marginTop: 4 }}
                        onClick={() => {
                          growFlower(normalizeRecipe(m.flower_recipe));
                          toast("Loaded flower into Studio.");
                        }}
                      >
                        <FlowerPreview recipe={normalizeRecipe(m.flower_recipe)} framing="tight" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
            <form
              className="row"
              style={{ gap: 6, marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                void sendProjectMessage(false);
              }}
            >
              <input
                type="text"
                value={chatText}
                placeholder="Message partner…"
                onChange={(e) => setChatText(e.target.value)}
                style={{ flex: 1 }}
              />
              {hasFlower && (
                <button
                  type="button"
                  className="btn icon small"
                  title="Send current Studio flower"
                  disabled={sendingChat}
                  onClick={() => void sendProjectMessage(true)}
                >
                  <IconFlower />
                </button>
              )}
              <button type="submit" className="btn small primary" disabled={sendingChat || !chatText.trim()}>
                <IconSend />
              </button>
            </form>
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
