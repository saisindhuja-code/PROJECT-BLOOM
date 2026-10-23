/**
 * Theme gallery: every website theme previewed side by side, each preview
 * drawn with that theme's own tokens (data-theme-scope), so you see it
 * before choosing. Picking one applies it instantly and remembers it.
 */
import { FlowerPreview } from "../components/FlowerPreview";
import { BloomMark } from "../components/Icons";
import { Toggle } from "../components/ui";
import { defaultRecipe } from "../flower/recipe";
import { useSession } from "../lib/session";
import { useTheme } from "../theme/ThemeProvider";
import { DEFAULT_THEME, SITE_THEMES, type SiteTheme } from "../theme/themes";

function ThemePreviewCard({ theme, current, onUse }: { theme: SiteTheme; current: boolean; onUse: () => void }) {
  const { recipe, hasFlower } = useSession();
  // Preview the person's own word with the theme's suggested colours.
  const sample = { ...defaultRecipe(hasFlower ? recipe.word : "bloom"), shape: hasFlower ? recipe.shape : "flower", colors: theme.flowerColors };
  return (
    <article className={`theme-preview${current ? " is-current" : ""}`} data-theme-scope={theme.id} aria-label={`${theme.name} preview`}>
      <div className="mini-bar">
        <span className="wordmark">
          <BloomMark />
          bloom
        </span>
        <span className="eyebrow">{theme.tone === "dark" ? "dark" : "light"}</span>
      </div>
      <div>
        <p className="eyebrow">{theme.tagline}</p>
        <h3>
          {theme.name.split(" ")[0]} <span className="flourish">{theme.name.split(" ").slice(1).join(" ")}</span>
        </h3>
        <p className="tagline">{theme.description}</p>
      </div>
      <div className="mini-row">
        <div className="plate">
          <FlowerPreview recipe={sample} label={`${theme.name} sample flower`} />
          <div className="plate-caption">
            <span>“{sample.word}”</span>
            <span className="lcd">'26 10 23</span>
          </div>
        </div>
        <div className="stack tight">
          <button type="button" className="btn small primary" tabIndex={-1} aria-hidden="true">
            Grow
          </button>
          <span className="chip on" aria-hidden="true">
            Chosen
          </span>
          <input type="text" readOnly value="A word to grow" tabIndex={-1} aria-hidden="true" style={{ minHeight: 34, fontSize: 13 }} />
        </div>
      </div>
      <div className="palette-row" aria-label="Colour palette">
        {theme.palette.map((p) => (
          <span key={p.name} title={`${p.name} ${p.color}`} style={{ background: p.color }} />
        ))}
      </div>
      <p className="muted small">Journal: {theme.journalName.toLowerCase()}.</p>
      <div className="btn-row">
        {current ? (
          <span className="status-pill ok">
            <span className="dot" /> IN USE
          </span>
        ) : (
          <button type="button" className="btn primary" onClick={onUse}>
            Use {theme.name}
          </button>
        )}
      </div>
    </article>
  );
}

export function ThemesPage() {
  const { choice, theme, setChoice, resetTheme } = useTheme();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Appearance</p>
          <h1>
            Choose your <span className="flourish">Bloom</span>
          </h1>
          <p className="lede" style={{ marginTop: 10 }}>
            Themes change how Bloom looks: colours, type and little details. They never change your flowers, saved
            photos or photo filters. Your choice is remembered on this device.
          </p>
        </div>
        <div className="stack tight" style={{ minWidth: 260 }}>
          <Toggle
            label="Auto: Midnight Garden at night, Paper Hearts by day (follows your device)"
            checked={choice === "auto"}
            onChange={(on) => setChoice(on ? "auto" : theme.id)}
          />
          <button type="button" className="btn small quiet" style={{ justifySelf: "start" }} disabled={choice === DEFAULT_THEME} onClick={resetTheme}>
            Back to the default (Midnight Garden)
          </button>
        </div>
      </div>
      <div className="theme-gallery">
        {SITE_THEMES.map((t) => (
          <ThemePreviewCard key={t.id} theme={t} current={choice !== "auto" ? choice === t.id : theme.id === t.id} onUse={() => setChoice(t.id)} />
        ))}
      </div>
    </main>
  );
}
