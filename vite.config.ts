import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * STATIC_BUILD=1 → build estático, sin servidor Node. Dos destinos lo usan:
 *
 * - **GitHub Pages** (`www.ethospy.online`) — ver `.github/workflows/deploy.yml`
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

export default defineConfig({
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    ...(staticBuild ? [] : [nitro()]),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
      ...(staticBuild && { spa: { enabled: true } }),
    }),
    viteReact(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
});
