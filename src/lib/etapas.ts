/**
 * Etapas (`ETAPAS`): períodos con fecha de inicio y de fin, sin nombre.
 * Contrato del backend: `backend/etapas.sql`.
 *
 * Reemplaza a la página 79 de APEX (el IG) y a su modal 80 (Crear etapa), que
 * en el sitio es el diálogo de `/etapas`. Como la tabla no tiene nombre, la
 * pantalla las numera por año y orden de inicio ("2ª etapa 2026").
 */

import { authFetch } from "@/lib/api";
import type { Uso } from "@/lib/facilitadores";

export type Etapa = {
  id: number;
  /** `YYYY-MM-DD`. */
  inicio: string;
  fin: string;
  /** Las tablas con filas de esta etapa. Con alguna, no se borra. */
  usos: Uso[];
};

export type DatosEtapa = { fecha_inicio: string; fecha_fin: string };

const s = (v: unknown) => (v == null ? "" : String(v));

/** Todas, por fecha de inicio. */
export async function listarEtapas(): Promise<Etapa[]> {
  const r = (await authFetch("etapas")) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_etapa),
    inicio: s(x.fecha_inicio),
    fin: s(x.fecha_fin),
    usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
      tabla: s(u.tabla),
      cantidad: Number(u.cantidad ?? 0),
    })),
  }));
}

/** Alta (`id` null) o modificación. Devuelve el id. */
export async function guardarEtapa(id: number | null, d: DatosEtapa): Promise<number> {
  const r = (await authFetch(id == null ? "etapas" : `etapas/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_etapa?: number };
  return Number(r.id_etapa ?? id ?? 0);
}

/** Baja. 409 si algo la usa. */
export async function eliminarEtapa(id: number): Promise<void> {
  await authFetch(`etapas/${id}`, { method: "DELETE" });
}

export const keysEtapas = {
  todo: ["etapas"] as const,
};
