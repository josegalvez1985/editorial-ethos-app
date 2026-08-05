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
  esSinConexion,
  getSesion,
  limpiarDatosViejos,
  login as apiLogin,
  logout as apiLogout,
  msHastaExpirar,
  setOnUnauthorized,
  type Sesion,
} from "@/lib/api";
import { guardarEvaluacion, keys, lista } from "@/lib/evaluaciones";
import {
  getSesionOffline,
  precargarListas,
  puedeEntrarSinRed,
  recordarSesion,
  sincronizar,
} from "@/lib/offline";
import { borrarCachePersistida } from "@/lib/query-persist";

/**
 * Sube las evaluaciones que quedaron en la cola. Best-effort y silenciosa: es
 * una tarea de fondo y un fallo acá no debe romper el ingreso — las entradas
 * quedan en la cola y se reintentan en el próximo login con red.
 */
async function sincronizarPendientes() {
  try {
    const { subidas } = await sincronizar((cab, detalles) =>
      // Sin ids originales: la cola solo lleva evaluaciones NUEVAS.
      guardarEvaluacion(cab, detalles, []),
    );
    if (subidas > 0) {
      toast.success(
        subidas === 1
          ? "Se subió 1 evaluación que habías cargado sin conexión"
          : `Se subieron ${subidas} evaluaciones que habías cargado sin conexión`,
      );
    }
  } catch {
    /* la cola no se pierde: se reintenta en el próximo login con red */
  }
}

/**
 * Deja las listas de los combos en la caché, para poder cargar una evaluación
 * sin red. Sin esto, offline solo está lo que el usuario ya abrió a mano.
 */
async function precargar(qc: ReturnType<typeof useQueryClient>) {
  try {
    await precargarListas((nombre, _params, datos) => {
      // La MISMA queryKey que usan los pickers, o la precarga no se aprovecha.
      qc.setQueryData(keys.lista(nombre as Parameters<typeof lista>[0], {}), datos);
    });
  } catch {
    /* quedarse sin precarga no es motivo para bloquear el ingreso */
  }
}

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
  /**
   * La sesión se abrió SIN validar contra el backend, porque no había red.
   *
   * Implica que **no hay token**: toda llamada a la API va a fallar y la app
   * trabaja contra la caché persistida. La UI lo usa para avisar y para mandar
   * lo que se guarde a la cola en vez de intentar un POST que no puede salir.
   */
  offline: boolean;
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
  const [offline, setOffline] = useState(false);
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

  /**
   * Inicia sesión. **Siempre intenta primero contra el backend.**
   *
   * El modo offline es un fallback y NADA MÁS: se activa solo si la llamada
   * falla por falta de red (`SinConexion`). Un usuario o contraseña rechazados
   * por Oracle son un rechazo real y no caen acá — si cayeran, una contraseña
   * vieja guardada dejaría entrar después de que la cambiaron en el servidor.
   */
  /*
   * Subir la cola cuando vuelve la red ESTANDO YA ADENTRO.
   *
   * Sin esto, lo cargado sin señal esperaría al próximo login: alguien que deja
   * la app abierta todo el día no sube nada hasta el día siguiente.
   *
   * Solo con token: en modo offline no hay con qué autenticar, así que subir es
   * imposible y hay que esperar a que el usuario entre de nuevo con red.
   *
   * `online` del navegador es una señal barata pero mentirosa —da `true` con
   * wifi sin salida a internet—. Alcanza igual: si no había red de verdad, el
   * intento falla, la entrada vuelve a la cola y se reintenta después. Lo que no
   * se puede es NO intentar.
   */
  const conToken = Boolean(sesion?.token);
  useEffect(() => {
    if (!conToken) return;
    const alVolverLaRed = () => void sincronizarPendientes();
    window.addEventListener("online", alVolverLaRed);
    return () => window.removeEventListener("online", alVolverLaRed);
  }, [conToken]);

  const login = useCallback(
    async (usuario: string, password: string) => {
      try {
        const s = await apiLogin(usuario, password);
        // Los datos para pintar la próxima sesión offline. Nunca el token.
        recordarSesion(s);
        setSesion(s);
        setOffline(false);

        // Con red: se suben los pendientes y se dejan las listas cacheadas. Las
        // dos cosas son best-effort y no bloquean el ingreso.
        void sincronizarPendientes();
        void precargar(qc);
      } catch (e) {
        // Solo la falta de red habilita el camino offline.
        if (!esSinConexion(e)) throw e;

        const previa = getSesionOffline();
        if (!previa || !puedeEntrarSinRed(usuario, password)) {
          throw new Error(
            "Sin conexión. Para entrar sin internet tenés que haber iniciado sesión antes " +
              "en este dispositivo con la opción “Recordar usuario y contraseña” tildada.",
          );
        }

        /*
         * Sesión offline: sin token y con `expira` vacío.
         *
         * Sin token, cualquier llamada a la API va a fallar con "No hay sesión
         * activa" — que es lo correcto: offline no hay backend con quien hablar,
         * y la app trabaja contra la caché persistida.
         *
         * `expira` vacío hace que `msHastaExpirar` devuelva null y el timer de
         * vencimiento no se arme: no hay token que pueda vencer.
         */
        setSesion({ ...previa, token: "", expira: "" });
        setOffline(true);
      }
    },
    [qc],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setSesion(null);
    setOffline(false);

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
    () => ({ sesion, user, ready, offline, login, logout }),
    [sesion, user, ready, offline, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
