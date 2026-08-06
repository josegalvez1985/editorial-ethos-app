import type { CapacitorConfig } from "@capacitor/cli";

/**
 * ============================================================================
 * EL APK ES UNA CÁSCARA. LA WEB VIVE EN EL SERVIDOR, NO ADENTRO.
 * ============================================================================
 *
 * `server.url` es LA línea que hace que un `git push` alcance para actualizar
 * los teléfonos. La WebView pide esa URL **en cada arranque**, así que lo que
 * publica GitHub Pages es lo que el usuario ve. El APK instalado nunca cambia;
 * cambia lo que hay del otro lado de la URL.
 *
 *   Celular → APK (WebView) → https://www.ethospy.online/ → la app web
 *                                        ↑
 *                          git push → Actions → deploy a Pages
 *
 * ── POR QUÉ SE CAMBIÓ (05/08/2026) ──────────────────────────────────────────
 *
 * Antes el APK empaquetaba la web adentro (`webDir` → assets nativos) y se
 * actualizaba con el plugin OTA de Capgo, que descargaba un `.zip` y lo aplicaba
 * al pasar a segundo plano. **No funcionó en la práctica**: los cambios no
 * llegaban al teléfono aunque el bundle se publicara bien, y cada intento
 * costaba compilar y repartir un APK para verificar.
 *
 * El mecanismo tenía demasiados pasos que podían fallar en silencio —descargar,
 * verificar checksum, aplicar al ir a background, y `resetWhenUpdate` que
 * descartaba el bundle en cada instalación—. Esto no tiene ninguno: si el sitio
 * carga en el navegador del celular, el APK lo va a mostrar, porque **es ese
 * mismo sitio dentro de una WebView**.
 *
 * ── EL COSTO, QUE ES REAL ───────────────────────────────────────────────────
 *
 * **La app YA NO ABRE SIN INTERNET.** Antes los assets viajaban dentro del APK y
 * había algo que mostrar aunque no hubiera señal; ahora sin conexión la WebView
 * no puede cargar nada y aparece la pantalla de error del navegador.
 *
 * Se acepta porque la app es 100% online igual: cada consulta va a Oracle y sin
 * red no se puede ni entrar. La diferencia práctica es ver un error del
 * navegador en vez de la pantalla de login, no perder funcionalidad.
 *
 * Si algún día molesta, la salida es un service worker con **network-first para
 * el HTML** (nunca cache-first: eso congela la app en la versión cacheada y
 * rompe justamente lo que este cambio vino a arreglar).
 *
 * ── QUÉ SIGUE NECESITANDO UN APK NUEVO ──────────────────────────────────────
 *
 * Un plugin nativo, el ícono, el splash, el nombre visible, los permisos del
 * manifest, y **esta URL**: está horneada en el binario. Ver el README.
 */
const config: CapacitorConfig = {
  appId: "com.editorialethos.app",
  // Visible en el instalador y en el selector de apps. El `appId` de arriba
  // sigue diciendo `editorialethos` a propósito: cambiarlo haría que Android
  // trate el APK como otra app. Ver APK.md → "Identidad de la app".
  appName: "Juventud con Valores",
  /**
   * SOLO EXISTE PARA QUE `cap sync` NO FALLE. Su contenido **no se muestra**: la
   * WebView va a `server.url`.
   *
   * Apunta igual al build real y no a un placeholder vacío para que el APK
   * conserve un último recurso si algún día se quita `server.url`. Los assets
   * copiados quedan sin usarse mientras la URL esté puesta.
   */
  webDir: "dist/client",
  server: {
    /**
     * DE ACÁ SALE TODO LO QUE SE VE. Con barra final: sin ella Capacitor puede
     * resolver mal las rutas relativas.
     *
     * Es el mismo sitio que sirve GitHub Pages y que se abre en cualquier
     * navegador. **Antes de compilar un APK, abrí esta URL en el celular**: si
     * ahí funciona, el APK va a funcionar, porque es exactamente lo mismo.
     *
     * Cambiar de dominio obliga a recompilar y repartir el APK.
     */
    url: "https://www.ethospy.online/",
    /**
     * `false` = solo HTTPS. Pages es HTTPS y ORDS también, así que no hace falta
     * texto plano — y permitirlo abriría la puerta a que el token viaje sin
     * cifrar si alguna URL quedara en http.
     */
    cleartext: false,
    /**
     * Se mantiene junto a `url` por si alguna vez se vuelve al contenido local:
     * con `http` la WebView trata a ORDS como contenido mixto y bloquea el login.
     */
    androidScheme: "https",
  },
};

export default config;
