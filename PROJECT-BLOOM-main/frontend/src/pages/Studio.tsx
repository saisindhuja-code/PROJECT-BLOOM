/** Bloom Flower Studio 2.0: grow a flower from a word, styles, themes, inscriptions. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import {
  BackgroundStylePicker,
  DecorationControls,
  Paints,
  ShapeControls,
  ShapePicker,
  StudioThemePicker,
  resetPaints,
} from "../components/FlowerControls";
import { IconCamera, IconDownload, IconJournal, IconReset, IconTrash, IconUpload } from "../components/Icons";
import { Toggle } from "../components/ui";
import { buildFlower, ORIGINAL_RINGS } from "../flower/engine";
import { MAX_WORD_LENGTH, cleanWord, isOriginalShape, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, drawingToCanvas, drawingToSvg, safeFileName } from "../flower/render";
import { SHAPES } from "../flower/shapes";
import type { StudioThemePreset } from "../flower/studioThemes";
import { errorMessage } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { SavedDesign, Visibility } from "../lib/store";
import { ThemeDots } from "../theme/ThemeMenu";
import { useTheme } from "../theme/ThemeProvider";

export function StudioPage() {
  const { recipe, setRecipe, store, toast, hasFlower, growFlower, growCount } = useSession();
  const [draftWord, setDraftWord] = useState(hasFlower ? recipe.word : "");
  const { navigate, query } = useRouter();
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [designId, setDesignId] = useState<string | undefined>(query.get("design") ?? undefined);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
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
  }, [store]);

  // Reopen from design or journal entry
  const wantedDesign = query.get("design");
  const wantedEntry = query.get("entry");

  useEffect(() => {
    if (wantedDesign) {
      const match = designs.find((d) => d.id === wantedDesign);
      if (match) {
        growFlower(match.recipe);
        setDraftWord(match.recipe.word);
        setDesignId(match.id);
        setTitle(match.title);
        setVisibility(match.visibility ?? "private");
      }
    } else if (wantedEntry) {
      store.getEntry(wantedEntry).then((entry) => {
        if (entry.recipe) {
          growFlower(entry.recipe);
          setDraftWord(entry.recipe.word);
          setTitle(entry.title || entry.recipe.word);
        }
      }).catch(() => undefined);
    }
  }, [designs, wantedDesign, wantedEntry]);

  const stats = useMemo(() => {
    const drawing = buildFlower(recipe);
    const words = drawing.primitives.filter((p) => p.kind === "text" && p.text === recipe.word).length;
    const petals = ORIGINAL_RINGS.reduce((n, ring) => n + Math.max(3, Math.round(ring.count * recipe.petalCount)), 0);
    return { words, petals };
  }, [recipe]);

  const update = (next: FlowerRecipe) => setRecipe(next);
  const { theme: siteTheme } = useTheme();
  const themeColours = siteTheme.flowerColors;
  const usingThemeColours = (Object.keys(themeColours) as Array<keyof typeof themeColours>).every(
    (k) => recipe.colors[k] === themeColours[k],
  );

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

  const applyStudioTheme = (th: StudioThemePreset) => {
    const next: FlowerRecipe = {
      ...recipe,
      colors: { ...th.colors },
      petalStyle: th.petalStyle,
      arrangement: th.arrangement,
      bgStyle: th.bgStyle,
      decoration: th.decoration,
      decorCount: th.decorCount,
      themeId: th.id,
    };
    if (hasFlower) growFlower(next);
    else setRecipe(next);
    toast(`Applied ${th.name} theme.`);
  };

  const saveDesign = async (asNew: boolean) => {
    setBusy(true);
    try {
      const saved = await store.saveDesign(recipe, title || recipe.word, asNew ? undefined : designId, visibility);
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
      const entry = await store.createEntry({ entry_type: "flower", title: title || recipe.word, recipe, visibility });
      toast("Pressed into your journal.");
      navigate(`/journal/${entry.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportPng = async () => {
    const drawing = buildFlower(recipe);
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
          <p className="eyebrow">01 · Flower studio 2.0</p>
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
              <h3>Studio Themes</h3>
              <span className="eyebrow">coordinated styles</span>
            </header>
            <StudioThemePicker recipe={recipe} onApply={applyStudioTheme} />
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
                if (hasFlower) growFlower(next);
                else setRecipe(next);
              }}
            />
          </div>

          <details className="sheet-section" open={Boolean(recipe.centerText || recipe.stemMessage)}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <header>
                <h3>Inscriptions &amp; dedications</h3>
                <span className="eyebrow">text integration</span>
              </header>
            </summary>
            <div className="stack" style={{ marginTop: 14 }}>
              <label className="field">
                <span>Center name or word</span>
                <input
                  type="text"
                  maxLength={32}
                  placeholder="e.g. for mom, forever"
                  value={recipe.centerText ?? ""}
                  onChange={(e) => update({ ...recipe, centerText: e.target.value })}
                />
              </label>
              {recipe.shape === "flower" && recipe.showStem && (
                <label className="field">
                  <span>Stem dedication note</span>
                  <input
                    type="text"
                    maxLength={48}
                    placeholder="e.g. forever in bloom"
                    value={recipe.stemMessage ?? ""}
                    onChange={(e) => update({ ...recipe, stemMessage: e.target.value })}
                  />
                </label>
              )}
            </div>
          </details>

          <div className="sheet-section">
            <header>
              <h3>Paints</h3>
              <button type="button" className="btn small quiet" onClick={() => update(resetPaints(recipe))}>
                <IconReset /> Original
              </button>
            </header>
            <Paints recipe={recipe} onChange={update} />
            <div className="stack tight" style={{ marginTop: 8 }}>
              <span className="label">Canvas background</span>
              <BackgroundStylePicker recipe={recipe} onChange={update} />
            </div>
            {!usingThemeColours && (
              <div className="suggested-colours" style={{ marginTop: 10 }}>
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
                <h3>Petal styles &amp; arrangement</h3>
                <span className="eyebrow">{isOriginalShape(recipe) ? "original" : "custom"} · optional</span>
              </header>
            </summary>
            <div style={{ marginTop: 14 }}>
              <ShapeControls recipe={recipe} onChange={update} />
            </div>
          </details>

          <div className="sheet-section">
            <header>
              <h3>Decorations</h3>
              <span className="eyebrow">floating doodles</span>
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
            {store.kind === "server" && (
              <label className="field">
                <span>Who can see this</span>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                  <option value="private">Private (only me)</option>
                  <option value="friends">Friends</option>
                  <option value="public">Public profile</option>
                </select>
              </label>
            )}
            <div className="btn-row">
              <button type="submit" className="btn small primary" disabled={busy || !hasFlower} onClick={() => void saveDesign(false)}>
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
                      setVisibility(design.visibility ?? "private");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        growFlower(design.recipe);
                        setDraftWord(design.recipe.word);
                        setDesignId(design.id);
                        setTitle(design.title);
                        setVisibility(design.visibility ?? "private");
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
            <p className="muted small">A .bloom.json recipe file containing all settings to grow this exact flower anywhere.</p>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={downloadRecipe} disabled={!hasFlower}>
                <IconDownload /> Download recipe
              </button>
              <button type="button" className="btn small quiet" onClick={() => fileInput.current?.click()}>
                <IconUpload /> Open recipe
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void openRecipe(file); }} />
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
                    {recipe.shape === "flower"
                      ? `${stats.petals} petals · ${recipe.petalStyle || "classic"}`
                      : SHAPES.find((sh) => sh.id === recipe.shape)?.name}
                    {" · "}
                    {stats.words} words
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
