/**
 * Website themes (the interface look). These are NOT photo filters: a theme
 * changes colours, type and decoration of the app; photo filters change a
 * photograph (see imaging/themes.ts). The two are chosen independently.
 *
 * The visual tokens live in styles/themes.css under [data-theme="…"]; this
 * file holds everything the app needs to know about each theme in code.
 */

import type { FlowerColors } from "../flower/recipe";
import type { ThemeId as FilterId } from "../imaging/themes";

export type SiteThemeId = "midnight" | "y2k" | "paper" | "fairy";
/** "auto" follows the device: Midnight Garden when dark, Paper Hearts when light. */
export type ThemeChoice = SiteThemeId | "auto";

export interface SiteTheme {
  id: SiteThemeId;
  name: string;
  tagline: string;
  description: string;
  tone: "dark" | "light";
  /** Shown in the theme gallery. */
  palette: Array<{ name: string; color: string }>;
  /** Browser UI colour (address bar on phones). */
  metaColor: string;
  /** Flower colours this theme suggests. Only applied when you press the button. */
  flowerColors: FlowerColors;
  /** Photo filter Bloom Cam starts with when you open it (you can change it). */
  cameraFilter: FilterId;
  /** How the journal is described in this theme. */
  journalName: string;
}

export const SITE_THEMES: SiteTheme[] = [
  {
    id: "midnight",
    name: "Midnight Garden",
    tagline: "The signature Bloom",
    description: "Deep plum night, rose and lavender light, a few quiet stars. A dark, immersive studio.",
    tone: "dark",
    palette: [
      { name: "Plum night", color: "#140b19" },
      { name: "Rose", color: "#e7a3b5" },
      { name: "Lavender", color: "#b9a2e8" },
      { name: "Ivory", color: "#f4ead9" },
      { name: "Plum grey", color: "#52365f" },
    ],
    metaColor: "#140b19",
    flowerColors: {
      ring1: "#ffe6f2",
      ring2: "#ffb3d9",
      ring3: "#ff66b2",
      ring4: "#ff1493",
      ring5: "#c71585",
      green: "#2e8b57",
      hearts: "#ff99cc",
      background: "#180018",
    },
    cameraFilter: "natural",
    journalName: "A nocturnal botanical archive",
  },
  {
    id: "y2k",
    name: "Y2K Digicam",
    tagline: "Early-2000s compact camera",
    description: "Brushed silver, hot pink and digital blue, LCD timestamps and chunky plastic buttons.",
    tone: "light",
    palette: [
      { name: "Silver", color: "#dfe2e8" },
      { name: "Hot pink", color: "#ff3ea5" },
      { name: "Digital blue", color: "#2f7bff" },
      { name: "White", color: "#ffffff" },
      { name: "Charcoal", color: "#1d2230" },
    ],
    metaColor: "#e9ebf0",
    flowerColors: {
      ring1: "#ffffff",
      ring2: "#9fd0ff",
      ring3: "#ff7cc4",
      ring4: "#ff3ea5",
      ring5: "#2f7bff",
      green: "#3ccf91",
      hearts: "#ff3ea5",
      background: "#14161f",
    },
    cameraFilter: "y2k",
    journalName: "A digital photo collection",
  },
  {
    id: "paper",
    name: "Paper Hearts",
    tagline: "Scrapbooks and letters",
    description: "Warm cream paper, dusty rose and cocoa ink, tape, Polaroids and handwritten notes.",
    tone: "light",
    palette: [
      { name: "Cream", color: "#f3ebe0" },
      { name: "Dusty rose", color: "#c97b84" },
      { name: "Cocoa", color: "#4a2a22" },
      { name: "Burgundy", color: "#8e3b4a" },
      { name: "Kraft", color: "#d6c3ab" },
    ],
    metaColor: "#f3ebe0",
    flowerColors: {
      ring1: "#fbe9e4",
      ring2: "#eab8b8",
      ring3: "#c97b84",
      ring4: "#a3505e",
      ring5: "#7a2e3c",
      green: "#6f7d55",
      hearts: "#c97b84",
      background: "#f6eee3",
    },
    cameraFilter: "polaroid",
    journalName: "A scrapbook of pressed moments",
  },
  {
    id: "fairy",
    name: "Fairycore",
    tagline: "A magical garden",
    description: "Lavender and blush on pearl, floating petals, soft sparkles and gentle light.",
    tone: "light",
    palette: [
      { name: "Lavender", color: "#9c7fd6" },
      { name: "Blush", color: "#e58fb4" },
      { name: "Pearl", color: "#fbf8ff" },
      { name: "Pale lilac", color: "#e6dcf6" },
      { name: "Twilight ink", color: "#3e2b5a" },
    ],
    metaColor: "#f4eefb",
    flowerColors: {
      ring1: "#fff7fd",
      ring2: "#f6d3ea",
      ring3: "#e58fb4",
      ring4: "#b796e6",
      ring5: "#8a6bc9",
      green: "#8fbf9f",
      hearts: "#c9a8f0",
      background: "#f7f1fd",
    },
    cameraFilter: "dreamy-pastel",
    journalName: "A dreamy garden of keepsakes",
  },
];

export const DEFAULT_THEME: SiteThemeId = "midnight";

export function siteTheme(id: string | null | undefined): SiteTheme {
  return SITE_THEMES.find((t) => t.id === id) ?? SITE_THEMES[0];
}

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "auto" || SITE_THEMES.some((t) => t.id === value);
}

export function resolveChoice(choice: ThemeChoice, deviceIsDark: boolean): SiteThemeId {
  if (choice === "auto") return deviceIsDark ? "midnight" : "paper";
  return choice;
}
