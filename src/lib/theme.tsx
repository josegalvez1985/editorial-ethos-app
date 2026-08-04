import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * El aspecto de la app son DOS ejes independientes:
 *
 *   - `theme`   claro / oscuro          -> la clase `.dark` en <html>
 *   - `palette` marca / slate / teal / indigo -> `data-palette` en <html>
 *
 * 4 paletas x 2 modos = 8 combinaciones, y cada una está definida en
 * `styles.css`. Se guardan en claves separadas de `localStorage` para que
 * cambiar una no pise la otra.
 *
 * **Solo cambia el COLOR.** Las fuentes, los tamaños y los espaciados son los
 * mismos en las cuatro paletas, a propósito: `--font-display`, `--font-sans` y
 * `--radius` viven en el `@theme` y ninguna paleta los toca.
 */
type Theme = "light" | "dark";

export const PALETAS = [
  "marca",
  "slate",
  "grafito",
  "azul",
  "indigo",
  "teal",
  "verde",
  "violeta",
  "rosa",
  "naranja",
  "ambar",
] as const;
export type Palette = (typeof PALETAS)[number];

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  palette: Palette;
  setPalette: (p: Palette) => void;
};

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "ethos-theme";
const PALETTE_KEY = "ethos-palette";

/**
 * El color de la barra de estado del sistema, por paleta y modo.
 *
 * Son los mismos valores que `--background` en `styles.css`. Están duplicados
 * acá porque el `<meta name="theme-color">` necesita un color literal: no
 * acepta `var(--background)`, y leerlo con getComputedStyle obligaría a esperar
 * a que el CSS aplique. **Si se toca un `--background` allá, hay que tocarlo
 * acá** o la barra de estado queda de otro color que la pantalla.
 */
const COLOR_BARRA: Record<Palette, Record<Theme, string>> = {
  marca: { light: "#f5f8fc", dark: "#0e1226" },
  slate: { light: "#f8fafc", dark: "#0b1220" },
  grafito: { light: "#fafafa", dark: "#0c0c0e" },
  azul: { light: "#f5f9ff", dark: "#0a1424" },
  indigo: { light: "#f7f8fd", dark: "#0d0d1f" },
  teal: { light: "#f4faf9", dark: "#071a1c" },
  verde: { light: "#f4faf5", dark: "#071a0f" },
  violeta: { light: "#faf7fe", dark: "#140d24" },
  rosa: { light: "#fef6f9", dark: "#1c0a14" },
  naranja: { light: "#fff9f4", dark: "#1c1008" },
  ambar: { light: "#fdfaf3", dark: "#191307" },
};

/** Descarta cualquier cosa guardada que ya no sea una paleta válida. */
function paletaValida(v: string | null): v is Palette {
  return v !== null && (PALETAS as readonly string[]).includes(v);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [palette, setPaletteState] = useState<Palette>("marca");

  // hydrate from localStorage on the client
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEY) as Theme | null) : null;
    const prefersDark =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    setThemeState(saved ?? (prefersDark ? "dark" : "light"));

    // Sin preferencia guardada arranca en la paleta de marca, que es la
    // identidad del producto. Un valor inválido (de una versión anterior o
    // editado a mano) cae al default en vez de dejar la app sin colores.
    const guardada = typeof window !== "undefined" ? localStorage.getItem(PALETTE_KEY) : null;
    if (paletaValida(guardada)) setPaletteState(guardada);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // La barra de estado del sistema sigue al tema elegido, no al del SO: si no,
    // en PWA instalada queda una franja blanca sobre una app oscura.
    root.style.colorScheme = theme;

    // La paleta de marca NO escribe el atributo: es el default del CSS, el que
    // aplica cuando no hay `data-palette`. Así el HTML del SSR y el de la
    // paleta por defecto son el mismo.
    if (palette === "marca") root.removeAttribute("data-palette");
    else root.setAttribute("data-palette", palette);

    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", COLOR_BARRA[palette][theme]);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      /* ignore */
    }
  }, [theme, palette]);

  const value: Ctx = {
    theme,
    setTheme: setThemeState,
    toggle: () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    palette,
    setPalette: setPaletteState,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
