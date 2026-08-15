/**
 * Agendas: el horario semanal de los facilitadores. **Solo lectura.**
 *
 * Contrato del backend: `backend/agendas.sql`.
 *
 * ============================================================================
 * QUÉ REEMPLAZA
 * ============================================================================
 *
 * La página 30 ("Agendas") de la app APEX, que era un *faceted search* sobre
 * `V_AGENDA` con una tabla de 17 columnas. Acá los filtros son modales y cada
 * fila es una tarjeta: la tabla de APEX en un teléfono no se puede leer.
 *
 * El WHERE del reporte original se conserva tal cual —`nvl(estado,'Activo') <>
 * 'Inactivo'`—, así que **una fila sin estado cuenta como activa**. Lo único que
 * este módulo agrega es poder pedir también las inactivas (`estado: "TODOS"`).
 *
 * ============================================================================
 * EL BACKEND YA DESARMÓ LOS DÍAS
 * ============================================================================
 *
 * En `V_AGENDA` cada día es UN string con las dos horas: `"06:40, 07:20"`, y
 * **`","` cuando no hay clase** — no `null`, no `""`. Es la trampa de esa vista:
 * un `if (fila.lunes)` da verdadero para los cinco días de todas las filas.
 *
 * Nada de eso llega hasta acá. El backend devuelve `lunes_desde` /`lunes_hasta`
 * ya separados y en `null` cuando no hay clase, más `dias` con los nombres de
 * los días que sí tienen. Este módulo no conoce el formato original y no debería
 * volver a conocerlo.
 *
 * ============================================================================
 * UNA FILA ES UN DÍA
 * ============================================================================
 *
 * Verificado sobre los datos (14/08/2026): cada fila trae un solo día con
 * horario. Por eso {@link diaDeAgenda} devuelve uno y la tarjeta muestra
 * "Lunes · 06:40 a 07:20".
 *
 * Pero **no se asume**: `dias` puede traer varios separados por coma y
 * {@link diasDeAgenda} los devuelve todos. Si algún día una fila trae dos, la UI
 * los muestra los dos en vez de perder uno en silencio.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Una fila de la agenda                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Los cinco días, en orden y **sin tilde**.
 *
 * Sin tilde porque es la clave con la que se arman los nombres de campo
 * (`miercoles_desde`) y con la que viaja el filtro al backend. El texto con
 * tilde que ve el usuario sale de {@link DIAS_LABEL}.
 */
export const DIAS = ["lunes", "martes", "miercoles", "jueves", "viernes"] as const;

export type Dia = (typeof DIAS)[number];

/** El nombre del día para mostrar. `miercoles` → `Miércoles`. */
export const DIAS_LABEL: Record<Dia, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
};

/**
 * El nombre del día como lo espera el backend: **sin tilde**.
 *
 * `"Miércoles"` → `"Miercoles"`. Es la única diferencia entre lo que se muestra
 * y lo que viaja, y existe porque la clave con la que compara el SQL no lleva
 * tilde. Se normaliza acá y no a mano en cada llamada para que no haya dos
 * grafías dando vueltas: mandar `"Miércoles"` no matchea ninguna fila y el
 * reporte sale vacío sin ningún error.
 */
export function sinTilde(dia: string): string {
  // `NFD` separa la letra de su tilde y `\p{Diacritic}` borra la marca suelta.
  // Con la clase Unicode y no con un rango de caracteres literales: esas marcas
  // son invisibles en el editor y cualquiera las rompería sin darse cuenta.
  return dia.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Las tres letras para la grilla semanal, donde no entra el nombre entero. */
export const DIAS_CORTO: Record<Dia, string> = {
  lunes: "Lun",
  martes: "Mar",
  miercoles: "Mié",
  jueves: "Jue",
  viernes: "Vie",
};

/**
 * Una fila de `V_AGENDA`: una postulación con su horario.
 *
 * Casi todo es opcional porque en la vista casi todo puede venir vacío. Los
 * `'-'` que usa la vista como marcador de "sin cargar" ya vienen convertidos a
 * `null` por el backend, así que acá un valor presente es un valor real.
 */
export type Agenda = {
  /** La PK de la postulación. Es lo único único de la fila. */
  id_postulacion: number;
  id_facilitador: number | null;
  nombre_facilitador: string | null;
  /** El usuario APEX del facilitador. Informativo. */
  usuario: string | null;
  id_institucion: number | null;
  nombre_institucion: string | null;
  /** 1/2/3 crudo. La etiqueta la pone `nombreTurno` de `lib/evaluaciones.ts`. */
  turno: number | null;
  grado: string | null;
  seccion: string | null;
  /** El docente del grado, no el facilitador. */
  nombre_profesor: string | null;
  id_enfasis: number | null;
  /** La vista ya lo resuelve ("BTC"). */
  enfasis: string | null;
  id_materia: number | null;
  /** Resuelta por el backend con un JOIN: la vista solo trae el id. */
  materia: string | null;
  manual: string | null;
  /** `'Activo'` / `'Inactivo'`, o `null` — que **cuenta como activo**. */
  estado: string | null;
  anio: string | null;
  /**
   * Dónde queda la institución. Vienen **por nombre**, no por id: la vista los
   * resuelve con un outer join y expone solo el nombre.
   *
   * `null` cuando la institución no los tiene cargados — el join es externo, así
   * que una institución sin ciudad sigue apareciendo en la agenda.
   */
  departamento: string | null;
  ciudad: string | null;
  /** Los días con clase, separados por coma y sin tilde: `"Lunes,Miercoles"`. */
  dias: string | null;
  lunes_desde: string | null;
  lunes_hasta: string | null;
  martes_desde: string | null;
  martes_hasta: string | null;
  miercoles_desde: string | null;
  miercoles_hasta: string | null;
  jueves_desde: string | null;
  jueves_hasta: string | null;
  viernes_desde: string | null;
  viernes_hasta: string | null;
};

/** El horario de un día: las dos horas, o `null` si ese día no hay clase. */
export type Horario = { desde: string; hasta: string | null };

/**
 * El horario de un día concreto de una fila.
 *
 * `null` = **no hay clase ese día**, que es distinto de "hay clase sin horario":
 * el backend ya descartó los `"00:00, 00:00"` de las filas viejas.
 *
 * `hasta` puede ser `null` con `desde` cargado (una fila con `"06:40,"`): ahí se
 * muestra solo la hora de inicio, que es mejor que inventar la de fin.
 */
export function horarioDe(a: Agenda, dia: Dia): Horario | null {
  const desde = a[`${dia}_desde`];
  if (!desde) return null;
  return { desde, hasta: a[`${dia}_hasta`] };
}

/**
 * Todos los días con clase de una fila, en orden de lunes a viernes.
 *
 * Se deriva de las horas y **no se parsea `dias`**: son la misma información y
 * las horas son las que la UI necesita igual. Leer el string separado por comas
 * obligaría a mapear de nuevo su texto sin tilde a las claves.
 */
export function diasDeAgenda(a: Agenda): { dia: Dia; horario: Horario }[] {
  const salida: { dia: Dia; horario: Horario }[] = [];
  for (const dia of DIAS) {
    const horario = horarioDe(a, dia);
    if (horario) salida.push({ dia, horario });
  }
  return salida;
}

/**
 * El día de la fila, que en los datos de hoy es siempre uno solo.
 *
 * `null` si la fila no tiene ningún horario cargado — pasa, y la UI la muestra
 * igual con "sin horario" en vez de esconderla: es una postulación real y
 * ocultarla haría que el total no cierre con lo que se ve.
 */
export function diaDeAgenda(a: Agenda): { dia: Dia; horario: Horario } | null {
  return diasDeAgenda(a)[0] ?? null;
}

/** `"06:40 a 07:20"`, o `"06:40"` si no hay hora de fin. */
export function formatearHorario(h: Horario | null): string {
  if (!h) return "Sin horario";
  return h.hasta ? `${h.desde} a ${h.hasta}` : h.desde;
}

/**
 * Los minutos que dura la clase, para ordenar o mostrar. `null` si falta alguna
 * de las dos horas.
 *
 * No usa `Date`: las horas son `HH:MM` sueltas, sin fecha, y construir un `Date`
 * para restarlas arrastraría la zona horaria del navegador a una cuenta que no
 * la necesita.
 */
export function duracionMinutos(h: Horario | null): number | null {
  if (!h?.hasta) return null;
  const [hd, md] = h.desde.split(":").map(Number);
  const [hh, mh] = h.hasta.split(":").map(Number);
  if ([hd, md, hh, mh].some(Number.isNaN)) return null;
  return hh * 60 + mh - (hd * 60 + md);
}

/* -------------------------------------------------------------------------- */
/* Los filtros                                                                */
/* -------------------------------------------------------------------------- */

export type FiltrosAgenda = {
  /** `"YYYY"`. Sin él, el año lectivo activo. `"TODOS"` lo apaga. */
  anio?: string;
  manual?: string;
  id_facilitador?: number | null;
  id_institucion?: number | null;
  turno?: number | null;
  /** El nombre del día **sin tilde**: `"Miercoles"`. Ver {@link DIAS}. */
  dia?: string;
  /** Por NOMBRE, no por id: la vista no expone las claves geográficas. */
  departamento?: string;
  ciudad?: string;
  /** Barre facilitador, institución, grado, docente, manual y ciudad. */
  buscar?: string;
  /** `"TODOS"` trae también las inactivas. Por defecto, solo las activas. */
  estado?: "TODOS";
  limite?: number;
  pagina?: number;
};

export type PaginaAgenda = {
  data: Agenda[];
  /** El total **sin paginar**: cuántas hay, no cuántas se muestran. */
  total: number;
  pagina: number;
  limite: number;
  /** El año contra el que se filtró de verdad. `null` = no se filtró. */
  anio: string | null;
};

/**
 * Las opciones de los combos: **los valores que existen en los datos**.
 *
 * Es lo que en APEX hacían las facetas, que se llenaban solas. Sin esto los
 * combos tendrían todos los facilitadores de la base, incluidos los que no
 * tienen ninguna agenda: elegir uno daría un reporte vacío.
 */
export type OpcionesAgenda = {
  anios: string[];
  /** Los días con al menos una clase, sin tilde: `["Lunes", "Martes"]`. */
  dias: string[];
  departamentos: string[];
  /** Ya recortadas por el departamento elegido: es la cascada geográfica. */
  ciudades: string[];
  /** Los turnos presentes, crudos (1/2/3). La etiqueta la pone `nombreTurno`. */
  turnos: number[];
  manuales: string[];
  facilitadores: { id: number; nombre: string }[];
  instituciones: { id: number; nombre: string }[];
};

/**
 * Los filtros que recortan los combos. **Es la cascada.**
 *
 * Elegido el martes, `facilitadores` trae solo a los que dan clase el martes.
 * Elegido además un facilitador, `instituciones` trae solo donde ese facilitador
 * da clase ese día.
 *
 * **Cada combo se excluye a sí mismo**, del lado del backend: el de
 * facilitadores no se filtra por `id_facilitador`. Si lo hiciera, al elegir uno
 * la lista quedaría con un solo elemento y no habría cómo cambiarlo sin limpiar
 * el filtro antes.
 */
export type FiltrosOpciones = {
  anio?: string;
  dia?: string;
  /**
   * El departamento **sí** recorta a `ciudades`, y esa es la única excepción a
   * la regla de "cada combo se excluye a sí mismo": la ciudad cuelga del
   * departamento, no al revés. Al contrario —filtrar `departamentos` por la
   * ciudad— dejaría un solo departamento y no habría cómo cambiarlo.
   */
  departamento?: string;
  ciudad?: string;
  turno?: number | null;
  id_facilitador?: number | null;
  id_institucion?: number | null;
  manual?: string;
};

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

/** Una fila cruda del backend, antes de normalizar. */
type FilaCruda = Record<string, unknown>;

const texto = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const numero = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

function normalizar(row: FilaCruda): Agenda {
  return {
    id_postulacion: Number(row.id_postulacion),
    id_facilitador: numero(row.id_facilitador),
    nombre_facilitador: texto(row.nombre_facilitador),
    usuario: texto(row.usuario),
    id_institucion: numero(row.id_institucion),
    nombre_institucion: texto(row.nombre_institucion),
    turno: numero(row.turno),
    grado: texto(row.grado),
    seccion: texto(row.seccion),
    nombre_profesor: texto(row.nombre_profesor),
    id_enfasis: numero(row.id_enfasis),
    enfasis: texto(row.enfasis),
    id_materia: numero(row.id_materia),
    materia: texto(row.materia),
    manual: texto(row.manual),
    estado: texto(row.estado),
    anio: texto(row.anio),
    departamento: texto(row.departamento),
    ciudad: texto(row.ciudad),
    dias: texto(row.dias),
    lunes_desde: texto(row.lunes_desde),
    lunes_hasta: texto(row.lunes_hasta),
    martes_desde: texto(row.martes_desde),
    martes_hasta: texto(row.martes_hasta),
    miercoles_desde: texto(row.miercoles_desde),
    miercoles_hasta: texto(row.miercoles_hasta),
    jueves_desde: texto(row.jueves_desde),
    jueves_hasta: texto(row.jueves_hasta),
    viernes_desde: texto(row.viernes_desde),
    viernes_hasta: texto(row.viernes_hasta),
  };
}

/** El reporte. Paginado: mirar `total` para saber si quedó algo afuera. */
export async function listarAgendas(f: FiltrosAgenda = {}): Promise<PaginaAgenda> {
  const r = (await authFetch(`agendas${qs({ ...f })}`)) as {
    data?: FilaCruda[];
    total?: number;
    pagina?: number;
    limite?: number;
    anio?: string | null;
  };

  return {
    data: (r.data ?? []).map(normalizar),
    total: Number(r.total ?? 0),
    pagina: Number(r.pagina ?? 1),
    limite: Number(r.limite ?? 100),
    anio: r.anio ?? null,
  };
}

/**
 * Las opciones de los combos, recortadas por los filtros ya elegidos.
 *
 * `anios` **no** se recorta por nada: es el filtro más externo de la pantalla, y
 * recortarlo con un día o un facilitador podría esconder un año entero porque el
 * facilitador elegido no daba clase en él.
 */
export async function opcionesAgenda(f: FiltrosOpciones = {}): Promise<OpcionesAgenda> {
  const r = (await authFetch(`agendas/filtros${qs({ ...f })}`)) as {
    anios?: unknown[];
    dias?: unknown[];
    departamentos?: unknown[];
    ciudades?: unknown[];
    turnos?: unknown[];
    manuales?: unknown[];
    facilitadores?: { id?: unknown; nombre?: unknown }[];
    instituciones?: { id?: unknown; nombre?: unknown }[];
  };

  const personas = (xs: { id?: unknown; nombre?: unknown }[] = []) =>
    xs
      .filter((x) => x?.id != null)
      .map((x) => ({ id: Number(x.id), nombre: String(x.nombre ?? `#${x.id}`) }));

  return {
    anios: (r.anios ?? []).filter(Boolean).map(String),
    dias: (r.dias ?? []).filter(Boolean).map(String),
    departamentos: (r.departamentos ?? []).filter(Boolean).map(String),
    ciudades: (r.ciudades ?? []).filter(Boolean).map(String),
    turnos: (r.turnos ?? []).filter((t) => t != null).map(Number),
    manuales: (r.manuales ?? []).filter(Boolean).map(String),
    facilitadores: personas(r.facilitadores),
    instituciones: personas(r.instituciones),
  };
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Query string sin claves vacías. Igual que en `lib/evaluaciones.ts`. */
function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

export const keysAgendas = {
  lista: (f: FiltrosAgenda = {}) => ["agendas", f] as const,
  /**
   * Los combos cambian poco, pero **la clave lleva los filtros**: con la
   * cascada, cada combinación devuelve opciones distintas. Sin ellos en la
   * clave, elegir un día serviría las opciones cacheadas del anterior.
   */
  opciones: (f: FiltrosOpciones = {}) => ["agendas-filtros", f] as const,
};

/** Las opciones casi no cambian: no vale re-pedirlas en cada apertura. */
export const STALE_OPCIONES = 5 * 60 * 1000;
