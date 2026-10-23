/**
 * IndexedDB storage for "this device" mode (no account, or server offline).
 * Survives page refreshes and browser restarts. Images are stored as Blobs.
 */

const DB_NAME = "bloom-local";
const DB_VERSION = 1;
export const STORES = ["entries", "albums", "designs", "blobs"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("This browser cannot store things offline."));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(new Error("This browser blocked offline storage (private windows often do)."));
      };
    });
  }
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Storage error"));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(id)) as Promise<T | undefined>;
}

export async function put<T extends { id: string }>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not save on this device. The browser may be out of space."));
    tx.onabort = () => reject(tx.error ?? new Error("Could not save on this device. The browser may be out of space."));
  });
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putBlob(blob: Blob): Promise<string> {
  const id = uid();
  await put("blobs", { id, blob });
  return id;
}

export async function getBlob(id: string | null | undefined): Promise<Blob | null> {
  if (!id) return null;
  const row = await get<{ id: string; blob: Blob }>("blobs", id);
  return row?.blob ?? null;
}
