/**
 * ABM de áreas de evaluación (Núcleo de Datos). Contrato del backend:
 * `backend/areas_evaluaciones.sql`.
 *
 * Es la página 81 de APEX (Areas de Evaluación) y su modal 82 (Crear Area), que
 * en el sitio es el diálogo de `/areas-evaluacion`, con los permisos de la 81.
 *
 * La columna de la tabla es `DESCRIPCION`; en la pantalla compartida
 * (`<CatalogoNombre>`) se maneja como `nombre`.
 *
 * El listado trae en qué tablas se usa cada área (los ítems de `EVALUACIONES`
 * y las evaluaciones de facilitadores). Con eso la pantalla no ofrece borrar un
 * área en uso. El combo de áreas del formulario de evaluación sale de
 * `listas/areas`: al guardar acá se invalida también.
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarAreasEvaluacion(): Promise<ListaCatalogo> {
  const r = (await authFetch("areas-evaluacion")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_area),
      nombre: String(row.descripcion ?? ""),
      usos: ((row.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: String(u.tabla ?? ""),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    largo: Number(r.largo ?? 255),
    tablas: (r.tablas ?? []).map(String),
  };
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarAreaEvaluacion(
  id: number | null,
  descripcion: string,
): Promise<number> {
  const r = (await authFetch(id == null ? "areas-evaluacion" : `areas-evaluacion/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descripcion }),
  })) as { id_area?: number };
  return Number(r.id_area ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo la usa. */
export async function eliminarAreaEvaluacion(id: number): Promise<void> {
  await authFetch(`areas-evaluacion/${id}`, { method: "DELETE" });
}

export const keysAreasEvaluacion = {
  todo: ["areas-evaluacion"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar áreas. */
export const apiAreasEvaluacion: ApiCatalogo = {
  queryKey: keysAreasEvaluacion.todo,
  listar: listarAreasEvaluacion,
  guardar: (id, d) => guardarAreaEvaluacion(id, d.nombre),
  eliminar: eliminarAreaEvaluacion,
  // El combo de áreas (`keys.lista("areas")` de lib/evaluaciones) y las
  // evaluaciones, que muestran el nombre del área.
  relacionadas: [["lista", "areas"], ["evaluaciones"], ["evaluacion-grupo"]],
};
