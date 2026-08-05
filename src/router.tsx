import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { avisarBundleOk } from "./lib/ota";
import { CACHE_MAX_AGE, reintentar } from "./lib/query-persist";
import { routeTree } from "./routeTree.gen";

/*
 * ACTUALIZACIÓN OTA: confirmarle al plugin que este bundle arranca bien.
 *
 * Va ACÁ, en el módulo del router, y no en un componente, porque este archivo se
 * ejecuta apenas el bundle se carga —antes de que React monte nada—. Si el aviso
 * dependiera de que un componente llegue a montarse, un error en cualquier
 * provider de `__root.tsx` haría que el plugin diera por roto un bundle sano y lo
 * revirtiera. Ver `lib/ota.ts`.
 *
 * `typeof window` descarta el SSR: en el servidor no hay app nativa que avisar, y
 * este módulo también corre ahí.
 *
 * Sin `await`: es fire-and-forget y `avisarBundleOk` no lanza. Bloquear la
 * creación del router por el actualizador sería subordinar la app a él.
 */
if (typeof window !== "undefined") {
  void avisarBundleOk();
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // gcTime largo porque la caché se persiste en localStorage (ver
        // `lib/query-persist.ts`): con los 5 min por defecto, react-query
        // descartaría las queries inactivas antes de que sirvan de algo offline.
        gcTime: CACHE_MAX_AGE,
        // Un minuto de datos frescos evita repedir lo mismo al navegar entre
        // pantallas, sin llegar a mostrar información vieja.
        staleTime: 60_000,
        // offlineFirst y no el "online" por defecto: sirve lo que hay en caché de
        // entrada e intenta la red igual. Con "online", react-query DEJA EN PAUSA
        // la query cuando el navegador se cree offline, y `navigator.onLine`
        // miente seguido (VPN, portal cautivo, Wi-Fi sin salida).
        networkMode: "offlineFirst",
        retry: reintentar,
        // Volver a la pestaña no debería disparar una tanda de requests: si el
        // dato tiene menos de un minuto ya alcanza.
        refetchOnWindowFocus: false,
      },
      mutations: {
        // Igual que arriba, y por un motivo concreto: con "online" un guardado
        // sin red queda PAUSADO en silencio, y el usuario cree que se guardó.
        // Así falla y muestra el error. No hay cola de reintentos todavía.
        networkMode: "offlineFirst",
        retry: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // El sitio no siempre cuelga de la raíz: en el Pages de proyecto vive en
    // /<repo>/. Sin esto el router compara las rutas contra la URL completa, no
    // encuentra ninguna y toda la app muestra el 404. Es la `base` de
    // vite.config.ts; el router le saca las barras sobrantes, así que "/" (dev,
    // APK, dominio propio) equivale a no configurar nada.
    basepath: import.meta.env.BASE_URL,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
