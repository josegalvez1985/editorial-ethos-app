/**
 * Feriados nacionales (`FERIADOS`). Contrato del backend: `backend/feriados.sql`.
 *
 * Reemplaza a la página 70 de APEX (el IG) y a su modal 71 (Crear Feriado), que
 * en el sitio es el diálogo de `/feriados`.
 */

import { authFetch } from "@/lib/api";

export type Feriado = {
  id: number;
  /** `YYYY-MM-DD`. */
  fecha: string;
  descripcion: string;
};

export type DatosFeriado = { fecha_feriado: string; descripcion: string };

const s = (v: unknown) => (v == null ? "" : String(v));

/** Todos, por fecha. */
export async function listarFeriados(): Promise<Feriado[]> {
  const r = (await authFetch("feriados")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_feriado),
    fecha: s(x.fecha_feriado),
    descripcion: s(x.descripcion),
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. 409 si el día ya es feriado. */
export async function guardarFeriado(id: number | null, d: DatosFeriado): Promise<number> {
  const r = (await authFetch(id == null ? "feriados" : `feriados/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_feriado?: number };
  return Number(r.id_feriado ?? id ?? 0);
}

export async function eliminarFeriado(id: number): Promise<void> {
  await authFetch(`feriados/${id}`, { method: "DELETE" });
}

/**
 * Copia los feriados de un año a otro con el mismo día y mes. Saltea los días
 * que ya son feriado y el 29 de febrero en un año que no lo tiene.
 */
export async function copiarFeriados(
  desde: number,
  hacia: number,
): Promise<{ copiados: number; salteados: number }> {
  const r = (await authFetch("feriados/copiar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ desde, hacia }),
  })) as { copiados?: number; salteados?: number };
  return { copiados: Number(r.copiados ?? 0), salteados: Number(r.salteados ?? 0) };
}

export const keysFeriados = {
  todo: ["feriados"] as const,
};
