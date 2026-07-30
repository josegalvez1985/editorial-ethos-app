import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { CACHE_MAX_AGE, reintentar } from "./lib/query-persist";
import { routeTree } from "./routeTree.gen";

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
