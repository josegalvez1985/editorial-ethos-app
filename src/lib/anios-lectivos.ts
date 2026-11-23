/**
 * Años lectivos (`ANIOS_LECTIVOS`). Contrato del backend:
 * `backend/anios_lectivos.sql` (la tabla, `FN_ANIO_LECTIVO_ACTUAL()` y, desde
 * el 09/10/2026, el ABM de `PKG_ANIOS_LECTIVOS_ETHOS`).
 *
 * Reemplaza a la página 57 de APEX (el IG) y a su modal 59 (Crea Año Lectivo),
 * que en el sitio es el diálogo de `/anios-lectivos`.
 *
 * **El vigente es el de ESTADO 'A'** y hay uno solo: guardar otro como activo
 * desactiva al anterior en el backend, en la misma transacción. De ese año
 * cuelgan los combos de evaluaciones y "el año actual" de horarios,
 * pre-horarios y postulaciones.
 */

import { authFetch } from "@/lib/api";
import type { Uso } from "@/lib/facilitadores";

export type AnioLectivo = {
  id: number;
  anio: number;
  descripcion: string;
  estado: string;
  vigente: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  hasta: string;
  /** Las tablas con datos de ese año (postulaciones, pre-horarios, horarios…). */
  usos: Uso[];
};

export type DatosAnioLectivo = {
  anio: number;
  descripcion: string;
  /** 'A' (vigente) o 'I'. */
  estado: "A" | "I";
  fecha_desde: string;
  fecha_hasta: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarAniosLectivos(): Promise<AnioLectivo[]> {
  const r = (await authFetch("anios-lectivos")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_anio),
    anio: Number(x.anio),
    descripcion: s(x.descripcion),
    estado: s(x.estado),
    vigente: x.es_vigente === "S",
    desde: s(x.fecha_desde),
    hasta: s(x.fecha_hasta),
    usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
      tabla: s(u.tabla),
      cantidad: Number(u.cantidad ?? 0),
    })),
  }));
}

export type ResultadoGuardarAnio = {
  id: number;
  /** El año que dejó de ser el vigente, si hubo. */
  desactivado: number | null;
  /**
   * Lo que inactivó `TRG_ANIOS_LECTIVOS_INACTIVAR` (23/11/2026): cuando el
   * vigente deja de serlo, todas las instituciones y todos los facilitadores
   * pasan a inactivos. 0 si el vigente no cambió.
   */
  institucionesInactivadas: number;
  facilitadoresInactivados: number;
};

/**
 * Alta (`id` null) o modificación. Devuelve el id, el año que dejó de ser el
 * vigente y cuántas instituciones y facilitadores se inactivaron.
 */
export async function guardarAnioLectivo(
  id: number | null,
  d: DatosAnioLectivo,
): Promise<ResultadoGuardarAnio> {
  const r = (await authFetch(id == null ? "anios-lectivos" : `anios-lectivos/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as {
    id_anio?: number;
    desactivado?: number | null;
    instituciones_inactivadas?: number;
    facilitadores_inactivados?: number;
  };
  return {
    id: Number(r.id_anio ?? id ?? 0),
    desactivado: r.desactivado == null ? null : Number(r.desactivado),
    institucionesInactivadas: Number(r.instituciones_inactivadas ?? 0),
    facilitadoresInactivados: Number(r.facilitadores_inactivados ?? 0),
  };
}

/**
 * "Se inactivaron 120 instituciones y 35 facilitadores", o `null` si no se
 * inactivó nada.
 */
export function textoInactivados(r: ResultadoGuardarAnio): string | null {
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [
    ...(r.institucionesInactivadas
      ? [plural(r.institucionesInactivadas, "institución", "instituciones")]
      : []),
    ...(r.facilitadoresInactivados
      ? [plural(r.facilitadoresInactivados, "facilitador", "facilitadores")]
      : []),
  ];
  if (!partes.length) return null;
  const uno = r.institucionesInactivadas + r.facilitadoresInactivados === 1;
  return `Se ${uno ? "inactivó" : "inactivaron"} ${partes.join(" y ")}.`;
}

/** Lo que pasa al dejar de ser vigente un año: va en las confirmaciones. */
export const AVISO_INACTIVAR =
  "Además se inactivan todas las instituciones y todos los facilitadores. Vuelven a activarse al confirmarles un pre-horario del año nuevo, o a mano desde su ficha.";

/** Baja. 409 si es el vigente o si tiene datos. */
export async function eliminarAnioLectivo(id: number): Promise<void> {
  await authFetch(`anios-lectivos/${id}`, { method: "DELETE" });
}

export const keysAniosLectivos = {
  todo: ["anios-lectivos"] as const,
};
