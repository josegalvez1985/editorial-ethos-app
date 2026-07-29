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

import {
  login as apiLogin,
  logout as apiLogout,
  revalidar,
  setOnUnauthorized,
  type Sesion,
} from "@/lib/api";
import {
  biometriaDisponible,
  borrarCredenciales,
  credencialesEnMemoria,
  guardarCredenciales,
  leerCredenciales,
  olvidarEnMemoria,
  pedirBiometria,
  recordarEnMemoria,
} from "@/lib/biometric";

type Ctx = {
  sesion: Sesion | null;
  /** Datos para pintar. `null` = invitado. */
  user: { name: string; email: string } | null;
  /** Biometría activada por el usuario Y con credenciales en el keystore. */
  biometry: boolean;
  /** El dispositivo tiene sensor y huella/rostro dados de alta. */
  biometryDisponible: boolean;
  /** false hasta que terminamos de leer storage y revalidar el token. */
  ready: boolean;
  login: (usuario: string, password: string) => Promise<void>;
  /** Pide la huella y reusa las credenciales del keystore. Lanza si no se puede. */
  loginBiometrico: () => Promise<void>;
  logout: () => Promise<void>;
  /** Activa o desactiva la biometría. Lanza con el motivo si no se pudo activar. */
  setBiometry: (v: boolean) => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);
const BIO_KEY = "ethos-biometry";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [biometry, setBiometryState] = useState(false);
  const [biometryDisponible, setBiometryDisponible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const [flag, disponible] = await Promise.all([
        AsyncStorage.getItem(BIO_KEY).catch(() => null),
        biometriaDisponible(),
      ]);
      if (!active) return;
      setBiometryDisponible(disponible);

      // La biometría solo cuenta como activa si además hay credenciales
      // guardadas: sin ellas el botón no puede hacer nada.
      const guardadas = flag === "1" ? await leerCredenciales() : null;
      if (!active) return;
      setBiometryState(Boolean(guardadas));

      // El backend es la autoridad: el token guardado dura 6 h y puede estar
      // vencido aunque el JSON siga en AsyncStorage.
      const s = await revalidar();
      if (!active) return;
      setSesion(s);
      setReady(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  // Cualquier 401 del backend tira la sesión del contexto, no solo del storage.
  useEffect(() => {
    setOnUnauthorized(() => setSesion(null));
    return () => setOnUnauthorized(() => {});
  }, []);

  const login = useCallback(async (usuario: string, password: string) => {
    const s = await apiLogin(usuario, password);
    // Necesarias para poder activar la biometría después sin volver a pedirlas.
    recordarEnMemoria(usuario, password);
    // Si la biometría ya estaba activa, refrescamos lo guardado: si el usuario
    // cambió su contraseña, el keystore quedaría con la vieja.
    if (await leerCredenciales()) {
      await guardarCredenciales({ usuario, password });
    }
    setSesion(s);
  }, []);

  const loginBiometrico = useCallback(async () => {
    if (!(await biometriaDisponible())) {
      throw new Error("Configura huella o rostro en tu dispositivo primero");
    }
    const cred = await leerCredenciales();
    if (!cred) {
      throw new Error("Activa la biometría desde tu cuenta primero");
    }
    if (!(await pedirBiometria("Accede a Editorial Ethos"))) {
      throw new Error("No pudimos verificar tu identidad");
    }

    try {
      const s = await apiLogin(cred.usuario, cred.password);
      recordarEnMemoria(cred.usuario, cred.password);
      setSesion(s);
    } catch (err) {
      // La contraseña guardada dejó de servir (cambio de clave, usuario dado de
      // baja). Limpiamos para no dejar un botón que siempre falla.
      const msg = err instanceof Error ? err.message : "";
      if (!/conexión|conexion|network/i.test(msg)) {
        await borrarCredenciales();
        await AsyncStorage.setItem(BIO_KEY, "0").catch(() => {});
        setBiometryState(false);
        throw new Error("Tus credenciales cambiaron. Entra con tu contraseña.");
      }
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    olvidarEnMemoria();
    setSesion(null);
  }, []);

  const setBiometry = useCallback(async (v: boolean) => {
    if (!v) {
      await borrarCredenciales();
      await AsyncStorage.setItem(BIO_KEY, "0").catch(() => {});
      setBiometryState(false);
      return;
    }

    if (!(await biometriaDisponible())) {
      throw new Error("Configura huella o rostro en tu dispositivo primero");
    }

    const cred = credencialesEnMemoria();
    if (!cred) {
      // Entramos con una sesión restaurada o con la propia huella: nunca vimos
      // la contraseña en esta ejecución y no la vamos a inventar.
      throw new Error(
        "Cierra sesión y entra con tu contraseña para activar la biometría",
      );
    }

    if (!(await pedirBiometria("Confirma tu identidad para activar la biometría"))) {
      throw new Error("No pudimos verificar tu identidad");
    }

    if (!(await guardarCredenciales(cred))) {
      throw new Error("Este dispositivo no permite guardar credenciales seguras");
    }
    await AsyncStorage.setItem(BIO_KEY, "1").catch(() => {});
    setBiometryState(true);
  }, []);

  const user = useMemo(
    () => (sesion ? { name: sesion.nombre, email: sesion.email || sesion.usuario } : null),
    [sesion],
  );

  const value = useMemo<Ctx>(
    () => ({
      sesion,
      user,
      biometry,
      biometryDisponible,
      ready,
      login,
      loginBiometrico,
      logout,
      setBiometry,
    }),
    [
      sesion,
      user,
      biometry,
      biometryDisponible,
      ready,
      login,
      loginBiometrico,
      logout,
      setBiometry,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
