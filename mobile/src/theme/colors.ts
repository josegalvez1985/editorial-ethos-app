/**
 * Paleta portada desde `src/styles.css` del proyecto web (OKLCH -> hex) y
 * reajustada a los colores exactos del logo: rojo #e31e24 y navy #0f2a3d.
 */

export type ThemeName = "light" | "dark";

export type Palette = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  primarySoft: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  border: string;
  input: string;
  destructive: string;
  /** Sobre gradiente/superficies de marca: siempre texto claro. */
  onBrand: string;
  heroGradient: [string, string];
  overlay: string;
  overlayStrong: string;
};

export const brand = {
  red: "#e31e24",
  navy: "#0f2a3d",
  indigo: "#1f156c",
  paper: "#efebe8",
} as const;

export const palettes: Record<ThemeName, Palette> = {
  light: {
    background: "#fbf9f7",
    foreground: "#12293a",
    card: "#ffffff",
    cardForeground: "#12293a",
    primary: brand.red,
    primaryForeground: "#ffffff",
    primarySoft: "#fdeaea",
    secondary: "#f4efeb",
    muted: "#f1ede9",
    mutedForeground: "#6b7480",
    border: "#e5e0db",
    input: "#e5e0db",
    destructive: "#c8181d",
    onBrand: "#ffffff",
    heroGradient: [brand.red, "#14314a"],
    overlay: "rgba(255,255,255,0.16)",
    overlayStrong: "rgba(255,255,255,0.28)",
  },
  dark: {
    background: "#0c1620",
    foreground: "#eef3f7",
    card: "#14212c",
    cardForeground: "#eef3f7",
    primary: "#ff6b6b",
    primaryForeground: "#1a0708",
    primarySoft: "#3a1c20",
    secondary: "#1a2733",
    muted: "#1a2733",
    mutedForeground: "#9aa8b4",
    border: "#26333f",
    input: "#2c3a47",
    destructive: "#f94144",
    onBrand: "#ffffff",
    heroGradient: ["#a3141a", "#0c1620"],
    overlay: "rgba(255,255,255,0.14)",
    overlayStrong: "rgba(255,255,255,0.24)",
  },
};

export const radius = { sm: 8, md: 10, lg: 12, xl: 16, xxl: 20, pill: 999 } as const;

export const fonts = {
  display: "PlayfairDisplay_700Bold",
  displayBlack: "PlayfairDisplay_800ExtraBold",
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemi: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
} as const;
