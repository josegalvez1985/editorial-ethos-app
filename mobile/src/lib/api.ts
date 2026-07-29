import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

/**
 * Cliente de la API de Editorial Ethos (ORDS / Oracle APEX).
 *
 * Contrato del backend: `../../../backend/ethos_auth.sql`.
 *
 * A diferencia del front web, acá NO hay proxy server-side: la app nativa pega
 * directo a ORDS. El fetch de React Native no aplica CORS, y para Expo Web el
 * backend ya emite los headers `Access-Control-Allow-*`.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

// EXPO_PUBLIC_* gana en desarrollo (`.env`); `extra.apiUrl` de app.json es lo
// que queda embebido en el APK compilado con EAS.
const BASE = process.env.EXPO_PUBLIC_API_URL || extra.apiUrl || "";

const SESSION_KEY = "ethos-sesion";

function url(path: string) {
  if (!BASE) {
    throw new Error(
      "Falta la URL de la API. Configura expo.extra.apiUrl en mobile/app.json.",
    );
  }
  return `${BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export type Sesion = {
  token: string;
  /** Nombre de usuario APEX, siempre en MAYÚSCULAS. */
  usuario: string;
  /** Nombre para mostrar. Cae al usuario si el workspace no lo tiene. */
  nombre: string;
  email: string;
  /** ISO local, tal como lo emite el backend. */
  expira: string;
};

/* -------------------------------------------------------------------------- */
/* Persistencia                                                               */
/* -------------------------------------------------------------------------- */

let sesionActual: Sesion | null = null;

/** Cache en memoria. Válido después de `cargarSesion()`. */
export function getSesion(): Sesion | null {
  return sesionActual;
}

export async function cargarSesion(): Promise<Sesion | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    sesionActual = raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    sesionActual = null; // dato corrupto: seguimos sin sesión
  }
  return sesionActual;
}

async function guardarSesion(s: Sesion) {
  sesionActual = s;
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s)).catch(() => {});
}

export async function cerrarSesion() {
  sesionActual = null;
  await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* Detección de token muerto                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Detecta el rechazo del token aun cuando el status HTTP no llegó como 401:
 * un handler ORDS que ya abrió la respuesta deja el STATUS_LINE en 200.
 */
function esTokenInvalido(res: Response, data: { success?: boolean; message?: string }) {
  return (
    res.status === 401 ||
    (data?.success === false &&
      typeof data?.message === "string" &&
      /token\s+inv[aá]lido|token\s+expirado|expirad/i.test(data.message))
  );
}

let onUnauthorized: () => void = () => {};

export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

function normalizar(data: Record<string, unknown>, usuarioTipeado: string): Sesion {
  const usuario = String(data.usuario ?? usuarioTipeado).toUpperCase();
  return {
    token: String(data.token ?? ""),
    usuario,
    // El workspace puede no tener nombre cargado; ahí mostramos el usuario.
    nombre: String(data.nombre || "").trim() || usuario,
    email: String(data.email || "").trim(),
    expira: String(data.expira ?? ""),
  };
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

export async function login(usuario: string, password: string): Promise<Sesion> {
  let res: Response;
  try {
    res = await fetch(url("auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    });
  } catch {
    // En móvil el fallo de red es lo más común: sin datos, Wi-Fi caído, DNS.
    throw new Error("Sin conexión con el servidor. Revisa tu red.");
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // El back puede responder plano { success, token } o envuelto { data: {...} }.
  const data = ((json?.data ?? json) ?? {}) as Record<string, unknown>;

  if (!res.ok || json?.success === false || !data?.token) {
    throw new Error(String(json?.message ?? "Usuario o contraseña incorrectos"));
  }

  const sesion = normalizar(data, usuario);
  await guardarSesion(sesion);
  return sesion;
}

export async function logout(): Promise<void> {
  const s = sesionActual;
  if (s) {
    // Best-effort: pase lo que pase (sin red, sin URL configurada) la sesión
    // local se limpia. Cerrar sesión nunca debe poder fallar.
    try {
      await fetch(url("auth/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${s.token}` },
      });
    } catch {
      /* el token queda vivo en la BD hasta que expire; aceptable */
    }
  }
  await cerrarSesion();
}

/**
 * Revalida contra el backend la sesión leída de AsyncStorage. `null` si el token
 * ya no sirve (y en ese caso deja el storage limpio).
 *
 * Si la revalidación falla por RED —no por token— conservamos la sesión: quedarse
 * sin señal no debería expulsar al usuario de la app.
 */
export async function revalidar(): Promise<Sesion | null> {
  const s = await cargarSesion();
  if (!s) return null;
  try {
    const data = (await authFetch("auth/me")) as { data?: Record<string, unknown> };
    const d = data?.data ?? {};
    const fresca = { ...s, ...normalizar({ ...d, token: s.token }, s.usuario) };
    await guardarSesion(fresca);
    return fresca;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/conexión|conexion|network/i.test(msg)) return s;
    return null;
  }
}

/** USAR EN TODA LLAMADA PROTEGIDA. Nunca un fetch con Authorization suelto. */
export async function authFetch(path: string, init: RequestInit = {}) {
  const s = sesionActual;
  if (!s) throw new Error("No hay sesión activa");

  let res: Response;
  try {
    res = await fetch(url(path), {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${s.token}` },
    });
  } catch {
    throw new Error("Sin conexión con el servidor. Revisa tu red.");
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // Este chequeo va ANTES de res.ok: si no, una sesión expirada se reporta como
  // error genérico y el usuario queda trabado sin entender por qué.
  if (esTokenInvalido(res, data)) {
    await cerrarSesion();
    onUnauthorized();
    throw new Error("Sesión expirada");
  }
  if (!res.ok || data?.success === false) {
    throw new Error(String(data?.message ?? "Operación fallida"));
  }
  return data;
}
