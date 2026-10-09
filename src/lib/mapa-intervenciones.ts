/**
 * El mapa de intervenciones (página 25 de APEX): dónde marcó un facilitador en
 * un período. Contrato del backend: `intervenciones/mapa` y
 * `intervenciones/mapa/facilitadores` en `backend/intervenciones.sql`.
 *
 * El punto de cada institución NO es su ubicación cargada (son links acortados
 * de Google Maps, sin coordenadas): es la MEDIANA de sus propias marcaciones,
 * el mismo criterio que el gráfico de ubicación del inicio. "Lejos" es más de
 * `umbralMetros` (1 km) de ese punto.
 */

import { authFetch } from "@/lib/api";

export type PuntoMapa = {
  id: number;
  /** `YYYY-MM-DD`. */
  dia: string;
  /** `HH:MM`. */
  hora: string;
  idInstitucion: number | null;
  institucion: string;
  manual: string;
  nroIndice: string;
  indice: string;
  observacion: string;
  /** `null`: la marcación no tiene ubicación (o quedó en 0,0). */
  lat: number | null;
  lng: number | null;
  /** El punto deducido de la institución. */
  instLat: number | null;
  instLng: number | null;
  distancia: number | null;
};

export type FacilitadorMapa = { id: number; nombre: string; cantidad: number };

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export async function listarFacilitadoresMapa(
  desde: string,
  hasta: string,
): Promise<FacilitadorMapa[]> {
  const r = (await authFetch(
    `intervenciones/mapa/facilitadores?desde=${desde}&hasta=${hasta}`,
  )) as { data?: Record<string, unknown>[] };
  return (r.data ?? []).map((x) => ({
    id: Number(x.id_facilitador),
    nombre: s(x.nombre),
    cantidad: Number(x.cantidad ?? 0),
  }));
}

export async function listarPuntosMapa(
  desde: string,
  hasta: string,
  idFacilitador: number,
): Promise<{ umbralMetros: number; limite: number; puntos: PuntoMapa[] }> {
  const r = (await authFetch(
    `intervenciones/mapa?desde=${desde}&hasta=${hasta}&id_facilitador=${idFacilitador}`,
  )) as { umbral_metros?: number; limite?: number; data?: Record<string, unknown>[] };
  return {
    umbralMetros: Number(r.umbral_metros ?? 1000),
    limite: Number(r.limite ?? 0),
    puntos: (r.data ?? []).map((x) => ({
      id: Number(x.id),
      dia: s(x.dia),
      hora: s(x.hora),
      idInstitucion: n(x.id_institucion),
      institucion: s(x.institucion),
      manual: s(x.manual),
      nroIndice: s(x.nro_indice),
      indice: s(x.indice),
      observacion: s(x.observacion),
      lat: n(x.lat),
      lng: n(x.lng),
      instLat: n(x.inst_lat),
      instLng: n(x.inst_lng),
      distancia: n(x.distancia_metros),
    })),
  };
}

/** "850 m" o "3,2 km". */
export function textoDistancia(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

/** Texto seguro para HTML (los popups del mapa): la observación la escribe el facilitador. */
export const esc = (t: string) =>
  t.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const keysMapa = {
  facilitadores: (desde: string, hasta: string) =>
    ["mapa-intervenciones", "fac", desde, hasta] as const,
  puntos: (desde: string, hasta: string, id: number) =>
    ["mapa-intervenciones", "puntos", desde, hasta, id] as const,
};
