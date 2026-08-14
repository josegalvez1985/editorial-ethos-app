/**
 * El borrador de "Nueva evaluación": lo que se tipeó, guardado en el teléfono.
 *
 * ============================================================================
 * QUÉ PROBLEMA RESUELVE, Y CUÁL NO
 * ============================================================================
 *
 * Cargar una evaluación lleva varios minutos y se hace **en la escuela**, que es
 * donde la señal se cae. Antes de esto, quedarse sin red a mitad de carga —o que
 * el teléfono matara la WebView, o que venciera el token de 6 h— perdía todo lo
 * tipeado y había que empezar de cero.
 *
 * Esto guarda el formulario mientras se escribe y lo ofrece de vuelta al
 * reabrir la pantalla.
 *
 * **Lo que NO hace: no guarda la evaluación en Oracle.** Un borrador no es una
 * evaluación creada. Mientras esté acá, no existe para nadie más: no está en la
 * lista, no la ve otro usuario y no sale en ningún reporte. Para que exista hay
 * que tocar "Crear evaluación" **con red**. Eso es deliberado y no un pendiente:
 * una cola de escrituras sin conexión ya se intentó y se revirtió (`a5ce4f3`),
 * y sigue bloqueada por lo mismo de siempre — la tabla no tiene columna de
 * cabecera, así que "una evaluación" son N filas que hay que insertar juntas y
 * sin transacción. Ver `backend/README.md`.
 *
 * ============================================================================
 * POR QUÉ NO USA LA CACHÉ DE REACT-QUERY
 * ============================================================================
 *
 * Sería el lugar "natural" —ya hay un persister a `localStorage`— y es
 * exactamente lo que rompió la vez anterior. El commit `a5ce4f3` revirtió el
 * modo offline entero porque la precarga escribía en la caché de react-query con
 * una `queryKey` que no coincidía con la que arma `PickerModal`, y el combo de
 * facilitadores quedaba en blanco.
 *
 * Este módulo tiene su propia clave de `localStorage` y **no toca react-query**.
 * Si algún día se rompe, no puede vaciar ningún combo: lo peor que hace es no
 * ofrecer un borrador.
 *
 * ============================================================================
 * SOBREVIVE AL LOGOUT, Y ESO DEJA DATOS EN EL DISCO
 * ============================================================================
 *
 * Pedido explícitamente (14/08/2026): cerrar sesión y volver a entrar tiene que
 * encontrar el borrador donde estaba. Por eso `SessionProvider.logout()` lo
 * conserva, a diferencia de la caché de react-query, que sí borra.
 *
 * La consecuencia hay que decirla: **queda en `localStorage` en texto plano**,
 * con el nombre del facilitador, el de la institución y los aspectos redactados,
 * legible desde la consola del navegador y por cualquier XSS del mismo origen.
 * Es el mismo criterio que ya se aceptó para la contraseña recordada (ver
 * `lib/api.ts`), y se mitiga por dos lados: se borra solo al guardar con éxito o
 * al descartarlo a mano, y caduca a los {@link MAX_EDAD_MS}.
 *
 * **No guarda el token ni nada de la sesión.** Solo el contenido del formulario.
 */

import type { Cabecera, Detalle } from "@/lib/evaluaciones";

const CLAVE = "ethos-borrador-evaluacion";

/**
 * Cuánto vive un borrador sin tocarse. Una semana.
 *
 * Pasado eso se descarta al leerlo: un formulario a medio llenar de hace un mes
 * ya no es "lo que estaba haciendo", es basura que va a confundir. El mismo
 * criterio y el mismo número que `CACHE_MAX_AGE` en `query-persist.ts`.
 */
export const MAX_EDAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * SUBIR ESTO CUANDO CAMBIE LA FORMA DE `Cabecera` O DE `Detalle`.
 *
 * Un borrador guardado con la forma vieja restaurado sobre el formulario nuevo
 * es peor que no restaurar nada: los campos que se renombraron aparecen vacíos
 * y los que cambiaron de tipo rompen el render, todo sin ningún error visible.
 * Cambiar esta cadena hace que los borradores viejos se descarten solos.
 */
const VERSION = "v1";

/** Lo que se guarda. Es exactamente el estado del formulario, nada más. */
export type Borrador = {
  version: string;
  /** `Date.now()` del último tecleo. Para la antigüedad y el "hace 5 min". */
  guardadoEn: number;
  cab: Cabecera;
  areas: { id: number; texto: string }[];
  detalles: Detalle[];
  /** Los textos de los combos ya elegidos: sin esto el campo vuelve vacío. */
  textos: { facilitador: string | null; institucion: string | null; ciudad: string | null };
};

/** Lo que el formulario entrega para guardar (todo menos los metadatos). */
export type ContenidoBorrador = Omit<Borrador, "version" | "guardadoEn">;

/**
 * Si el borrador tiene algo que valga la pena ofrecer.
 *
 * El formulario nace con las dos fechas en hoy, así que un borrador "vacío" no
 * lo está del todo. Sin este chequeo, entrar a la pantalla y salir sin tocar
 * nada dejaría un borrador guardado, y la próxima vez aparecería el cartel de
 * "tenés una evaluación a medio cargar" ofreciendo restaurar la nada.
 */
export function tieneContenido(b: ContenidoBorrador): boolean {
  const c = b.cab;
  return Boolean(
    c.id_facilitador ||
    c.id_institucion ||
    c.evaluado_por.trim() ||
    c.aspectos_positivos.trim() ||
    c.aspectos_mejorar.trim() ||
    c.observacion_admin.trim() ||
    c.id_postulacion ||
    c.id_indice ||
    b.areas.length ||
    b.detalles.some((d) => d.marcada),
  );
}

/**
 * Guarda, o borra si no hay nada que guardar.
 *
 * Falla en silencio a propósito: quedarse sin poder guardar el borrador —modo
 * privado, cuota llena— no es motivo para romperle la carga a nadie. El
 * formulario sigue funcionando; lo que se pierde es la red de seguridad.
 */
export function guardarBorrador(contenido: ContenidoBorrador) {
  if (typeof window === "undefined") return; // SSR: no hay storage
  try {
    if (!tieneContenido(contenido)) {
      window.localStorage.removeItem(CLAVE);
      return;
    }
    const b: Borrador = { version: VERSION, guardadoEn: Date.now(), ...contenido };
    window.localStorage.setItem(CLAVE, JSON.stringify(b));
  } catch {
    /* sin storage o sin cuota: se pierde la red de seguridad, no la carga */
  }
}

/**
 * El borrador guardado, o `null`.
 *
 * Devuelve `null` —y de paso limpia— cuando está vencido, cuando es de otra
 * versión o cuando el JSON no parsea. En los tres casos el dato no sirve, y
 * dejarlo en el disco haría que el chequeo se repita en cada arranque.
 */
export function leerBorrador(): Borrador | null {
  if (typeof window === "undefined") return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE);
    if (!crudo) return null;

    const b = JSON.parse(crudo) as Borrador;

    if (b?.version !== VERSION || typeof b.guardadoEn !== "number" || !b.cab) {
      window.localStorage.removeItem(CLAVE);
      return null;
    }
    if (Date.now() - b.guardadoEn > MAX_EDAD_MS) {
      window.localStorage.removeItem(CLAVE);
      return null;
    }
    return b;
  } catch {
    // JSON corrupto: se descarta en vez de arrastrarlo.
    try {
      window.localStorage.removeItem(CLAVE);
    } catch {
      /* nada que hacer */
    }
    return null;
  }
}

/** Borra el borrador. Al guardar con éxito y al descartarlo a mano. */
export function borrarBorrador() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLAVE);
  } catch {
    /* modo privado sin storage: no había nada que borrar */
  }
}

/** "hace 5 min", "hace 2 h", "ayer". Para el cartel que ofrece restaurar. */
export function hace(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}
