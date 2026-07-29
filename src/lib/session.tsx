import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getSesion,
  login as apiLogin,
  loginAutomatico,
  logout as apiLogout,
  revalidar,
  setOnUnauthorized,
  type Sesion,
} from "@/lib/api";

type Ctx = {
  sesion: Sesion | null;
  /** Datos para pintar. `null` = sin sesión. */
  user: { name: string; email: string } | null;
  biometry: boolean;
  /** false hasta que terminamos de revalidar la sesión guardada. */
  ready: boolean;
  login: (usuario: string, password: string, recordar?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  setBiometry: (v: boolean) => void;
};

const SessionContext = createContext<Ctx | null>(null);
const BIO_KEY = "ethos-biometry";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [biometry, setBiometryState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // El backend es la autoridad: la sesión de storage puede tener el token
    // vencido (6 h) aunque el JSON siga ahí.
    let active = true;
    const guardada = getSesion();
    if (guardada) setSesion(guardada);

    try {
      setBiometryState(localStorage.getItem(BIO_KEY) === "1");
    } catch {
      /* ignore */
    }

    // Si el token murió (6 h) pero el usuario marcó "Mantener sesión iniciada",
    // rehacemos el login con las credenciales guardadas antes de mandarlo al
    // formulario.
    revalidar()
      .then((s) => s ?? loginAutomatico())
      .then((s) => {
        if (active) setSesion(s);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // Cualquier 401 del backend tira la sesión del contexto, no solo del storage.
  useEffect(() => {
    setOnUnauthorized(() => setSesion(null));
    return () => setOnUnauthorized(() => {});
  }, []);

  const login = useCallback(async (usuario: string, password: string, recordar = false) => {
    setSesion(await apiLogin(usuario, password, recordar));
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setSesion(null);
  }, []);

  const setBiometry = useCallback((v: boolean) => {
    setBiometryState(v);
    try {
      localStorage.setItem(BIO_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const user = useMemo(
    () => (sesion ? { name: sesion.nombre, email: sesion.email || sesion.usuario } : null),
    [sesion],
  );

  const value = useMemo<Ctx>(
    () => ({ sesion, user, biometry, ready, login, logout, setBiometry }),
    [sesion, user, biometry, ready, login, logout, setBiometry],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
