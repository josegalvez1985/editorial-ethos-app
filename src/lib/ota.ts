/**
 * Actualización OTA del APK: el contenido web se actualiza solo, sin recompilar.
 *
 * **Todo lo que hay que saber está en `OTA.md`.** Acá va lo que el código tiene
 * que hacer sí o sí, que es una sola cosa: avisar que el bundle arrancó bien.
 *
 * ── EL ROLLBACK, QUE ES LO QUE HAY QUE ENTENDER ───────────────────────────────
 *
 * Cuando el plugin aplica un bundle descargado, arranca un cronómetro de 10 s
 * (`appReadyTimeout`). Si nadie llama a `notifyAppReady()` antes de que suene, da
 * el bundle por roto, **lo borra y vuelve al anterior**.
 *
 * Es una red de seguridad real: si algún día se publica un bundle con un error
 * que rompe el arranque, los teléfonos se recuperan solos en vez de quedar con la
 * app muerta y sin forma de actualizarse —que sería el peor final posible, porque
 * ya no habría manera de arreglarlo a distancia—.
 *
 * Por eso el aviso va lo ANTES posible y NO depende de que React monte:
 *
 *   - No es un `useEffect`. Un error en cualquier provider de `__root.tsx` haría
 *     que el efecto no corra, el plugin cuente 10 s y revierta un bundle que en
 *     realidad estaba sano.
 *   - No espera a la sesión ni a ninguna query. La doc del plugin es explícita:
 *     "call it BEFORE any network requests". El bundle es válido si el JS corre;
 *     que el backend responda es otro problema.
 *
 * ── EN LA WEB NO HACE NADA ────────────────────────────────────────────────────
 *
 * El mismo bundle se sirve en el sitio y adentro del APK. En el navegador no hay
 * plugin nativo: `isNativePlatform()` da false y esto termina en un no-op. No hay
 * dos builds ni un flag de compilación que mantener sincronizado.
 */

import { Capacitor } from "@capacitor/core";

/**
 * Avisa al plugin que el bundle cargó bien. Idempotente y silenciosa: si algo
 * falla, no se propaga.
 *
 * El import del plugin es DINÁMICO a propósito. El build de la web —GitHub Pages,
 * `npm run dev`— no tiene por qué cargar un plugin nativo que nunca va a usar, y
 * un import estático lo metería en el chunk de arranque de todos los usuarios.
 */
export async function avisarBundleOk() {
  // El orden importa: primero se descarta la web, y recién ahí se importa el
  // plugin. Al revés, el navegador bajaría el módulo para nada.
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch (error) {
    /*
     * Tragarse el error es deliberado.
     *
     * Si esto falla, el plugin va a revertir al bundle anterior por su cuenta —
     * que es exactamente lo que corresponde—. Dejar escapar la excepción sí sería
     * grave: rompería el arranque de la app por un problema del actualizador.
     *
     * Se loguea porque en `adb logcat` es la única pista de por qué un bundle
     * volvió atrás.
     */
    console.error("[ota] notifyAppReady falló:", error);
  }
}
