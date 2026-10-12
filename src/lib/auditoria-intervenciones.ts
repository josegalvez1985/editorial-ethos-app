/**
 * La bitácora de intervenciones (`INTERVENCIONES_JN`): la página 58 de APEX,
 * Auditoría de Intervenciones. Contrato: `backend/auditoria_intervenciones.sql`.
 *
 * Es aparte de `lib/auditoria.ts` (la pantalla Auditoría, genérica para todas
 * las bitácoras): acá llegan TODAS las columnas de la intervención, con los
 * ids resueltos, para el reporte de la 58.
 */

import { authFetch } from "@/lib/api";

/** `INS` / `UPD` / `DEL`. Como texto: una bitácora vieja podría traer otra cosa. */
export type OperacionJn = string;

/** Cómo la mostraba APEX: el texto y el color de la pastilla. */
export const OPERACIONES: Record<string, { texto: string; color: string }> = {
  INS: { texto: "Insertó", color: "green" },
  UPD: { texto: "Actualizó", color: "blue" },
  DEL: { texto: "Borró", color: "red" },
};

export type MovimientoIntervencion = {
  id_auditoria: number | null;
  operacion: OperacionJn;
  /** Quién hizo el cambio (JN_ORACLE_USER). */
  usuario: string | null;
  /** Su nombre, si es el usuario de un facilitador. */
  nombre_usuario: string | null;
  /** `DD/MM/YYYY HH24:MI:SS`, ya en hora de Paraguay. */
  fecha_auditoria: string;
  /** `YYYYMMDDHH24MISS`, para ordenar. */
  orden_auditoria: string;
  id_institucion: number | null;
  institucion: string | null;
  id_indice: number | null;
  nro_indice: number | null;
  indice_titulo: string | null;
  si_no: string | null;
  grado: string | null;
  id_enfasis: number | null;
  enfasis: string | null;
  motivo_desarrollo: string | null;
  seccion: string | null;
  turno: number | null;
  id_facilitador: number | null;
  facilitador: string | null;
  /** `DD/MM/YYYY HH24:MI:SS`. */
  fecha_intervencion: string | null;
  manual: string | null;
  latitud: string | null;
  longitud: string | null;
  observacion: string | null;
  id_intervencion: number | null;
  id_postulacion: number | null;
  /** El usuario del facilitador guardado en la intervención (USUARIO). */
  usuario_facilitador: string | null;
};

const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Los movimientos de un período (`YYYY-MM-DD`, hasta un año), por fecha de auditoría. */
export async function listarAuditoriaIntervenciones(
  desde: string,
  hasta: string,
): Promise<{ data: MovimientoIntervencion[]; truncado: boolean; limite: number }> {
  const r = (await authFetch(
    `auditoria-intervenciones?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
  )) as Record<string, unknown>;
  return {
    data: ((r.data as Record<string, unknown>[] | undefined) ?? []).map((x) => ({
      id_auditoria: num(x.id_auditoria),
      operacion: String(x.operacion ?? ""),
      usuario: txt(x.usuario),
      nombre_usuario: txt(x.nombre_usuario),
      fecha_auditoria: String(x.fecha_auditoria ?? ""),
      orden_auditoria: String(x.orden_auditoria ?? ""),
      id_institucion: num(x.id_institucion),
      institucion: txt(x.institucion),
      id_indice: num(x.id_indice),
      nro_indice: num(x.nro_indice),
      indice_titulo: txt(x.indice_titulo),
      si_no: txt(x.si_no),
      grado: txt(x.grado),
      id_enfasis: num(x.id_enfasis),
      enfasis: txt(x.enfasis),
      motivo_desarrollo: txt(x.motivo_desarrollo),
      seccion: txt(x.seccion),
      turno: num(x.turno),
      id_facilitador: num(x.id_facilitador),
      facilitador: txt(x.facilitador),
      fecha_intervencion: txt(x.fecha_intervencion),
      manual: txt(x.manual),
      latitud: txt(x.latitud),
      longitud: txt(x.longitud),
      observacion: txt(x.observacion),
      id_intervencion: num(x.id_intervencion),
      id_postulacion: num(x.id_postulacion),
      usuario_facilitador: txt(x.usuario_facilitador),
    })),
    truncado: r.truncado === true,
    limite: Number(r.limite ?? 0),
  };
}

export const keysAuditoriaIntervenciones = {
  periodo: (desde: string, hasta: string) => ["auditoria-intervenciones", desde, hasta] as const,
};
