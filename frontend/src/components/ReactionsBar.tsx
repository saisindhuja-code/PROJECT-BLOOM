/**
 * Reusable emoji reaction strip for Journal entries, Bloom Together projects, and Messages.
 */
import { useEffect, useState } from "react";
import { api, errorMessage, type ReactionCount } from "../lib/api";
import { useSession } from "../lib/session";

const EMOJIS = ["🌸", "♡", "✨", "🌿", "📷", "💫"];

export function ReactionsBar({
  targetType,
  targetId,
  initial,
  compact = false,
}: {
  targetType: "entry" | "project" | "message" | "design";
  targetId: string | number;
  initial?: ReactionCount[];
  compact?: boolean;
}) {
  const { user, toast } = useSession();
  const [reactions, setReactions] = useState<ReactionCount[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const idStr = String(targetId);

  useEffect(() => {
    if (initial) {
      setReactions(initial);
      return;
    }
    if (!user) return;
    let cancelled = false;
    api<ReactionCount[]>(`/api/reactions?target_type=${encodeURIComponent(targetType)}&target_id=${encodeURIComponent(idStr)}`)
      .then((list) => !cancelled && setReactions(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, targetType, idStr, initial]);

  if (!user) return null;

  const toggle = async (emoji: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ reactions: ReactionCount[] }>("/api/reactions", {
        body: { target_type: targetType, target_id: idStr, emoji },
      });
      setReactions(res.reactions);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`reactions-bar${compact ? " compact" : ""}`} role="group" aria-label="Reactions">
      {EMOJIS.map((emoji) => {
        const hit = reactions.find((r) => r.emoji === emoji);
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction-pill${hit?.reacted ? " active" : ""}`}
            aria-pressed={Boolean(hit?.reacted)}
            onClick={() => void toggle(emoji)}
            disabled={busy}
          >
            <span>{emoji}</span>
            {hit && hit.count > 0 && <span className="count">{hit.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
