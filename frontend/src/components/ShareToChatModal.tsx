/**
 * Modal for sharing a flower recipe (or journal note) straight into any
 * DM, Group chat, or the Studio Lounge.
 */
import { useEffect, useState } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { api, errorMessage, type ChatThread } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { FlowerPreview } from "./FlowerPreview";
import { IconSend } from "./Icons";
import { Loading, Modal } from "./ui";

export function ShareToChatModal({
  recipe,
  journalEntryId,
  defaultText = "",
  onClose,
}: {
  recipe: FlowerRecipe | null;
  journalEntryId?: number | null;
  defaultText?: string;
  onClose: () => void;
}) {
  const { user, toast } = useSession();
  const { navigate } = useRouter();
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [note, setNote] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<ChatThread[]>("/api/chats")
      .then((list) => {
        setThreads(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch((e) => {
        toast(errorMessage(e), "error");
        setThreads([]);
      });
  }, [user, toast]);

  const send = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await api(`/api/chats/${selectedId}/messages`, {
        body: {
          text: note.trim(),
          flower_recipe: recipe ?? undefined,
          journal_entry_id: journalEntryId ?? undefined,
        },
      });
      toast("Shared to chat.");
      onClose();
      navigate(`/chat/${selectedId}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Share to Bloom Chat" onClose={onClose}>
      {!user ? (
        <p className="muted">Sign in to share flowers and notes in Bloom Chat.</p>
      ) : threads === null ? (
        <Loading label="Loading your chats" />
      ) : (
        <div className="stack">
          {recipe && (
            <div className="share-preview-card">
              <div className="share-thumb">
                <FlowerPreview recipe={recipe} framing="tight" />
              </div>
              <div>
                <strong>“{recipe.word}”</strong>
                <p className="muted small">
                  {recipe.shape} · {recipe.petalStyle ?? "classic"} petals
                </p>
              </div>
            </div>
          )}
          <label className="field">
            <span>Send to</span>
            <select value={selectedId ?? ""} onChange={(e) => setSelectedId(Number(e.target.value))}>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.type === "studio" ? "🌸 Studio Lounge (public)" : t.type === "project" ? `✦ ${t.title}` : t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              maxLength={300}
              placeholder="Grew this flower for you…"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="btn-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn quiet" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!selectedId || busy || (!recipe && !note.trim())}
              onClick={() => void send()}
            >
              <IconSend /> Share
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
