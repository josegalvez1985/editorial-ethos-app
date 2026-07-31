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
 * Lo anterior es sobre el TOKEN. La CONTRASEÑA es otra cosa y sí puede quedar
 * guardada, si el usuario tilda el check del login: ver "Recordar usuario y
 * contraseña" más abajo. Con ella se rehace el `login()`, que valida contra el
 * backend como siempre; la sesión no se restaura sola.
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
 * `ethos-biometria-activa` está en la lista porque el acceso con huella existió
 * en la v1.5/1.6 y se quitó en la 1.7: quien haya instalado alguna de esas tiene
 * esa clave escrita en el teléfono, y sin esto le quedaría para siempre.
 *
 * OJO: las claves que la versión ACTUAL escribe **no** van acá, o se borrarían
 * solas en cada arranque y el check del login no funcionaría nunca. Son
 * `ethos-usuario` y `ethos-password`, parecidas a las viejas pero distintas:
 *
 * | Actual (NO tocar) | Vieja, parecida (sí se barre) |
 * | --- | --- |
 * | `ethos-usuario` | — |
 * | `ethos-password` | `ethos-credenciales` |
 *
 * Se llama una vez al arrancar. Se puede eliminar cuando no queden instalaciones
 * viejas dando vueltas.
 */
export function limpiarDatosViejos() {
  if (typeof window === "undefined") return; // SSR: no hay storage
  for (const clave of [
    "ethos-sesion",
    "ethos-credenciales",
    "ethos-biometry",
    "ethos-biometria-activa",
  ]) {
    try {
      localStorage.removeItem(clave);
      sessionStorage.removeItem(clave);
    } catch {
      /* modo privado sin storage: no había nada que borrar */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* "Recordar usuario y contraseña"                                             */
/* -------------------------------------------------------------------------- */

/**
 * Credenciales recordadas para precargar el login.
 *
 * ## LA CONTRASEÑA ACÁ QUEDA EN TEXTO PLANO
 *
 * En `localStorage`, legible desde la consola del navegador (F12 → Application →
 * Local Storage) y alcanzable por cualquier XSS que llegue al sitio. **Es una
 * decisión tomada a conciencia**, pedida explícitamente el 31/07/2026, no un
 * descuido: no la "arregles" borrando esto sin hablarlo.
 *
 * Vale igual en la web y en el APK. Hubo una versión con biometría en la que el
 * APK guardaba la contraseña en el Keystore de Android, cifrada por hardware; eso
 * **se quitó entero** (ver `APK.md`), así que hoy no hay ningún entorno con
 * almacenamiento seguro y el comportamiento es uno solo.
 *
 * Se mitiga por dos lados:
 *
 * 1. **Es opt-in.** Solo se guarda si el usuario tilda el check.
 * 2. **La UI lo dice.** El login muestra una advertencia mientras el check está
 *    tildado, para que nadie lo active en un equipo compartido sin saber lo que
 *    implica.
 *
 * El TOKEN sigue sin escribirse en el disco: lo que se guarda es la contraseña
 * para rehacer el login, nunca la sesión.
 */
const CLAVE_USUARIO = "ethos-usuario";
const CLAVE_PASSWORD = "ethos-password";

/** El usuario recordado, o `""` si no hay o no se puede leer el storage. */
export function getUsuarioRecordado(): string {
  if (typeof window === "undefined") return ""; // SSR: no hay storage
  try {
    return localStorage.getItem(CLAVE_USUARIO) ?? "";
  } catch {
    return ""; // modo privado sin storage
  }
}

/** La contraseña recordada, o `""`. */
export function getPasswordRecordada(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CLAVE_PASSWORD) ?? "";
  } catch {
    return "";
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

/**
 * Guarda la contraseña **en texto plano**, o la borra con `""`.
 *
 * Llamar SIEMPRE después de un login aceptado por el backend, nunca al tildar el
 * check: una contraseña mal escrita quedaría guardada y volvería a precargarse
 * mal en cada arranque.
 */
export function setPasswordRecordada(password: string) {
  if (typeof window === "undefined") return;
  try {
    if (password) localStorage.setItem(CLAVE_PASSWORD, password);
    else localStorage.removeItem(CLAVE_PASSWORD);
  } catch {
    /* modo privado sin storage */
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

/*
 * Acá vivía `CredencialRechazada`, que distinguía "el backend dijo que no" de
 * "el backend falló". La consumía solo el login biométrico, para decidir si
 * borrar la contraseña del Keystore, y se fue con él el 31/07/2026.
 *
 * Si algún día hay que reponerla —por ejemplo para invalidar la contraseña
 * recordada cuando el usuario la cambia desde otro lado— el criterio era:
 * `res.status >= 500` es fallo del servidor y NO invalida nada; cualquier otro
 * rechazo sí. Confundirlos borra credenciales buenas cuando se cae Oracle.
 */

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
    throw new Error(String(json?.message ?? "Usuario o contraseña incorrectos"));
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
