/**
 * Pre-horarios: la planificación del año de cada institución (`PRE_HORARIOS`).
 * Contrato del backend: `backend/pre_horarios.sql`.
 *
 * Es el modal 43 de APEX (Pre Horarios, el botón "Pre Postulación" del 21): la
 * pestaña Pre-horarios de `/instituciones/$id`, con los permisos de la 16.
 *
 * Un pre-horario es UNA clase de la semana. Al **confirmarlo** el trigger
 * `TRG_POSTULACIONES` crea su postulación; al modificarlo la borra y la vuelve
 * a crear. Si esa postulación ya tiene intervenciones o evaluaciones, el
 * pre-horario queda **bloqueado** (`usos > 0`): no se puede modificar ni
 * borrar. Ver el encabezado del `.sql`.
 */

import { authFetch } from "@/lib/api";
import { DIAS, GRADOS, MANUALES, type Detalle, type Formulario } from "@/lib/postulaciones";
import type { ValorLista } from "@/lib/utils";

export type PreHorario = {
  id: number;
  turno: number | null;
  /** "2" … "9", "1M", "2M", "3M" (ver `GRADOS`). */
  grado: string;
  seccion: string;
  idEnfasis: number | null;
  enfasis: string;
  cantidad: number | null;
  /** "SER" … "LIDERAZGO" (ver `MANUALES`). */
  manual: string;
  /** "LUNES" … "VIERNES" (ver `DIAS`). */
  dia: string;
  desde: string;
  hasta: string;
  idMateria: number | null;
  materia: string;
  idDocente: number | null;
  docente: string;
  docenteTelefono: string;
  telefono: string;
  idFacilitador: number | null;
  facilitador: string;
  observacion: string;
  confirmado: boolean;
  anio: string;
  /** La postulación que generó al confirmarlo, si hay. */
  idPostulacion: number | null;
  /** Intervenciones y evaluaciones de esa postulación: > 0 = bloqueado. */
  usos: number;
};

export type ListaPreHorarios = { anio: string; anioActual: string; items: PreHorario[] };

export type Elegible = { id: number; nombre: string };

export type OpcionesPreHorario = {
  anioActual: string;
  /** La lista de turnos de APEX (`valor` "1", "2", "3"). */
  turno: ValorLista[];
  /** "Confirmado" de la 43: SI / NO. */
  estado: ValorLista[];
  materias: Elegible[];
  enfasis: Elegible[];
  /** Todos: la pantalla ofrece los activos y el que ya estaba elegido. */
  docentes: (Elegible & { telefono: string; activo: boolean })[];
};

/** Lo que se edita en el diálogo: es lo que viaja en el POST/PUT. */
export type DatosPreHorario = {
  turno: number | null;
  grado: string;
  seccion: string;
  idEnfasis: number | null;
  cantidad: string;
  manual: string;
  dia: string;
  desde: string;
  hasta: string;
  idMateria: number | null;
  idDocente: number | null;
  telefono: string;
  idFacilitador: number | null;
  observacion: string;
  confirmado: boolean;
};

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export async function listarPreHorarios(idInstitucion: number): Promise<ListaPreHorarios> {
  const r = (await authFetch(`pre-horarios?id_institucion=${idInstitucion}`)) as {
    anio?: unknown;
    anio_actual?: unknown;
    data?: Record<string, unknown>[];
  };
  return {
    anio: s(r.anio),
    anioActual: s(r.anio_actual),
    items: (r.data ?? []).map((x) => ({
      id: Number(x.id),
      turno: n(x.turno),
      grado: s(x.grado),
      seccion: s(x.seccion),
      idEnfasis: n(x.id_enfasis),
      enfasis: s(x.enfasis),
      cantidad: n(x.cantidad_alumnos),
      manual: s(x.manual),
      dia: s(x.dia),
      desde: s(x.hora_desde),
      hasta: s(x.hora_hasta),
      idMateria: n(x.id_materia),
      materia: s(x.materia),
      idDocente: n(x.id_docente),
      docente: s(x.docente),
      docenteTelefono: s(x.docente_telefono),
      telefono: s(x.telefono),
      idFacilitador: n(x.id_facilitador),
      facilitador: s(x.facilitador),
      observacion: s(x.observacion),
      confirmado: s(x.estado).toUpperCase() === "SI",
      anio: s(x.anio),
      idPostulacion: n(x.id_postulacion),
      usos: Number(x.usos ?? 0) || 0,
    })),
  };
}

export async function opcionesPreHorario(): Promise<OpcionesPreHorario> {
  const r = (await authFetch("pre-horarios/opciones")) as Record<string, unknown>;
  const lista = (k: string) => (r[k] as Record<string, unknown>[] | undefined) ?? [];
  const valores = (k: string): ValorLista[] =>
    lista(k).map((o) => ({ valor: s(o.valor), mostrar: s(o.mostrar) || s(o.valor) }));
  return {
    anioActual: s(r.anio_actual),
    turno: valores("turno"),
    estado: valores("estado"),
    materias: lista("materias").map((o) => ({ id: Number(o.id), nombre: s(o.nombre) })),
    enfasis: lista("enfasis").map((o) => ({ id: Number(o.id), nombre: s(o.nombre) })),
    docentes: lista("docentes").map((o) => ({
      id: Number(o.id),
      nombre: s(o.nombre),
      telefono: s(o.telefono),
      activo: o.es_activo !== "N",
    })),
  };
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarPreHorario(
  id: number | null,
  idInstitucion: number,
  d: DatosPreHorario,
): Promise<number> {
  const r = (await authFetch(id == null ? "pre-horarios" : `pre-horarios/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_institucion: idInstitucion,
      turno: d.turno,
      grado: d.grado,
      seccion: d.seccion,
      id_enfasis: d.idEnfasis,
      cantidad_alumnos: d.cantidad.trim() || null,
      manual: d.manual,
      dia: d.dia,
      hora_desde: d.desde,
      hora_hasta: d.hasta,
      id_materia: d.idMateria,
      id_docente: d.idDocente,
      telefono: d.telefono,
      id_facilitador: d.idFacilitador,
      observacion: d.observacion,
      estado: d.confirmado ? "SI" : "NO",
    }),
  })) as { id?: number };
  return Number(r.id ?? id ?? 0);
}

/** Baja. El trigger borra su postulación; 409 si está bloqueado. */
export async function eliminarPreHorario(id: number): Promise<void> {
  await authFetch(`pre-horarios/${id}`, { method: "DELETE" });
}

/**
 * El Formulario N° 1 con los PRE-HORARIOS en el detalle (22/10/2026, pedido de
 * Jose): el mismo PDF e imagen de la pestaña Postulaciones, para imprimirlo
 * antes de confirmar. Sin endpoint nuevo: la institución, las autoridades y el
 * horario salen de `postulaciones/formulario` (`f`) y acá solo se cambia el
 * detalle. Entran todos, confirmados o no. Cada pre-horario es una fila: su
 * cantidad en la columna de su grado y de su manual, y las horas en su día
 * (lo mismo que hace el trigger al confirmarlo). El N° vuelve a 1 en cada
 * turno, como en el impreso.
 */
export function formularioConPreHorarios(f: Formulario, items: PreHorario[]): Formulario {
  const orden = (p: PreHorario) =>
    `${p.turno ?? 9}-${DIAS.findIndex((d) => d.valor === p.dia) + 1 || 9}-${p.desde}`;
  const porTurno = new Map<number | null, number>();
  const detalle = [...items]
    .sort((a, b) => orden(a).localeCompare(orden(b)))
    .map((p) => {
      const nro = (porTurno.get(p.turno) ?? 0) + 1;
      porTurno.set(p.turno, nro);
      const cant = p.cantidad ?? 0;
      return {
        id: p.id,
        nroItem: nro,
        turno: p.turno,
        seccion: p.seccion,
        grados: Object.fromEntries(
          GRADOS.map((g) => [g.clave, g.valor === p.grado ? cant : 0]),
        ) as Detalle["grados"],
        manuales: Object.fromEntries(
          MANUALES.map((m) => [m.clave, m.valor === p.manual ? cant : 0]),
        ) as Detalle["manuales"],
        dias: Object.fromEntries(
          DIAS.map((d) => [
            d.clave,
            d.valor === p.dia ? { desde: p.desde, hasta: p.hasta } : { desde: "", hasta: "" },
          ]),
        ) as Detalle["dias"],
        materia: p.materia,
        docente: p.docente,
        telefono: p.telefono || p.docenteTelefono,
        enfasis: p.enfasis,
      };
    });
  return { ...f, detalle };
}

export const keysPreHorarios = {
  todo: ["pre-horarios"] as const,
  institucion: (id: number) => ["pre-horarios", id] as const,
  opciones: ["pre-horarios", "opciones"] as const,
};
