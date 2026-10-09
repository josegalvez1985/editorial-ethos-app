/**
 * Postulaciones de una institución (`POSTULACIONES`). Contrato del backend:
 * `backend/postulaciones.sql`.
 *
 * Es el modal 38 de APEX (Datos) y la página 60 (Consulta de Postulaciones,
 * con su PDF e imagen), para UNA institución: la pestaña Postulaciones de
 * `/instituciones/$id`. Hoy las crea el trigger al confirmar un pre-horario
 * (ver `lib/pre-horarios.ts`); acá se miran en la misma grilla editable de la
 * 38, se corrigen, se agregan, se borran y se imprimen.
 *
 * También viven acá las listas FIJAS que comparten las dos pestañas y el
 * formulario: grados, días y manuales. En APEX eran listas estáticas del IG
 * de la página 43 (no compartidas), y el backend las valida igual
 * (`pre_horarios.sql`).
 */

import type { CSSProperties } from "react";

import { authFetch } from "@/lib/api";
import type { ValorLista } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Listas fijas                                                               */
/* -------------------------------------------------------------------------- */

/** Los grados, en el orden de las columnas de POSTULACIONES ("2" … "3M"). */
export const GRADOS = [
  { valor: "2", corto: "2°", clave: "g2" },
  { valor: "3", corto: "3°", clave: "g3" },
  { valor: "4", corto: "4°", clave: "g4" },
  { valor: "5", corto: "5°", clave: "g5" },
  { valor: "6", corto: "6°", clave: "g6" },
  { valor: "7", corto: "7°", clave: "g7" },
  { valor: "8", corto: "8°", clave: "g8" },
  { valor: "9", corto: "9°", clave: "g9" },
  { valor: "1M", corto: "1°M", clave: "g1m" },
  { valor: "2M", corto: "2°M", clave: "g2m" },
  { valor: "3M", corto: "3°M", clave: "g3m" },
] as const;
export type ClaveGrado = (typeof GRADOS)[number]["clave"];

/**
 * Los siete manuales, con los colores de sus columnas en APEX (las clases
 * rojo, verde, violeta, gris, amarillo, azul y rojo del IG) y del formulario
 * impreso. Ser y Liderazgo comparten el rojo, como en APEX. La letra (`tinta`)
 * va oscura sobre los claros (Tener, Carácter, Visión), como en el formulario.
 */
export const MANUALES = [
  { valor: "SER", nombre: "Ser", corto: "SER", clave: "ser", color: "#e74c3c", tinta: "#ffffff" },
  {
    valor: "HACER",
    nombre: "Hacer",
    corto: "HAC",
    clave: "hacer",
    color: "#27ae60",
    tinta: "#ffffff",
  },
  {
    valor: "TENER",
    nombre: "Tener",
    corto: "TEN",
    clave: "tener",
    color: "#c39bd3",
    tinta: "#2b1d33",
  },
  {
    valor: "CARACTER",
    nombre: "Carácter",
    corto: "CAR",
    clave: "caracter",
    color: "#a6a6a6",
    tinta: "#1f1f1f",
  },
  {
    valor: "VISION",
    nombre: "Visión",
    corto: "VIS",
    clave: "vision",
    color: "#ffe45c",
    tinta: "#3d3400",
  },
  {
    valor: "CORAJE",
    nombre: "Coraje",
    corto: "COR",
    clave: "coraje",
    color: "#3498db",
    tinta: "#ffffff",
  },
  {
    valor: "LIDERAZGO",
    nombre: "Liderazgo",
    corto: "LID",
    clave: "liderazgo",
    color: "#e74c3c",
    tinta: "#ffffff",
  },
] as const;
export type ClaveManual = (typeof MANUALES)[number]["clave"];

/** Los días, como los guarda PRE_HORARIOS.DIA y como se llaman las columnas. */
export const DIAS = [
  { valor: "LUNES", nombre: "Lunes", corto: "Lun", impreso: "LUNES", clave: "lunes" },
  { valor: "MARTES", nombre: "Martes", corto: "Mar", impreso: "MARTES", clave: "martes" },
  { valor: "MIERCOLES", nombre: "Miércoles", corto: "Mié", impreso: "MIÉRC.", clave: "miercoles" },
  { valor: "JUEVES", nombre: "Jueves", corto: "Jue", impreso: "JUEVES", clave: "jueves" },
  { valor: "VIERNES", nombre: "Viernes", corto: "Vie", impreso: "VIERNES", clave: "viernes" },
] as const;
export type ClaveDia = (typeof DIAS)[number]["clave"];

export const manualDe = (valor: string) => MANUALES.find((m) => m.valor === valor);
export const gradoDe = (valor: string) => GRADOS.find((g) => g.valor === valor);
export const diaDe = (valor: string) => DIAS.find((d) => d.valor === valor);

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type Franja = { desde: string; hasta: string };

/** Lo que tienen en común una postulación de la lista y una fila del formulario. */
export type Detalle = {
  id: number;
  turno: number | null;
  seccion: string;
  grados: Record<ClaveGrado, number>;
  manuales: Record<ClaveManual, number>;
  dias: Record<ClaveDia, Franja>;
  materia: string;
  docente: string;
  telefono: string;
  enfasis: string;
};

export type Postulacion = Detalle & {
  idPreHorario: number | null;
  idMateria: number | null;
  idDocente: number | null;
  idFacilitador: number | null;
  facilitador: string;
  idEnfasis: number | null;
  observacion: string;
  estado: string;
  obsEstado: string;
  anio: string;
  /** Intervenciones y evaluaciones que la usan. */
  usos: number;
  /** Lo que no está 'Inactivo' (criterio de la página 60). */
  activa: boolean;
};

export type ListaPostulaciones = {
  anio: string;
  anioActual: string;
  /** Los años que tiene la institución, del más nuevo al más viejo. */
  anios: string[];
  items: Postulacion[];
};

/** Lo que imprime el "Formulario N° 1" (el proceso DATOS de la página 60). */
export type Formulario = {
  anio: string;
  nombre: string;
  direccion: string;
  departamento: string;
  ciudad: string;
  barrio: string;
  autoridades: { cargo: string; nombre: string; ci: string; telefono: string }[];
  detalle: (Detalle & { nroItem: number })[];
  horarios: {
    turno: number | null;
    inicio: string;
    fin: string;
    total: string;
    observacion: string;
  }[];
};

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

function aDetalle(x: Record<string, unknown>): Detalle {
  return {
    id: Number(x.id),
    turno: n(x.turno),
    seccion: s(x.seccion),
    grados: Object.fromEntries(GRADOS.map((g) => [g.clave, num(x[g.clave])])) as Record<
      ClaveGrado,
      number
    >,
    manuales: Object.fromEntries(MANUALES.map((m) => [m.clave, num(x[m.clave])])) as Record<
      ClaveManual,
      number
    >,
    dias: Object.fromEntries(
      DIAS.map((d) => [
        d.clave,
        { desde: s(x[`${d.clave}_desde`]), hasta: s(x[`${d.clave}_hasta`]) },
      ]),
    ) as Record<ClaveDia, Franja>,
    materia: s(x.materia),
    docente: s(x.docente),
    telefono: s(x.telefono),
    enfasis: s(x.enfasis),
  };
}

export async function listarPostulaciones(
  idInstitucion: number,
  anio?: string,
): Promise<ListaPostulaciones> {
  const q = `id_institucion=${idInstitucion}${anio ? `&anio=${encodeURIComponent(anio)}` : ""}`;
  const r = (await authFetch(`postulaciones?${q}`)) as {
    anio?: unknown;
    anio_actual?: unknown;
    anios?: unknown[];
    data?: Record<string, unknown>[];
  };
  return {
    anio: s(r.anio),
    anioActual: s(r.anio_actual),
    anios: (r.anios ?? []).map(String),
    items: (r.data ?? []).map(aPostulacion),
  };
}

function aPostulacion(x: Record<string, unknown>): Postulacion {
  return {
    ...aDetalle(x),
    idPreHorario: n(x.id_pre_horario),
    idMateria: n(x.id_materia),
    idDocente: n(x.id_docente),
    idFacilitador: n(x.id_facilitador),
    facilitador: s(x.facilitador),
    idEnfasis: n(x.id_enfasis),
    observacion: s(x.observacion),
    estado: s(x.estado),
    obsEstado: s(x.obs_estado),
    anio: s(x.anio),
    usos: num(x.usos),
    activa: s(x.estado) !== "Inactivo",
  };
}

/* -------------------------------------------------------------------------- */
/* La página 20: todas las instituciones                                      */
/* -------------------------------------------------------------------------- */

/** Una fila de la página 20: la postulación con su institución. */
export type PostulacionFila = Postulacion & { idInstitucion: number; institucion: string };

/** Los filtros de la región "Parámetros" de la 20. `null` = todos. */
export type FiltrosPostulaciones = {
  anio: string;
  idDepartamento: number | null;
  idCiudad: number | null;
  idBarrio: number | null;
  idInstitucion: number | null;
  turno: number | null;
};

/** El IG de la página 20: las de un año (vacío = el lectivo actual) con los filtros. */
export async function listarTodasPostulaciones(f: FiltrosPostulaciones): Promise<{
  anio: string;
  anioActual: string;
  anios: string[];
  items: PostulacionFila[];
}> {
  const q = new URLSearchParams();
  if (f.anio) q.set("anio", f.anio);
  if (f.idDepartamento != null) q.set("id_departamento", String(f.idDepartamento));
  if (f.idCiudad != null) q.set("id_ciudad", String(f.idCiudad));
  if (f.idBarrio != null) q.set("id_barrio", String(f.idBarrio));
  if (f.idInstitucion != null) q.set("id_institucion", String(f.idInstitucion));
  if (f.turno != null) q.set("turno", String(f.turno));
  const r = (await authFetch(`postulaciones/todas?${q}`)) as {
    anio?: unknown;
    anio_actual?: unknown;
    anios?: unknown[];
    data?: Record<string, unknown>[];
  };
  return {
    anio: s(r.anio),
    anioActual: s(r.anio_actual),
    anios: (r.anios ?? []).map(String),
    items: (r.data ?? []).map((x) => ({
      ...aPostulacion(x),
      idInstitucion: Number(x.id_institucion),
      institucion: s(x.institucion),
    })),
  };
}

/** El botón Generar de la 20: 8 postulaciones vacías para la institución. */
export async function generarPostulaciones(
  idInstitucion: number,
  turno: number | null,
): Promise<number> {
  const r = (await authFetch("postulaciones/generar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_institucion: idInstitucion, turno }),
  })) as { generadas?: number };
  return Number(r.generadas ?? 0);
}

/**
 * El botón Eliminar de la 20: las de la institución en ese año (y turno). Las
 * que tienen intervenciones o evaluaciones se saltean.
 */
export async function eliminarPostulacionesLote(
  idInstitucion: number,
  turno: number | null,
  anio: string,
): Promise<{ eliminadas: number; salteadas: number }> {
  const r = (await authFetch("postulaciones/eliminar-lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_institucion: idInstitucion, turno, anio }),
  })) as { eliminadas?: number; salteadas?: number };
  return { eliminadas: Number(r.eliminadas ?? 0), salteadas: Number(r.salteadas ?? 0) };
}

/** Los estados (Activo / Inactivo) de la lista de APEX. */
export async function opcionesPostulacion(): Promise<{ estado: ValorLista[] }> {
  const r = (await authFetch("postulaciones/opciones")) as { estado?: Record<string, unknown>[] };
  return {
    estado: (r.estado ?? []).map((o) => ({
      valor: s(o.valor),
      mostrar: s(o.mostrar) || s(o.valor),
    })),
  };
}

/**
 * Alta (`id` null) o modificación de una fila de la grilla, como el IG de la
 * página 38. `fila` va con las claves del backend (`turno`, `g2` … `g3m`,
 * `ser` … `liderazgo`, `lunes_desde` …, `observacion`, `id_materia`,
 * `id_docente`, `id_facilitador`, `id_enfasis`, `estado`, `obs_estado`), todas
 * como texto. Viaja entera en `datos` porque ORDS bindea solo campos sueltos.
 * Devuelve el id.
 */
export async function guardarPostulacion(
  id: number | null,
  idInstitucion: number,
  fila: Record<string, string>,
): Promise<number> {
  const r = (await authFetch(id == null ? "postulaciones" : `postulaciones/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      datos: JSON.stringify({ ...fila, id_institucion: String(idInstitucion) }),
    }),
  })) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

/** Baja. 409 si tiene intervenciones o evaluaciones. */
export async function eliminarPostulacion(id: number): Promise<void> {
  await authFetch(`postulaciones/${id}`, { method: "DELETE" });
}

export async function obtenerFormulario(idInstitucion: number, anio: string): Promise<Formulario> {
  const r = (await authFetch(
    `postulaciones/formulario?id_institucion=${idInstitucion}&anio=${encodeURIComponent(anio)}`,
  )) as Record<string, unknown>;
  const lista = (k: string) => (r[k] as Record<string, unknown>[] | undefined) ?? [];
  return {
    anio: s(r.anio),
    nombre: s(r.nombre),
    direccion: s(r.direccion),
    departamento: s(r.departamento),
    ciudad: s(r.ciudad),
    barrio: s(r.barrio),
    autoridades: lista("autoridades").map((a) => ({
      cargo: s(a.cargo),
      nombre: s(a.nombre),
      ci: s(a.ci),
      telefono: s(a.telefono),
    })),
    detalle: lista("detalle").map((x) => ({ ...aDetalle(x), nroItem: num(x.nro_item) })),
    horarios: lista("horarios").map((h) => ({
      turno: n(h.turno),
      inicio: s(h.hora_inicio),
      fin: s(h.hora_fin),
      total: s(h.total),
      observacion: s(h.observacion),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Cuentas                                                                    */
/* -------------------------------------------------------------------------- */

export const sumaGrados = (d: Pick<Detalle, "grados">) =>
  GRADOS.reduce((acc, g) => acc + d.grados[g.clave], 0);

export const sumaManuales = (d: Pick<Detalle, "manuales">) =>
  MANUALES.reduce((acc, m) => acc + d.manuales[m.clave], 0);

/** Los días con horario, en orden: "Lun 07:20–08:00". */
export const franjas = (d: Pick<Detalle, "dias">) =>
  DIAS.filter((x) => d.dias[x.clave].desde || d.dias[x.clave].hasta).map((x) => ({
    dia: x,
    ...d.dias[x.clave],
  }));

/** 'HH:MM' → minutos, o `null`. */
const aMin = (h: string) => {
  const m = h.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * La duración de la clase, "0:40": la del primer día con las dos horas. Es la
 * columna "Dur." del formulario; una postulación sale de UN pre-horario, que
 * es un día.
 */
export function duracion(d: Pick<Detalle, "dias">): string {
  for (const f of franjas(d)) {
    const a = aMin(f.desde);
    const b = aMin(f.hasta);
    if (a != null && b != null && b > a) {
      const m = b - a;
      return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    }
  }
  return "";
}

export const keysPostulaciones = {
  todo: ["postulaciones"] as const,
  institucion: (id: number, anio: string) => ["postulaciones", id, anio] as const,
  todas: (f: FiltrosPostulaciones) => ["postulaciones", "todas", f] as const,
  opciones: ["postulaciones", "opciones"] as const,
};

/**
 * Los colores de APEX (el CSS en línea de las páginas 20 y 22), con la letra
 * oscura para que se lean igual en el tema oscuro.
 */
export const COLORES_APEX = {
  filtro: { backgroundColor: "#aed6f1", color: "#0f172a" },
  ubicacion: { backgroundColor: "#d1f2eb", color: "#0f172a" },
  grado: { backgroundColor: "#d4e6f1", color: "#0f172a" },
  dia: { backgroundColor: "#e8daef", color: "#0f172a" },
  docente: { backgroundColor: "#d5d8dc", color: "#0f172a" },
  observacion: { backgroundColor: "#f2d7d5", color: "#0f172a" },
  facilitador: { backgroundColor: "#2e86c1", color: "#ffffff" },
} satisfies Record<string, CSSProperties>;
