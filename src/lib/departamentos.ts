/**
 * ABM de departamentos (Núcleo de Datos). Contrato del backend:
 * `backend/departamentos.sql`.
 *
 * Es la página 6 de APEX (Departamentos) y su modal 7 (Crear Departamento),
 * que en el sitio es el diálogo de `/departamentos`, con los permisos de la 6.
 *
 * Cada departamento es de un país (`ID_PAIS`, obligatorio). La pantalla usa
 * `<CatalogoNombre>` con `padre` = países: filtra y agrupa por país, y el
 * selector del diálogo lee la lista de `lib/paises.ts` (la misma caché que
 * la pantalla de Países).
 */

import type { ApiCatalogo, ListaCatalogo } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export async function listarDepartamentos(): Promise<ListaCatalogo> {
  const r = (await authFetch("departamentos")) as {
    data?: Record<string, unknown>[];
    largo?: number;
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((row) => ({
      id: Number(row.id_departamento),
      nombre: String(row.nombre ?? ""),
      padre: {
        id: Number(row.id_pais),
        // Vacío si el país ya no existe (ver el LEFT JOIN del backend).
        nombre: String(row.pais ?? "") || "Sin país",
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

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarDepartamento(
  id: number | null,
  idPais: number,
  nombre: string,
): Promise<number> {
  const r = (await authFetch(id == null ? "departamentos" : `departamentos/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_pais: idPais, nombre }),
  })) as { id_departamento?: number };
  return Number(r.id_departamento ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarDepartamento(id: number): Promise<void> {
  await authFetch(`departamentos/${id}`, { method: "DELETE" });
}

export const keysDepartamentos = {
  todo: ["departamentos"] as const,
};

/** Lo que necesita `<CatalogoNombre>` para mostrar y editar departamentos. */
export const apiDepartamentos: ApiCatalogo = {
  queryKey: keysDepartamentos.todo,
  listar: listarDepartamentos,
  // `<CatalogoNombre>` no deja guardar sin padre: `padreId` siempre llega.
  guardar: (id, d) => guardarDepartamento(id, d.padreId ?? 0, d.nombre),
  eliminar: eliminarDepartamento,
};
