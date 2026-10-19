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
 *
 * También trae dónde está cada docente (19/10/2026, a pedido): una fila por
 * año + institución, con la ciudad, sacada de sus pre-horarios y
 * postulaciones, y el año lectivo actual para abrir el diálogo en ese año.
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
  /** Dónde está, del año más nuevo al más viejo. */
  ubicaciones: UbicacionDocente[];
};

/** Una institución donde figura el docente en un año. */
export type UbicacionDocente = {
  /** `""` si la fila no tiene año. */
  anio: string;
  idInstitucion: number | null;
  institucion: string;
  ciudad: string;
  preHorarios: number;
  postulaciones: number;
};

export type ListaDocentes = {
  items: Docente[];
  tablas: string[];
  /** El año lectivo actual (FN_ANIO_LECTIVO_ACTUAL). */
  anioActual: string;
};

export type DatosDocente = { nombre: string; ci: string; telefono: string; activo: boolean };

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarDocentes(): Promise<ListaDocentes> {
  const r = (await authFetch("docentes")) as {
    data?: Record<string, unknown>[];
    tablas?: unknown[];
    anio_actual?: unknown;
    ubicaciones?: Record<string, unknown>[];
  };
  // El backend las manda ordenadas por docente, año (nuevo primero) e
  // institución. Un Map solo para armar: la lista se persiste en localStorage
  // (query-persist.ts) y ahí un Map no sobrevive, así que va dentro de cada docente.
  const ubicaciones = new Map<number, UbicacionDocente[]>();
  for (const u of r.ubicaciones ?? []) {
    const id = Number(u.id_docente);
    const lista = ubicaciones.get(id) ?? [];
    lista.push({
      anio: s(u.anio),
      idInstitucion: u.id_institucion == null ? null : Number(u.id_institucion),
      institucion: s(u.institucion),
      ciudad: s(u.ciudad),
      preHorarios: Number(u.pre_horarios ?? 0),
      postulaciones: Number(u.postulaciones ?? 0),
    });
    ubicaciones.set(id, lista);
  }
  return {
    anioActual: s(r.anio_actual) || String(new Date().getFullYear()),
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
      ubicaciones: ubicaciones.get(Number(x.id_docente)) ?? [],
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
