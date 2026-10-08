/**
 * ABM de nacionalidades (Núcleo de Datos). Contrato del backend:
 * `backend/nacionalidades.sql`.
 *
 * Es la página 12 de APEX (Nacionalidades) y su modal 13 (Crear Nacionalidad),
 * que en el sitio es el diálogo de `/nacionalidades`, con los permisos de la 12.
 *
 * La columna de la tabla es `DESCRIPCION`; en la pantalla compartida
 * (`<CatalogoNombre>`) se maneja como `nombre`.
 *
 * El listado trae en qué tablas se usa cada nacionalidad. No lo sabe una lista a mano:
 * el backend lo saca de las FK que apuntan a `NACIONALIDADES`. Con eso la pantalla
 * no ofrece borrar una nacionalidad en uso.
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarNacionalidades(): Promise<ListaCatalogo> {
  const r = (await authFetch("nacionalidades")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_nacionalidad),
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
export async function guardarNacionalidad(id: number | null, descripcion: string): Promise<number> {
  const r = (await authFetch(id == null ? "nacionalidades" : `nacionalidades/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descripcion }),
  })) as { id_nacionalidad?: number };
  return Number(r.id_nacionalidad ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarNacionalidad(id: number): Promise<void> {
  await authFetch(`nacionalidades/${id}`, { method: "DELETE" });
}

export const keysNacionalidades = {
  todo: ["nacionalidades"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar nacionalidades. */
export const apiNacionalidades: ApiCatalogo = {
  queryKey: keysNacionalidades.todo,
  listar: listarNacionalidades,
  guardar: (id, d) => guardarNacionalidad(id, d.nombre),
  eliminar: eliminarNacionalidad,
};
