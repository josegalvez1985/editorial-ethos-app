/**
 * Quién dirige cada institución (`INSTITUCIONES_DIRECTORES`). Contrato del
 * backend: `backend/instituciones_directores.sql`.
 *
 * Es el IG "Directores" de la región Autoridades del modal 21 de APEX; en el
 * sitio, la mitad de la pestaña Autoridades de `/instituciones/$id` (ver
 * `<AutoridadesInstitucion>`). La página 36 (Instituciones y Directores) y su
 * modal 37 son de esta misma tabla: `/instituciones-directores`, con
 * `<InstitucionesAutoridad>`, desde el 09/10/2026.
 */

import { authFetch } from "@/lib/api";
import {
  aAutoridad,
  aOpcionesAutoridad,
  type ApiAutoridades,
  type Autoridad,
  type DatosAutoridad,
  type OpcionesAutoridad,
} from "@/lib/autoridades";
import { guardarDirector, keysDirectoresAbm, listarDirectoresAbm } from "@/lib/directores";

export async function listarDirectoresDeInstitucion(idInstitucion: number): Promise<Autoridad[]> {
  const r = (await authFetch(`instituciones-directores?id_institucion=${idInstitucion}`)) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map(aAutoridad);
}

/** Cargo, nivel, turno y estado: las listas de APEX del IG. */
export async function opcionesDirectoresInstitucion(): Promise<OpcionesAutoridad> {
  return aOpcionesAutoridad(
    (await authFetch("instituciones-directores/opciones")) as Record<string, unknown>,
  );
}

/** Alta (`id` null) o modificación. Devuelve el id de la fila. */
export async function guardarDirectorInstitucion(
  id: number | null,
  d: DatosAutoridad,
): Promise<number> {
  const r = (await authFetch(
    id == null ? "instituciones-directores" : `instituciones-directores/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_institucion: d.idInstitucion,
        id_director: d.idPersona,
        periodo: d.periodo,
        cargo: d.rol,
        nivel: d.nivel,
        turno: d.turno,
        estado: d.estado,
        nro_telefono: d.telefono,
      }),
    },
  )) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

/** Quita al director de la institución. La persona sigue cargada. */
export async function quitarDirectorInstitucion(id: number): Promise<void> {
  await authFetch(`instituciones-directores/${id}`, { method: "DELETE" });
}

/** Las filas de TODAS las instituciones: dónde figura cada director (página 34). */
export async function listarTodosDirectoresInstitucion(): Promise<Autoridad[]> {
  const r = (await authFetch("instituciones-directores")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map(aAutoridad);
}

export const keysDirectoresInstitucion = {
  todo: ["instituciones-directores"] as const,
  todas: ["instituciones-directores", "todas"] as const,
  institucion: (id: number) => ["instituciones-directores", id] as const,
  opciones: ["instituciones-directores", "opciones"] as const,
};

/** Lo que necesita `<AutoridadesInstitucion>` para mostrar y editar directores. */
export const apiDirectoresInstitucion: ApiAutoridades = {
  textos: { titulo: "Directores", singular: "director", rol: "Cargo", verbo: "Dirige" },
  ruta: "/instituciones-directores",
  rutaPersonas: "/directores",
  key: keysDirectoresInstitucion.institucion,
  listar: listarDirectoresDeInstitucion,
  todas: { key: keysDirectoresInstitucion.todas, listar: listarTodosDirectoresInstitucion },
  keyOpciones: keysDirectoresInstitucion.opciones,
  opciones: opcionesDirectoresInstitucion,
  guardar: guardarDirectorInstitucion,
  quitar: quitarDirectorInstitucion,
  personas: {
    key: keysDirectoresAbm.todo,
    listar: listarDirectoresAbm,
    crear: (d) => guardarDirector(null, d),
  },
};
