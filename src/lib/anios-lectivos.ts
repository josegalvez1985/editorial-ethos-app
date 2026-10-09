/**
 * Años lectivos (`ANIOS_LECTIVOS`). Contrato del backend:
 * `backend/anios_lectivos.sql` (la tabla, `FN_ANIO_LECTIVO_ACTUAL()` y, desde
 * el 09/10/2026, el ABM de `PKG_ANIOS_LECTIVOS_ETHOS`).
 *
 * Reemplaza a la página 57 de APEX (el IG) y a su modal 59 (Crea Año Lectivo),
 * que en el sitio es el diálogo de `/anios-lectivos`.
 *
 * **El vigente es el de ESTADO 'A'** y hay uno solo: guardar otro como activo
 * desactiva al anterior en el backend, en la misma transacción. De ese año
 * cuelgan los combos de evaluaciones y "el año actual" de horarios,
 * pre-horarios y postulaciones.
 */

import { authFetch } from "@/lib/api";
import type { Uso } from "@/lib/facilitadores";

export type AnioLectivo = {
  id: number;
  anio: number;
  descripcion: string;
  estado: string;
  vigente: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  hasta: string;
  /** Las tablas con datos de ese año (postulaciones, pre-horarios, horarios…). */
  usos: Uso[];
};

export type DatosAnioLectivo = {
  anio: number;
  descripcion: string;
  /** 'A' (vigente) o 'I'. */
  estado: "A" | "I";
  fecha_desde: string;
  fecha_hasta: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarAniosLectivos(): Promise<AnioLectivo[]> {
  const r = (await authFetch("anios-lectivos")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_anio),
    anio: Number(x.anio),
    descripcion: s(x.descripcion),
    estado: s(x.estado),
    vigente: x.es_vigente === "S",
    desde: s(x.fecha_desde),
    hasta: s(x.fecha_hasta),
    usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
      tabla: s(u.tabla),
      cantidad: Number(u.cantidad ?? 0),
    })),
  }));
}

/**
 * Alta (`id` null) o modificación. Devuelve el id y, si se guardó como
 * vigente, el año que dejó de serlo.
 */
export async function guardarAnioLectivo(
  id: number | null,
  d: DatosAnioLectivo,
): Promise<{ id: number; desactivado: number | null }> {
  const r = (await authFetch(id == null ? "anios-lectivos" : `anios-lectivos/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_anio?: number; desactivado?: number | null };
  return {
    id: Number(r.id_anio ?? id ?? 0),
    desactivado: r.desactivado == null ? null : Number(r.desactivado),
  };
}

/** Baja. 409 si es el vigente o si tiene datos. */
export async function eliminarAnioLectivo(id: number): Promise<void> {
  await authFetch(`anios-lectivos/${id}`, { method: "DELETE" });
}

export const keysAniosLectivos = {
  todo: ["anios-lectivos"] as const,
};
