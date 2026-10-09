/**
 * Los ítems que se califican en la evaluación de facilitadores, cada uno en un
 * área. Tabla `EVALUACIONES` (el nombre engaña: las evaluaciones de los
 * facilitadores son `EVALUACIONES_FACILITADORES`). Contrato del backend:
 * `backend/evaluaciones.sql`.
 *
 * Reemplaza a la página 83 de APEX (Evaluaciones) y a su modal 84 (Crear
 * Evaluación), que en el sitio es el diálogo de `/items-evaluacion`.
 */

import type { QueryClient } from "@tanstack/react-query";

import { authFetch } from "@/lib/api";
import type { Uso } from "@/lib/facilitadores";

export type ItemEvaluacion = {
  id: number;
  idArea: number;
  area: string;
  descripcion: string;
  /** Las evaluaciones que lo usan. Con alguna, no se borra ni cambia de área. */
  usos: Uso[];
};

export type AreaItem = { id: number; descripcion: string };

export type ListaItems = { items: ItemEvaluacion[]; areas: AreaItem[]; largo: number };

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarItemsEvaluacion(): Promise<ListaItems> {
  const r = (await authFetch("items-evaluacion")) as {
    data?: Record<string, unknown>[];
    areas?: Record<string, unknown>[];
    largo?: number;
  };
  return {
    items: (r.data ?? []).map((x) => ({
      id: Number(x.id_evaluacion),
      idArea: Number(x.id_area),
      area: s(x.area),
      descripcion: s(x.descripcion),
      usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: s(u.tabla),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    areas: (r.areas ?? []).map((a) => ({ id: Number(a.id_area), descripcion: s(a.descripcion) })),
    largo: Number(r.largo ?? 255),
  };
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarItemEvaluacion(
  id: number | null,
  d: { id_area: number; descripcion: string },
): Promise<number> {
  const r = (await authFetch(id == null ? "items-evaluacion" : `items-evaluacion/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_evaluacion?: number };
  return Number(r.id_evaluacion ?? id ?? 0);
}

/** Baja. 409 si alguna evaluación lo usa. */
export async function eliminarItemEvaluacion(id: number): Promise<void> {
  await authFetch(`items-evaluacion/${id}`, { method: "DELETE" });
}

export const keysItemsEvaluacion = {
  todo: ["items-evaluacion"] as const,
};

/**
 * Después de guardar: esta lista, el combo de ítems del formulario
 * (`keys.lista("evaluaciones")` de lib/evaluaciones), las evaluaciones, que
 * muestran el texto del ítem, y Áreas, que cuenta los ítems de cada una.
 */
export function invalidarItems(qc: QueryClient) {
  for (const k of [
    keysItemsEvaluacion.todo,
    ["lista", "evaluaciones"],
    ["evaluaciones"],
    ["evaluacion-grupo"],
    ["areas-evaluacion"],
  ]) {
    qc.invalidateQueries({ queryKey: k });
  }
}
