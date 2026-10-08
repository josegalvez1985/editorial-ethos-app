/**
 * ABM de ciudades (Núcleo de Datos). Contrato del backend:
 * `backend/ciudades.sql`.
 *
 * Es la página 8 de APEX (Ciudades) y su modal 9 (Crear Ciudad), que en el
 * sitio es el diálogo de `/ciudades`, con los permisos de la 8.
 *
 * Cada ciudad es de un departamento. **Se elige solo el departamento**: el
 * país (`CIUDADES.ID_PAIS`) lo copia el backend del departamento al guardar.
 * En APEX se elegían por separado y podían no coincidir. La pantalla usa
 * `<CatalogoNombre>` con `padre` = departamentos (misma caché que su pantalla).
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarCiudades(): Promise<ListaCatalogo> {
  const r = (await authFetch("ciudades")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_ciudad),
      nombre: String(row.nombre ?? ""),
      padre: {
        id: Number(row.id_departamento),
        // Vacío si el departamento ya no existe (ver el LEFT JOIN del backend).
        nombre: String(row.departamento ?? "") || "Sin departamento",
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

/** Alta (`id` null) o modificación. El país lo pone el backend. Devuelve el id. */
export async function guardarCiudad(
  id: number | null,
  idDepartamento: number,
  nombre: string,
): Promise<number> {
  const r = (await authFetch(id == null ? "ciudades" : `ciudades/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_departamento: idDepartamento, nombre }),
  })) as { id_ciudad?: number };
  return Number(r.id_ciudad ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo la usa. */
export async function eliminarCiudad(id: number): Promise<void> {
  await authFetch(`ciudades/${id}`, { method: "DELETE" });
}

export const keysCiudades = {
  todo: ["ciudades"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar ciudades. */
export const apiCiudades: ApiCatalogo = {
  queryKey: keysCiudades.todo,
  listar: listarCiudades,
  // `<CatalogoNombre>` no deja guardar sin padre: `padreId` siempre llega.
  guardar: (id, d) => guardarCiudad(id, d.padreId ?? 0, d.nombre),
  eliminar: eliminarCiudad,
};
