/**
 * Persistencia de la caché de react-query, para que la app sirva sin red.
 *
 * Sin esto la caché vive solo en memoria: recargar la página o volver a abrir el
 * APK sin conexión deja las pantallas vacías aunque los datos se hayan visto
 * hace un minuto. Con esto, lo que ya se trajo una vez sigue disponible.
 *
 * **Requiere al menos una sesión con red.** Un dispositivo recién instalado y sin
 * conexión no tiene nada que mostrar: esto guarda lo que se vio, no lo adivina.
 *
 * LO QUE ESTO ESCRIBE EN EL DISCO. La caché incluye los datos de las listas de
 * valores, y esas vienen del backend con todas las columnas de la fila —
 * facilitadores con su CI, instituciones con lo que tengan cargado. Todo eso
 * queda en `localStorage` en texto claro, legible por cualquier script del mismo
 * origen. Por eso `SessionProvider` la borra al cerrar sesión; si el criterio
 * cambia, ese es el lugar a mirar.
 */

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Persister } from "@tanstack/react-query-persist-client";

import { esSinConexion } from "@/lib/api";

const STORAGE_KEY = "ethos-query-cache";

/** Una semana. Pasado eso se descarta y se vuelve a pedir todo. */
export const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/**
 * SUBIR ESTO CUANDO CAMBIE LA FORMA DE LOS DATOS DEL BACKEND.
 *
 * Es lo único que evita que una caché vieja alimente a la UI nueva. Concreto: el
 * día que `CALIFICACION_ESTRELLAS` pasó a llamarse `ESCALA`, una caché guardada
 * antes seguía teniendo el nombre viejo y todos los detalles habrían aparecido
 * sin marcar, sin ningún error visible. El buster la descarta.
 */
export const CACHE_BUSTER = "escala-v1";

/** En SSR no hay `localStorage`: un persister que no hace nada. */
const enMemoria: Persister = {
  persistClient: async () => {},
  restoreClient: async () => undefined,
  removeClient: async () => {},
};

export const persister: Persister =
  typeof window === "undefined"
    ? enMemoria
    : createSyncStoragePersister({
        storage: window.localStorage,
        key: STORAGE_KEY,
        // Sin throttle, cada query que resuelve reescribe TODA la caché a
        // localStorage de forma sincrónica y se siente en el scroll.
        throttleTime: 1000,
      });

/** Borra la caché del disco. Se llama al cerrar sesión. */
export function borrarCachePersistida() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* modo privado sin storage: no había nada que borrar */
  }
}

/**
 * Cuándo vale la pena reintentar.
 *
 * Ni sin red (el reintento va a fallar igual y solo demora el mensaje) ni con la
 * sesión vencida (el token no se arregla insistiendo, hay que volver al login).
 */
export function reintentar(intentos: number, error: unknown) {
  if (esSinConexion(error)) return false;
  if (error instanceof Error && /sesi[oó]n expirada/i.test(error.message)) return false;
  return intentos < 2;
}
