/** Bloom Flower Studio: grow a flower from a word, save it, export it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import { DecorationControls, Paints, ShapeControls, ShapePicker, resetPaints } from "../components/FlowerControls";
import { IconCamera, IconDownload, IconJournal, IconReset, IconTrash, IconUpload } from "../components/Icons";
import { Toggle } from "../components/ui";
import { buildFlower, ORIGINAL_RINGS } from "../flower/engine";
import { SHAPES } from "../flower/shapes";
import { MAX_WORD_LENGTH, cleanWord, isOriginalShape, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, drawingToCanvas, drawingToSvg, safeFileName } from "../flower/render";
import { errorMessage } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { SavedDesign } from "../lib/store";
import { ThemeDots } from "../theme/ThemeMenu";
import { useTheme } from "../theme/ThemeProvider";

export function StudioPage() {
  const { recipe, setRecipe, store, toast, hasFlower, growFlower, growCount } = useSession();
  const [draftWord, setDraftWord] = useState(hasFlower ? recipe.word : "");
  const { navigate, query } = useRouter();
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [designId, setDesignId] = useState<string | undefined>(query.get("design") ?? undefined);
  const [title, setTitle] = useState("");
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    store
      .listDesigns()
      .then(setDesigns)
      .catch((error) => toast(errorMessage(error), "error"));

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Opening /studio?design=s:12 loads that design.
  useEffect(() => {
    const wanted = query.get("design");
    const match = wanted && designs.find((d) => d.id === wanted);
    if (match) {
      growFlower(match.recipe);
      setDraftWord(match.recipe.word);
      setDesignId(match.id);
      setTitle(match.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs]);

  const stats = useMemo(() => {
    const drawing = buildFlower(recipe);
    const words = drawing.primitives.filter((p) => p.kind === "text" && p.text === recipe.word).length;
    const petals = ORIGINAL_RINGS.reduce((n, ring) => n + Math.max(3, Math.round(ring.count * recipe.petalCount)), 0);
    return { words, petals };
  }, [recipe]);

  const update = (next: FlowerRecipe) => setRecipe(next);
  const { theme: siteTheme } = useTheme();
  // Themes only SUGGEST colours: nothing changes until you press the button.
  const themeColours = siteTheme.flowerColors;
  const usingThemeColours = (Object.keys(themeColours) as Array<keyof typeof themeColours>).every((k) => recipe.colors[k] === themeColours[k]);

  /** Grows the flower only when you ask for it. */
  const grow = () => {
    const word = cleanWord(draftWord);
    if (!word) {
      toast("Type a word first.", "error");
      return;
    }
    setDraftWord(word);
    growFlower({ ...recipe, word });
  };
  const wordChanged = hasFlower && cleanWord(draftWord) !== recipe.word && cleanWord(draftWord) !== "";

  const saveDesign = async (asNew: boolean) => {
    setBusy(true);
    try {
      const saved = await store.saveDesign(recipe, title || recipe.word, asNew ? undefined : designId);
      setDesignId(saved.id);
      setTitle(saved.title);
      toast(store.kind === "server" ? "Design saved to your account." : "Design saved on this device.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const addToJournal = async () => {
    setBusy(true);
    try {
      const entry = await store.createEntry({ entry_type: "flower", title: title || recipe.word, recipe });
      toast("Pressed into your journal.");
      navigate(`/journal/${entry.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportPng = async () => {
    const drawing = buildFlower(transparent ? { ...recipe } : recipe);
    const canvas = drawingToCanvas(drawing, { framing: transparent ? "tight" : "window", background: !transparent, scale: 4 });
    downloadBlob(await canvasToBlob(canvas), `bloom-${safeFileName(recipe.word)}.png`);
  };

  const exportSvg = () => {
    const svg = drawingToSvg(buildFlower(recipe), { framing: transparent ? "tight" : "window", background: !transparent, title: recipe.word });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `bloom-${safeFileName(recipe.word)}.svg`);
  };

  const downloadRecipe = () => {
    downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }), `${safeFileName(recipe.word)}.bloom.json`);
  };

  const openRecipe = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== "bloom-flower") throw new Error("That file is not a Bloom flower recipe.");
      const opened = normalizeRecipe(data);
      growFlower(opened);
      setDraftWord(opened.word);
      setDesignId(undefined);
      toast("Recipe opened.");
    } catch (error) {
      toast(error instanceof SyntaxError ? "That file is not a Bloom flower recipe." : errorMessage(error), "error");
    }
  };

  const removeDesign = async (design: SavedDesign) => {
    if (!window.confirm(`Delete the design “${design.title}”? Journal entries made from it stay.`)) return;
    try {
      await store.deleteDesign(design.id);
      if (designId === design.id) setDesignId(undefined);
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">01 · Flower studio</p>
          <h1>
            Grow a flower from <span className="flourish">a word</span>
          </h1>
        </div>
      </div>

      <div className="studio">
        <section className="sheet" aria-label="Flower settings">
          <div className="sheet-section">
            <form
              className="stack tight"
              onSubmit={(e) => {
                e.preventDefault();
                grow();
              }}
            >
              <label className="field">
                <span>A word to grow</span>
                <input
                  className="word-input"
                  type="text"
                  value={draftWord}
                  maxLength={MAX_WORD_LENGTH}
                  autoFocus
                  placeholder="love, home, you…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraftWord(e.target.value)}
                />
              </label>
              <button type="submit" className="btn primary" style={{ justifySelf: "start" }} disabled={!cleanWord(draftWord)}>
                {hasFlower ? (wordChanged ? "Grow this word" : "Grow again") : "Grow my flower"}
              </button>
            </form>
          </div>
          <div className="sheet-section">
            <header>
              <h3>Shape</h3>
              <span className="eyebrow">your word, drawn as…</span>
            </header>
            <ShapePicker
              recipe={recipe}
              onPick={(shape) => {
                const next = { ...recipe, shape, word: cleanWord(draftWord) || recipe.word };
                // Picking a shape is a deliberate choice: grow it right away if a flower exists.
                if (hasFlower) growFlower(next);
                else setRecipe(next);
              }}
            />
          </div>
          <div className="sheet-section">
            <header>
              <h3>Paints</h3>
              <button type="button" className="btn small quiet" onClick={() => update(resetPaints(recipe))}>
                <IconReset /> Original
              </button>
            </header>
            <Paints recipe={recipe} onChange={update} />
            {!usingThemeColours && (
              <div className="suggested-colours">
                <ThemeDots colors={[themeColours.ring1, themeColours.ring3, themeColours.ring5, themeColours.background]} />
                <span style={{ flex: 1 }}>{siteTheme.name} colours</span>
                <button type="button" className="btn small" onClick={() => update({ ...recipe, colors: { ...themeColours } })}>
                  Use them
                </button>
              </div>
            )}
          </div>
          <details className="sheet-section" open={!isOriginalShape(recipe)}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <header>
                <h3>Size & angle</h3>
                <span className="eyebrow">{isOriginalShape(recipe) ? "original" : "adjusted"} · optional</span>
              </header>
            </summary>
            <div style={{ marginTop: 14 }}>
              <ShapeControls recipe={recipe} onChange={update} />
            </div>
          </details>
          <div className="sheet-section">
            <header>
              <h3>Decorations</h3>
              <span className="eyebrow">journal doodles</span>
            </header>
            <DecorationControls recipe={recipe} onChange={update} />
          </div>
          <div className="sheet-section">
            <header>
              <h3>Saved designs</h3>
              <span className="eyebrow">{store.kind === "server" ? "your account" : "this device"}</span>
            </header>
            <label className="field">
              <span>Design name</span>
              <input type="text" value={title} maxLength={80} placeholder={recipe.word} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="btn-row">
              <button type="button" className="btn small primary" disabled={busy || !hasFlower} onClick={() => void saveDesign(false)}>
                {designId ? "Save changes" : "Save design"}
              </button>
              {designId && (
                <button type="button" className="btn small" disabled={busy} onClick={() => void saveDesign(true)}>
                  Save as new
                </button>
              )}
            </div>
            {designs.length > 0 && (
              <div className="design-list">
                {designs.map((design) => (
                  <div
                    key={design.id}
                    className="design-row"
                    role="button"
                    tabIndex={0}
                    aria-pressed={design.id === designId}
                    style={design.id === designId ? { borderColor: "var(--rose)" } : undefined}
                    onClick={() => {
                      growFlower(design.recipe);
                      setDraftWord(design.recipe.word);
                      setDesignId(design.id);
                      setTitle(design.title);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        growFlower(design.recipe);
                        setDraftWord(design.recipe.word);
                        setDesignId(design.id);
                        setTitle(design.title);
                      }
                    }}
                  >
                    <span className="thumb">
                      <FlowerPreview recipe={design.recipe} label={design.title} />
                    </span>
                    <span>
                      <strong>{design.title}</strong>
                      <span className="muted small">“{design.recipe.word}”</span>
                    </span>
                    <button
                      type="button"
                      className="btn icon small quiet"
                      aria-label={`Delete ${design.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeDesign(design);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="sheet-section">
            <header>
              <h3>Recipe file</h3>
            </header>
            <p className="muted small">A small .bloom.json file with every setting, so this exact flower can be grown again anywhere.</p>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={downloadRecipe} disabled={!hasFlower}>
                <IconDownload /> Download recipe
              </button>
              <button type="button" className="btn small quiet" onClick={() => fileInput.current?.click()}>
                <IconUpload /> Open recipe
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void openRecipe(e.target.files?.[0])} />
            </div>
          </div>
        </section>

        <section className="studio-preview" aria-label="Preview">
          {hasFlower ? (
            <>
              <div className="plate">
                <FlowerPreview recipe={recipe} growKey={growCount} />
                <div className="plate-caption">
                  <span>“{recipe.word}”</span>
                  <span className="lcd">
                    {recipe.shape === "flower" ? `${stats.petals} petals` : SHAPES.find((sh) => sh.id === recipe.shape)?.name} · {stats.words} words
                  </span>
                </div>
              </div>
              <div className="row between">
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={() => navigate("/cam")}>
                    <IconCamera /> Photograph it
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void addToJournal()}>
                    <IconJournal /> Add to journal
                  </button>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn small" onClick={() => void exportPng()}>
                    <IconDownload /> PNG
                  </button>
                  <button type="button" className="btn small" onClick={exportSvg}>
                    <IconDownload /> SVG
                  </button>
                </div>
              </div>
              <div style={{ maxWidth: 320, marginLeft: "auto" }}>
                <Toggle label="Export flower only, transparent" checked={transparent} onChange={setTransparent} />
              </div>
            </>
          ) : (
            <div className="plate">
              <div className="empty-plate" style={{ background: recipe.colors.background }}>
                <p>
                  Type a word and press <strong>Grow my flower</strong>.
                  <br />
                  Your flower grows here, petal by petal.
                </p>
              </div>
              <div className="plate-caption">
                <span>Nothing grown yet</span>
                <span className="lcd">waiting for a word</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
