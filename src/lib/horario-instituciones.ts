/**
 * El horario de cada institución, por año (`HORARIO_INSTITUCIONES`). Contrato
 * del backend: `backend/horario_instituciones.sql`.
 *
 * Es el modal 33 de APEX (Horarios, el botón "Horario IE" del 21); en el sitio,
 * la pestaña Horario de `/instituciones/$id` (ver `<HorarioInstitucion>`). La
 * página 31 (Horarios de Instituciones) es de esta misma tabla.
 *
 * Las horas viajan como 'HH:MM' (24 h). El total ('HH:MM') lo calcula el
 * backend al guardar; acá se calcula solo para mostrarlo mientras se edita.
 */

import { authFetch } from "@/lib/api";
import type { ValorLista } from "@/lib/utils";

export type BloqueHorario = {
  id: number;
  idInstitucion: number;
  /** 1 mañana, 2 tarde, 3 noche: el dominio de POSTULACIONES.TURNO. */
  turno: number;
  inicio: string;
  fin: string;
  total: string;
  observacion: string;
  /** Vacío: bloques viejos sin año. */
  anio: string;
};

export type HorarioInstitucion = {
  /** El año lectivo activo. Vacío si no hay ninguno. */
  anioActual: string;
  /** De TODOS los años, ordenados por año, turno y hora. */
  bloques: BloqueHorario[];
};

export type OpcionesHorario = {
  anioActual: string;
  /** La lista de turnos de APEX: `valor` es el número como texto ("1"). */
  turno: ValorLista[];
};

export type DatosBloque = {
  turno: number;
  inicio: string;
  fin: string;
  observacion: string;
  /**
   * El año del bloque. `null` en un alta = el lectivo actual (lo pone el
   * trigger); en una modificación = no cambiarlo.
   */
  anio: string | null;
};

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarHorario(idInstitucion: number): Promise<HorarioInstitucion> {
  const r = (await authFetch(`horario-instituciones?id_institucion=${idInstitucion}`)) as {
    anio_actual?: unknown;
    data?: Record<string, unknown>[];
  };
  return {
    anioActual: s(r.anio_actual),
    bloques: (r.data ?? []).map((x) => ({
      id: Number(x.id),
      idInstitucion: Number(x.id_institucion),
      turno: Number(x.turno),
      inicio: s(x.hora_inicio),
      fin: s(x.hora_fin),
      total: s(x.total),
      observacion: s(x.observacion),
      anio: s(x.anio),
    })),
  };
}

export async function opcionesHorario(): Promise<OpcionesHorario> {
  const r = (await authFetch("horario-instituciones/opciones")) as Record<string, unknown>;
  return {
    anioActual: s(r.anio_actual),
    turno: ((r.turno as Record<string, unknown>[] | undefined) ?? []).map((o) => ({
      valor: s(o.valor),
      mostrar: s(o.mostrar) || s(o.valor),
    })),
  };
}

/** Alta (`id` null) o modificación de un bloque. Devuelve el id. */
export async function guardarBloque(
  id: number | null,
  idInstitucion: number,
  d: DatosBloque,
): Promise<number> {
  const r = (await authFetch(id == null ? "horario-instituciones" : `horario-instituciones/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_institucion: idInstitucion,
      turno: d.turno,
      hora_inicio: d.inicio,
      hora_fin: d.fin,
      observacion: d.observacion,
      anio: d.anio,
    }),
  })) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

export async function eliminarBloque(id: number): Promise<void> {
  await authFetch(`horario-instituciones/${id}`, { method: "DELETE" });
}

/**
 * Copia los bloques del año `desde` ("" = los sin año) al año lectivo actual.
 * El backend se niega si el actual ya tiene bloques. Devuelve cuántos copió.
 */
export async function copiarHorario(idInstitucion: number, desde: string): Promise<number> {
  const r = (await authFetch("horario-instituciones/copiar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_institucion: idInstitucion, desde: desde || null }),
  })) as { copiados?: number };
  return Number(r.copiados ?? 0);
}

/** 'HH:MM' → minutos desde las 00:00, o `null` si no es una hora. */
export function minutos(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutos → 'HH:MM', sin pasar de las 23:59. */
export function aHora(min: number): string {
  const t = Math.max(0, Math.min(min, 23 * 60 + 59));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** "40 min", "1 h", "1 h 20 min". */
export function textoDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const keysHorario = {
  todo: ["horario-instituciones"] as const,
  institucion: (id: number) => ["horario-instituciones", id] as const,
  opciones: ["horario-instituciones", "opciones"] as const,
};
