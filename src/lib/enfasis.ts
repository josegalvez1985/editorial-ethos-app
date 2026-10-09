/**
 * ABM de énfasis (Núcleo de Datos). Contrato del backend:
 * `backend/enfasis.sql`.
 *
 * Es la página 26 de APEX (Enfasis) y su modal 27 (Crear Énfasis),
 * que en el sitio es el diálogo de `/enfasis`, con los permisos de la 26.
 *
 * La columna de la tabla es `DESCRIPCION`; en la pantalla compartida
 * (`<CatalogoNombre>`) se maneja como `nombre`.
 *
 * El listado trae en qué tablas se usa cada énfasis (las FK, y además
 * pre-horarios y postulaciones aunque no tengan FK). Con eso la pantalla no
 * ofrece borrar un énfasis en uso. Las listas de Pre-horarios y Postulaciones
 * salen de `pre-horarios/opciones`: al guardar acá se invalidan también.
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";
import { keysPreHorarios } from "@/lib/pre-horarios";

export async function listarEnfasis(): Promise<ListaCatalogo> {
  const r = (await authFetch("enfasis")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_enfasis),
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
export async function guardarEnfasis(id: number | null, descripcion: string): Promise<number> {
  const r = (await authFetch(id == null ? "enfasis" : `enfasis/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descripcion }),
  })) as { id_enfasis?: number };
  return Number(r.id_enfasis ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarEnfasis(id: number): Promise<void> {
  await authFetch(`enfasis/${id}`, { method: "DELETE" });
}

export const keysEnfasis = {
  todo: ["enfasis"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar énfasis. */
export const apiEnfasis: ApiCatalogo = {
  queryKey: keysEnfasis.todo,
  listar: listarEnfasis,
  guardar: (id, d) => guardarEnfasis(id, d.nombre),
  eliminar: eliminarEnfasis,
  relacionadas: [keysPreHorarios.opciones],
};
