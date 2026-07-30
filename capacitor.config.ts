import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor empaqueta el sitio web dentro del APK: `npx cap sync android` copia
 * `webDir` a los assets nativos y la WebView carga esos archivos locales.
 *
 * NO hay `server.url`: el contenido viaja adentro del APK. Por eso cualquier
 * cambio del front obliga a regenerar el APK — ver `APK.md`.
 */
const config: CapacitorConfig = {
  appId: "com.editorialethos.app",
  appName: "Editorial Ethos",
  // Lo que produce `APK_BUILD=1 npm run build` (modo SPA, ver vite.config.ts).
  webDir: "dist/client",
  server: {
    // https y no http: con http la WebView trata a ORDS como contenido mixto y
    // bloquea el login. El origen queda en `https://localhost`.
    androidScheme: "https",
  },
};

export default config;
