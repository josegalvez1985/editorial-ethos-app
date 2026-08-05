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
  limpiarDatosViejos,
  login as apiLogin,
  logout as apiLogout,
  msHastaExpirar,
  setOnUnauthorized,
  type Sesion,
} from "@/lib/api";
import { borrarCachePersistida } from "@/lib/query-persist";

/**
 * Estado de la sesión.
 *
 * **El TOKEN nunca sobrevive a recargar la página ni a cerrar la app.** Vive solo
 * en memoria (ver `lib/api.ts`): no hay "mantener sesión iniciada" y cada arranque
 * pasa por el login.
 *
 * Lo que sí puede sobrevivir, si el usuario tilda el check del login, es **la
 * contraseña** — en `localStorage` y en texto plano, igual en la web que en el
 * APK. Ver `lib/api.ts`. Con ella se rehace el `POST auth/login`; la sesión no se
 * restaura sola.
 *
 * **No hay biometría.** Se implementó y se quitó el 31/07/2026; ver `APK.md`.
 */
type Ctx = {
  sesion: Sesion | null;
  /** Datos para pintar. `null` = sin sesión. */
  user: { name: string; email: string } | null;
  /**
   * Se mantiene por compatibilidad con `AppShell`, que lo usa para no pintar la
   * pantalla antes de saber si hay sesión. Sin persistencia que restaurar, pasa a
   * `true` apenas monta.
   */
  ready: boolean;
  login: (usuario: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

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
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  // No hay sesión que restaurar: se arranca siempre en el login. Lo único que se
  // hace acá es barrer el token y la contraseña que dejaron versiones anteriores
  // en el disco — quitar el código no borra lo ya escrito en el equipo del
  // usuario. Ver `limpiarDatosViejos()`.
  useEffect(() => {
    limpiarDatosViejos();
    setReady(true);
  }, []);

  /**
   * Da la sesión por terminada. **La redirección al login no se hace acá**: la
   * hace `AppShell` en cuanto ve la sesión en null, que es el único punto por el
   * que pasan las cinco pantallas protegidas.
   */
  const caerSesion = useCallback((motivo: string) => {
    cerrarSesion();
    setSesion(null);
    avisar(motivo);
  }, []);

  // Cualquier 401 del backend tira la sesión.
  useEffect(() => {
    setOnUnauthorized(() => caerSesion("Volvé a iniciar sesión para continuar."));
    return () => setOnUnauthorized(() => {});
  }, [caerSesion]);

  // Vencimiento proactivo. El token dura 6 h y no se renueva; sin esto la app
  // puede quedar abierta mostrando datos de una sesión que ya murió hasta que el
  // usuario toca algo.
  //
  // Acá SÍ se puede cortar sin preguntarle al backend —a diferencia de antes—
  // porque la sesión vive en memoria: si `expira` estuviera corrido por zona
  // horaria, el peor caso es pedir el login de nuevo, no perder nada guardado.
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
    const id = setTimeout(() => caerSesion("El token venció. Volvé a iniciar sesión."), espera);
    return () => clearTimeout(id);
  }, [token, expira, caerSesion]);

  // Los timers se frenan en pestañas de fondo y la WebView del APK los congela,
  // así que al volver puede haber vencido sin que el timer llegara a disparar.
  const vencido = useRef(false);
  vencido.current = msHastaExpirar(expira) !== null && (msHastaExpirar(expira) ?? 0) <= 0;
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      if (!getSesion()) return;
      if (vencido.current) caerSesion("El token venció. Volvé a iniciar sesión.");
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [caerSesion]);

  const login = useCallback(async (usuario: string, password: string) => {
    setSesion(await apiLogin(usuario, password));
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setSesion(null);

    // El check de "recordar" NO se toca acá, a propósito: es comodidad para
    // tipear, no una sesión. Si se borrara al salir, se destildaría solo cada vez
    // que el usuario cierra sesión correctamente y no serviría para nada. Se
    // apaga destildándolo en el login.
    //
    // El token sí muere siempre, que es lo que realmente protege la cuenta.

    // La caché persistida tiene datos del negocio (nombres, CI de facilitadores):
    // no puede quedar en el disco después de cerrar sesión. Se borra de los dos
    // lados, memoria y localStorage, o el próximo login la restauraría.
    qc.clear();
    borrarCachePersistida();
  }, [qc]);

  const user = useMemo(
    () => (sesion ? { name: sesion.nombre, email: sesion.email || sesion.usuario } : null),
    [sesion],
  );

  const value = useMemo<Ctx>(
    () => ({ sesion, user, ready, login, logout }),
    [sesion, user, ready, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
