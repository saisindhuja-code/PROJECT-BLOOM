/** Botanical / line-icon reactions for shared flowers and journal entries. */
import { useState } from "react";
import { api, errorMessage, type ReactionKind, type ReactionSummary } from "../lib/api";
import { useSession } from "../lib/session";
import { IconFlower, IconHeart, IconLeaf, IconSparkle } from "./Icons";

const REACTIONS: Array<{ kind: ReactionKind; label: string; Icon: typeof IconHeart }> = [
  { kind: "heart", label: "Love", Icon: IconHeart },
  { kind: "bloom", label: "Bloom", Icon: IconFlower },
  { kind: "sparkle", label: "Sparkle", Icon: IconSparkle },
  { kind: "leaf", label: "Fresh", Icon: IconLeaf },
];

export function ReactionBar({
  targetType,
  targetId,
  value,
  onChange,
}: {
  targetType: "design" | "entry";
  targetId: number;
  value?: ReactionSummary;
  onChange?: (next: ReactionSummary) => void;
}) {
  const { toast } = useSession();
  const [local, setLocal] = useState<ReactionSummary>(value ?? { counts: {}, total: 0, my_reaction: null });
  const [busy, setBusy] = useState(false);

  const current = value ?? local;

  const toggle = async (kind: ReactionKind) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api<ReactionSummary>("/api/reactions", {
        body: { target_type: targetType, target_id: targetId, kind },
      });
      setLocal(next);
      onChange?.(next);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reaction-bar" role="group" aria-label="Reactions">
      {REACTIONS.map(({ kind, label, Icon }) => {
        const count = current.counts[kind] ?? 0;
        const active = current.my_reaction === kind;
        return (
          <button
            key={kind}
            type="button"
            className="chip reaction-chip"
            aria-pressed={active}
            title={label}
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              void toggle(kind);
            }}
          >
            <Icon width={14} height={14} />
            {count > 0 && <span>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
