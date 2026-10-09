/**
 * Quién coordina en cada institución (`INSTITUCIONES_COORDNADORES`, así, sin
 * la I: es el nombre de la tabla). Contrato del backend:
 * `backend/instituciones_coordinadores.sql`. El gemelo de
 * `lib/instituciones-directores.ts`.
 *
 * Es el IG "Coordinadores" de la región Autoridades del modal 21 de APEX; en
 * el sitio, la otra mitad de la pestaña Autoridades de `/instituciones/$id`.
 * La página 47 (Instituciones y Coordinadores) es de esta misma tabla:
 * `/instituciones-coordinadores`, con `<InstitucionesAutoridad>`, desde el
 * 09/10/2026.
 *
 * Distinto de directores: el "cargo" acá es el TIPO de coordinador, y el
 * período y el estado pueden venir vacíos en filas viejas.
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
import { guardarCoordinador, keysCoordinadores, listarCoordinadores } from "@/lib/coordinadores";

export async function listarCoordinadoresDeInstitucion(
  idInstitucion: number,
): Promise<Autoridad[]> {
  const r = (await authFetch(`instituciones-coordinadores?id_institucion=${idInstitucion}`)) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map(aAutoridad);
}

/** Tipo, nivel, turno y estado: las listas de APEX del IG. */
export async function opcionesCoordinadoresInstitucion(): Promise<OpcionesAutoridad> {
  return aOpcionesAutoridad(
    (await authFetch("instituciones-coordinadores/opciones")) as Record<string, unknown>,
  );
}

/** Alta (`id` null) o modificación. Devuelve el id de la fila. */
export async function guardarCoordinadorInstitucion(
  id: number | null,
  d: DatosAutoridad,
): Promise<number> {
  const r = (await authFetch(
    id == null ? "instituciones-coordinadores" : `instituciones-coordinadores/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id_institucion: d.idInstitucion,
        id_coordinador: d.idPersona,
        periodo: d.periodo,
        tipo_coordinador: d.rol,
        nivel: d.nivel,
        turno: d.turno,
        estado: d.estado,
        nro_telefono: d.telefono,
      }),
    },
  )) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

/** Quita al coordinador de la institución. La persona sigue cargada. */
export async function quitarCoordinadorInstitucion(id: number): Promise<void> {
  await authFetch(`instituciones-coordinadores/${id}`, { method: "DELETE" });
}

/** Las filas de TODAS las instituciones (páginas 45 y 47). */
export async function listarTodosCoordinadoresInstitucion(): Promise<Autoridad[]> {
  const r = (await authFetch("instituciones-coordinadores")) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map(aAutoridad);
}

export const keysCoordinadoresInstitucion = {
  todo: ["instituciones-coordinadores"] as const,
  todas: ["instituciones-coordinadores", "todas"] as const,
  institucion: (id: number) => ["instituciones-coordinadores", id] as const,
  opciones: ["instituciones-coordinadores", "opciones"] as const,
};

/** Lo que necesita `<AutoridadesInstitucion>` para mostrar y editar coordinadores. */
export const apiCoordinadoresInstitucion: ApiAutoridades = {
  textos: { titulo: "Coordinadores", singular: "coordinador", rol: "Tipo", verbo: "Coordina" },
  ruta: "/instituciones-coordinadores",
  rutaPersonas: "/coordinadores",
  key: keysCoordinadoresInstitucion.institucion,
  listar: listarCoordinadoresDeInstitucion,
  todas: { key: keysCoordinadoresInstitucion.todas, listar: listarTodosCoordinadoresInstitucion },
  keyOpciones: keysCoordinadoresInstitucion.opciones,
  opciones: opcionesCoordinadoresInstitucion,
  guardar: guardarCoordinadorInstitucion,
  quitar: quitarCoordinadorInstitucion,
  personas: {
    key: keysCoordinadores.todo,
    listar: listarCoordinadores,
    crear: (d) => guardarCoordinador(null, d),
  },
};
