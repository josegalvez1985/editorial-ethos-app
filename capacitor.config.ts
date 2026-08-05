import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor empaqueta el sitio web dentro del APK: `npx cap sync android` copia
 * `webDir` a los assets nativos y la WebView carga esos archivos locales.
 *
 * NO hay `server.url`: el contenido viaja adentro del APK. Eso es lo que hace
 * que la app abra SIN INTERNET, y por eso se mantiene.
 *
 * Lo que evita tener que regenerar el APK en cada cambio de la web es el bloque
 * `CapacitorUpdater` de abajo (OTA), no un `server.url`. Ver `OTA.md`.
 */
const config: CapacitorConfig = {
  appId: "com.editorialethos.app",
  // Visible en el instalador y en el selector de apps. El `appId` de arriba
  // sigue diciendo `editorialethos` a propósito: cambiarlo haría que Android
  // trate el APK como otra app. Ver APK.md → "Identidad de la app".
  appName: "Juventud con Valores",
  // Lo que produce `APK_BUILD=1 npm run build` (modo SPA, ver vite.config.ts).
  webDir: "dist/client",
  server: {
    // https y no http: con http la WebView trata a ORDS como contenido mixto y
    // bloquea el login. El origen queda en `https://localhost`.
    androidScheme: "https",
  },
  plugins: {
    /**
     * ACTUALIZACIÓN OTA (over-the-air). Documentado entero en `OTA.md`.
     *
     * Qué resuelve: un cambio de menú, de formulario o de validación llega a los
     * teléfonos con un `git push`, sin compilar ni repartir un APK nuevo.
     *
     * Qué NO resuelve: el bundle OTA lleva SOLO web (HTML/CSS/JS). Un plugin
     * nativo nuevo, el ícono, el nombre visible o un permiso del manifest siguen
     * necesitando APK nuevo con `versionCode` subido.
     *
     * Cómo se comporta sin internet: la app abre con el último bundle que llegó
     * a descargarse. Nunca queda sin abrir — los assets del APK son el piso.
     */
    CapacitorUpdater: {
      /**
       * `atBackground`: descarga en segundo plano y aplica el bundle CUANDO LA
       * APP PASA A BACKGROUND, así que se ve al reabrirla.
       *
       * Deliberadamente NO es `always` ni `atInstall`: esos recargan la WebView
       * apenas termina la descarga. Alguien a mitad de una evaluación perdería
       * lo tipeado, porque el formulario vive en estado de React y no hay
       * borrador persistido.
       */
      autoUpdate: "atBackground",

      /**
       * Endpoint self-hosted que responde qué versión hay disponible. Lo genera
       * el workflow de GitHub Pages en cada push a main; el JSON y el .zip se
       * publican junto al sitio. Ver `.github/workflows/deploy.yml`.
       *
       * Va con dominio propio y no con el `github.io` porque el 301 de Pages
       * hacia el dominio complicaría la descarga del .zip desde el cliente
       * nativo.
       *
       * SIN `publicKey`: los bundles NO van cifrados. Es una decisión tomada
       * (04/08/2026) y `OTA.md` explica el porqué y cómo activarlo después.
       */
      updateUrl: "https://www.ethospy.online/ota/updates.json",

      /**
       * Las estadísticas van al servidor de Capgo por defecto. Se apagan con "":
       * el updater es self-hosted y no hay razón para reportarle el uso de la app
       * a un tercero.
       */
      statsUrl: "",

      /**
       * Igual que `statsUrl`: no se usan canales de release, así que el endpoint
       * de canales tampoco tiene a dónde apuntar.
       */
      channelUrl: "",

      /**
       * Al instalar un APK nuevo, se descartan los bundles OTA descargados.
       *
       * Es lo que evita el peor escenario: repartís un APK 1.9 con un plugin
       * nativo nuevo y el teléfono sigue corriendo el bundle web de 1.8, que no
       * conoce ese plugin. Con esto, un APK nuevo arranca siempre con SU propia
       * web y desde ahí vuelve a actualizarse.
       */
      resetWhenUpdate: true,
    },
  },
};

export default config;
