import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG contrast of the colour pairs the interface actually uses (UX-03), in both themes.
 *
 * The values come from Tailwind's own theme file, so a palette change upstream is caught
 * here. Body text needs 4.5:1 (WCAG AA); the pairs are the ones of `ui.tsx` (cards, stat
 * tones, notices, badges, inputs) and of the tables' secondary text.
 */
const theme = readFileSync(join(process.cwd(), "node_modules/tailwindcss/theme.css"), "utf8");

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(theme);
  if (!match) throw new Error(`Unknown Tailwind colour ${name}`);
  return match[1].trim();
}

/** Linear sRGB channels in [0, 1], from `oklch(L% C H)` or `#rgb` / `#rrggbb`. */
function linearRgb(value: string): [number, number, number] {
  // A hue of `none` (achromatic greys such as zinc-50) reads as 0: chroma is 0 anyway.
  const oklch = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)$/.exec(value);
  if (oklch) {
    const l = Number(oklch[1]) / 100;
    const c = Number(oklch[2]);
    const h = oklch[3] === "none" ? 0 : (Number(oklch[3]) * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    return [
      clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
      clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
      clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    ];
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g)!;
    return digits.map((pair) => {
      const channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
  }

  throw new Error(`Unsupported colour value ${value}`);
}

function contrast(foreground: string, background: string): number {
  const luminance = (name: string) => {
    const [r, g, b] = linearRgb(token(name));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// [text, background]
const LIGHT: [string, string][] = [
  // Cards and the page background: primary, secondary and amount tones.
  ...["zinc-900", "zinc-600", "zinc-500", "emerald-700", "rose-700", "amber-700", "sky-700"].flatMap(
    (text): [string, string][] => [
      [text, "white"],
      [text, "zinc-50"],
    ],
  ),
  // Notices and badges.
  ["sky-900", "sky-50"],
  ["amber-900", "amber-50"],
  ["rose-900", "rose-50"],
  ["zinc-700", "zinc-100"],
  ["emerald-800", "emerald-100"],
  ["rose-800", "rose-100"],
  ["amber-900", "amber-100"],
  // Destructive buttons.
  ["white", "rose-700"],
];

const DARK: [string, string][] = [
  ...["zinc-100", "zinc-400", "emerald-400", "rose-400", "amber-300", "sky-300"].flatMap(
    (text): [string, string][] => [
      [text, "zinc-900"],
      [text, "zinc-950"],
    ],
  ),
  ["sky-100", "sky-950"],
  ["amber-100", "amber-950"],
  ["rose-100", "rose-950"],
  ["zinc-200", "zinc-800"],
  ["emerald-200", "emerald-950"],
  ["rose-200", "rose-950"],
];

describe("colour contrast (WCAG AA, 4.5:1)", () => {
  it("computes the reference ratio of black on white", () => {
    expect(contrast("black", "white")).toBeCloseTo(21, 0);
  });

  it.each(LIGHT)("light theme: %s on %s", (text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(DARK)("dark theme: %s on %s", (text, background) => {
    expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  });
});
