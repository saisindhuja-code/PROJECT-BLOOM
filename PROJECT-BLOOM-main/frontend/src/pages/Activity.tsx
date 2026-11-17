/** Shared flowers and journal creations from friends & people you follow. */
import { useCallback, useEffect, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { IconFlower } from "../components/Icons";
import { ReactionBar } from "../components/ReactionBar";
import { Avatar, Empty, Loading, Modal, SignInNeeded, formatDate } from "../components/ui";
import { normalizeRecipe } from "../flower/recipe";
import { api, errorMessage, mediaUrl, type ReactionSummary } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

interface FeedAuthor {
  bloom_id: string;
  display_name: string;
  avatar_url: string | null;
}

interface FeedDesignItem {
  item_type: "design";
  id: number;
  title: string;
  recipe: unknown;
  visibility: string;
  timestamp: string;
  author: FeedAuthor;
  is_you: boolean;
  reactions: ReactionSummary;
}

interface FeedEntryItem {
  item_type: "entry";
  id: number;
  entry_type: "flower" | "photo" | "composition";
  title: string;
  caption: string;
  notes: string;
  recipe: unknown;
  photo_url: string | null;
  visibility: string;
  timestamp: string;
  author: FeedAuthor;
  is_you: boolean;
  reactions: ReactionSummary;
}

type FeedItem = FeedDesignItem | FeedEntryItem;

export function ActivityPage() {
  const { user, toast, growFlower } = useSession();
  const { navigate } = useRouter();
  const [kind, setKind] = useState<"all" | "designs" | "entries">("all");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [openItem, setOpenItem] = useState<FeedEntryItem | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    api<{ items: FeedItem[] }>(`/api/social/feed?kind=${kind}`)
      .then((res) => setItems(res.items))
      .catch((e) => {
        setItems([]);
        toast(errorMessage(e), "error");
      });
  }, [user, kind, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Shared feed" />
      </main>
    );
  }

  const updateReactions = (itemType: "design" | "entry", id: number, next: ReactionSummary) => {
    setItems((list) =>
      list
        ? list.map((it) =>
            (itemType === "design" ? it.item_type === "design" : it.item_type === "entry") && it.id === id
              ? { ...it, reactions: next }
              : it,
          )
        : list,
    );
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Community garden</p>
          <h1>
            Shared by <span className="flourish">friends</span>
          </h1>
        </div>
        <div className="btn-row">
          <div className="segmented" role="group" aria-label="Feed filter">
            <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All</button>
            <button type="button" aria-pressed={kind === "designs"} onClick={() => setKind("designs")}>Flowers</button>
            <button type="button" aria-pressed={kind === "entries"} onClick={() => setKind("entries")}>Journal</button>
          </div>
          <Link to="/friends" className="btn small">Friends &amp; following</Link>
        </div>
      </div>

      {items === null ? (
        <Loading label="Loading shared creations" />
      ) : items.length === 0 ? (
        <Empty
          title="Nothing shared here yet"
          action={<Link to="/friends" className="btn primary">Find friends</Link>}
        >
          Flowers and journal pages that you or your friends mark as Friends or Public appear here.
        </Empty>
      ) : (
        <div className="feed-grid">
          {items.map((item) => {
            const rec = item.recipe ? normalizeRecipe(item.recipe) : null;
            return (
              <article key={`${item.item_type}:${item.id}`} className="plate stack tight">
                <div className="row between">
                  <Link to={`/profile/${item.author.bloom_id}`} className="row" style={{ gap: 10, textDecoration: "none", color: "inherit" }}>
                    <Avatar name={item.author.display_name} src={item.author.avatar_url} />
                    <div>
                      <strong style={{ display: "block", fontSize: 14 }}>{item.author.display_name}</strong>
                      <span className="eyebrow">{formatDate(item.timestamp)}</span>
                    </div>
                  </Link>
                  <span className="eyebrow">{item.visibility}</span>
                </div>

                {item.item_type === "entry" && item.photo_url ? (
                  <button
                    type="button"
                    className="feed-media-btn"
                    onClick={() => setOpenItem(item)}
                  >
                    <img src={mediaUrl(item.photo_url)!} alt={item.title || "Shared entry"} loading="lazy" />
                  </button>
                ) : rec ? (
                  <FlowerPreview recipe={rec} label={item.title || rec.word} />
                ) : null}

                <div>
                  <strong style={{ fontFamily: "var(--display)", fontStyle: "italic", fontSize: 20 }}>
                    {item.title || rec?.word || "Untitled"}
                  </strong>
                  {item.item_type === "entry" && item.caption && <p className="muted small">{item.caption}</p>}
                </div>

                <div className="row between">
                  <ReactionBar
                    targetType={item.item_type === "design" ? "design" : "entry"}
                    targetId={item.id}
                    value={item.reactions}
                    onChange={(next) => updateReactions(item.item_type === "design" ? "design" : "entry", item.id, next)}
                  />
                  {rec && (
                    <button
                      type="button"
                      className="btn small quiet"
                      onClick={() => {
                        growFlower(rec);
                        navigate("/studio");
                      }}
                    >
                      <IconFlower /> Studio
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {openItem && (
        <Modal title={openItem.title || "Journal entry"} onClose={() => setOpenItem(null)} wide>
          <div className="entry-view">
            <div className="plate">
              {openItem.photo_url && (
                <img src={mediaUrl(openItem.photo_url)!} alt={openItem.title || "Shared photo"} style={{ width: "100%", height: "auto", display: "block" }} />
              )}
            </div>
            <div className="stack">
              <p className="eyebrow">By {openItem.author.display_name} · {formatDate(openItem.timestamp)}</p>
              {openItem.caption && <p><strong>{openItem.caption}</strong></p>}
              {openItem.notes && <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{openItem.notes}</p>}
              <ReactionBar
                targetType="entry"
                targetId={openItem.id}
                value={openItem.reactions}
                onChange={(next) => {
                  setOpenItem({ ...openItem, reactions: next });
                  updateReactions("entry", openItem.id, next);
                }}
              />
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
