import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  cerrarSesion,
  getSesion,
  login as apiLogin,
  loginAutomatico,
  logout as apiLogout,
  msHastaExpirar,
  revalidar,
  SESSION_KEY,
  setOnUnauthorized,
  type Sesion,
} from "@/lib/api";
import { borrarCachePersistida } from "@/lib/query-persist";

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

/**
 * Cada cuánto, como mucho, se le pregunta al backend si el token sigue vivo al
 * volver a la pestaña. Sin este freno, alternar entre pestañas dispararía un
 * `auth/me` por cada foco.
 */
const MIN_ENTRE_CHEQUEOS = 60_000;

/**
 * Aviso de que la sesión se cayó. El `id` fijo es a propósito: si vencen varias
 * llamadas en paralelo, cada una pasa por acá y sin el id salen tres toasts
 * idénticos apilados.
 */
function avisar(descripcion: string) {
  toast.error("Tu sesión se cerró", { id: "sesion-caida", description: descripcion });
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [biometry, setBiometryState] = useState(false);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

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

  /**
   * Da la sesión por terminada. **La redirección al login no se hace acá**: la
   * hace `AppShell` en cuanto ve la sesión en null, que es el único punto por el
   * que pasan las cinco pantallas protegidas.
   *
   * `cerrarSesion()` y no `logout()`: borra el token pero NO las credenciales de
   * "Mantener sesión iniciada". Que el token venza no es lo mismo que salir a
   * mano; si acá se borraran, vencer una sola vez dejaría al usuario sin login
   * automático para siempre.
   */
  const caerSesion = useCallback((motivo: string) => {
    cerrarSesion();
    setSesion(null);
    avisar(motivo);
  }, []);

  // Cualquier 401 del backend tira la sesión del contexto, no solo del storage.
  useEffect(() => {
    setOnUnauthorized(() => caerSesion("Volvé a iniciar sesión para continuar."));
    return () => setOnUnauthorized(() => {});
  }, [caerSesion]);

  /**
   * Le pregunta al backend si el token sigue vivo.
   *
   * Se usa cuando SOSPECHAMOS que venció, no cuando lo sabemos: el `expira` viene
   * sin zona horaria (ver `msHastaExpirar`) y una cuenta corrida por el huso no
   * puede ser motivo para echar a nadie. Que conteste el que sabe.
   *
   * Sin red `revalidar()` devuelve la sesión guardada tal cual y no pasa nada:
   * quedarse sin señal no dice nada sobre el token.
   */
  const ultimoChequeo = useRef(0);
  const verificar = useCallback(async () => {
    if (!getSesion()) return;
    ultimoChequeo.current = Date.now();
    const s = await revalidar();
    if (s) setSesion(s);
    else caerSesion("El token venció. Volvé a iniciar sesión.");
  }, [caerSesion]);

  // Vencimiento proactivo. Sin esto el token puede morir con la app abierta y la
  // pantalla se queda mostrando datos de una sesión que ya no existe hasta que el
  // usuario toca algo.
  //
  // Las dependencias son `token` y `expira` y no el objeto `sesion` a propósito:
  // `revalidar()` devuelve un objeto NUEVO cada vez, así que con `sesion` el
  // efecto se reprogramaría solo y quedaría un chequeo por segundo contra ORDS.
  const token = sesion?.token;
  const expira = sesion?.expira;
  useEffect(() => {
    if (!token) return;
    const restante = msHastaExpirar(expira);
    // Sin `expira` usable no inventamos nada: queda el chequeo reactivo del 401.
    if (restante === null) return;

    // Piso de 1 s: un `expira` ya pasado dispararía inmediato. Techo en el máximo
    // de setTimeout — arriba de ~24,8 días el valor desborda a 32 bits y el timer
    // se dispara AL INSTANTE, en bucle.
    const espera = Math.min(Math.max(restante, 1_000), 2_147_483_647);
    const id = setTimeout(verificar, espera);
    return () => clearTimeout(id);
  }, [token, expira, verificar]);

  // Volver a la pestaña después de horas es el caso más común de "venció mientras
  // no mirabas", y justo el que el timer de arriba no cubre: los navegadores
  // ralentizan los timers en pestañas de fondo y la WebView del APK directamente
  // los congela, así que puede no haber disparado nunca.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      if (!getSesion()) return;
      if (Date.now() - ultimoChequeo.current < MIN_ENTRE_CHEQUEOS) return;
      verificar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [verificar]);

  // El token puede desaparecer sin que esta pestaña se entere: un logout en otra
  // pestaña, o alguien que limpia el storage del navegador. `storage` solo llega
  // a las OTRAS pestañas, nunca a la que hizo el cambio, así que esto no se cruza
  // con el logout propio.
  useEffect(() => {
    const alCambiarStorage = (e: StorageEvent) => {
      // key null = `clear()` completo, que también se lleva la sesión puesta.
      if (e.key !== null && e.key !== SESSION_KEY) return;
      if (getSesion()) {
        // Sigue habiendo token pero es otro: pudo ser un login en otra pestaña.
        verificar();
      } else {
        // Desapareció. Sin toast de "venció": no venció, lo cerraron a propósito.
        setSesion(null);
      }
    };
    window.addEventListener("storage", alCambiarStorage);
    return () => window.removeEventListener("storage", alCambiarStorage);
  }, [verificar]);

  const login = useCallback(async (usuario: string, password: string, recordar = false) => {
    setSesion(await apiLogin(usuario, password, recordar));
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setSesion(null);
    // La caché persistida tiene datos del negocio (nombres, CI de facilitadores):
    // no puede quedar en el disco después de cerrar sesión. Se borra de los dos
    // lados, memoria y localStorage, o el próximo login la restauraría.
    qc.clear();
    borrarCachePersistida();
  }, [qc]);

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
