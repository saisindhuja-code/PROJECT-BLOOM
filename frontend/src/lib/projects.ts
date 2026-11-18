/** Types and helpers for Bloom Together projects. */
import { normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { normalizePhotoTransform, normalizePlacement, type CompositionItem, type FlowerPlacement, type LayoutId, type PhotoTransform } from "../imaging/compose";
import { normalizeSettings, type ThemeSettings } from "../imaging/themes";
import { api, fetchImage, mediaUrl, type PublicUser } from "./api";

export type ProjectMode = "twin" | "two" | "moment";

export const MODES: Array<{ id: ProjectMode; name: string; text: string; max: number }> = [
  { id: "twin", name: "Twin Bloom", text: "One flower design, two photographs. You each hold the same flower wherever you are.", max: 1 },
  { id: "two", name: "Two Blooms", text: "You each grow your own flower and take your own photo; they meet in one picture.", max: 1 },
  { id: "moment", name: "Our Moment", text: "A shared page: you each add up to four photos or flowers to one layout.", max: 4 },
];

export interface ItemData {
  media_id: number | null;
  media_url: string | null;
  recipe: FlowerRecipe | null;
  photo: Record<string, number>;
  flower: Record<string, number>;
}

export interface Member extends PublicUser {
  role: "owner" | "member";
  status: "invited" | "active";
  is_you: boolean;
}

export interface Contribution extends PublicUser {
  is_you: boolean;
  items: ItemData[];
  updated_at: string;
}

export interface Project {
  id: number;
  title: string;
  mode: ProjectMode;
  owner: PublicUser;
  is_owner: boolean;
  my_status: "invited" | "active" | null;
  created_at: string;
  updated_at: string;
  layout?: LayoutId;
  theme_state?: unknown;
  shared_recipe?: unknown;
  members?: Member[];
  contributions?: Contribution[];
}

/** Editable form of one of my items (photo may be a new, not yet uploaded capture). */
export interface DraftItem {
  key: string;
  mediaId: number | null;
  image: HTMLCanvasElement | HTMLImageElement | null;
  newPhoto: HTMLCanvasElement | null;
  recipe: FlowerRecipe | null;
  photo: PhotoTransform;
  flower: FlowerPlacement;
}

export function placementToJson(p: FlowerPlacement): Record<string, number> {
  return {
    x: p.x,
    y: p.y,
    size: p.size,
    rotation: p.rotation,
    flip: p.flip ? 1 : 0,
    visible: p.visible ? 1 : 0,
    cropTop: p.crop.top,
    cropRight: p.crop.right,
    cropBottom: p.crop.bottom,
    cropLeft: p.crop.left,
  };
}

export function placementFromJson(data: Record<string, number> | undefined): FlowerPlacement {
  const d = data ?? {};
  return normalizePlacement({
    x: d.x,
    y: d.y,
    size: d.size,
    rotation: d.rotation,
    flip: d.flip === 1,
    visible: d.visible === undefined ? true : d.visible === 1,
    crop: { top: d.cropTop, right: d.cropRight, bottom: d.cropBottom, left: d.cropLeft },
  });
}

export function photoFromJson(data: Record<string, number> | undefined): PhotoTransform {
  return normalizePhotoTransform(data);
}

export function sharedRecipe(project: Project): FlowerRecipe | null {
  return project.shared_recipe ? normalizeRecipe(project.shared_recipe) : null;
}

export function projectTheme(project: Project): ThemeSettings {
  return normalizeSettings(project.theme_state);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadProjectImage(url: string): Promise<HTMLImageElement> {
  const full = mediaUrl(url)!;
  let pending = imageCache.get(full);
  if (!pending) {
    pending = fetchImage(full);
    pending.catch(() => imageCache.delete(full));
    imageCache.set(full, pending);
  }
  return pending;
}

/**
 * Builds the list of pictures for the composition, in a stable order
 * (owner first), with placeholders for anyone who hasn't added theirs yet.
 * `mine` replaces my saved items with my unsaved drafts.
 */
export function compositionItems(
  project: Project,
  images: Map<number, HTMLImageElement>,
  mine: DraftItem[] | null,
): CompositionItem[] {
  const shared = sharedRecipe(project);
  const members = (project.members ?? []).filter((m) => m.status === "active");
  const items: CompositionItem[] = [];
  for (const member of members) {
    const contribution = project.contributions?.find((c) => c.bloom_id === member.bloom_id);
    const recipeFor = (own: FlowerRecipe | null) => (project.mode === "twin" ? shared : own);
    if (member.is_you && mine) {
      if (mine.length === 0) items.push(placeholder(`Add your photo`, project.mode === "twin" ? shared : null));
      for (const draft of mine) {
        items.push({ photo: draft.image, photoTransform: draft.photo, recipe: recipeFor(draft.recipe), flower: draft.flower });
      }
      continue;
    }
    if (!contribution || contribution.items.length === 0) {
      items.push(placeholder(`Waiting for ${member.display_name}`, null));
      continue;
    }
    for (const item of contribution.items) {
      items.push({
        photo: item.media_id ? images.get(item.media_id) ?? null : null,
        photoTransform: photoFromJson(item.photo),
        recipe: recipeFor(item.recipe ? normalizeRecipe(item.recipe) : null),
        flower: placementFromJson(item.flower),
        label: item.media_id && !images.get(item.media_id) ? "Loading…" : undefined,
      });
    }
  }
  if (project.mode !== "moment" && members.length < 2) items.push(placeholder("Waiting for your friend to join", null));
  return items;
}

function placeholder(label: string, recipe: FlowerRecipe | null): CompositionItem {
  return { photo: null, photoTransform: normalizePhotoTransform(null), recipe, flower: normalizePlacement(null), label };
}

export async function fetchProject(id: number): Promise<Project> {
  return api<Project>(`/api/projects/${id}`);
}
