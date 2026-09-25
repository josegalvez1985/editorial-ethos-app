/**
 * ABM de sucursales (Núcleo de datos). Contrato del backend:
 * `backend/sucursales.sql`.
 *
 * El listado trae el USO de cada sucursal —existencias, inventarios y
 * transferencias— para que la pantalla sepa, sin preguntar, si se puede borrar:
 * todas esas tablas tienen FK a `SUCURSALES`.
 *
 * El combo de sucursales de Inventario y Transferencias sigue saliendo de
 * `inventarios/sucursales` (`lib/inventarios.ts`): trae otra cosa (los conteos
 * abiertos). Al guardar acá se invalidan las dos.
 */

import { authFetch } from "@/lib/api";

export type Sucursal = {
  id_sucursal: number;
  descripcion: string;
  /** Manuales con fila en `EXISTENCIAS`. */
  manuales: number;
  /** Libros en total según `EXISTENCIAS`. */
  libros: number;
  inventarios: number;
  /** Como origen o como destino. */
  transferencias: number;
};

/** Si algo la referencia, no se puede borrar (FK). */
export const enUso = (s: Sucursal) => s.manuales + s.inventarios + s.transferencias > 0;

export async function listarSucursalesAbm(): Promise<Sucursal[]> {
  const r = (await authFetch("sucursales")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((row) => ({
    id_sucursal: Number(row.id_sucursal),
    descripcion: String(row.descripcion ?? ""),
    manuales: Number(row.manuales ?? 0),
    libros: Number(row.libros ?? 0),
    inventarios: Number(row.inventarios ?? 0),
    transferencias: Number(row.transferencias ?? 0),
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarSucursal(id: number | null, descripcion: string): Promise<number> {
  const r = (await authFetch(id == null ? "sucursales" : `sucursales/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ descripcion }),
  })) as { id_sucursal?: number };
  return Number(r.id_sucursal ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo la usa. */
export async function eliminarSucursal(id: number): Promise<void> {
  await authFetch(`sucursales/${id}`, { method: "DELETE" });
}

export const keysSucursales = {
  todo: ["sucursales"] as const,
};
