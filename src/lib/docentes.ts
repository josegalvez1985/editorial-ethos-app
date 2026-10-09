/**
 * ABM de docentes (Núcleo de Datos). Contrato del backend:
 * `backend/docentes.sql`.
 *
 * Es la página 41 de APEX (Docentes) y su modal 42 (Crear Docente), que en el
 * sitio es el diálogo de `/docentes`, con los permisos de la 41.
 *
 * El listado trae en qué tablas se usa cada docente (pre-horarios y
 * postulaciones): uno en uso no se borra, se marca inactivo. La lista de
 * docentes de Pre-horarios y Postulaciones sale de `pre-horarios/opciones`:
 * al guardar acá se invalida también.
 */

import type { Uso } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";

export type Docente = {
  id: number;
  nombre: string;
  ci: string;
  telefono: string;
  /** ACTIVO empieza con S (como lo lee Pre-horarios). */
  activo: boolean;
  usos: Uso[];
};

export type ListaDocentes = { items: Docente[]; tablas: string[] };

export type DatosDocente = { nombre: string; ci: string; telefono: string; activo: boolean };

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarDocentes(): Promise<ListaDocentes> {
  const r = (await authFetch("docentes")) as {
    data?: Record<string, unknown>[];
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((x) => ({
      id: Number(x.id_docente),
      nombre: s(x.nombre_apellido),
      ci: s(x.nro_ci),
      telefono: s(x.nro_telefono),
      activo: x.es_activo === "S",
      usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: s(u.tabla),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    tablas: (r.tablas ?? []).map(String),
  };
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarDocente(id: number | null, d: DatosDocente): Promise<number> {
  const r = (await authFetch(id == null ? "docentes" : `docentes/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre_apellido: d.nombre,
      nro_ci: d.ci,
      nro_telefono: d.telefono,
      activo: d.activo ? "SI" : "NO",
    }),
  })) as { id_docente?: number };
  return Number(r.id_docente ?? id ?? 0);
}

/** Baja. El backend responde 409 si algo lo usa. */
export async function eliminarDocente(id: number): Promise<void> {
  await authFetch(`docentes/${id}`, { method: "DELETE" });
}

export const keysDocentes = {
  todo: ["docentes"] as const,
};
