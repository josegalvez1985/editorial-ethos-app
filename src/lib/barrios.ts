/**
 * ABM de barrios (Núcleo de Datos). Contrato del backend:
 * `backend/barrios.sql`.
 *
 * Es la página 10 de APEX (Barrios) y su modal 11 (Crear Barrio), que en el
 * sitio es el diálogo de `/barrios`, con los permisos de la 10.
 *
 * Cada barrio es de una ciudad. **Se elige solo la ciudad**: el departamento
 * y el país (`BARRIOS.ID_DEPARTAMENTO`, `ID_PAIS`) los copia el backend de la
 * ciudad al guardar. En APEX se elegían los tres por separado y podían no
 * coincidir. La pantalla usa `<CatalogoNombre>` con `padre` = ciudades (misma
 * caché que su pantalla).
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarBarrios(): Promise<ListaCatalogo> {
  const r = (await authFetch("barrios")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_barrio),
      nombre: String(row.nombre ?? ""),
      padre: {
        id: Number(row.id_ciudad),
        // Vacío si la ciudad ya no existe (ver el LEFT JOIN del backend).
        nombre: String(row.ciudad ?? "") || "Sin ciudad",
      },
      usos: ((row.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: String(u.tabla ?? ""),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    largo: Number(r.largo ?? 200),
    tablas: (r.tablas ?? []).map(String),
  };
}

/** Alta (`id` null) o modificación. Departamento y país los pone el backend. */
export async function guardarBarrio(
  id: number | null,
  idCiudad: number,
  nombre: string,
): Promise<number> {
  const r = (await authFetch(id == null ? "barrios" : `barrios/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_ciudad: idCiudad, nombre }),
  })) as { id_barrio?: number };
  return Number(r.id_barrio ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarBarrio(id: number): Promise<void> {
  await authFetch(`barrios/${id}`, { method: "DELETE" });
}

export const keysBarrios = {
  todo: ["barrios"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar barrios. */
export const apiBarrios: ApiCatalogo = {
  queryKey: keysBarrios.todo,
  listar: listarBarrios,
  // `<CatalogoNombre>` no deja guardar sin padre: `padreId` siempre llega.
  guardar: (id, d) => guardarBarrio(id, d.padreId ?? 0, d.nombre),
  eliminar: eliminarBarrio,
};
