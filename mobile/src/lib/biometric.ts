import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

/**
 * Acceso biométrico real.
 *
 * Cómo funciona, porque no es obvio: el backend solo entiende usuario+contraseña,
 * así que la huella NO reemplaza al login — lo desbloquea. Al activar la
 * biometría guardamos las credenciales en el keystore del sistema
 * (`expo-secure-store`, cifrado por el SO) y el login biométrico las recupera y
 * hace el `POST /auth/login` de siempre. El servidor nunca ve nada distinto.
 *
 * Las credenciales solo se persisten cuando el usuario activa la biometría, y se
 * borran al desactivarla o al cerrar sesión.
 */

const CRED_KEY = "ethos-credenciales";

export type Credenciales = { usuario: string; password: string };

/* -------------------------------------------------------------------------- */
/* Credenciales en memoria                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Últimas credenciales validadas con contraseña en esta ejecución de la app.
 * Vive solo en memoria: se pierde al cerrar la app, a propósito.
 *
 * Existe porque activar la biometría necesita la contraseña, y no queremos ni
 * volver a pedirla en un modal ni guardarla mientras la biometría está apagada.
 */
let enMemoria: Credenciales | null = null;

export function recordarEnMemoria(usuario: string, password: string) {
  enMemoria = { usuario, password };
}

export function credencialesEnMemoria(): Credenciales | null {
  return enMemoria;
}

export function olvidarEnMemoria() {
  enMemoria = null;
}

/* -------------------------------------------------------------------------- */
/* Hardware                                                                    */
/* -------------------------------------------------------------------------- */

/** true solo si el dispositivo tiene sensor Y el usuario tiene huella/rostro dado de alta. */
export async function biometriaDisponible(): Promise<boolean> {
  try {
    const [hardware, enrolado] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolado;
  } catch {
    return false;
  }
}

export async function pedirBiometria(motivo: string): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: motivo,
      cancelLabel: "Cancelar",
      disableDeviceFallback: false, // permite caer al PIN del dispositivo
    });
    return res.success;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Keystore                                                                    */
/* -------------------------------------------------------------------------- */

async function keystoreDisponible(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false; // Expo Web no tiene keystore
  }
}

export async function guardarCredenciales(c: Credenciales): Promise<boolean> {
  if (!(await keystoreDisponible())) return false;
  try {
    await SecureStore.setItemAsync(CRED_KEY, JSON.stringify(c), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch {
    return false;
  }
}

export async function leerCredenciales(): Promise<Credenciales | null> {
  if (!(await keystoreDisponible())) return null;
  try {
    const raw = await SecureStore.getItemAsync(CRED_KEY);
    return raw ? (JSON.parse(raw) as Credenciales) : null;
  } catch {
    return null;
  }
}

export async function borrarCredenciales(): Promise<void> {
  if (!(await keystoreDisponible())) return;
  await SecureStore.deleteItemAsync(CRED_KEY).catch(() => {});
}
