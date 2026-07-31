import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * STATIC_BUILD=1 → build estático, sin servidor Node. Dos destinos lo usan:
 *
 * - **GitHub Pages** (`josegalvez1985.github.io/editorial-ethos-app/`) — ver
 *   `.github/workflows/deploy.yml`
 *   y `DESPLIEGUE.md`.
 * - **El APK de Capacitor** — ver `APK.md` y `scripts/build-apk.ps1`.
 *
 * `APK_BUILD=1` sigue funcionando como alias por compatibilidad.
 *
 * Cambia dos cosas respecto del build normal:
 *
 * - **Modo SPA**: genera un shell estático (`dist/client/_shell.html`) que se
 *   sirve como archivo. El build por defecto es SSR y necesita un servidor Node
 *   para responder cada ruta.
 * - **Sin nitro**: su preset arma un servidor y rompe el prerender del shell.
 *
 * CONSECUENCIA IMPORTANTE: el proxy `src/routes/api/ords.$.ts` es código de
 * servidor y en un build estático NO corre. El navegador (o la WebView) le pega
 * DIRECTO a ORDS, lo que exige que ORDS mantenga el CORS abierto y hace que el
 * token viaje desde el cliente sin pasar por un mismo origen. Es el trade-off
 * que el README ya anticipaba para el hosting estático.
 */
const staticBuild = process.env.STATIC_BUILD === "1" || process.env.APK_BUILD === "1";

/**
 * Prefijo del que cuelga todo el sitio. Por defecto la raíz, que es lo correcto
 * en dev, con dominio propio y dentro del APK (la WebView sirve desde la raíz).
 *
 * GitHub Pages sin dominio propio publica en `https://<usuario>.github.io/<repo>/`,
 * y ahí hay que pasar `BASE_PATH=/<repo>/` o todos los assets y los chunks se
 * piden a la raíz del dominio y devuelven 404. Lo calcula
 * `.github/workflows/deploy.yml`. Con la barra final: `import.meta.env.BASE_URL`
 * la conserva y de eso dependen `src/lib/asset.ts` y el `basepath` del router.
 */
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    tailwindcss(),
    ...(staticBuild ? [] : [nitro()]),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
      ...(staticBuild && { spa: { enabled: true } }),
      // El prerender tiene que saber de dónde cuelga el router, o pide "/" y
      // recibe un 404: `src/router.tsx` usa `basepath: BASE_URL`, así que con el
      // sitio en /<repo>/ —GitHub Pages sin dominio propio— la raíz no matchea
      // ninguna ruta y el build MUERE con "Failed to fetch /: Not Found", sin
      // generar el shell.
      //
      // Hay que declararlo acá aparte de `base`: el plugin lee su propia config
      // (`startConfig.router.basepath`), no la `base` de vite, y resuelve contra
      // eso la ruta que crawlea. Con base "/" el valor es "/" y no cambia nada
      // en dev, en el APK ni con dominio propio.
      router: { basepath: base },
    }),
    viteReact(),
  ],
  resolve: {
    // Resuelve el alias `@/*` de tsconfig.json, del que depende cada import del
    // proyecto. Antes lo hacía el plugin `vite-tsconfig-paths`; Vite 8 lo trae
    // nativo y el plugin quedó deprecado (avisaba en cada arranque de dev).
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
