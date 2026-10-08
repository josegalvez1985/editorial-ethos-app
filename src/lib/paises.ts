/**
 * ABM de países (Núcleo de Datos). Contrato del backend: `backend/paises.sql`.
 *
 * Es la página 4 de APEX (Países) y su modal 5 (Crear País), que en el sitio
 * es el diálogo de `/paises`, con los permisos de la 4.
 *
 * El listado trae en qué tablas se usa cada país. No lo sabe una lista a mano:
 * el backend lo saca de las FK que apuntan a `PAISES`. Con eso la pantalla no
 * ofrece borrar un país en uso.
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarPaises(): Promise<ListaCatalogo> {
  const r = (await authFetch("paises")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_pais),
      nombre: String(row.nombre ?? ""),
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
export async function guardarPais(id: number | null, nombre: string): Promise<number> {
  const r = (await authFetch(id == null ? "paises" : `paises/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  })) as { id_pais?: number };
  return Number(r.id_pais ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarPais(id: number): Promise<void> {
  await authFetch(`paises/${id}`, { method: "DELETE" });
}

export const keysPaises = {
  todo: ["paises"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar países. */
export const apiPaises: ApiCatalogo = {
  queryKey: keysPaises.todo,
  listar: listarPaises,
  guardar: (id, d) => guardarPais(id, d.nombre),
  eliminar: eliminarPais,
};
