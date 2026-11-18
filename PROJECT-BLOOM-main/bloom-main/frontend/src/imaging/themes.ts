/**
 * Bloom Themes: digital-camera looks built from a small set of adjustable
 * ingredients (colour grade, grain, glow, vignette, date stamp, frame).
 *
 * A theme is only a description. The photo itself is never changed: every
 * preview and export is rendered fresh from the original image.
 */

export type ThemeId =
  | "natural"
  | "y2k"
  | "vintage-film"
  | "disposable"
  | "dreamy-pastel"
  | "botanical"
  | "midnight"
  | "polaroid"
  | "scrapbook"
  | "warm-sunset"
  | "black-white"
  | "soft-glow";

export type DateStyle = "none" | "lcd" | "film" | "handwritten";
export type FrameStyle = "none" | "polaroid" | "film" | "scrapbook" | "cream" | "garden" | "midnight" | "y2k";

export interface Grade {
  exposure: number; // stops, about -1..1
  contrast: number; // 1 = unchanged
  saturation: number; // 1 = unchanged
  temperature: number; // -1 cool .. 1 warm
  tint: number; // -1 green .. 1 magenta
  fade: number; // 0..0.3 lifts the blacks
  shadows: [number, number, number]; // colour pushed into the shadows (-1..1 per channel)
  highlights: [number, number, number];
  split: number; // strength of the shadow/highlight colours
  bw: number; // 0 colour .. 1 black and white
  flash: number; // 0..1 on-camera flash hot spot
  chroma: number; // pixels of red/blue fringing (cheap digital lens)
  halation: number; // 0..1 red glow around highlights (film)
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  blurb: string;
  grade: Grade;
  defaults: { grain: number; vignette: number; glow: number; dateStamp: boolean; frame: boolean };
  date: DateStyle;
  frame: FrameStyle;
  /** Two colours for the little swatch in the theme gallery. */
  swatch: [string, string];
}

export interface ThemeSettings {
  preset: ThemeId;
  intensity: number; // 0..1, how strongly the colour grade applies
  grain: number; // 0..1
  vignette: number; // 0..1
  glow: number; // 0..1
  dateStamp: boolean;
  frame: boolean;
  /** Your own adjustments on top of the filter, -1..1 (0 = unchanged). */
  brightness: number;
  contrast: number;
  saturation: number;
}

const NEUTRAL: Grade = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  fade: 0,
  shadows: [0, 0, 0],
  highlights: [0, 0, 0],
  split: 0,
  bw: 0,
  flash: 0,
  chroma: 0,
  halation: 0,
};

const grade = (values: Partial<Grade>): Grade => ({ ...NEUTRAL, ...values });

export const THEMES: ThemePreset[] = [
  {
    id: "natural",
    name: "No filter",
    blurb: "Your photo as it was taken.",
    grade: NEUTRAL,
    defaults: { grain: 0, vignette: 0, glow: 0, dateStamp: false, frame: false },
    date: "lcd",
    frame: "none",
    swatch: ["#d9cfc7", "#8c7f86"],
  },
  {
    id: "y2k",
    name: "Y2K Flash",
    blurb: "Cool, punchy, a little lens fringe and an orange date.",
    grade: grade({ exposure: 0.12, contrast: 1.12, saturation: 1.22, temperature: -0.22, tint: 0.08, fade: 0.02, chroma: 1.6, flash: 0.12 }),
    defaults: { grain: 0.22, vignette: 0.12, glow: 0.18, dateStamp: true, frame: false },
    date: "lcd",
    frame: "y2k",
    swatch: ["#9fd3ff", "#ff9a3c"],
  },
  {
    id: "vintage-film",
    name: "Vintage Film",
    blurb: "Warm highlights, teal shadows, soft grain and halation.",
    grade: grade({
      exposure: -0.03,
      contrast: 0.94,
      saturation: 0.82,
      temperature: 0.3,
      fade: 0.08,
      shadows: [-0.35, 0.25, 0.4],
      highlights: [0.45, 0.25, -0.2],
      split: 0.16,
      halation: 0.35,
    }),
    defaults: { grain: 0.42, vignette: 0.32, glow: 0.1, dateStamp: true, frame: false },
    date: "film",
    frame: "film",
    swatch: ["#d9a066", "#3f6f73"],
  },
  {
    id: "disposable",
    name: "Disposable Camera",
    blurb: "Hard on-camera flash, dark corners, party grain.",
    grade: grade({ exposure: 0.05, contrast: 1.22, saturation: 1.08, temperature: -0.08, flash: 0.6 }),
    defaults: { grain: 0.34, vignette: 0.55, glow: 0.05, dateStamp: true, frame: false },
    date: "film",
    frame: "none",
    swatch: ["#fff6e8", "#2a2228"],
  },
  {
    id: "dreamy-pastel",
    name: "Soft Dream",
    blurb: "Airy, milky and pink, with a gentle bloom.",
    grade: grade({
      exposure: 0.2,
      contrast: 0.8,
      saturation: 0.72,
      temperature: 0.06,
      tint: 0.18,
      fade: 0.17,
      highlights: [0.5, 0.2, 0.35],
      split: 0.12,
    }),
    defaults: { grain: 0.08, vignette: 0.08, glow: 0.45, dateStamp: false, frame: true },
    date: "handwritten",
    frame: "cream",
    swatch: ["#f8d7e3", "#d8d0f2"],
  },
  {
    id: "botanical",
    name: "Botanical Garden",
    blurb: "Lush greens, creamy light, pressed in a sage mat.",
    grade: grade({
      contrast: 1.06,
      saturation: 1.1,
      temperature: 0.1,
      fade: 0.05,
      shadows: [-0.15, 0.3, -0.05],
      highlights: [0.3, 0.25, 0.05],
      split: 0.14,
    }),
    defaults: { grain: 0.18, vignette: 0.24, glow: 0.12, dateStamp: false, frame: true },
    date: "handwritten",
    frame: "garden",
    swatch: ["#9db39a", "#f4ead9"],
  },
  {
    id: "midnight",
    name: "Midnight Blue",
    blurb: "Low light, plum shadows and lavender glow.",
    grade: grade({
      exposure: -0.22,
      contrast: 1.18,
      saturation: 0.86,
      temperature: -0.3,
      tint: 0.14,
      shadows: [0.3, -0.1, 0.55],
      highlights: [0.25, 0.15, 0.45],
      split: 0.2,
    }),
    defaults: { grain: 0.3, vignette: 0.6, glow: 0.32, dateStamp: false, frame: true },
    date: "lcd",
    frame: "midnight",
    swatch: ["#2a1934", "#b9a2e8"],
  },
  {
    id: "polaroid",
    name: "Polaroid",
    blurb: "Instant film colour in a white frame with a caption.",
    grade: grade({
      contrast: 0.9,
      saturation: 0.88,
      temperature: 0.16,
      fade: 0.11,
      shadows: [-0.2, 0.15, 0.3],
      highlights: [0.3, 0.2, 0.0],
      split: 0.12,
    }),
    defaults: { grain: 0.14, vignette: 0.2, glow: 0.08, dateStamp: false, frame: true },
    date: "handwritten",
    frame: "polaroid",
    swatch: ["#f7f3ea", "#c9a36b"],
  },
  {
    id: "scrapbook",
    name: "Scrapbook",
    blurb: "Taped onto kraft paper with the date in pen.",
    grade: grade({ saturation: 0.94, temperature: 0.12, fade: 0.06, contrast: 0.97 }),
    defaults: { grain: 0.2, vignette: 0.14, glow: 0, dateStamp: true, frame: true },
    date: "handwritten",
    frame: "scrapbook",
    swatch: ["#d8c3a0", "#c96b88"],
  },
  {
    id: "warm-sunset",
    name: "Warm Sunset",
    blurb: "Golden hour: orange light and rosy shadows.",
    grade: grade({
      exposure: 0.04,
      contrast: 1.05,
      saturation: 1.14,
      temperature: 0.55,
      tint: 0.1,
      shadows: [0.35, -0.05, 0.25],
      highlights: [0.5, 0.2, -0.25],
      split: 0.16,
    }),
    defaults: { grain: 0.14, vignette: 0.3, glow: 0.34, dateStamp: false, frame: false },
    date: "film",
    frame: "none",
    swatch: ["#ff9f5a", "#c95a7a"],
  },
  {
    id: "black-white",
    name: "Black and White",
    blurb: "Silver gelatin contrast and real grain.",
    grade: grade({ bw: 1, contrast: 1.24, fade: 0.03 }),
    defaults: { grain: 0.4, vignette: 0.3, glow: 0, dateStamp: false, frame: true },
    date: "handwritten",
    frame: "cream",
    swatch: ["#f2f2f2", "#1a1a1a"],
  },
  {
    id: "soft-glow",
    name: "Soft Glow",
    blurb: "Gentle bloom on the highlights, lifted blacks and skin-friendly warmth.",
    grade: grade({
      exposure: 0.1,
      contrast: 0.9,
      saturation: 0.95,
      temperature: 0.1,
      tint: 0.06,
      fade: 0.07,
      highlights: [0.25, 0.15, 0.2],
      split: 0.08,
      halation: 0.12,
    }),
    defaults: { grain: 0.06, vignette: 0.12, glow: 0.55, dateStamp: false, frame: false },
    date: "film",
    frame: "none",
    swatch: ["#fde6ef", "#f6c9a8"],
  },
];

export const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function themeById(id: string | undefined): ThemePreset {
  return THEME_BY_ID.get(id as ThemeId) ?? THEMES[0];
}

export function defaultSettings(id: ThemeId = "natural"): ThemeSettings {
  const preset = themeById(id);
  return { preset: preset.id, intensity: 1, ...preset.defaults, brightness: 0, contrast: 0, saturation: 0 };
}

const signed = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0;
};

/** True when the photo has no filter and no adjustments: it shows exactly as taken. */
export function isUnfiltered(s: ThemeSettings): boolean {
  return s.preset === "natural" && !s.brightness && !s.contrast && !s.saturation && !s.grain && !s.vignette && !s.glow && !s.dateStamp;
}

export function normalizeSettings(input: unknown): ThemeSettings {
  if (!input || typeof input !== "object") return defaultSettings();
  const data = input as Record<string, unknown>;
  const base = defaultSettings(themeById(String(data.preset)).id);
  const num = (key: keyof ThemeSettings) => {
    const value = Number(data[key]);
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : (base[key] as number);
  };
  return {
    preset: base.preset,
    intensity: num("intensity"),
    grain: num("grain"),
    vignette: num("vignette"),
    glow: num("glow"),
    dateStamp: typeof data.dateStamp === "boolean" ? data.dateStamp : base.dateStamp,
    frame: typeof data.frame === "boolean" ? data.frame : base.frame,
    brightness: signed(data.brightness),
    contrast: signed(data.contrast),
    saturation: signed(data.saturation),
  };
}
