/**
 * Períodos de postulación (`PERIODOS_POSTULACION`, 24/11/2026). Contrato del
 * backend: `backend/periodos_postulacion.sql` (`PKG_PERIODOS_POST_ETHOS`).
 *
 * **Tabla compartida:** la usa también otra app sobre la misma base. El sitio
 * solo la lee y la edita por el paquete; no le cambia la estructura.
 *
 * Un período por año lectivo: desde qué día y hasta cuál se acepta postular,
 * más la habilitación extraordinaria (abierta aunque esté fuera de fecha, con
 * su motivo). El listado trae **todos los años lectivos**, tengan período o no.
 */

import { authFetch } from "@/lib/api";
import { diaISO, hoyISO } from "@/lib/fechas";

export type Periodo = {
  id: number;
  /** `YYYY-MM-DD`. */
  inicio: string;
  fin: string;
  extraordinaria: boolean;
  motivo: string;
};

/** Un año lectivo y su período, si tiene. */
export type AnioPeriodo = {
  idAnio: number;
  anio: number;
  descripcion: string;
  vigente: boolean;
  periodo: Periodo | null;
};

export type DatosPeriodo = {
  /** Solo en el alta: el año de un período no cambia. */
  id_anio?: number;
  fecha_inicio: string;
  fecha_fin: string;
  habilitacion_extraordinaria: "SI" | "NO";
  motivo_habilitacion: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarPeriodosPostulacion(): Promise<AnioPeriodo[]> {
  const r = (await authFetch("periodos-postulacion")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    idAnio: Number(x.id_anio),
    anio: Number(x.anio),
    descripcion: s(x.descripcion),
    vigente: x.es_vigente === "S",
    periodo:
      x.id == null
        ? null
        : {
            id: Number(x.id),
            inicio: s(x.fecha_inicio),
            fin: s(x.fecha_fin),
            extraordinaria: s(x.habilitacion_extraordinaria).toUpperCase() === "SI",
            motivo: s(x.motivo_habilitacion),
          },
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarPeriodoPostulacion(
  id: number | null,
  d: DatosPeriodo,
): Promise<number> {
  const r = (await authFetch(id == null ? "periodos-postulacion" : `periodos-postulacion/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

export async function eliminarPeriodoPostulacion(id: number): Promise<void> {
  await authFetch(`periodos-postulacion/${id}`, { method: "DELETE" });
}

export type EstadoPeriodo =
  | { tipo: "abierta"; quedan: number; pct: number }
  | { tipo: "extraordinaria" }
  | { tipo: "proxima"; faltan: number }
  | { tipo: "cerrada"; hace: number };

/**
 * Cómo está hoy: dentro del rango está abierta; fuera, la habilitación
 * extraordinaria la abre igual; si no, todavía no abrió o ya cerró.
 */
export function estadoPeriodo(p: Periodo, hoy = hoyISO()): EstadoPeriodo {
  const h = diaISO(hoy);
  const d = diaISO(p.inicio);
  const t = diaISO(p.fin);
  if (h >= d && h <= t) {
    const total = Math.max(1, t - d);
    return { tipo: "abierta", quedan: t - h, pct: Math.round(((h - d) / total) * 100) };
  }
  if (p.extraordinaria) return { tipo: "extraordinaria" };
  return h < d ? { tipo: "proxima", faltan: d - h } : { tipo: "cerrada", hace: h - t };
}

export const keysPeriodosPostulacion = {
  todo: ["periodos-postulacion"] as const,
};
