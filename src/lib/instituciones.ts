/**
 * Instituciones (Núcleo de Datos). Contrato del backend: `backend/instituciones.sql`.
 *
 * Reemplaza a la página 16 de APEX (el listado) y a su modal 21 (Crear
 * Institución), que en el sitio es la ficha `/instituciones/$id`, con los
 * permisos de la 16. Cada pestaña de la ficha tiene su tabla y su backend:
 *
 * | Pestaña | Tabla | Lib |
 * | --- | --- | --- |
 * | Datos | `INSTITUCIONES` | esta |
 * | Autoridades | `INSTITUCIONES_DIRECTORES`, `INSTITUCIONES_COORDNADORES` | `instituciones-directores.ts`, `instituciones-coordinadores.ts` |
 * | Horario | `HORARIO_INSTITUCIONES` | `horario-instituciones.ts` |
 *
 * Los pre-horarios (modal 43) y las postulaciones (38 y 60) son las fases 2 y 3.
 *
 * **Ubicación:** se elige la ciudad (y el barrio); departamento y país los pone
 * el backend copiándolos de la fila del barrio o de la ciudad, porque
 * `INSTITUCIONES` tiene FK compuestas (ver el encabezado del `.sql`).
 */

import { authFetch } from "@/lib/api";
import type { Uso } from "@/lib/facilitadores";
import { linkMapaPunto } from "@/lib/intervenciones";
import type { ValorLista } from "@/lib/utils";

export type InstitucionFila = {
  id: number;
  nombre: string;
  estado: string;
  activa: boolean;
  idDepartamento: number | null;
  departamento: string;
  idCiudad: number | null;
  ciudad: string;
  barrio: string;
  zona: string;
  direccion: string;
  ubicacion: string;
  idFacilitador: number | null;
  facilitador: string;
  /** El director ACTIVO del período más reciente, si hay. */
  director: string;
  directorTelefono: string;
  /** Directores y coordinadores activos. */
  autoridades: number;
  /** Del año lectivo actual (`anio` de la lista). */
  bloquesHorario: number;
  preHorarios: number;
  preConfirmados: number;
  postulaciones: number;
};

export type ListaInstituciones = {
  /** El año lectivo actual, al que se refieren los conteos. Vacío si no hay ninguno activo. */
  anio: string;
  items: InstitucionFila[];
};

export type OpcionesInstitucion = {
  anio: string;
  /** La lista ACTIVO_INACTIVO de APEX. */
  estado: ValorLista[];
};

/** Lo que se edita en la pestaña Datos: es lo que viaja en el POST/PUT. */
export type DatosInstitucion = {
  nombre: string;
  estado: string;
  id_ciudad: number | null;
  id_barrio: number | null;
  direccion: string;
  ubicacion: string;
  zona: string;
  comentario: string;
  id_facilitador: number | null;
};

export type FichaInstitucion = DatosInstitucion & {
  id: number;
  departamento: string;
  ciudad: string;
  barrio: string;
  facilitador: string;
  anio: string;
  /** Pre-horarios del año sin facilitador: los que tocaría "Asignar a los pre-horarios". */
  preSinFacilitador: number;
  /** De esos, los confirmados: su postulación se vuelve a generar. */
  preSinFacilitadorConfirmados: number;
  /** Lo que la usa fuera de su ficha. Vacío = se puede borrar. */
  usos: Uso[];
};

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
const num = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Activa = 'A' o sin estado: hay filas con ESTADO en NULL y para el negocio
 * cuentan como activas (mismo criterio que el backend).
 */
export const esActiva = (estado: string) => !estado.trim() || estado.trim().toUpperCase() === "A";

export async function listarInstituciones(): Promise<ListaInstituciones> {
  const r = (await authFetch("instituciones")) as {
    anio?: unknown;
    data?: Record<string, unknown>[];
  };
  return {
    anio: s(r.anio),
    items: (r.data ?? []).map((x) => ({
      id: Number(x.id_institucion),
      nombre: s(x.nombre),
      estado: s(x.estado),
      activa: x.es_activa === "S",
      idDepartamento: n(x.id_departamento),
      departamento: s(x.departamento),
      idCiudad: n(x.id_ciudad),
      ciudad: s(x.ciudad),
      barrio: s(x.barrio),
      zona: s(x.zona),
      direccion: s(x.direccion),
      ubicacion: s(x.ubicacion),
      idFacilitador: n(x.id_facilitador),
      facilitador: s(x.facilitador),
      director: s(x.director),
      directorTelefono: s(x.director_telefono),
      autoridades: num(x.autoridades),
      bloquesHorario: num(x.bloques_horario),
      preHorarios: num(x.pre_horarios),
      preConfirmados: num(x.pre_confirmados),
      postulaciones: num(x.postulaciones),
    })),
  };
}

export async function opcionesInstitucion(): Promise<OpcionesInstitucion> {
  const r = (await authFetch("instituciones/opciones")) as Record<string, unknown>;
  return {
    anio: s(r.anio),
    estado: ((r.estado as Record<string, unknown>[] | undefined) ?? []).map((o) => ({
      valor: s(o.valor),
      mostrar: s(o.mostrar) || s(o.valor),
    })),
  };
}

/** Una ficha vacía para el alta, con el estado activo de la lista. */
export function fichaVacia(estados: ValorLista[]): DatosInstitucion {
  return {
    nombre: "",
    estado: estados.find((e) => esActiva(e.valor))?.valor ?? "A",
    id_ciudad: null,
    id_barrio: null,
    direccion: "",
    ubicacion: "",
    zona: "",
    comentario: "",
    id_facilitador: null,
  };
}

export async function obtenerInstitucion(id: number): Promise<FichaInstitucion> {
  const r = (await authFetch(`instituciones/${id}`)) as { data?: Record<string, unknown> };
  const d = r.data ?? {};
  return {
    id: Number(d.id_institucion),
    nombre: s(d.nombre),
    estado: s(d.estado),
    id_ciudad: n(d.id_ciudad),
    id_barrio: n(d.id_barrio),
    direccion: s(d.direccion),
    ubicacion: s(d.ubicacion),
    zona: s(d.zona),
    comentario: s(d.comentario),
    id_facilitador: n(d.id_facilitador),
    departamento: s(d.departamento),
    ciudad: s(d.ciudad),
    barrio: s(d.barrio),
    facilitador: s(d.facilitador),
    anio: s(d.anio),
    preSinFacilitador: num(d.pre_sin_facilitador),
    preSinFacilitadorConfirmados: num(d.pre_sin_facilitador_confirmados),
    usos: ((d.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
      tabla: s(u.tabla),
      cantidad: num(u.cantidad),
    })),
  };
}

/**
 * Alta (`id` null) o modificación. Devuelve el id y cuántas autoridades cambió
 * `TRG_UPD_ESTADO_INSTITUCIONES` al cambiar el estado (ver el `.sql`).
 */
export async function guardarInstitucion(
  id: number | null,
  d: DatosInstitucion,
): Promise<{ id: number; autoridadesCambiadas: number }> {
  const r = (await authFetch(id == null ? "instituciones" : `instituciones/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_institucion?: number; autoridades_cambiadas?: number };
  return {
    id: Number(r.id_institucion ?? id ?? 0),
    autoridadesCambiadas: num(r.autoridades_cambiadas),
  };
}

/** Baja, con sus autoridades y su horario. El backend responde 409 si algo más la usa. */
export async function eliminarInstitucion(id: number): Promise<void> {
  await authFetch(`instituciones/${id}`, { method: "DELETE" });
}

/**
 * El botón "Actualizar Facilitador" de la página 21: pone el facilitador
 * GUARDADO de la institución en los pre-horarios del año que no tienen.
 * Devuelve cuántos cambió.
 */
export async function asignarFacilitadorPreHorarios(id: number): Promise<number> {
  const r = (await authFetch(`instituciones/${id}/facilitador`, { method: "POST" })) as {
    actualizados?: number;
  };
  return num(r.actualizados);
}

/**
 * Un link para abrir la UBICACIÓN en el mapa, o `null`. La columna es texto
 * libre (hasta 4000): si es un link se usa tal cual; si son coordenadas
 * ("-25.28, -57.63"), se arma el de Google Maps. Cualquier otra cosa se
 * muestra como texto, sin link.
 */
export function linkUbicacion(ubicacion: string): string | null {
  const t = ubicacion.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  const m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  return m ? linkMapaPunto(m[1], m[2]) : null;
}

export const keysInstituciones = {
  todo: ["instituciones"] as const,
  lista: ["instituciones", "lista"] as const,
  opciones: ["instituciones", "opciones"] as const,
  ficha: (id: number) => ["instituciones", "ficha", id] as const,
};
