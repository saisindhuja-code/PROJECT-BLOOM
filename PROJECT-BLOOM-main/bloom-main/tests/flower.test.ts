import test from "node:test";
import assert from "node:assert/strict";
import { buildFlower, type TextPrimitive } from "../frontend/src/flower/engine";
import {
  PETAL_STYLES,
  STUDIO_PALETTES,
  defaultRecipe,
  isOriginalShape,
  normalizeRecipe,
} from "../frontend/src/flower/recipe";

test("classic flower builds deterministically with expected text and line primitives", () => {
  const recipe = defaultRecipe("bloom");
  const a = buildFlower(recipe);
  const b = buildFlower(recipe);

  const textA = a.primitives.filter((p): p is TextPrimitive => p.kind === "text");
  const lineA = a.primitives.filter((p) => p.kind === "line");

  assert.ok(textA.length > 800, `expected > 800 text primitives, got ${textA.length}`);
  assert.ok(lineA.length > 0, "expected stem and leaf line primitives");
  assert.deepEqual(a.primitives, b.primitives);
  assert.equal(a.background, recipe.colors.background);
  assert.equal(isOriginalShape(recipe), true);
});

test("all Bloom 2.0 petalStyle variants build cleanly with distinct geometry", () => {
  const signatures = new Map<string, string>();
  for (const style of PETAL_STYLES) {
    const r = { ...defaultRecipe("aurora"), petalStyle: style.id };
    const drawing = buildFlower(r);
    const petalTexts = drawing.primitives.filter(
      (p): p is TextPrimitive => p.kind === "text" && p.color === r.colors.ring1,
    );
    assert.ok(petalTexts.length > 0, `expected petal text primitives for petalStyle ${style.id}`);
    signatures.set(
      style.id,
      petalTexts
        .slice(1, 7)
        .map((t) => `${t.x.toFixed(1)},${t.y.toFixed(1)}`)
        .join("|"),
    );
    if (style.id !== "classic") {
      assert.equal(isOriginalShape(r), false);
    }
  }
  assert.notEqual(signatures.get("tulip"), signatures.get("daisy"));
  assert.notEqual(signatures.get("classic"), signatures.get("lotus"));
  assert.notEqual(signatures.get("rounded"), signatures.get("heart"));
});

test("normalizeRecipe validates colors, petalStyle, and dedication notes", () => {
  const palette = STUDIO_PALETTES[1];
  const normalized = normalizeRecipe({
    word: "  moonlight  ",
    petalStyle: "lotus",
    colors: { ...palette.colors, ring1: "not-a-hex" },
    petalSize: 99,
    decorCount: -4,
    message: "  grown for Sunday  ",
    signature: "  — Ada ",
  });

  assert.equal(normalized.word, "moonlight");
  assert.equal(normalized.petalStyle, "lotus");
  assert.equal(normalized.colors.ring1, "#ffe6f2");
  assert.equal(normalized.colors.ring3, palette.colors.ring3);
  assert.equal(normalized.petalSize, 1.5);
  assert.equal(normalized.decorCount, 0);
  assert.equal(normalized.message, "grown for Sunday");
  assert.equal(normalized.signature, "— Ada");
});
