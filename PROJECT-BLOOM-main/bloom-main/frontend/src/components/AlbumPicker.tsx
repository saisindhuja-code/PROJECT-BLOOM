import { useEffect, useState } from "react";
import { errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import type { Album } from "../lib/store";
import { IconPlus } from "./Icons";

/** Choose which albums (collections) an entry belongs to; create one inline. */
export function AlbumPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { store, toast } = useSession();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    store.listAlbums().then(setAlbums).catch(() => setAlbums([]));
  }, [store]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const album = await store.createAlbum(trimmed);
      setAlbums((list) => [...list, album]);
      onChange([...value, album.id]);
      setName("");
      setAdding(false);
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <div className="stack tight">
      <span className="label">Albums</span>
      <div className="chips">
        {albums.map((album) => (
          <button key={album.id} type="button" className="chip" aria-pressed={value.includes(album.id)} onClick={() => toggle(album.id)}>
            {album.name}
          </button>
        ))}
        {!adding && (
          <button type="button" className="chip" onClick={() => setAdding(true)}>
            <IconPlus width={14} height={14} /> New album
          </button>
        )}
      </div>
      {adding && (
        <div className="row">
          <input
            type="text"
            value={name}
            maxLength={60}
            placeholder="Album name"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button type="button" className="btn small" onClick={() => void create()}>
            Add
          </button>
          <button type="button" className="btn small quiet" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
