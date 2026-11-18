/**
 * Photo filter gallery (separate from the website theme): every filter
 * previewed on YOUR photo as a little print. The original photo is never
 * changed; filters are stored as settings and re-rendered from it.
 * Thumbnails are rendered small and one at a time so the page stays smooth.
 */
import { useEffect, useRef, useState } from "react";
import { renderThemed, toCanvas, type Source } from "../imaging/process";
import { THEMES, defaultSettings, isUnfiltered, themeById, type ThemeId, type ThemeSettings } from "../imaging/themes";
import { Slider, Toggle } from "./ui";

export function ThemeGallery({
  source,
  value,
  onChange,
  caption,
}: {
  source: Source | null;
  value: ThemeSettings;
  onChange: (next: ThemeSettings, commit: boolean) => void;
  caption?: string;
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const generation = useRef(0);

  useEffect(() => {
    if (!source) return;
    const run = ++generation.current;
    const small = toCanvas(source, 220);
    let index = 0;
    let handle = 0;
    const urls: string[] = [];
    const next = () => {
      if (run !== generation.current || index >= THEMES.length) return;
      const theme = THEMES[index++];
      const canvas = renderThemed(small, { ...defaultSettings(theme.id), frame: false, dateStamp: false }, { maxSize: 220, caption });
      const url = canvas.toDataURL("image/jpeg", 0.8);
      urls.push(url);
      setThumbs((t) => ({ ...t, [theme.id]: url }));
      handle = window.setTimeout(next, 16);
    };
    setThumbs({});
    next();
    return () => {
      generation.current++;
      window.clearTimeout(handle);
    };
  }, [source, caption]);

  const preset = themeById(value.preset);
  // Picking another filter keeps your own brightness/contrast/saturation.
  const choose = (id: ThemeId) =>
    onChange({ ...defaultSettings(id), brightness: value.brightness, contrast: value.contrast, saturation: value.saturation }, true);
  const adjust = (key: "brightness" | "contrast" | "saturation", label: string) => (
    <Slider
      label={label}
      value={value[key]}
      min={-1}
      max={1}
      step={0.05}
      format={(v) => (v === 0 ? "0" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`)}
      onChange={(n) => onChange({ ...value, [key]: n }, false)}
      onCommit={() => onChange(value, true)}
    />
  );

  return (
    <div className="stack">
      <div className="theme-strip" role="list">
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="listitem"
            className="theme-card"
            aria-pressed={value.preset === theme.id}
            onClick={() => choose(theme.id)}
            title={theme.blurb}
          >
            <span className="print">
              {thumbs[theme.id] ? (
                <img src={thumbs[theme.id]} alt="" />
              ) : (
                <span className="swatch" style={{ background: `linear-gradient(135deg, ${theme.swatch[0]}, ${theme.swatch[1]})` }} />
              )}
            </span>
            <span>{theme.name}</span>
          </button>
        ))}
      </div>
      <div className="filter-head">
        <p className="muted small">{preset.blurb}</p>
        <div className="btn-row">
          <button type="button" className="btn small quiet" disabled={value.preset === "natural"} onClick={() => choose("natural")}>
            Remove filter
          </button>
          <button
            type="button"
            className="btn small quiet"
            disabled={isUnfiltered(value)}
            onClick={() => onChange(defaultSettings("natural"), true)}
            title="Back to the photo exactly as taken"
          >
            Reset all
          </button>
        </div>
      </div>
      {preset.id !== "natural" && (
        <Slider
          label="Strength"
          value={value.intensity}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(intensity) => onChange({ ...value, intensity }, false)}
          onCommit={() => onChange(value, true)}
        />
      )}
      <Slider
        label="Grain"
        value={value.grain}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}`}
        onChange={(grain) => onChange({ ...value, grain }, false)}
        onCommit={() => onChange(value, true)}
      />
      <Slider
        label="Vignette"
        value={value.vignette}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}`}
        onChange={(vignette) => onChange({ ...value, vignette }, false)}
        onCommit={() => onChange(value, true)}
      />
      <Slider
        label="Glow"
        value={value.glow}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}`}
        onChange={(glow) => onChange({ ...value, glow }, false)}
        onCommit={() => onChange(value, true)}
      />
      <div className="adjust-group">
        <span className="label">Adjust</span>
        {adjust("brightness", "Brightness")}
        {adjust("contrast", "Contrast")}
        {adjust("saturation", "Saturation")}
      </div>
      <Toggle label="Date stamp" checked={value.dateStamp} onChange={(dateStamp) => onChange({ ...value, dateStamp }, true)} />
      <Toggle
        label={preset.frame === "none" ? "Frame (none for this look)" : `Frame`}
        checked={value.frame && preset.frame !== "none"}
        disabled={preset.frame === "none"}
        onChange={(frame) => onChange({ ...value, frame }, true)}
      />
    </div>
  );
}
