/**
 * ABM de materias (Núcleo de Datos). Contrato del backend:
 * `backend/materias.sql`.
 *
 * Es la página 17 de APEX (Materias) y su modal 18 (Crear Materia),
 * que en el sitio es el diálogo de `/materias`, con los permisos de la 17.
 *
 * La columna de la tabla es `DESCRIPCION`; en la pantalla compartida
 * (`<CatalogoNombre>`) se maneja como `nombre`.
 *
 * El listado trae en qué tablas se usa cada materia (las FK, y además
 * pre-horarios y postulaciones aunque no tengan FK). Con eso la pantalla no
 * ofrece borrar una materia en uso. Las listas de Pre-horarios y Postulaciones
 * salen de `pre-horarios/opciones`: al guardar acá se invalidan también.
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";
import { keysPreHorarios } from "@/lib/pre-horarios";

export async function listarMaterias(): Promise<ListaCatalogo> {
  const r = (await authFetch("materias")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_materia),
      nombre: String(row.descripcion ?? ""),
      usos: ((row.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: String(u.tabla ?? ""),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    largo: Number(r.largo ?? 200),
    tablas: (r.tablas ?? []).map(String),
  };
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarMateria(id: number | null, descripcion: string): Promise<number> {
  const r = (await authFetch(id == null ? "materias" : `materias/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descripcion }),
  })) as { id_materia?: number };
  return Number(r.id_materia ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo la usa. */
export async function eliminarMateria(id: number): Promise<void> {
  await authFetch(`materias/${id}`, { method: "DELETE" });
}

export const keysMaterias = {
  todo: ["materias"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar materias. */
export const apiMaterias: ApiCatalogo = {
  queryKey: keysMaterias.todo,
  listar: listarMaterias,
  guardar: (id, d) => guardarMateria(id, d.nombre),
  eliminar: eliminarMateria,
  relacionadas: [keysPreHorarios.opciones],
};
