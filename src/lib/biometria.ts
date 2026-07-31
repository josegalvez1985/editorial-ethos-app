/**
 * Acceso biométrico — SOLO dentro del APK.
 *
 * Guarda la contraseña en el **Keystore de Android**, cifrada por hardware y
 * detrás de la huella, para poder repetir el `POST auth/login` sin que el usuario
 * escriba nada. El token sigue viviendo solo en memoria (ver `lib/api.ts`): lo
 * que se persiste es la credencial, no la sesión.
 *
 * ## Por qué no existe en la web ni en la PWA
 *
 * No es una limitación pendiente de resolver, es la condición para que esto sea
 * aceptable. En un navegador no hay Keystore: guardar la contraseña ahí significa
 * `localStorage` en texto plano, que es exactamente lo que se sacó de este
 * proyecto (ver `limpiarDatosViejos()` en `lib/api.ts`). WebAuthn tampoco sirve
 * acá — autentica contra un servidor que lo soporte, y ORDS no lo hace; no
 * devuelve un secreto que se pueda usar para reloguear.
 *
 * Por eso `disponible()` corta en seco si no hay puente nativo: en la web y en la
 * PWA la biometría no se ofrece y no hay nada que guardar. **Si alguien agrega
 * acá un camino alternativo con `localStorage`, se rompe la premisa entera.**
 *
 * ## El modo de guardado
 *
 * `accessControl: BIOMETRY_ANY` + `getSecureCredentials()` hace que la clave del
 * Keystore quede atada a un `CryptoObject`: cada lectura exige un
 * `BiometricPrompt` vivo. No alcanza con que la app "haya pedido la huella antes"
 * — ningún otro punto del código puede leer la contraseña sin ese prompt.
 * `authValidityDuration` se deja en 0 (el default) justamente para eso.
 *
 * Se elige `BIOMETRY_ANY` y no `BIOMETRY_CURRENT_SET` porque este último invalida
 * la credencial al registrar una huella nueva: el usuario agrega un dedo y el
 * acceso deja de funcionar sin explicación. Con `ANY` sobrevive.
 *
 * Doc de fondo y los tres motivos por los que esto costó un día entero la primera
 * vez: `APK.md` → *Acceso biométrico*.
 */

import { AccessControl, NativeBiometric } from "@capgo/capacitor-native-biometric";

/**
 * Identifica el juego de credenciales dentro del Keystore. Es una etiqueta, no
 * una URL: no se le pega a este host. Cambiarla deja huérfano lo ya guardado.
 */
const SERVIDOR = "com.editorialethos.app";

/** Preferencia del usuario. Solo dice "está activado", nunca guarda un secreto. */
const CLAVE_ACTIVA = "ethos-biometria-activa";

/**
 * `window.Capacitor` lo inyecta el puente nativo: existe en la WebView del APK y
 * en ningún navegador. Es el mismo chequeo que usa el login para ocultar la
 * descarga del APK.
 *
 * Va como función y no como constante de módulo porque en SSR/prerender no hay
 * `window` y el módulo se evalúa igual.
 *
 * **NO SACAR ESTA GUARDA.** No alcanza con confiar en el plugin: su
 * implementación web (`dist/esm/web.js`) es un stub de desarrollo que MIENTE.
 * `isAvailable()` devuelve `isAvailable: true` y `deviceIsSecure: true` en
 * cualquier navegador, `verifyIdentity()` "siempre tiene éxito" sin pedir nada, y
 * las credenciales van a un `Map` en memoria. Sin este chequeo, la web mostraría
 * el switch, aceptaría una huella que nunca existió y daría por guardada una
 * contraseña que no está en ningún Keystore.
 */
export function enApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as { Capacitor?: unknown }).Capacitor);
}

/**
 * Por qué no se puede usar la biometría. `null` = sí se puede.
 *
 * Devuelve el motivo y no un booleano a propósito: "sin bloqueo de pantalla" y
 * "sin huellas registradas" se ven idénticos desde afuera —el botón no aparece—
 * y son la causa más común de que esto parezca roto. El usuario necesita saber
 * cuál de las dos es para poder resolverlo.
 */
export type MotivoNoDisponible =
  | "sin-app" // navegador o PWA: no hay Keystore
  | "sin-hardware" // el equipo no tiene lector
  | "sin-bloqueo" // falta PIN/patrón/contraseña en el celular
  | "sin-huellas"; // hay lector y bloqueo, pero no hay huella registrada

export type Disponibilidad = { ok: true } | { ok: false; motivo: MotivoNoDisponible };

/**
 * Estado real del equipo. **Nunca lanza**: cualquier fallo del puente nativo se
 * reporta como "no disponible", porque un error acá no puede impedir el login
 * normal con contraseña.
 */
export async function disponible(): Promise<Disponibilidad> {
  if (!enApp()) return { ok: false, motivo: "sin-app" };

  try {
    // useFallback en false: el PIN del equipo NO debe alcanzar para destapar la
    // contraseña. Si se aceptara, cualquiera que sepa el PIN entra a la cuenta,
    // que es justamente lo que la huella tiene que evitar.
    const r = await NativeBiometric.isAvailable({ useFallback: false });

    if (r.isAvailable) return { ok: true };

    // El Keystore exige bloqueo de pantalla para poder cifrar. Sin PIN, patrón o
    // contraseña no hay biometría por más lector que tenga el equipo — es una
    // restricción del sistema operativo, no algo que la app pueda sortear.
    if (!r.deviceIsSecure) return { ok: false, motivo: "sin-bloqueo" };

    // Con el equipo asegurado, lo que falta es registrar una huella.
    return { ok: false, motivo: "sin-huellas" };
  } catch (e) {
    // Aparece en chrome://inspect con el celular conectado (ver APK.md).
    console.warn("[biometria] isAvailable falló:", e);
    return { ok: false, motivo: "sin-hardware" };
  }
}

/** Texto para mostrarle al usuario, con la salida concreta en cada caso. */
export function explicar(motivo: MotivoNoDisponible): string {
  switch (motivo) {
    case "sin-app":
      return "El acceso con huella solo está disponible en la app de Android.";
    case "sin-hardware":
      return "Este dispositivo no tiene lector de huellas.";
    case "sin-bloqueo":
      return "Activá el bloqueo de pantalla (PIN, patrón o contraseña) en los ajustes del celular para poder usar la huella.";
    case "sin-huellas":
      return "No tenés ninguna huella registrada. Agregá una desde los ajustes del celular.";
  }
}

/* -------------------------------------------------------------------------- */
/* Preferencia activada/desactivada                                            */
/* -------------------------------------------------------------------------- */

/**
 * Si el usuario activó el acceso biométrico.
 *
 * Se guarda en `localStorage` y no en el Keystore **a propósito**: es un booleano
 * sin valor para nadie, y leerlo del Keystore obligaría a pedir la huella solo
 * para saber si hay que mostrar el botón. El secreto está en el Keystore; esto
 * es nada más el interruptor.
 *
 * La fuente de verdad sigue siendo el Keystore: `hayCredencial()` es la que
 * manda, esto solo evita un viaje al puente nativo en el arranque.
 */
export function activada(): boolean {
  if (!enApp()) return false;
  try {
    return localStorage.getItem(CLAVE_ACTIVA) === "1";
  } catch {
    return false;
  }
}

function marcar(valor: boolean) {
  try {
    if (valor) localStorage.setItem(CLAVE_ACTIVA, "1");
    else localStorage.removeItem(CLAVE_ACTIVA);
  } catch {
    /* sin storage: se pierde la preferencia, no la credencial */
  }
}

/** Si hay credenciales realmente guardadas en el Keystore. No pide huella. */
export async function hayCredencial(): Promise<boolean> {
  if (!enApp()) return false;
  try {
    const { isSaved } = await NativeBiometric.isCredentialsSaved({ server: SERVIDOR });
    return isSaved;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Guardar / leer / borrar                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Guarda usuario y contraseña en el Keystore, detrás de la huella.
 *
 * **Llamar solo con un login ya aceptado por el backend.** Guardar una contraseña
 * sin validar deja al usuario con una credencial que falla en cada intento y sin
 * forma de saber por qué.
 *
 * Android muestra un `BiometricPrompt` durante el guardado: es el que autoriza la
 * creación de la clave protegida, no un chequeo decorativo.
 *
 * Lanza si el usuario cancela o si el guardado falla, para que la UI pueda dejar
 * el switch apagado en vez de mentir.
 */
export async function guardarCredencial(usuario: string, password: string): Promise<void> {
  if (!enApp()) throw new Error("El acceso con huella solo está disponible en la app.");

  await NativeBiometric.setCredentials({
    username: usuario,
    password,
    server: SERVIDOR,
    // Sin esto la contraseña queda accesible SIN huella y todo el módulo pierde
    // sentido: `getSecureCredentials()` exige que se haya guardado así.
    accessControl: AccessControl.BIOMETRY_ANY,
    // 0 (default, implícito): cada lectura pide huella de nuevo. Cualquier valor
    // mayor abre una ventana en la que el resto del código puede leer la
    // contraseña en silencio.
    title: "Activar acceso con huella",
    negativeButtonText: "Cancelar",
  });

  marcar(true);
}

/**
 * Pide la huella y devuelve las credenciales, o `null` si el usuario canceló o
 * no hay nada guardado.
 *
 * El `BiometricPrompt` lo dispara el propio Keystore al descifrar: no es la app
 * la que decide si la huella fue válida.
 *
 * Devuelve `null` en vez de lanzar porque cancelar el prompt es una acción
 * legítima —el usuario prefiere escribir la contraseña— y no un error que haya
 * que reportar como tal.
 */
export async function leerCredencial(): Promise<{ usuario: string; password: string } | null> {
  if (!enApp()) return null;

  try {
    const c = await NativeBiometric.getSecureCredentials({
      server: SERVIDOR,
      reason: "Confirmá tu identidad para entrar a Editorial Ethos",
      title: "Entrar con tu huella",
      subtitle: "Editorial Ethos",
      negativeButtonText: "Usar contraseña",
    });
    return { usuario: c.username, password: c.password };
  } catch (e) {
    // Cancelar entra por acá y es normal. También entra el caso en que la
    // credencial quedó inutilizable (por ejemplo, si el usuario borró todas sus
    // huellas del sistema): ahí el login con contraseña sigue funcionando y
    // `desactivar()` lo limpia desde Mi cuenta.
    console.warn("[biometria] getSecureCredentials falló o se canceló:", e);
    return null;
  }
}

/**
 * Borra la credencial del Keystore y apaga la preferencia.
 *
 * **Se llama también al cerrar sesión**, no solo desde el switch: dejar la
 * contraseña guardada después de un logout explícito sería contradecir el gesto
 * del usuario.
 *
 * No lanza: si el borrado falla igual hay que apagar el interruptor, o la app
 * queda ofreciendo una huella que no va a poder resolver.
 */
export async function desactivar(): Promise<void> {
  marcar(false);
  if (!enApp()) return;
  try {
    await NativeBiometric.deleteCredentials({ server: SERVIDOR });
  } catch (e) {
    console.warn("[biometria] deleteCredentials falló:", e);
  }
}
