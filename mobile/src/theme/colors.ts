/**
 * Espejo de `src/styles.css` del proyecto web. Los dos frontends tienen que
 * verse igual: si tocas un valor acá, tócalo allá.
 *
 * Colores muestreados del logo "Juventud con Valores" (`public/logo.png`):
 * navy `#27306a`, rojo `#e41420`, azul `#7095cc`, blanco.
 *
 * **El primario es el NAVY, no el rojo**, aunque en el logo el rojo ocupe más
 * superficie: un botón primario rojo compite con los mensajes de error. El rojo
 * queda para `destructive` y acentos.
 *
 * En oscuro el primario pasa al azul claro: el navy sobre fondo oscuro no
 * contrasta lo suficiente para un botón.
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
  navy: "#27306a",
  red: "#e41420",
  blue: "#7095cc",
  paper: "#f5f8fc",
} as const;

export const palettes: Record<ThemeName, Palette> = {
  light: {
    background: "#f5f8fc",
    foreground: "#1a1f3d",
    card: "#ffffff",
    cardForeground: "#1a1f3d",
    primary: brand.navy,
    primaryForeground: "#ffffff",
    primarySoft: "#e8ecf7",
    secondary: "#e9eef7",
    muted: "#eaeef6",
    mutedForeground: "#5f6b85",
    border: "#d9e1ef",
    input: "#d9e1ef",
    // El rojo del logo, apenas oscurecido para llegar a 4.5:1 sobre blanco.
    destructive: "#d1121c",
    onBrand: "#ffffff",
    heroGradient: [brand.red, brand.navy],
    overlay: "rgba(255,255,255,0.16)",
    overlayStrong: "rgba(255,255,255,0.28)",
  },
  dark: {
    background: "#0e1226",
    foreground: "#e8ecf7",
    card: "#171d3a",
    cardForeground: "#e8ecf7",
    // Azul claro y no el navy: sobre fondo oscuro el navy no contrasta.
    primary: "#8fb0dd",
    primaryForeground: "#0e1226",
    primarySoft: "#1f2850",
    secondary: "#1c2344",
    muted: "#1c2344",
    mutedForeground: "#9aa5c4",
    border: "#2a3157",
    input: "#333b66",
    destructive: "#ff5a5f",
    onBrand: "#ffffff",
    heroGradient: ["#a30e17", "#0e1226"],
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
