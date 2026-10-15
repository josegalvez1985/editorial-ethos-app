/**
 * El asistente con IA (15/10/2026): un chat en un botón flotante, en todas las
 * pantallas. Contrato del backend: `backend/ia_asistente.sql`.
 *
 * La IA corre en Oracle (`PKG_IA_ETHOS`, que llama a la API de Claude): acá
 * solo se manda la pregunta con lo que el backend no sabe —la conversación, la
 * pantalla abierta y el manual— y se muestra la respuesta.
 *
 * - **Quién lo ve:** todos los que entran (Jose, 15/10/2026). No depende de
 *   Roles de páginas ni es una pantalla del menú; el gasto lo frena el límite
 *   de preguntas por día del backend.
 * - **La conversación vive solo en memoria y dura lo que la sesión**: va
 *   atada al token, así que recargar, salir o entrar con otro usuario la
 *   borra. Puede traer datos de cualquier tabla; no se escribe en el disco.
 * - **El manual es el README** (las secciones de las pantallas), importado como
 *   texto: así la IA sabe de cada pantalla nueva con el deploy, sin volver a
 *   correr el `.sql`. Se descarga recién al abrir el chat.
 */

import { useSyncExternalStore } from "react";

import { authFetch, getSesion } from "@/lib/api";

/** Una consulta SQL que corrió la IA para responder. */
export type ConsultaIA = {
  motivo: string;
  sql: string;
  /** Filas devueltas, o `null` si dio error. */
  filas: number | null;
  error: string | null;
};

export type MensajeIA = {
  id: string;
  rol: "usuario" | "asistente";
  texto: string;
  consultas?: ConsultaIA[];
  /** Un fallo (sin respuesta): no se le manda a la IA como historial. */
  error?: boolean;
};

type Estado = {
  /**
   * De qué sesión es: el token, que cambia en cada login. Con otro, la
   * conversación arranca de cero.
   */
  sesion: string;
  mensajes: MensajeIA[];
  /** Esperando la respuesta (puede tardar: la IA corre consultas). */
  pendiente: boolean;
  usadasHoy: number | null;
  limite: number | null;
  /**
   * El panel abierto. Acá y no en el componente: cada pantalla monta su
   * AppShell, y en la computadora el panel sigue abierto al navegar (para
   * preguntar por la pantalla nueva).
   */
  abierto: boolean;
};

const VACIO: Omit<Estado, "sesion"> = {
  mensajes: [],
  pendiente: false,
  usadasHoy: null,
  limite: null,
  abierto: false,
};

/* -------------------------------------------------------------------------- */
/* La conversación: un store de módulo                                         */
/* -------------------------------------------------------------------------- */

/*
 * De módulo y no en un componente: el chat sobrevive a la navegación (cada
 * pantalla monta su propio AppShell) y una respuesta que llega con el panel
 * cerrado no se pierde.
 */
let estado: Estado = { sesion: "", ...VACIO };
const oyentes = new Set<() => void>();

function fijar(parcial: Partial<Estado>) {
  estado = { ...estado, ...parcial };
  oyentes.forEach((f) => f());
}

const tokenActual = () => getSesion()?.token ?? "";

/** La conversación de esta sesión (la de una anterior, si quedó, se descarta). */
function actual(): Estado {
  const sesion = tokenActual();
  if (estado.sesion !== sesion) estado = { sesion, ...VACIO };
  return estado;
}

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

export function useAsistente() {
  return useSyncExternalStore(suscribir, actual, actual);
}

export function abrirAsistente(abierto: boolean) {
  actual();
  fijar({ abierto });
}

export function nuevaConversacion() {
  if (actual().pendiente) return;
  fijar({ mensajes: [] });
}

let secuencia = 0;
const nuevoId = () => `m${Date.now()}-${++secuencia}`;

/** Cuántos mensajes previos viajan como contexto (el backend corta en 12). */
const HISTORIAL = 12;

/**
 * Manda una pregunta y agrega la respuesta (o el error) a la conversación.
 * `pantalla`: la que está abierta, para "¿cómo uso esta pantalla?".
 */
export async function preguntar(texto: string, pantalla: string | null) {
  const pregunta = texto.trim();
  const previo = actual();
  if (!pregunta || previo.pendiente) return;

  const historial = previo.mensajes
    .filter((m) => !m.error)
    .slice(-HISTORIAL)
    .map((m) => ({ rol: m.rol, texto: m.texto }));

  fijar({
    mensajes: [...previo.mensajes, { id: nuevoId(), rol: "usuario", texto: pregunta }],
    pendiente: true,
  });

  try {
    const r = (await authFetch("ia/preguntar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pregunta,
        historial,
        manual: await cargarManual(),
        pantalla,
        nombre: getSesion()?.nombre ?? "",
      }),
    })) as {
      respuesta?: string;
      consultas?: Record<string, unknown>[];
      usadas_hoy?: number;
      limite?: number;
    };
    agregar({
      id: nuevoId(),
      rol: "asistente",
      texto: String(r.respuesta ?? ""),
      consultas: (r.consultas ?? []).map((c) => ({
        motivo: String(c.motivo ?? ""),
        sql: String(c.sql ?? ""),
        filas: c.filas == null ? null : Number(c.filas),
        error: c.error == null ? null : String(c.error),
      })),
    });
    fijar({ usadasHoy: r.usadas_hoy ?? null, limite: r.limite ?? null });
  } catch (e) {
    agregar({
      id: nuevoId(),
      rol: "asistente",
      texto: e instanceof Error ? e.message : "No se pudo obtener la respuesta.",
      error: true,
    });
  } finally {
    fijar({ pendiente: false });
  }
}

/** Agrega al final, salvo que la sesión haya cambiado mientras se esperaba. */
function agregar(m: MensajeIA) {
  if (estado.sesion !== tokenActual()) return;
  fijar({ mensajes: [...estado.mensajes, m] });
}

/** Vuelve a mandar la última pregunta que falló. */
export function reintentar(pantalla: string | null) {
  const { mensajes, pendiente } = actual();
  const ultimo = mensajes[mensajes.length - 1];
  const pregunta = mensajes[mensajes.length - 2];
  if (pendiente || !ultimo?.error || pregunta?.rol !== "usuario") return;
  fijar({ mensajes: mensajes.slice(0, -2) });
  void preguntar(pregunta.texto, pantalla);
}

/* -------------------------------------------------------------------------- */
/* El manual                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Lo básico de usar el sistema que el README no dice (o dice para el
 * programador). Va antes de las secciones del README.
 */
const GUIA_BASICA = `## Lo básico

- Se entra con el usuario y la contraseña del sistema. El check "Recordar usuario y contraseña" deja la contraseña guardada en ese equipo: no conviene en una computadora compartida.
- La sesión dura 6 horas. Recargar la página o cerrar la app cierra la sesión y hay que volver a entrar.
- En el celular (y en la app de Android, que es el mismo sitio) la barra de abajo tiene Inicio, Menú (todas las pantallas, agrupadas por menú principal: tocá uno para abrirlo), Perfil (Mi cuenta: tema, color y cerrar sesión) y Salir.
- En la computadora el menú está a la izquierda, agrupado por menú principal.
- Cada usuario ve solo las pantallas que tiene habilitadas. Si falta una, hay que pedírsela a quien administra los permisos (Administrador → Roles de páginas).
- Este asistente se abre con el botón redondo de abajo a la derecha; recuerda la conversación hasta que se recarga la página.`;

/** Desde el título `desde` hasta antes de `hasta` (o el final). */
function seccion(md: string, desde: string, hasta?: string) {
  const i = md.indexOf(desde);
  if (i < 0) return "";
  const j = hasta ? md.indexOf(hasta, i + desde.length) : -1;
  return md.slice(i, j < 0 ? undefined : j).trim();
}

/**
 * Las secciones del README que describen el menú, los permisos, cada
 * pantalla y la sesión. Si un título cambia, esa sección falta (la IA dice
 * que no sabe) pero nada se rompe: revisar estos títulos al reordenar el
 * README.
 */
function armarManual(md: string) {
  return [
    GUIA_BASICA,
    seccion(md, "## Módulos y menú", "### Sumar un módulo"),
    seccion(md, "### Cómo se ve el menú", "### Reportes: siempre con Excel"),
    seccion(md, "## Sesión y datos en el dispositivo", "## ¿Hay que repartir"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

let manual: Promise<string> | null = null;

/**
 * El manual, una vez por carga del sitio. Import dinámico: el README (unos
 * 70 KB) no pesa en el bundle de nadie que no abra el chat.
 */
export function cargarManual(): Promise<string> {
  manual ??= import("../../README.md?raw")
    .then((m) => armarManual(m.default))
    .catch(() => GUIA_BASICA);
  return manual;
}
