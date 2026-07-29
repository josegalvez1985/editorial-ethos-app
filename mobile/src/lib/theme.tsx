import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { palettes, type Palette, type ThemeName } from "@/theme/colors";

type Ctx = {
  theme: ThemeName;
  colors: Palette;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "ethos-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemeName>("light");
  const [hydrated, setHydrated] = useState(false);

  // Preferencia guardada; si no hay, seguimos el esquema del sistema.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!active) return;
        if (saved === "light" || saved === "dark") setThemeState(saved);
        else if (systemScheme === "dark") setThemeState("dark");
      })
      .catch(() => {})
      .finally(() => active && setHydrated(true));
    return () => {
      active = false;
    };
    // Solo al montar: después manda la elección explícita del usuario.
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEY, t).catch(() => {});
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      theme,
      colors: palettes[theme],
      setTheme,
      toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme],
  );

  // Evita el parpadeo claro->oscuro antes de leer la preferencia.
  if (!hydrated) return null;

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Atajo para el caso más común: solo necesito los colores. */
export function useColors() {
  return useTheme().colors;
}
