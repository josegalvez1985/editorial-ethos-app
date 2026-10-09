/**
 * Coordinadores: las PERSONAS de `COORDINADORES` (nombre, teléfono, CI).
 * Contrato del backend: `backend/coordinadores.sql`. El gemelo de
 * `lib/directores.ts`.
 *
 * Hoy lo usa la pestaña Autoridades de la ficha de Instituciones para elegir
 * al coordinador y para darlo de alta ahí mismo (el modal 46 de APEX). La
 * página 45 (Coordinadores) todavía no está en el sitio; cuando se haga, usa
 * esto.
 */

import { authFetch } from "@/lib/api";
import type { DatosPersona, Persona } from "@/lib/autoridades";

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarCoordinadores(): Promise<Persona[]> {
  const r = (await authFetch("coordinadores")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_coordinador),
    nombre: s(x.nombre_apellido),
    ci: s(x.nro_ci),
    telefono: s(x.nro_telefono),
    instituciones: Number(x.instituciones ?? 0),
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. 409 si la CI ya es de otro. */
export async function guardarCoordinador(id: number | null, d: DatosPersona): Promise<number> {
  const r = (await authFetch(id == null ? "coordinadores" : `coordinadores/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_coordinador?: number };
  return Number(r.id_coordinador ?? id ?? 0);
}

/** Baja. 409 si figura en alguna institución. */
export async function eliminarCoordinador(id: number): Promise<void> {
  await authFetch(`coordinadores/${id}`, { method: "DELETE" });
}

export const keysCoordinadores = {
  todo: ["coordinadores"] as const,
};
