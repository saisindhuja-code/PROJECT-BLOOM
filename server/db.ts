/**
 * Bloom persistence store (JSON + in-memory media blobs, with optional disk backing).
 * Designed to run seamlessly in ephemeral containers and local dev without external DB setup.
 */
import fs from "node:fs";
import path from "node:path";

export type ProfileVisibility = "everyone" | "friends" | "private";
export type DmPolicy = "everyone" | "friends";

export interface UserPrivacy {
  profile_visibility: ProfileVisibility;
  allow_dm_from: DmPolicy;
  discoverable: boolean;
  show_online: boolean;
}

export interface UserRecord {
  id: number;
  bloom_id: string;
  username: string;
  display_name: string;
  password_hash: string;
  bio: string;
  favorite_word: string;
  avatar_recipe: Record<string, unknown> | null;
  privacy: UserPrivacy;
  created_at: string;
  updated_at: string;
}

export interface FlowerDesignRecord {
  id: number;
  owner_id: number;
  title: string;
  recipe: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MediaRecord {
  id: number;
  owner_id: number;
  kind: string;
  content_type: string;
  width: number;
  height: number;
  size_bytes: number;
  storage_key: string;
  created_at: string;
}

export interface AlbumRecord {
  id: number;
  owner_id: number;
  name: string;
  created_at: string;
}

export interface JournalEntryRecord {
  id: number;
  owner_id: number;
  entry_type: "flower" | "photo" | "composition";
  title: string;
  caption: string;
  notes: string;
  taken_at: string;
  recipe: Record<string, unknown> | null;
  photo_media_id: number | null;
  original_media_id: number | null;
  edit_state: Record<string, unknown> | null;
  project_id: number | null;
  participants: Array<{ bloom_id: string; display_name: string }>;
  album_ids: number[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendshipRecord {
  id: number;
  requester_id: number;
  addressee_id: number;
  status: "pending" | "accepted";
  created_at: string;
  responded_at: string | null;
}

export interface FollowRecord {
  id: number;
  follower_id: number;
  followee_id: number;
  created_at: string;
}

export interface ReactionRecord {
  id: number;
  target_type: "entry" | "project" | "message" | "design";
  target_id: string;
  user_id: number;
  emoji: string;
  created_at: string;
}

export interface NotificationRecord {
  id: number;
  user_id: number;
  type: "friend_request" | "friend_accepted" | "follow" | "project_invite" | "project_update" | "reaction" | "chat_message" | "live_invite";
  actor_id: number | null;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export interface ChatThreadRecord {
  id: number;
  type: "dm" | "group" | "studio" | "project";
  title: string;
  project_id: number | null;
  created_by: number | null;
  member_ids: number[];
  last_read_by: Record<number, number>;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRecord {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string;
  flower_recipe: Record<string, unknown> | null;
  media_id: number | null;
  journal_entry_id: number | null;
  reply_to_id: number | null;
  created_at: string;
}

export interface ProjectMemberRecord {
  user_id: number;
  role: "owner" | "member";
  status: "invited" | "active";
  created_at: string;
}

export interface ContributionItemRecord {
  media_id: number | null;
  recipe: Record<string, unknown> | null;
  photo: Record<string, number>;
  flower: Record<string, number>;
}

export interface ContributionRecord {
  user_id: number;
  items: ContributionItemRecord[];
  updated_at: string;
}

export interface ProjectRecord {
  id: number;
  owner_id: number;
  title: string;
  mode: "twin" | "two" | "moment";
  shared_recipe: Record<string, unknown> | null;
  layout: string;
  theme_state: Record<string, unknown> | null;
  members: ProjectMemberRecord[];
  contributions: ContributionRecord[];
  created_at: string;
  updated_at: string;
}

export interface LiveRoomRecord {
  id: string;
  host_id: number;
  guest_id: number;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
}

export interface LiveCaptureRecord {
  id: number;
  room_id: string;
  user_id: number;
  media_id: number;
  round_id: string;
  placement: Record<string, number> | null;
  created_at: string;
}

interface PersistedState {
  seq: Record<string, number>;
  users: UserRecord[];
  designs: FlowerDesignRecord[];
  media: MediaRecord[];
  albums: AlbumRecord[];
  journalEntries: JournalEntryRecord[];
  friendships: FriendshipRecord[];
  follows: FollowRecord[];
  reactions: ReactionRecord[];
  notifications: NotificationRecord[];
  chats: ChatThreadRecord[];
  chatMessages: ChatMessageRecord[];
  projects: ProjectRecord[];
  liveRooms: LiveRoomRecord[];
  liveCaptures: LiveCaptureRecord[];
}

export class BloomDatabase {
  private dataDir: string | null;
  private mediaDir: string | null;
  private dbFile: string | null;
  private mediaBuffers = new Map<string, Buffer>();
  private saveTimer: NodeJS.Timeout | null = null;

  seq: Record<string, number> = {
    user: 0,
    design: 0,
    media: 0,
    album: 0,
    entry: 0,
    friendship: 0,
    follow: 0,
    reaction: 0,
    notification: 0,
    chat: 0,
    message: 0,
    project: 0,
    capture: 0,
  };

  users: UserRecord[] = [];
  designs: FlowerDesignRecord[] = [];
  media: MediaRecord[] = [];
  albums: AlbumRecord[] = [];
  journalEntries: JournalEntryRecord[] = [];
  friendships: FriendshipRecord[] = [];
  follows: FollowRecord[] = [];
  reactions: ReactionRecord[] = [];
  notifications: NotificationRecord[] = [];
  chats: ChatThreadRecord[] = [];
  chatMessages: ChatMessageRecord[] = [];
  projects: ProjectRecord[] = [];
  liveRooms: LiveRoomRecord[] = [];
  liveCaptures: LiveCaptureRecord[] = [];

  constructor(options: { dataDir?: string | null } = {}) {
    if (options.dataDir === null) {
      this.dataDir = null;
      this.mediaDir = null;
      this.dbFile = null;
    } else {
      const dir = options.dataDir ?? path.resolve(process.cwd(), ".bloom-data");
      this.dataDir = dir;
      this.mediaDir = path.join(dir, "media");
      this.dbFile = path.join(dir, "db.json");
      try {
        fs.mkdirSync(this.mediaDir, { recursive: true });
        if (fs.existsSync(this.dbFile)) {
          const parsed = JSON.parse(fs.readFileSync(this.dbFile, "utf-8")) as Partial<PersistedState>;
          if (parsed.seq) this.seq = { ...this.seq, ...parsed.seq };
          this.users = parsed.users ?? [];
          this.designs = parsed.designs ?? [];
          this.media = parsed.media ?? [];
          this.albums = parsed.albums ?? [];
          this.journalEntries = parsed.journalEntries ?? [];
          this.friendships = parsed.friendships ?? [];
          this.follows = parsed.follows ?? [];
          this.reactions = parsed.reactions ?? [];
          this.notifications = parsed.notifications ?? [];
          this.chats = parsed.chats ?? [];
          this.chatMessages = parsed.chatMessages ?? [];
          this.projects = parsed.projects ?? [];
          this.liveRooms = parsed.liveRooms ?? [];
          this.liveCaptures = parsed.liveCaptures ?? [];
        }
      } catch {
        // Fallback cleanly to in-memory if filesystem is read-only
        this.dataDir = null;
        this.mediaDir = null;
        this.dbFile = null;
      }
    }

    this.ensureStudioChat();
  }

  private ensureStudioChat(): void {
    const existing = this.chats.find((c) => c.type === "studio");
    if (!existing) {
      const now = new Date().toISOString();
      this.chats.push({
        id: this.nextId("chat"),
        type: "studio",
        title: "Studio Lounge",
        project_id: null,
        created_by: null,
        member_ids: [],
        last_read_by: {},
        created_at: now,
        updated_at: now,
      });
    }
  }

  nextId(key: string): number {
    this.seq[key] = (this.seq[key] ?? 0) + 1;
    return this.seq[key];
  }

  now(): string {
    return new Date().toISOString();
  }

  persist(): void {
    if (!this.dbFile) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        const snapshot: PersistedState = {
          seq: this.seq,
          users: this.users,
          designs: this.designs,
          media: this.media,
          albums: this.albums,
          journalEntries: this.journalEntries,
          friendships: this.friendships,
          follows: this.follows,
          reactions: this.reactions,
          notifications: this.notifications,
          chats: this.chats,
          chatMessages: this.chatMessages,
          projects: this.projects,
          liveRooms: this.liveRooms,
          liveCaptures: this.liveCaptures,
        };
        const tmp = `${this.dbFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(snapshot));
        fs.renameSync(tmp, this.dbFile!);
      } catch {
        // Ignore transient write errors
      }
    }, 50);
  }

  saveMediaBytes(key: string, data: Buffer): void {
    this.mediaBuffers.set(key, data);
    if (this.mediaDir) {
      try {
        fs.writeFileSync(path.join(this.mediaDir, key), data);
      } catch {
        // Already in memory map
      }
    }
  }

  readMediaBytes(key: string): Buffer | null {
    const cached = this.mediaBuffers.get(key);
    if (cached) return cached;
    if (this.mediaDir) {
      try {
        const filePath = path.join(this.mediaDir, key);
        if (fs.existsSync(filePath)) {
          const data = fs.readFileSync(filePath);
          this.mediaBuffers.set(key, data);
          return data;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  deleteMediaBytes(key: string): void {
    this.mediaBuffers.delete(key);
    if (this.mediaDir) {
      try {
        const filePath = path.join(this.mediaDir, key);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
    }
  }
}
