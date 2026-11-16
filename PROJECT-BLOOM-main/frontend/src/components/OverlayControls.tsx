import type { FlowerPlacement } from "../imaging/compose";
import { defaultPlacement } from "../imaging/compose";
import { IconReset } from "./Icons";
import { Slider, Toggle } from "./ui";

/** Precise controls for the flower on a photo (size, rotation, crop, flip). */
export function OverlayControls({
  value,
  onChange,
}: {
  value: FlowerPlacement;
  onChange: (next: FlowerPlacement, commit: boolean) => void;
}) {
  const set = (patch: Partial<FlowerPlacement>, commit = false) => onChange({ ...value, ...patch }, commit);
  const setCrop = (patch: Partial<FlowerPlacement["crop"]>) => onChange({ ...value, crop: { ...value.crop, ...patch } }, false);
  const commit = () => onChange(value, true);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="stack">
      <Toggle label="Show flower" checked={value.visible} onChange={(visible) => set({ visible }, true)} />
      <Slider label="Size" value={value.size} min={0.1} max={2} step={0.01} format={pct} onChange={(size) => set({ size })} onCommit={commit} />
      <Slider
        label="Rotation"
        value={value.rotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(rotation) => set({ rotation })}
        onCommit={commit}
      />
      <Toggle label="Mirror flower" checked={value.flip} onChange={(flip) => set({ flip }, true)} />
      <details>
        <summary className="label" style={{ cursor: "pointer" }}>
          Crop the flower
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <Slider label="Top" value={value.crop.top} min={0} max={0.45} step={0.01} format={pct} onChange={(top) => setCrop({ top })} onCommit={commit} />
          <Slider label="Bottom" value={value.crop.bottom} min={0} max={0.45} step={0.01} format={pct} onChange={(bottom) => setCrop({ bottom })} onCommit={commit} />
          <Slider label="Left" value={value.crop.left} min={0} max={0.45} step={0.01} format={pct} onChange={(left) => setCrop({ left })} onCommit={commit} />
          <Slider label="Right" value={value.crop.right} min={0} max={0.45} step={0.01} format={pct} onChange={(right) => setCrop({ right })} onCommit={commit} />
        </div>
      </details>
      <button type="button" className="btn small quiet" onClick={() => onChange(defaultPlacement(), true)} style={{ justifySelf: "start" }}>
        <IconReset /> Default placement
      </button>
    </div>
  );
}
