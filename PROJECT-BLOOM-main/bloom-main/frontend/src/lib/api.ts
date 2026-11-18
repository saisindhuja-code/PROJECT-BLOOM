/**
 * Small fetch wrapper for the FastAPI backend.
 * - Sends cookies (the session lives in an httpOnly cookie).
 * - Adds the X-Bloom-Client header the server requires on changes (CSRF guard).
 * - Turns errors into ApiError with a readable message.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string; loc?: unknown[] };
      const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : "";
      const msg = (first.msg ?? "is not valid").replace(/^Value error, /, "");
      return field && field !== "body" ? `${field.replace(/_/g, " ")}: ${msg}` : msg;
    }
  }
  return fallback;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.form ? "POST" : "GET");
  const headers: Record<string, string> = { "X-Bloom-Client": "1" };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body, credentials: "include", signal: options.signal });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("Can't reach the Bloom server. Is the backend running?", 0);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const fallback =
      response.status === 502 || response.status === 503 || response.status === 504
        ? "Can't reach the Bloom server. Is the backend running?"
        : `Something went wrong (${response.status}).`;
    throw new ApiError(messageFrom(data, fallback), response.status >= 502 && response.status <= 504 ? 0 : response.status);
  }
  return data as T;
}

export async function uploadImage(blob: Blob, kind: string, filename = "image.jpg"): Promise<MediaInfo> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("kind", kind);
  return api<MediaInfo>("/api/media", { form });
}

export function mediaUrl(path: string | null | undefined): string | null {
  return path ? `${API_BASE}${path}` : null;
}

export async function fetchImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status === 404 ? "That image is no longer shared with you." : "Could not load the image.", response.status);
  return blobToImage(await response.blob());
}

export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as an image."));
    };
    image.src = url;
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

// ---------------------------------------------------------------------------
// Shared server types
// ---------------------------------------------------------------------------

export type ProfileVisibility = "everyone" | "friends" | "private";
export type DmPolicy = "everyone" | "friends";

export interface UserPrivacy {
  profile_visibility: ProfileVisibility;
  allow_dm_from: DmPolicy;
  discoverable: boolean;
  show_online: boolean;
}

export interface User {
  id: number;
  bloom_id: string;
  username: string;
  display_name: string;
  bio: string;
  favorite_word: string;
  avatar_recipe: Record<string, unknown> | null;
  privacy: UserPrivacy;
  created_at: string;
}

export interface PublicUser {
  bloom_id: string;
  display_name: string;
  avatar_recipe?: Record<string, unknown> | null;
  online?: boolean;
}

export interface DiscoverUser extends PublicUser {
  favorite_word?: string;
  relation: "none" | "self" | "friend" | "request-sent" | "request-received";
  following: boolean;
}

export interface UserProfile extends PublicUser {
  relation: "none" | "self" | "friend" | "request-sent" | "request-received";
  following: boolean;
  follows_you: boolean;
  profile_locked: boolean;
  bio: string;
  favorite_word: string;
  allow_dm: boolean;
  stats: { followers: number; following: number; friends: number };
  created_at: string;
}

export interface ReactionCount {
  emoji: string;
  count: number;
  reacted: boolean;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
  actor: { bloom_id: string; display_name: string } | null;
}

export interface NotificationsData {
  items: NotificationItem[];
  unread: number;
}

export interface ChatMember extends PublicUser {
  is_you: boolean;
}

export interface ChatMessage {
  id: number;
  chat_id: number;
  sender: PublicUser;
  is_you: boolean;
  text: string;
  flower_recipe: Record<string, unknown> | null;
  media_id: number | null;
  media_url: string | null;
  journal_entry_id: number | null;
  reply_to: { id: number; text: string; sender_name: string } | null;
  reactions: ReactionCount[];
  created_at: string;
}

export interface ChatThread {
  id: number;
  type: "dm" | "group" | "studio" | "project";
  title: string;
  project_id: number | null;
  members: ChatMember[];
  unread: number;
  last_message: ChatMessage | null;
  created_at: string;
  updated_at: string;
}

export interface MediaInfo {
  id: number;
  kind: string;
  url: string;
  width: number;
  height: number;
  content_type: string;
}
