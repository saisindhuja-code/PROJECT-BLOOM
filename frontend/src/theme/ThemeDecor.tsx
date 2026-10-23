/** Theme-only decoration layers (currently: Fairycore's floating petals). */
import { useMemo } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeDecor() {
  const { theme } = useTheme();
  const petals = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => ({
        left: `${(i * 113) % 100}%`,
        duration: `${18 + ((i * 7) % 12)}s`,
        delay: `${-((i * 5) % 20)}s`,
        scale: 0.7 + ((i * 3) % 5) / 10,
      })),
    [],
  );
  if (theme.id !== "fairy") return null;
  return (
    <div className="petal-layer" aria-hidden="true">
      {petals.map((p, i) => (
        <span key={i} style={{ left: p.left, animationDuration: p.duration, animationDelay: p.delay, transform: `scale(${p.scale})` }} />
      ))}
    </div>
  );
}
