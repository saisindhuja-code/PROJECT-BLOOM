/**
 * The flower settings: word, paints, and the optional shape controls.
 * Used by the Studio and wherever a flower is chosen (Together, Live).
 */
import { useState } from "react";
import {
  DECORATIONS,
  LIMITS,
  MAX_DECORATION_LENGTH,
  MAX_WORD_LENGTH,
  ORIGINAL_COLORS,
  cleanWord,
  isOriginalShape,
  newSeed,
  type FlowerColors,
  type FlowerRecipe,
} from "../flower/recipe";
import { SHAPES, type ShapeId } from "../flower/shapes";
import { FlowerPreview } from "./FlowerPreview";
import { IconReset, IconShuffle } from "./Icons";
import { Slider, Toggle } from "./ui";

const PAINTS: Array<{ key: keyof FlowerColors; name: string }> = [
  { key: "ring1", name: "Centre" },
  { key: "ring2", name: "Ring 2" },
  { key: "ring3", name: "Ring 3" },
  { key: "ring4", name: "Ring 4" },
  { key: "ring5", name: "Outer" },
  { key: "green", name: "Stem & leaves" },
  { key: "hearts", name: "Decorations" },
  { key: "background", name: "Canvas" },
];

export function WordField({ recipe, onChange, autoFocus }: { recipe: FlowerRecipe; onChange: (r: FlowerRecipe) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(recipe.word);
  const [lastWord, setLastWord] = useState(recipe.word);
  if (recipe.word !== lastWord) {
    setLastWord(recipe.word);
    setDraft(recipe.word);
  }
  return (
    <label className="field">
      <span>A word to grow</span>
      <input
        className="word-input"
        type="text"
        value={draft}
        maxLength={MAX_WORD_LENGTH}
        autoFocus={autoFocus}
        placeholder="love, home, you…"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          const word = cleanWord(e.target.value);
          if (word) {
            setLastWord(word);
            onChange({ ...recipe, word });
          }
        }}
        onBlur={() => setDraft(recipe.word)}
      />
    </label>
  );
}

export function Paints({ recipe, onChange }: { recipe: FlowerRecipe; onChange: (r: FlowerRecipe) => void }) {
  return (
    <div className="paints">
      {PAINTS.map(({ key, name }) => (
        <label key={key} className="dab" style={{ ["--paint" as string]: recipe.colors[key] }}>
          <input
            type="color"
            value={recipe.colors[key]}
            aria-label={`${name} colour`}
            onChange={(e) => onChange({ ...recipe, colors: { ...recipe.colors, [key]: e.target.value } })}
          />
          <span className="paint" />
          <span className="name">{name}</span>
        </label>
      ))}
    </div>
  );
}

/** Pick the shape: the original flower, or a word shape. Thumbnails show your own word. */
export function ShapePicker({ recipe, onPick }: { recipe: FlowerRecipe; onPick: (shape: ShapeId) => void }) {
  return (
    <div className="shape-picker" role="radiogroup" aria-label="Shape">
      {SHAPES.map((shape) => (
        <button
          key={shape.id}
          type="button"
          role="radio"
          aria-checked={recipe.shape === shape.id}
          className="shape-card"
          title={shape.hint}
          onClick={() => onPick(shape.id)}
        >
          <span className="thumb">
            <FlowerPreview
              recipe={{ ...recipe, shape: shape.id, showHearts: false, showStem: false, rotation: 0, petalSize: 1, petalCount: 1 }}
              framing="tight"
              label={shape.name}
            />
          </span>
          <span className="name">{shape.name}</span>
        </button>
      ))}
    </div>
  );
}

/** The little floating decorations (♡ in the original) — pick one or type your own. */
export function DecorationControls({ recipe, onChange }: { recipe: FlowerRecipe; onChange: (r: FlowerRecipe) => void }) {
  const [custom, setCustom] = useState(DECORATIONS.includes(recipe.decoration) ? "" : recipe.decoration);
  return (
    <div className="stack">
      <Toggle label="Floating decorations" checked={recipe.showHearts} onChange={(showHearts) => onChange({ ...recipe, showHearts })} />
      {recipe.showHearts && (
        <>
          <div className="chips decor-chips" role="radiogroup" aria-label="Decoration">
            {DECORATIONS.map((d) => (
              <button key={d} type="button" className="chip" role="radio" aria-checked={recipe.decoration === d} aria-pressed={recipe.decoration === d} onClick={() => onChange({ ...recipe, decoration: d })}>
                {d}
              </button>
            ))}
          </div>
          <div className="decor-more">
            <label className="field">
              <span>Your own (up to {MAX_DECORATION_LENGTH})</span>
              <input
                type="text"
                value={custom}
                maxLength={MAX_DECORATION_LENGTH * 2}
                placeholder=":) · xo · s+b"
                onChange={(e) => {
                  const value = Array.from(cleanWord(e.target.value)).slice(0, MAX_DECORATION_LENGTH).join("");
                  setCustom(value);
                  if (value) onChange({ ...recipe, decoration: value });
                }}
              />
            </label>
            <Slider
              label="How many"
              value={recipe.decorCount}
              min={0}
              max={40}
              step={1}
              format={(v) => String(v)}
              onChange={(decorCount) => onChange({ ...recipe, decorCount })}
            />
          </div>
          <button type="button" className="btn small" style={{ justifySelf: "start" }} onClick={() => onChange({ ...recipe, seed: newSeed() })}>
            <IconShuffle /> Scatter again
          </button>
        </>
      )}
    </div>
  );
}

export function ShapeControls({ recipe, onChange }: { recipe: FlowerRecipe; onChange: (r: FlowerRecipe) => void }) {
  const original = isOriginalShape(recipe);
  const isFlower = recipe.shape === "flower";
  return (
    <div className="stack">
      <Slider
        label={isFlower ? "Petal size" : "Size"}
        value={recipe.petalSize}
        {...LIMITS.petalSize}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(petalSize) => onChange({ ...recipe, petalSize })}
      />
      <Slider
        label={isFlower ? "Petals per ring" : recipe.shape === "heartburst" ? "Rays" : "Word density"}
        value={recipe.petalCount}
        {...LIMITS.petalCount}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(petalCount) => onChange({ ...recipe, petalCount })}
      />
      <Slider
        label="Rotation"
        value={recipe.rotation}
        {...LIMITS.rotation}
        format={(v) => `${Math.round(v)}°`}
        onChange={(rotation) => onChange({ ...recipe, rotation })}
      />
      {isFlower && (
        <>
          <Toggle label="Stem" checked={recipe.showStem} onChange={(showStem) => onChange({ ...recipe, showStem })} />
          <Toggle label="Leaves" checked={recipe.showLeaves} disabled={!recipe.showStem} onChange={(showLeaves) => onChange({ ...recipe, showLeaves })} />
        </>
      )}
      <button
        type="button"
        className="btn small quiet"
        style={{ justifySelf: "start" }}
        disabled={original}
        onClick={() =>
          onChange({ ...recipe, shape: "flower", petalSize: 1, petalCount: 1, rotation: 0, showStem: true, showLeaves: true, showHearts: true, decoration: "♡", decorCount: 12 })
        }
      >
        <IconReset /> Back to the original flower
      </button>
    </div>
  );
}

export function resetPaints(recipe: FlowerRecipe): FlowerRecipe {
  return { ...recipe, colors: { ...ORIGINAL_COLORS } };
}
