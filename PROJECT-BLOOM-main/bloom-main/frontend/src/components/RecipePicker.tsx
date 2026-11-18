/** Choose which flower to use: the one in the Studio, or a saved design. */
import { useEffect, useState } from "react";
import type { FlowerRecipe } from "../flower/recipe";
import { useSession } from "../lib/session";
import type { SavedDesign } from "../lib/store";
import { FlowerPreview } from "./FlowerPreview";

export function RecipePicker({ value, onChange }: { value: FlowerRecipe | null; onChange: (recipe: FlowerRecipe) => void }) {
  const { recipe: studioRecipe, store, hasFlower } = useSession();
  const [designs, setDesigns] = useState<SavedDesign[]>([]);

  useEffect(() => {
    store.listDesigns().then(setDesigns).catch(() => setDesigns([]));
  }, [store]);

  const options = [
    ...(hasFlower ? [{ id: "studio", title: `Studio · “${studioRecipe.word}”`, recipe: studioRecipe }] : []),
    ...designs.map((d) => ({ id: d.id, title: d.title, recipe: d.recipe })),
  ];
  if (options.length === 0) {
    return (
      <p className="muted small">
        No flower yet. <a href="/studio">Grow one in the Studio</a> first.
      </p>
    );
  }
  const current = value ? JSON.stringify(value) : "";

  return (
    <div className="design-list">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="design-row"
          aria-pressed={JSON.stringify(option.recipe) === current}
          style={JSON.stringify(option.recipe) === current ? { borderColor: "var(--rose)" } : undefined}
          onClick={() => onChange(option.recipe)}
        >
          <span className="thumb">
            <FlowerPreview recipe={option.recipe} label={option.title} />
          </span>
          <span>
            <strong>{option.recipe.word}</strong>
            <span className="muted small">{option.title}</span>
          </span>
          <span />
        </button>
      ))}
    </div>
  );
}
