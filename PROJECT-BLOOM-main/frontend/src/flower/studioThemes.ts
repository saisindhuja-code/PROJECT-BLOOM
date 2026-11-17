/**
 * Studio Themes: Coordinated visual styles for Flower Studio 2.0.
 * Modifies color palette, petal style, arrangement, background and decorations.
 */

import type { FlowerColors } from "./recipe";

export interface StudioThemePreset {
  id: string;
  name: string;
  tagline: string;
  colors: FlowerColors;
  petalStyle: "classic" | "pointed" | "wavy" | "chrysanthemum" | "dahlia";
  arrangement: "rings" | "spiral" | "burst";
  bgStyle: "solid" | "radial" | "studio" | "paper";
  decoration: string;
  decorCount: number;
  swatch: [string, string, string];
}

export const STUDIO_THEMES: StudioThemePreset[] = [
  {
    id: "y2k",
    name: "Y2K",
    tagline: "Bold, punchy neon & digital bloom",
    colors: {
      ring1: "#ffffff",
      ring2: "#9fd0ff",
      ring3: "#ff7cc4",
      ring4: "#ff3ea5",
      ring5: "#2f7bff",
      green: "#3ccf91",
      hearts: "#ff3ea5",
      background: "#14161f",
    },
    petalStyle: "pointed",
    arrangement: "burst",
    bgStyle: "radial",
    decoration: "✦",
    decorCount: 16,
    swatch: ["#ff3ea5", "#2f7bff", "#14161f"],
  },
  {
    id: "vintage",
    name: "Vintage",
    tagline: "Sepia tones, dahlia petals & pressed textures",
    colors: {
      ring1: "#fff8f0",
      ring2: "#e8d3b9",
      ring3: "#c9a37e",
      ring4: "#9c6d48",
      ring5: "#6b4429",
      green: "#6a7356",
      hearts: "#c9a37e",
      background: "#f4ede1",
    },
    petalStyle: "dahlia",
    arrangement: "rings",
    bgStyle: "paper",
    decoration: "❀",
    decorCount: 10,
    swatch: ["#c9a37e", "#6a7356", "#f4ede1"],
  },
  {
    id: "disposable",
    name: "Disposable camera",
    tagline: "High-contrast party flash on dark canvas",
    colors: {
      ring1: "#ffffff",
      ring2: "#ffdf99",
      ring3: "#ff6b4a",
      ring4: "#ff2255",
      ring5: "#880022",
      green: "#2ea868",
      hearts: "#ff4466",
      background: "#0c0a0f",
    },
    petalStyle: "classic",
    arrangement: "rings",
    bgStyle: "studio",
    decoration: "♡",
    decorCount: 14,
    swatch: ["#ff2255", "#ffdf99", "#0c0a0f"],
  },
  {
    id: "dreamy-pastel",
    name: "Dreamy pastel",
    tagline: "Soft lilac, blush waves & golden spiral",
    colors: {
      ring1: "#ffffff",
      ring2: "#fae6f0",
      ring3: "#f0c2dc",
      ring4: "#d9b6e8",
      ring5: "#bca0dc",
      green: "#a0cca8",
      hearts: "#f0c2dc",
      background: "#f8f3fa",
    },
    petalStyle: "wavy",
    arrangement: "spiral",
    bgStyle: "radial",
    decoration: "♡",
    decorCount: 12,
    swatch: ["#f0c2dc", "#bca0dc", "#f8f3fa"],
  },
  {
    id: "midnight",
    name: "Midnight",
    tagline: "Nocturnal plum, slender rays & crescent moons",
    colors: {
      ring1: "#ffe6f2",
      ring2: "#d9b0df",
      ring3: "#af7dc5",
      ring4: "#884ea0",
      ring5: "#5b2c6f",
      green: "#487a5b",
      hearts: "#d9b0df",
      background: "#120817",
    },
    petalStyle: "chrysanthemum",
    arrangement: "rings",
    bgStyle: "studio",
    decoration: "☾",
    decorCount: 12,
    swatch: ["#af7dc5", "#5b2c6f", "#120817"],
  },
  {
    id: "botanical",
    name: "Botanical",
    tagline: "Herbarium greens, classic flora & parchment",
    colors: {
      ring1: "#fffdf5",
      ring2: "#e5eedb",
      ring3: "#b8d5a7",
      ring4: "#7ea368",
      ring5: "#506d40",
      green: "#506d40",
      hearts: "#b8d5a7",
      background: "#f4f1ea",
    },
    petalStyle: "classic",
    arrangement: "spiral",
    bgStyle: "paper",
    decoration: "❀",
    decorCount: 8,
    swatch: ["#7ea368", "#506d40", "#f4f1ea"],
  },
];
