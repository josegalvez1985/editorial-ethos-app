/**
 * Directores: las PERSONAS de `DIRECTORES` (nombre, teléfono, CI). Contrato del
 * backend: `backend/directores.sql`.
 *
 * Hoy lo usa la pestaña Autoridades de la ficha de Instituciones para elegir
 * al director y para darlo de alta ahí mismo (el modal 35 de APEX). La página
 * 34 (Directores) todavía no está en el sitio; cuando se haga, usa esto.
 *
 * No confundir con `listarDirectores` de `lib/evaluaciones.ts`: esa trae los
 * directores ACTIVOS de UNA institución, para la tarjeta del formulario de
 * evaluación.
 */

import { authFetch } from "@/lib/api";
import type { DatosPersona, Persona } from "@/lib/autoridades";

const s = (v: unknown) => (v == null ? "" : String(v));

/** Todos, para elegir. "Abm" para no chocar con `listarDirectores` de evaluaciones. */
export async function listarDirectoresAbm(): Promise<Persona[]> {
  const r = (await authFetch("directores")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_director),
    nombre: s(x.nombre_apellido),
    ci: s(x.nro_ci),
    telefono: s(x.nro_telefono),
    instituciones: Number(x.instituciones ?? 0),
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. 409 si la CI ya es de otro. */
export async function guardarDirector(id: number | null, d: DatosPersona): Promise<number> {
  const r = (await authFetch(id == null ? "directores" : `directores/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_director?: number };
  return Number(r.id_director ?? id ?? 0);
}

/** Baja. 409 si figura en alguna institución. */
export async function eliminarDirector(id: number): Promise<void> {
  await authFetch(`directores/${id}`, { method: "DELETE" });
}

export const keysDirectoresAbm = {
  // Bajo "directores": invalidarla refresca también la tarjeta de evaluaciones.
  todo: ["directores", "abm"] as const,
};
