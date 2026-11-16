/**
 * One interface for the journal, albums and saved designs, with two storage
 * backends:
 *   - ServerStore: your Bloom account (FastAPI + database + private files)
 *   - LocalStore:  this device only (IndexedDB), used without an account or
 *                  when the server is unreachable
 */

import type { FlowerRecipe } from "../flower/recipe";
import { normalizeRecipe } from "../flower/recipe";
import { api, mediaUrl, uploadImage } from "./api";
import * as local from "./localdb";

export type EntryType = "flower" | "photo" | "composition";

export interface Participant {
  bloom_id: string;
  display_name: string;
}

export interface JournalEntry {
  id: string;
  source: "server" | "local";
  entry_type: EntryType;
  title: string;
  caption: string;
  notes: string;
  taken_at: string;
  recipe: FlowerRecipe | null;
  photoUrl: string | null;
  originalUrl: string | null;
  edit_state: EditState | null;
  project_id: number | null;
  participants: Participant[];
  album_ids: string[];
  created_at: string;
  updated_at: string;
}

/** Everything needed to reopen an edit (kept with photo and composition entries). */
export interface EditState {
  version?: number;
  theme?: { preset: string; name?: string; [key: string]: unknown };
  overlay?: unknown;
  [key: string]: unknown;
}

export interface Album {
  id: string;
  name: string;
  entry_count: number;
}

export interface SavedDesign {
  id: string;
  title: string;
  recipe: FlowerRecipe;
  updated_at: string;
}

export interface NewEntry {
  entry_type: EntryType;
  title?: string;
  caption?: string;
  notes?: string;
  taken_at?: string;
  recipe?: FlowerRecipe | null;
  photo?: Blob | null;
  original?: Blob | null;
  edit_state?: EditState | null;
  project_id?: number | null;
  album_ids?: string[];
}

export interface EntryPatch {
  title?: string;
  caption?: string;
  notes?: string;
  taken_at?: string;
  recipe?: FlowerRecipe;
  photo?: Blob;
  original?: Blob;
  keep_original?: boolean;
  edit_state?: EditState;
  album_ids?: string[];
}

export interface EntryFilter {
  q?: string;
  type?: EntryType | "";
  albumId?: string;
}

export interface BloomStore {
  kind: "server" | "local";
  listEntries(filter?: EntryFilter): Promise<JournalEntry[]>;
  getEntry(id: string): Promise<JournalEntry>;
  createEntry(entry: NewEntry): Promise<JournalEntry>;
  updateEntry(id: string, patch: EntryPatch): Promise<JournalEntry>;
  duplicateEntry(id: string): Promise<JournalEntry>;
  deleteEntry(id: string): Promise<void>;
  listAlbums(): Promise<Album[]>;
  createAlbum(name: string): Promise<Album>;
  renameAlbum(id: string, name: string): Promise<Album>;
  deleteAlbum(id: string): Promise<void>;
  listDesigns(): Promise<SavedDesign[]>;
  saveDesign(recipe: FlowerRecipe, title: string, id?: string): Promise<SavedDesign>;
  deleteDesign(id: string): Promise<void>;
}

const imageName = (blob: Blob) => (blob.type === "image/png" ? "image.png" : "image.jpg");

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

interface ServerEntry {
  id: number;
  entry_type: EntryType;
  title: string;
  caption: string;
  notes: string;
  taken_at: string;
  recipe: unknown;
  photo_url: string | null;
  original_url: string | null;
  edit_state: EditState | null;
  project_id: number | null;
  participants: Participant[];
  album_ids: number[];
  created_at: string;
  updated_at: string;
}

const serverId = (id: string) => Number(id.replace(/^s:/, ""));

function fromServer(entry: ServerEntry): JournalEntry {
  return {
    id: `s:${entry.id}`,
    source: "server",
    entry_type: entry.entry_type,
    title: entry.title,
    caption: entry.caption,
    notes: entry.notes,
    taken_at: entry.taken_at,
    recipe: entry.recipe ? normalizeRecipe(entry.recipe) : null,
    photoUrl: mediaUrl(entry.photo_url),
    originalUrl: mediaUrl(entry.original_url),
    edit_state: entry.edit_state,
    project_id: entry.project_id,
    participants: entry.participants ?? [],
    album_ids: entry.album_ids.map((id) => `s:${id}`),
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  };
}

export class ServerStore implements BloomStore {
  kind = "server" as const;

  async listEntries(filter: EntryFilter = {}): Promise<JournalEntry[]> {
    const params = new URLSearchParams();
    if (filter.q) params.set("q", filter.q);
    if (filter.type) params.set("type", filter.type);
    if (filter.albumId) params.set("album_id", String(serverId(filter.albumId)));
    const rows = await api<ServerEntry[]>(`/api/journal?${params}`);
    return rows.map(fromServer);
  }

  async getEntry(id: string): Promise<JournalEntry> {
    return fromServer(await api<ServerEntry>(`/api/journal/${serverId(id)}`));
  }

  async createEntry(entry: NewEntry): Promise<JournalEntry> {
    const photo = entry.photo ? await uploadImage(entry.photo, "photo", imageName(entry.photo)) : null;
    const original = entry.original ? await uploadImage(entry.original, "original", imageName(entry.original)) : null;
    const created = await api<ServerEntry>("/api/journal", {
      body: {
        entry_type: entry.entry_type,
        title: entry.title ?? "",
        caption: entry.caption ?? "",
        notes: entry.notes ?? "",
        taken_at: entry.taken_at,
        recipe: entry.recipe ?? null,
        photo_media_id: photo?.id ?? null,
        original_media_id: original?.id ?? null,
        edit_state: entry.edit_state ?? null,
        project_id: entry.project_id ?? null,
        album_ids: (entry.album_ids ?? []).map(serverId),
      },
    });
    return fromServer(created);
  }

  async updateEntry(id: string, patch: EntryPatch): Promise<JournalEntry> {
    const body: Record<string, unknown> = {};
    for (const key of ["title", "caption", "notes", "taken_at", "recipe", "keep_original", "edit_state"] as const) {
      if (patch[key] !== undefined) body[key] = patch[key];
    }
    if (patch.album_ids) body.album_ids = patch.album_ids.map(serverId);
    if (patch.photo) body.photo_media_id = (await uploadImage(patch.photo, "photo", imageName(patch.photo))).id;
    if (patch.original) body.original_media_id = (await uploadImage(patch.original, "original", imageName(patch.original))).id;
    return fromServer(await api<ServerEntry>(`/api/journal/${serverId(id)}`, { method: "PATCH", body }));
  }

  async duplicateEntry(id: string): Promise<JournalEntry> {
    return fromServer(await api<ServerEntry>(`/api/journal/${serverId(id)}/duplicate`, { method: "POST" }));
  }

  async deleteEntry(id: string): Promise<void> {
    await api(`/api/journal/${serverId(id)}`, { method: "DELETE" });
  }

  async listAlbums(): Promise<Album[]> {
    const rows = await api<Array<{ id: number; name: string; entry_count: number }>>("/api/albums");
    return rows.map((a) => ({ id: `s:${a.id}`, name: a.name, entry_count: a.entry_count }));
  }

  async createAlbum(name: string): Promise<Album> {
    const a = await api<{ id: number; name: string; entry_count: number }>("/api/albums", { body: { name } });
    return { id: `s:${a.id}`, name: a.name, entry_count: a.entry_count };
  }

  async renameAlbum(id: string, name: string): Promise<Album> {
    const a = await api<{ id: number; name: string; entry_count: number }>(`/api/albums/${serverId(id)}`, {
      method: "PATCH",
      body: { name },
    });
    return { id: `s:${a.id}`, name: a.name, entry_count: a.entry_count };
  }

  async deleteAlbum(id: string): Promise<void> {
    await api(`/api/albums/${serverId(id)}`, { method: "DELETE" });
  }

  async listDesigns(): Promise<SavedDesign[]> {
    const rows = await api<Array<{ id: number; title: string; recipe: unknown; updated_at: string }>>("/api/designs");
    return rows.map((d) => ({ id: `s:${d.id}`, title: d.title, recipe: normalizeRecipe(d.recipe), updated_at: d.updated_at }));
  }

  async saveDesign(recipe: FlowerRecipe, title: string, id?: string): Promise<SavedDesign> {
    const body = { title, recipe };
    const d = id?.startsWith("s:")
      ? await api<{ id: number; title: string; recipe: unknown; updated_at: string }>(`/api/designs/${serverId(id)}`, {
          method: "PUT",
          body,
        })
      : await api<{ id: number; title: string; recipe: unknown; updated_at: string }>("/api/designs", { body });
    return { id: `s:${d.id}`, title: d.title, recipe: normalizeRecipe(d.recipe), updated_at: d.updated_at };
  }

  async deleteDesign(id: string): Promise<void> {
    await api(`/api/designs/${serverId(id)}`, { method: "DELETE" });
  }
}

// ---------------------------------------------------------------------------
// This device (IndexedDB)
// ---------------------------------------------------------------------------

interface LocalEntryRow extends Omit<JournalEntry, "photoUrl" | "originalUrl" | "source"> {
  photoBlobId: string | null;
  originalBlobId: string | null;
}

interface LocalAlbumRow {
  id: string;
  name: string;
}

interface LocalDesignRow {
  id: string;
  title: string;
  recipe: FlowerRecipe;
  updated_at: string;
}

const objectUrls = new Map<string, string>();

async function blobUrl(blobId: string | null): Promise<string | null> {
  if (!blobId) return null;
  const cached = objectUrls.get(blobId);
  if (cached) return cached;
  const blob = await local.getBlob(blobId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(blobId, url);
  return url;
}

function matches(entry: LocalEntryRow, needle: string): boolean {
  if (!needle) return true;
  const theme = entry.edit_state?.theme?.name ?? "";
  const words = [entry.title, entry.caption, entry.notes, entry.recipe?.word ?? "", String(theme)];
  return words.join(" ").toLowerCase().includes(needle);
}

export class LocalStore implements BloomStore {
  kind = "local" as const;

  private async hydrate(row: LocalEntryRow): Promise<JournalEntry> {
    const { photoBlobId, originalBlobId, ...rest } = row;
    return { ...rest, source: "local", photoUrl: await blobUrl(photoBlobId), originalUrl: await blobUrl(originalBlobId) };
  }

  private async row(id: string): Promise<LocalEntryRow> {
    const row = await local.get<LocalEntryRow>("entries", id);
    if (!row) throw new Error("That journal entry was not found on this device.");
    return row;
  }

  async listEntries(filter: EntryFilter = {}): Promise<JournalEntry[]> {
    const needle = (filter.q ?? "").trim().toLowerCase();
    const rows = (await local.getAll<LocalEntryRow>("entries"))
      .filter((e) => !filter.type || e.entry_type === filter.type)
      .filter((e) => !filter.albumId || e.album_ids.includes(filter.albumId))
      .filter((e) => matches(e, needle))
      .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
    return Promise.all(rows.map((r) => this.hydrate(r)));
  }

  async getEntry(id: string): Promise<JournalEntry> {
    return this.hydrate(await this.row(id));
  }

  async createEntry(entry: NewEntry): Promise<JournalEntry> {
    const now = new Date().toISOString();
    const row: LocalEntryRow = {
      id: `l:${local.uid()}`,
      entry_type: entry.entry_type,
      title: entry.title ?? "",
      caption: entry.caption ?? "",
      notes: entry.notes ?? "",
      taken_at: entry.taken_at ?? now,
      recipe: entry.recipe ?? null,
      edit_state: entry.edit_state ?? null,
      project_id: entry.project_id ?? null,
      participants: [],
      album_ids: entry.album_ids ?? [],
      created_at: now,
      updated_at: now,
      photoBlobId: entry.photo ? await local.putBlob(entry.photo) : null,
      originalBlobId: entry.original ? await local.putBlob(entry.original) : null,
    };
    await local.put("entries", row);
    return this.hydrate(row);
  }

  async updateEntry(id: string, patch: EntryPatch): Promise<JournalEntry> {
    const row = await this.row(id);
    const { photo, original, keep_original, ...fields } = patch;
    Object.assign(row, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    if (photo) row.photoBlobId = await local.putBlob(photo);
    if (original) row.originalBlobId = await local.putBlob(original);
    if (keep_original === false) row.originalBlobId = null;
    row.updated_at = new Date().toISOString();
    await local.put("entries", row);
    await this.collectBlobs();
    return this.hydrate(row);
  }

  async duplicateEntry(id: string): Promise<JournalEntry> {
    const row = await this.row(id);
    const now = new Date().toISOString();
    const copy = { ...row, id: `l:${local.uid()}`, title: row.title ? `${row.title} (copy)` : "Copy", created_at: now, updated_at: now };
    await local.put("entries", copy);
    return this.hydrate(copy);
  }

  async deleteEntry(id: string): Promise<void> {
    await local.remove("entries", id);
    await this.collectBlobs();
  }

  /** Deletes stored images that no entry uses any more. */
  private async collectBlobs(): Promise<void> {
    const used = new Set<string>();
    for (const e of await local.getAll<LocalEntryRow>("entries")) {
      if (e.photoBlobId) used.add(e.photoBlobId);
      if (e.originalBlobId) used.add(e.originalBlobId);
    }
    for (const b of await local.getAll<{ id: string }>("blobs")) {
      if (!used.has(b.id)) {
        await local.remove("blobs", b.id);
        const url = objectUrls.get(b.id);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(b.id);
      }
    }
  }

  async listAlbums(): Promise<Album[]> {
    const albums = await local.getAll<LocalAlbumRow>("albums");
    const entries = await local.getAll<LocalEntryRow>("entries");
    return albums
      .map((a) => ({ ...a, entry_count: entries.filter((e) => e.album_ids.includes(a.id)).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createAlbum(name: string): Promise<Album> {
    const albums = await local.getAll<LocalAlbumRow>("albums");
    if (albums.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new Error("You already have an album with that name.");
    }
    const album = { id: `l:${local.uid()}`, name: name.trim() };
    await local.put("albums", album);
    return { ...album, entry_count: 0 };
  }

  async renameAlbum(id: string, name: string): Promise<Album> {
    const album = await local.get<LocalAlbumRow>("albums", id);
    if (!album) throw new Error("That album was not found.");
    album.name = name.trim();
    await local.put("albums", album);
    return (await this.listAlbums()).find((a) => a.id === id)!;
  }

  async deleteAlbum(id: string): Promise<void> {
    await local.remove("albums", id);
    for (const entry of await local.getAll<LocalEntryRow>("entries")) {
      if (entry.album_ids.includes(id)) {
        entry.album_ids = entry.album_ids.filter((a) => a !== id);
        await local.put("entries", entry);
      }
    }
  }

  async listDesigns(): Promise<SavedDesign[]> {
    const rows = await local.getAll<LocalDesignRow>("designs");
    return rows
      .map((d) => ({ ...d, recipe: normalizeRecipe(d.recipe) }))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async saveDesign(recipe: FlowerRecipe, title: string, id?: string): Promise<SavedDesign> {
    const row: LocalDesignRow = {
      id: id?.startsWith("l:") ? id : `l:${local.uid()}`,
      title: title.trim() || recipe.word,
      recipe,
      updated_at: new Date().toISOString(),
    };
    await local.put("designs", row);
    return row;
  }

  async deleteDesign(id: string): Promise<void> {
    await local.remove("designs", id);
  }

  async counts(): Promise<{ entries: number; designs: number; albums: number }> {
    const [entries, designs, albums] = await Promise.all([
      local.getAll("entries"),
      local.getAll("designs"),
      local.getAll("albums"),
    ]);
    return { entries: entries.length, designs: designs.length, albums: albums.length };
  }

  /** Copies everything on this device into the signed-in account, then clears it here. */
  async moveTo(server: ServerStore, onProgress?: (done: number, total: number) => void): Promise<number> {
    const albums = await local.getAll<LocalAlbumRow>("albums");
    const existing = await server.listAlbums();
    const albumMap = new Map<string, string>();
    for (const album of albums) {
      const match = existing.find((a) => a.name.toLowerCase() === album.name.toLowerCase());
      albumMap.set(album.id, match ? match.id : (await server.createAlbum(album.name)).id);
    }
    for (const design of await local.getAll<LocalDesignRow>("designs")) {
      await server.saveDesign(normalizeRecipe(design.recipe), design.title);
      await local.remove("designs", design.id);
    }
    const entries = await local.getAll<LocalEntryRow>("entries");
    let done = 0;
    for (const entry of entries) {
      await server.createEntry({
        entry_type: entry.entry_type,
        title: entry.title,
        caption: entry.caption,
        notes: entry.notes,
        taken_at: entry.taken_at,
        recipe: entry.recipe,
        photo: await local.getBlob(entry.photoBlobId),
        original: await local.getBlob(entry.originalBlobId),
        edit_state: entry.edit_state,
        album_ids: entry.album_ids.map((id) => albumMap.get(id)).filter((id): id is string => Boolean(id)),
      });
      await local.remove("entries", entry.id);
      done += 1;
      onProgress?.(done, entries.length);
    }
    for (const album of albums) await local.remove("albums", album.id);
    await this.collectBlobs();
    return done;
  }
}

export const serverStore = new ServerStore();
export const localStore = new LocalStore();

/** The store an entry id belongs to ("s:12" = account, "l:…" = this device). */
export function storeFor(id: string, fallback: BloomStore): BloomStore {
  if (id.startsWith("s:")) return serverStore;
  if (id.startsWith("l:")) return localStore;
  return fallback;
}
