/**
 * Cliente de la API de Editorial Ethos (ORDS / Oracle APEX).
 *
 * Contrato del backend: `backend/ethos_auth.sql`.
 * Pega contra el proxy de mismo origen (`src/routes/api/ords.$.ts`), no contra
 * ORDS directo: así el navegador nunca ve una petición cross-origin.
 */

const BASE = import.meta.env.VITE_API_URL ?? "/api/ords/";

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
/* Sesión en memoria                                                          */
/* -------------------------------------------------------------------------- */

/**
 * La sesión vive SOLO en memoria: se pierde al recargar o al cerrar la app.
 *
 * Es una decisión deliberada, no una limitación. Antes el token se guardaba en
 * `localStorage`/`sessionStorage` y la contraseña en `localStorage` para poder
 * reentrar solo; eso se sacó entero. Consecuencias, para que nadie lo "arregle"
 * sin querer:
 *
 * - **El token NUNCA se escribe en el disco**, en ningún frontend. Un XSS no
 *   encuentra una sesión que robar.
 * - **Recargar la página cierra la sesión.** Es el costo, y es el esperado.
 *
 * ÚNICA EXCEPCIÓN, y no toca nada de lo de arriba: dentro del APK el usuario
 * puede activar el acceso con huella (`lib/biometria.ts`), que guarda **la
 * contraseña** —no el token— en el Keystore de Android, cifrada por hardware. Con
 * ella se rehace el `login()` de abajo, que valida contra el backend como
 * siempre. En la web y en la PWA eso no existe: sin Keystore sería `localStorage`
 * en texto plano, que es justamente lo que se sacó.
 *
 * Un `let` de módulo alcanza porque toda la app corre en un único contexto de JS.
 */
let sesionActual: Sesion | null = null;

export function getSesion(): Sesion | null {
  return sesionActual;
}

function guardarSesion(s: Sesion) {
  sesionActual = s;
}

export function cerrarSesion() {
  sesionActual = null;
}

/* -------------------------------------------------------------------------- */
/* Limpieza de versiones anteriores                                           */
/* -------------------------------------------------------------------------- */

/**
 * Borra lo que dejaron versiones anteriores.
 *
 * Hasta hace poco esta app guardaba el token y —con "Mantener sesión iniciada"—
 * **la contraseña en texto plano** en `localStorage`. Las dos cosas se sacaron,
 * pero quitar el código no borra lo que ya está escrito en el disco de quien
 * viene usando la app: eso sobrevive a la actualización.
 *
 * OJO: `ethos-usuario` NO está en esta lista y no debe estarlo. Es el nombre de
 * usuario que guarda "Recordar mi usuario" (ver abajo) — dato no sensible y
 * escrito por la versión actual a pedido explícito del usuario. Meterlo acá lo
 * borraría en cada arranque y el check no funcionaría nunca.
 *
 * Lo mismo vale para `ethos-biometria-activa` (`lib/biometria.ts`). Es la clave
 * ACTUAL del acceso con huella y tampoco va acá: borrarla en cada arranque
 * apagaría el botón de la huella siempre. La de esta lista es `ethos-biometry`,
 * la de la versión vieja — parecidas a propósito de nada, pero distintas.
 *
 * Se llama una vez al arrancar. Se puede eliminar cuando no queden instalaciones
 * viejas dando vueltas.
 */
export function limpiarDatosViejos() {
  if (typeof window === "undefined") return; // SSR: no hay storage
  for (const clave of ["ethos-sesion", "ethos-credenciales", "ethos-biometry"]) {
    try {
      localStorage.removeItem(clave);
      sessionStorage.removeItem(clave);
    } catch {
      /* modo privado sin storage: no había nada que borrar */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* "Recordar mi usuario"                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Nombre de usuario recordado para precargar el campo del login.
 *
 * SE GUARDA EL USUARIO Y NADA MÁS. La contraseña y el token siguen sin tocar el
 * disco: eso es lo que sostiene todo lo escrito arriba sobre la sesión en
 * memoria. Si alguien agrega acá la contraseña, `limpiarDatosViejos()` deja de
 * tener sentido y un XSS pasa a tener algo que robar.
 *
 * Es una comodidad para tipear, no una sesión: quien abre la app igual tiene que
 * escribir la contraseña entera.
 */
const CLAVE_USUARIO = "ethos-usuario";

/** El usuario recordado, o `""` si no hay o no se puede leer el storage. */
export function getUsuarioRecordado(): string {
  if (typeof window === "undefined") return ""; // SSR: no hay storage
  try {
    return localStorage.getItem(CLAVE_USUARIO) ?? "";
  } catch {
    return ""; // modo privado sin storage
  }
}

/**
 * Guarda el usuario, o lo borra si se pasa `""` / se destildó el check.
 *
 * Falla en silencio a propósito: quedarse sin poder recordar el usuario no es
 * motivo para romperle el login a nadie.
 */
export function setUsuarioRecordado(usuario: string) {
  if (typeof window === "undefined") return;
  try {
    const limpio = usuario.trim();
    if (limpio) localStorage.setItem(CLAVE_USUARIO, limpio);
    else localStorage.removeItem(CLAVE_USUARIO);
  } catch {
    /* modo privado sin storage: se pierde la comodidad, no el login */
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
 * El backend rechazó el usuario y la contraseña. Es DISTINTO de "el servidor
 * falló".
 *
 * La diferencia importa para el acceso biométrico (`lib/biometria.ts`): un
 * rechazo significa que la contraseña guardada en el Keystore quedó vieja y hay
 * que borrarla, pero un 500 o un backend caído no dicen nada sobre ella. Si se
 * tratan igual, una caída del servidor le borra al usuario una credencial
 * perfectamente válida y lo obliga a reconfigurar la huella.
 */
export class CredencialRechazada extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CredencialRechazada";
  }
}

export function esCredencialRechazada(e: unknown): e is CredencialRechazada {
  return e instanceof CredencialRechazada;
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

/**
 * Milisegundos que le quedan al token según el `expira` que emitió el backend.
 * `null` si no hay dato o no se puede parsear.
 *
 * OJO CON EL FORMATO: el backend manda ISO **sin zona** (`2026-07-30T15:04:05`), y
 * `new Date()` interpreta eso en la hora LOCAL del navegador. Si el server está en
 * otro huso, esta cuenta se corre esas horas enteras.
 *
 * Por eso el resultado sirve para decidir **cuándo preguntar**, nunca para dar la
 * sesión por muerta: quien dictamina es el backend. Ver `lib/session.tsx`.
 */
export function msHastaExpirar(expira: string | undefined): number | null {
  if (!expira) return null;
  const t = new Date(expira).getTime();
  return Number.isNaN(t) ? null : t - Date.now();
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

export async function login(usuario: string, password: string): Promise<Sesion> {
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
    const mensaje = String(json?.message ?? "Usuario o contraseña incorrectos");

    // Rechazo de credenciales vs. fallo del servidor. Solo el primero invalida
    // la contraseña guardada en el Keystore — ver `CredencialRechazada`.
    //
    // El 5xx se excluye explícitamente porque ORDS puede devolver `success:
    // false` con un mensaje cualquiera cuando el paquete PL/SQL no compila, y
    // eso no es una contraseña equivocada.
    const fallaDelServidor = res.status >= 500;
    if (!fallaDelServidor) throw new CredencialRechazada(mensaje);
    throw new Error(mensaje);
  }

  const sesion = normalizar(data, usuario);
  guardarSesion(sesion);
  return sesion;
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
