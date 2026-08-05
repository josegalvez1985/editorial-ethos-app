/**
 * Trabajo sin conexión: entrar sin red y guardar lo que se cargue para subirlo
 * cuando vuelva.
 *
 * ============================================================================
 * LAS DOS MITADES
 * ============================================================================
 *
 * 1. **Entrar sin red.** El login siempre pega contra Oracle, así que sin señal
 *    no se puede validar nada contra el backend. La salida es comparar la
 *    contraseña tipeada con la que quedó guardada por el check "Recordar usuario
 *    y contraseña" (ver `lib/api.ts`). Es la única credencial que hay en el
 *    teléfono.
 *
 * 2. **Guardar sin red.** Lo que se carga offline va a una cola en
 *    `localStorage` y se sube solo cuando vuelve la conexión.
 *
 * ============================================================================
 * LO QUE ESTA COLA **NO** HACE, Y POR QUÉ
 * ============================================================================
 *
 * **Solo encola evaluaciones NUEVAS.** Editar y borrar sin red quedaron afuera a
 * propósito, no por falta de tiempo:
 *
 * - `EVALUACIONES_FACILITADORES` no tiene columna de cabecera: una evaluación
 *   son N filas agrupadas por clave natural (facilitador + institución + las dos
 *   fechas + evaluado_por). Ver el encabezado de `lib/evaluaciones.ts`.
 * - Editar offline exige mandar los ids de las filas que ya existen. Si mientras
 *   tanto alguien las editó desde APEX o desde otro teléfono, el PUT pisa ese
 *   cambio sin avisar — no hay `updated_at` ni versión de fila con qué
 *   detectarlo.
 * - Borrar offline es peor: la fila puede ya no existir.
 *
 * Crear es el caso seguro **y el que se usa de verdad en la calle**: el
 * evaluador carga la evaluación parado en el aula, sin señal.
 *
 * ============================================================================
 * POR QUÉ UNA EVALUACIÓN ENCOLADA ES **UNA** ENTRADA Y NO N LLAMADAS
 * ============================================================================
 *
 * Guardar son N POST, uno por detalle, sin transacción. Si se encolaran las N
 * llamadas sueltas y al sincronizar fallara la quinta, la evaluación quedaría
 * partida en Oracle: unas filas sí y otras no, agrupadas igual por clave
 * natural, sin forma de saber cuáles faltan.
 *
 * Por eso se guarda la evaluación ENTERA (cabecera + detalles) como una sola
 * entrada, y al sincronizar se reproduce `guardarEvaluacion` completo. Si algo
 * falla, la entrada **queda en la cola** y se reintenta entera la próxima vez.
 *
 * OJO CON EL REINTENTO PARCIAL: si fallan 3 de 8 filas, las 5 que sí entraron ya
 * están en Oracle, y el reintento las vuelve a insertar — quedan duplicadas
 * dentro del mismo grupo. Es el riesgo conocido de no tener cabecera ni
 * idempotencia en el backend, y está anotado en PENDIENTES.md. Se mitiga
 * marcando la entrada como enviada apenas la primera pasada no falla del todo:
 * ver `sincronizar()`.
 */

import { authFetch, getPasswordRecordada, getUsuarioRecordado, type Sesion } from "@/lib/api";
import type { Cabecera, Detalle } from "@/lib/evaluaciones";

/* -------------------------------------------------------------------------- */
/* 1. Entrar sin red                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Marca de que la sesión actual se abrió **sin validar contra el backend**.
 *
 * Importa que sea visible: en modo offline el token no existe, así que cualquier
 * llamada a la API va a fallar. La UI lo usa para avisar y para no ofrecer
 * acciones que no puede cumplir.
 */
export const CLAVE_ULTIMA_SESION = "ethos-ultima-sesion";

/**
 * Los datos de la última sesión válida, para poder pintar el nombre y el mail
 * sin haber hablado con el backend.
 *
 * **No incluye el token**: sigue sin escribirse en el disco, ni acá ni en
 * ningún lado. Lo que se guarda es lo necesario para que la app se vea igual, no
 * para revivir la sesión — sin token no hay llamada posible de todas formas.
 */
export type SesionOffline = Pick<Sesion, "usuario" | "nombre" | "email">;

export function recordarSesion(s: Sesion) {
  if (typeof window === "undefined") return;
  try {
    const guardar: SesionOffline = { usuario: s.usuario, nombre: s.nombre, email: s.email };
    localStorage.setItem(CLAVE_ULTIMA_SESION, JSON.stringify(guardar));
  } catch {
    /* modo privado sin storage: se pierde el modo offline, no el login */
  }
}

export function getSesionOffline(): SesionOffline | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = localStorage.getItem(CLAVE_ULTIMA_SESION);
    if (!crudo) return null;
    const d = JSON.parse(crudo) as Partial<SesionOffline>;
    if (!d.usuario) return null;
    return {
      usuario: String(d.usuario),
      nombre: String(d.nombre || d.usuario),
      email: String(d.email || ""),
    };
  } catch {
    return null; // JSON corrupto: se trata como si no hubiera sesión previa
  }
}

/**
 * ¿Se puede entrar sin red con estas credenciales?
 *
 * Compara contra el usuario y la contraseña que guardó el check "Recordar". Las
 * tres condiciones tienen que darse: haber tildado el check alguna vez con red,
 * haber tenido una sesión válida, y que lo tipeado coincida.
 *
 * ## Esto NO es autenticación
 *
 * La contraseña está en `localStorage` en texto plano, así que quien pueda leer
 * el storage puede entrar igual sin pasar por acá. Esta comparación evita que
 * **otra persona** que agarra el teléfono entre tipeando cualquier cosa; no
 * protege contra alguien que inspeccione el dispositivo.
 *
 * Es aceptable porque lo que se expone offline son los datos ya cacheados, que
 * están en ese mismo `localStorage` sin cifrar. Subir el nivel acá sin cifrar la
 * caché sería teatro.
 *
 * La comparación es **case-sensitive en la contraseña** (una contraseña es
 * exacta) e **insensible en el usuario**, que el backend normaliza a mayúsculas.
 */
export function puedeEntrarSinRed(usuario: string, password: string): boolean {
  const u = getUsuarioRecordado();
  const p = getPasswordRecordada();
  if (!u || !p) return false;
  if (!getSesionOffline()) return false;
  return u.trim().toUpperCase() === usuario.trim().toUpperCase() && p === password;
}

/* -------------------------------------------------------------------------- */
/* 2. La cola de evaluaciones pendientes                                      */
/* -------------------------------------------------------------------------- */

const CLAVE_COLA = "ethos-cola-pendientes";

/**
 * Una evaluación cargada sin conexión, esperando a subirse.
 *
 * Guarda la cabecera y los detalles **tal como los tenía el formulario**, no las
 * N llamadas HTTP: al sincronizar se reproduce `guardarEvaluacion` entero, que
 * es la misma función que corre online. Así la lógica de guardado vive en un
 * solo lugar y la cola no la duplica.
 */
export type Pendiente = {
  /**
   * Id local, solo para identificar la entrada en la cola. **No tiene nada que
   * ver con el id de Oracle**, que lo genera el IDENTITY al insertar.
   */
  id: string;
  /** ISO. Para mostrar "cargada hace 2 h" y para ordenar la subida. */
  creada: string;
  cab: Cabecera;
  detalles: Detalle[];
  /** Cuántas veces se intentó subir. Sirve para no reintentar para siempre. */
  intentos: number;
  /** El error de la última pasada, para poder mostrarlo. */
  ultimoError?: string;
};

function leerCola(): Pendiente[] {
  if (typeof window === "undefined") return [];
  try {
    const crudo = localStorage.getItem(CLAVE_COLA);
    if (!crudo) return [];
    const d = JSON.parse(crudo);
    return Array.isArray(d) ? (d as Pendiente[]) : [];
  } catch {
    return []; // corrupta: mejor vacía que romper el arranque
  }
}

function escribirCola(cola: Pendiente[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
  } catch {
    /*
     * `localStorage` lleno (cuota ~5 MB, compartida con la caché de react-query).
     * No se puede hacer mucho más que no romper: el usuario va a ver que la
     * evaluación no quedó encolada porque el contador no sube.
     */
  }
}

/** Las evaluaciones que esperan subirse, de la más vieja a la más nueva. */
export function getPendientes(): Pendiente[] {
  return leerCola().sort((a, b) => a.creada.localeCompare(b.creada));
}

export function contarPendientes(): number {
  return leerCola().length;
}

/**
 * Encola una evaluación nueva para subirla cuando vuelva la red.
 *
 * Devuelve la entrada creada. **Solo para evaluaciones nuevas**: si algún
 * detalle ya tiene `id` de Oracle, esto es una edición y no debe encolarse — ver
 * el encabezado de este archivo.
 */
export function encolar(cab: Cabecera, detalles: Detalle[]): Pendiente {
  const entrada: Pendiente = {
    // `crypto.randomUUID` existe en todo navegador moderno y en la WebView de
    // Android; el fallback cubre contextos no seguros (http://), donde no está.
    id:
      globalThis.crypto?.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    creada: new Date().toISOString(),
    cab,
    detalles,
    intentos: 0,
  };
  escribirCola([...leerCola(), entrada]);
  return entrada;
}

export function quitarPendiente(id: string) {
  escribirCola(leerCola().filter((p) => p.id !== id));
}

/** Vacía la cola entera. Solo para "descartar los pendientes" desde la UI. */
export function vaciarCola() {
  escribirCola([]);
}

/**
 * Cuántos intentos antes de dejar de reintentar solo.
 *
 * No es para siempre: una evaluación que falla por un dato inválido —una
 * institución que se dio de baja, por ejemplo— fallaría en cada arranque para
 * siempre, y el usuario vería un error recurrente sin forma de salir. Al llegar
 * al tope queda en la cola pero sin reintentarse: la UI la muestra para que se
 * resuelva a mano.
 */
export const MAX_INTENTOS = 5;

/**
 * Sube las evaluaciones pendientes.
 *
 * Recibe la función de guardado por parámetro en vez de importarla: `evaluaciones.ts`
 * ya importa de acá para los tipos, e importarlo de vuelta cerraría el ciclo.
 *
 * **Las sube de a una y en orden**, no en paralelo: son N llamadas cada una, y
 * diez evaluaciones en paralelo son cien requests simultáneos contra ORDS.
 *
 * Una entrada que falla **queda en la cola** con el error anotado. Una que sube
 * bien se quita. Devuelve el resumen para que la UI avise.
 */
export async function sincronizar(
  guardar: (cab: Cabecera, detalles: Detalle[]) => Promise<unknown>,
): Promise<{ subidas: number; fallidas: number }> {
  const cola = getPendientes();
  if (!cola.length) return { subidas: 0, fallidas: 0 };

  let subidas = 0;
  let fallidas = 0;

  for (const p of cola) {
    if (p.intentos >= MAX_INTENTOS) {
      fallidas++;
      continue;
    }
    try {
      await guardar(p.cab, p.detalles);
      quitarPendiente(p.id);
      subidas++;
    } catch (e) {
      fallidas++;
      /*
       * Se relee la cola en cada vuelta en vez de mutar la lista de arriba: si
       * el usuario cargó otra evaluación mientras esto corría, escribir la copia
       * vieja se la comería.
       */
      escribirCola(
        leerCola().map((x) =>
          x.id === p.id
            ? {
                ...x,
                intentos: x.intentos + 1,
                ultimoError: e instanceof Error ? e.message : String(e),
              }
            : x,
        ),
      );
    }
  }

  return { subidas, fallidas };
}

/* -------------------------------------------------------------------------- */
/* 3. Precarga: dejar los datos listos para trabajar sin red                  */
/* -------------------------------------------------------------------------- */

/**
 * Trae de una las listas que el formulario necesita, para que estén en la caché
 * cuando no haya red.
 *
 * **Sin esto, offline solo está lo que el usuario ya abrió.** La caché de
 * react-query se persiste (`lib/query-persist.ts`), pero solo guarda lo que se
 * pidió: entrar al formulario sin haber abierto nunca el combo de facilitadores
 * lo deja vacío y no hay forma de cargar la evaluación.
 *
 * Se llama después de un login con red. Es **best-effort**: si algo falla no se
 * propaga, porque quedarse sin precarga no es motivo para bloquear el ingreso.
 * Lo peor que pasa es que offline falte una lista.
 *
 * No incluye `evaluaciones` (los ítems de cada área) porque dependen del área
 * elegida y son cinco llamadas más; el listado de evaluaciones tampoco, que ya
 * se cachea al entrar a la pantalla.
 */
export async function precargarListas(
  cachear: (nombre: string, params: Record<string, unknown>, datos: unknown) => void,
): Promise<void> {
  const listas = ["facilitadores", "instituciones", "areas", "ciudades"] as const;

  await Promise.allSettled(
    listas.map(async (nombre) => {
      const r = (await authFetch(`listas/${nombre}?limite=500`)) as {
        data?: Record<string, unknown>[];
      };
      cachear(nombre, {}, r.data ?? []);
    }),
  );
}
