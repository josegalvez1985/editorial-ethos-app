/**
 * Cliente de la API de Editorial Ethos (ORDS / Oracle APEX).
 *
 * Contrato del backend: `backend/ethos_auth.sql`.
 * Pega contra el proxy de mismo origen (`src/routes/api/ords.$.ts`), no contra
 * ORDS directo: así el navegador nunca ve una petición cross-origin.
 */

const BASE = import.meta.env.VITE_API_URL ?? "/api/ords/";
const SESSION_KEY = "ethos-sesion";
const CRED_KEY = "ethos-credenciales";

function url(path: string) {
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

export function getSesion(): Sesion | null {
  if (typeof window === "undefined") return null; // SSR: no hay storage
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    return null;
  }
}

/**
 * "Recordar" = localStorage (sobrevive al cierre del navegador).
 * Sin recordar = sessionStorage (muere con la pestaña). Nunca los dos a la vez.
 */
function guardarSesion(s: Sesion, recordar: boolean) {
  try {
    const store = recordar ? localStorage : sessionStorage;
    const otro = recordar ? sessionStorage : localStorage;
    otro.removeItem(SESSION_KEY);
    store.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* modo privado sin storage: la sesión vive solo en memoria */
  }
}

/** Borra solo el token. Las credenciales de "recordarme" no se tocan acá. */
export function cerrarSesion() {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Credenciales para el login automático                                       */
/* -------------------------------------------------------------------------- */

export type Credenciales = { usuario: string; password: string };

/**
 * Credenciales de "Mantener sesión iniciada".
 *
 * El token del backend vive 6 h y no se renueva, así que para volver a entrar sin
 * escribir nada hace falta repetir el `POST auth/login` — y para eso hay que
 * guardar la contraseña.
 *
 * LEER ESTO ANTES DE TOCARLO: en el navegador no existe almacén cifrado.
 * Esto queda en localStorage en texto claro, legible por cualquier script del
 * mismo origen (un XSS se lleva la contraseña, no solo la sesión) y por quien
 * tenga acceso al equipo. Es una decisión de producto consciente, no un
 * descuido: se guarda solo si el usuario marca la casilla, y se borra al cerrar
 * sesión o cuando el backend rechaza esas credenciales.
 *
 * La app de `mobile/` no hace esto: usa el keystore del sistema
 * (`expo-secure-store`) detrás de la huella. Ver `mobile/src/lib/biometric.ts`.
 */
function guardarCredenciales(c: Credenciales) {
  try {
    localStorage.setItem(CRED_KEY, JSON.stringify(c));
  } catch {
    /* modo privado sin storage: no hay login automático y ya */
  }
}

export function getCredenciales(): Credenciales | null {
  if (typeof window === "undefined") return null; // SSR: no hay storage
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Credenciales;
    return c?.usuario && c?.password ? c : null;
  } catch {
    return null;
  }
}

export function borrarCredenciales() {
  try {
    localStorage.removeItem(CRED_KEY);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Fallo de red vs. fallo del servidor                                         */
/* -------------------------------------------------------------------------- */

/**
 * No hubo respuesta del servidor. Es DISTINTO de "el servidor dijo que no".
 *
 * La diferencia importa para la sesión: un 401 significa que el token murió y hay
 * que volver al login, pero quedarse sin señal no dice nada sobre el token. Si se
 * tratan igual, salir del subte te expulsa de la app.
 */
export class SinConexion extends Error {
  constructor() {
    super("Sin conexión con el servidor. Revisá tu red.");
    this.name = "SinConexion";
  }
}

export function esSinConexion(e: unknown): e is SinConexion {
  return e instanceof SinConexion;
}

/**
 * `fetch` envuelto. Solo rechaza por red, CORS o abort: un 4xx o un 5xx llegan
 * como respuesta normal, así que todo lo que caiga en el catch es falta de red.
 */
async function pedir(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new SinConexion();
  }
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

/** Se dispara cuando el backend rechaza el token: limpiar y volver al login. */
let onUnauthorized: () => void = () => {};

export function setOnUnauthorized(fn: () => void) {
  onUnauthorized = fn;
}

function handleUnauthorized() {
  cerrarSesion();
  onUnauthorized();
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

export async function login(usuario: string, password: string, recordar = false): Promise<Sesion> {
  const res = await pedir(url("auth/login"), {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, password }),
  });

  const json = await res.json().catch(() => ({}) as Record<string, unknown>);
  // El back puede responder plano { success, token } o envuelto { data: {...} }.
  const data = (json?.data ?? json) as Record<string, unknown>;

  if (!res.ok || json?.success === false || !data?.token) {
    throw new Error(String(json?.message ?? "Usuario o contraseña incorrectos"));
  }

  const sesion = normalizar(data, usuario);
  guardarSesion(sesion, recordar);
  // "Recordar" implica poder entrar solo cuando el token de 6 h ya venció.
  if (recordar) guardarCredenciales({ usuario, password });
  else borrarCredenciales();
  return sesion;
}

/**
 * Reintenta el login con las credenciales guardadas. `null` si no hay ninguna o
 * si ya no sirven (contraseña cambiada, usuario dado de baja), y en ese caso las
 * borra para no reintentar en cada arranque.
 */
export async function loginAutomatico(): Promise<Sesion | null> {
  const c = getCredenciales();
  if (!c) return null;
  try {
    return await login(c.usuario, c.password, true);
  } catch (e) {
    // Solo se borran si el backend las RECHAZÓ. Sin red no sabemos si siguen
    // sirviendo, y borrarlas dejaría al usuario sin login automático incluso
    // después de recuperar la conexión — perdiendo la contraseña para siempre.
    if (!esSinConexion(e)) borrarCredenciales();
    return null;
  }
}

export async function logout(): Promise<void> {
  const s = getSesion();
  if (s) {
    // Best-effort: si el server no responde igual limpiamos la sesión local.
    await fetch(url("auth/logout"), {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${s.token}` },
    }).catch(() => {});
  }
  cerrarSesion();
  // Salir a mano cancela el login automático; expirar el token, no.
  borrarCredenciales();
}

/**
 * Revalida la sesión guardada contra el backend. `null` si el token ya no sirve.
 *
 * **Sin red devuelve la sesión guardada tal cual.** No se puede saber si el token
 * sigue vivo sin preguntar, y asumir que murió expulsaría al usuario cada vez que
 * abre la app sin señal. Si el token estaba vencido, la primera llamada con red lo
 * va a rechazar y ahí sí cae la sesión, por el camino de `handleUnauthorized`.
 */
export async function revalidar(): Promise<Sesion | null> {
  const s = getSesion();
  if (!s) return null;
  try {
    const data = (await authFetch("auth/me")) as { data?: Record<string, unknown> };
    const d = data?.data ?? {};
    return { ...s, ...normalizar({ ...d, token: s.token }, s.usuario) };
  } catch (e) {
    if (esSinConexion(e)) return s;
    return null;
  }
}

/** USAR EN TODA LLAMADA PROTEGIDA. Nunca un fetch con Authorization suelto. */
export async function authFetch(path: string, init: RequestInit = {}) {
  const s = getSesion();
  if (!s) throw new Error("No hay sesión activa");

  // Si no hay red, esto lanza SinConexion y NO toca la sesión: el token puede
  // seguir siendo válido. Solo un rechazo explícito del backend la tira.
  const res = await pedir(url(path), {
    ...init,
    cache: "no-store", // datos vivos: nunca desde cache
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${s.token}`,
    },
  });

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  // Este chequeo va ANTES de res.ok: si no, una sesión expirada se reporta como
  // error genérico y el usuario queda trabado sin entender por qué.
  if (esTokenInvalido(res, data)) {
    handleUnauthorized();
    throw new Error("Sesión expirada");
  }
  if (!res.ok || data?.success === false) {
    throw new Error(String(data?.message ?? "Operación fallida"));
  }
  return data;
}
