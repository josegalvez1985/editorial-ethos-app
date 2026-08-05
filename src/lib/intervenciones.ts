/**
 * Puntualidad de los facilitadores: a qué hora marcaron contra a qué hora
 * empezaba la clase.
 *
 * Contrato del backend: `backend/intervenciones.sql`.
 *
 * ============================================================================
 * QUÉ MIDE, EXACTAMENTE
 * ============================================================================
 *
 * `atraso` = hora en que marcó − hora en que empezaba la clase, en minutos.
 *
 * Tres cosas que decide el BACKEND y que no hay que rehacer acá:
 *
 * 1. **Los adelantos cuentan como cero.** Llegar 5 minutos antes no compensa
 *    llegar 5 tarde otro día: se mide atraso, no puntualidad neta.
 * 2. **El promedio se calcula por MARCACIÓN, no por grado.** Una marcación que
 *    cubre 7mo y 8vo es una sola llegada.
 * 3. **Las filas sin hora cargada se descartan**, no cuentan como 0. Un 0 diría
 *    "llegó puntual", que es una afirmación que el dato no respalda.
 *
 * ============================================================================
 * DOS ENDPOINTS, NO UNO
 * ============================================================================
 *
 * El resumen trae una fila por facilitador (para el gráfico) y el detalle trae
 * las marcaciones de uno solo (para el modal). Separados a propósito: el inicio
 * bajaría cientos de filas si el gráfico se armara agrupando el detalle en
 * memoria, y en el celular eso se nota.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Resumen: una fila por facilitador                                          */
/* -------------------------------------------------------------------------- */

/** Lo que dibuja una barra del gráfico. */
export type ResumenFacilitador = {
  id_facilitador: number;
  nombre_facilitador: string;
  /** Minutos de atraso promedio por marcación. Es el valor de la barra. */
  promedio: number;
  /** El peor atraso del período. Contexto para el tooltip. */
  peor: number;
  /** Cuántas llegadas se contaron. */
  marcaciones: number;
  /**
   * De esas, cuántas fueron tarde de verdad. Da contexto que el promedio solo
   * no da: 8 minutos con 2 atrasos sobre 20 clases no es lo mismo que 8 con 20.
   */
  con_atraso: number;
};

/**
 * El atraso promedio de cada facilitador, **ya ordenado de mayor a menor**.
 *
 * El orden lo hace Oracle, no el front: es parte de la respuesta y así el
 * gráfico no tiene que reordenar en cada render.
 *
 * @param anio  `"YYYY"`. Sin él, el año lectivo activo.
 * @param mes   1–12. Sin él, todo el año.
 */
export async function resumenPuntualidad(
  anio?: string,
  mes?: number,
): Promise<ResumenFacilitador[]> {
  const r = (await authFetch(`intervenciones/resumen${qs({ anio, mes })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_facilitador: Number(row.id_facilitador),
    nombre_facilitador: String(row.nombre_facilitador ?? ""),
    promedio: Number(row.promedio ?? 0),
    peor: Number(row.peor ?? 0),
    marcaciones: Number(row.marcaciones ?? 0),
    con_atraso: Number(row.con_atraso ?? 0),
  }));
}

/* -------------------------------------------------------------------------- */
/* Detalle: las marcaciones de un facilitador                                 */
/* -------------------------------------------------------------------------- */

/**
 * Una marcación: el facilitador llegó a una clase y registró la hora.
 *
 * Casi todo es opcional porque en la vista casi todo puede venir en null.
 */
export type Intervencion = {
  id_intervencion: number;
  fecha: string | null;
  /** `HH:MM`. La hora en que efectivamente marcó. */
  hora: string | null;
  /** `HH:MM`. La hora en que empezaba la clase. */
  hora_desde: string | null;
  hora_hasta: string | null;
  /**
   * Minutos de atraso. `null` si no se pudo calcular —falta una de las dos
   * horas—, y ahí la fila se muestra sin el dato en vez de fingir un 0.
   */
  atraso: number | null;
  id_institucion: number | null;
  institucion: string | null;
  /** 1/2/3 crudo, igual que en las postulaciones. */
  turno: number | null;
  /** Los grados de ESA marcación, juntos: "7mo, 8vo". Lo arma el backend. */
  grado: string | null;
  seccion: string | null;
  enfasis: string | null;
  manual: string | null;
  /** `'Si'` / `'No'`: si el índice se desarrolló. Texto libre en la base. */
  si_no: string | null;
  observacion: string | null;
  /** Obligatorio cuando `si_no` es 'No': por qué no se desarrolló. */
  motivo_desarrollo: string | null;
  mes: string | null;
  anio: string | null;
  /** Ya normalizadas con punto decimal por el backend. */
  latitud: string | null;
  longitud: string | null;
  ubicacion_institucion: string | null;
};

/**
 * Las marcaciones de UN facilitador, de la más reciente a la más vieja.
 *
 * `id_facilitador` es obligatorio en el backend (400 sin él): la llamada no debe
 * hacerse hasta tenerlo, y el `enabled` de la query es de quien la usa.
 */
export async function listarIntervenciones(
  id_facilitador: number,
  anio?: string,
  mes?: number,
): Promise<Intervencion[]> {
  const r = (await authFetch(`intervenciones${qs({ id_facilitador, anio, mes })}`)) as {
    data?: Record<string, unknown>[];
  };

  return (r.data ?? []).map((row) => ({
    id_intervencion: Number(row.id_intervencion),
    fecha: (row.fecha as string) ?? null,
    hora: (row.hora as string) ?? null,
    hora_desde: (row.hora_desde as string) ?? null,
    hora_hasta: (row.hora_hasta as string) ?? null,
    atraso: row.atraso == null ? null : Number(row.atraso),
    id_institucion: row.id_institucion == null ? null : Number(row.id_institucion),
    institucion: (row.institucion as string) ?? null,
    turno: row.turno == null ? null : Number(row.turno),
    grado: (row.grado as string) ?? null,
    seccion: (row.seccion as string) ?? null,
    enfasis: (row.enfasis as string) ?? null,
    manual: (row.manual as string) ?? null,
    si_no: (row.si_no as string) ?? null,
    observacion: (row.observacion as string) ?? null,
    motivo_desarrollo: (row.motivo_desarrollo as string) ?? null,
    mes: (row.mes as string) ?? null,
    anio: (row.anio as string) ?? null,
    latitud: (row.latitud as string) ?? null,
    longitud: (row.longitud as string) ?? null,
    ubicacion_institucion: (row.ubicacion_institucion as string) ?? null,
  }));
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

/**
 * Los meses, para el selector. El VALOR es el número —es lo único estable entre
 * idiomas—; el backend lo traduce al nombre que usa la vista.
 */
export const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Setiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

/** "8 min", "1 h 5 min". Los minutos sueltos se leen mal arriba de 60. */
export function formatearAtraso(minutos: number | null): string {
  if (minutos === null) return "—";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const keysIntervenciones = {
  resumen: (anio: string, mes: number) => ["puntualidad", anio, mes] as const,
  detalle: (id: number, anio: string, mes: number) => ["intervenciones", id, anio, mes] as const,
};
