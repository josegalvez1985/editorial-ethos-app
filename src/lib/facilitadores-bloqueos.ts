/**
 * Horarios bloqueados de los facilitadores (`FACILITADORES_DIAS_BLOQUEOS`,
 * 14/10/2026). Contrato del backend: `backend/facilitadores_dias_bloqueos.sql`.
 *
 * Tabla nueva, no viene de APEX: en el sitio es un modal de Facilitadores
 * (`components/bloqueos-facilitador.tsx`), por facilitador. **No controla
 * permisos** (pedido de Jose): quien entra a Facilitadores lo usa entero, y el
 * backend pide solo sesión.
 *
 * Una fila por facilitador y año lectivo; cada día (lunes a viernes) es un
 * texto con las franjas en que NO está disponible, separadas por coma:
 * `"07:00 - 08:00, 13:30 - 15:00"`. El backend las normaliza y valida igual.
 */

import { authFetch } from "@/lib/api";
import { minutos } from "@/lib/horario-instituciones";

export const DIAS = [
  { clave: "lunes", nombre: "Lunes", corto: "Lu" },
  { clave: "martes", nombre: "Martes", corto: "Ma" },
  { clave: "miercoles", nombre: "Miércoles", corto: "Mi" },
  { clave: "jueves", nombre: "Jueves", corto: "Ju" },
  { clave: "viernes", nombre: "Viernes", corto: "Vi" },
] as const;
export type Dia = (typeof DIAS)[number]["clave"];

/** El texto guardado de cada día ("" = libre). */
export type DiasBloqueo = Record<Dia, string>;

export type Bloqueo = {
  id: number;
  idFacilitador: number;
  idAnio: number;
  anio: number | null;
  dias: DiasBloqueo;
  /** `YYYY-MM-DDTHH:MI`, hora de Paraguay, de la bitácora. */
  cargadoEl: string;
  cargadoPor: string;
  modificadoEl: string;
  modificadoPor: string;
};

export type AnioBloqueo = { id: number; anio: number; vigente: boolean };

export type Bloqueos = {
  bloqueos: Bloqueo[];
  anios: AnioBloqueo[];
  /** El largo de cada columna de día (100). */
  largo: number;
};

export type Franja = { desde: string; hasta: string };

const s = (v: unknown) => (v == null ? "" : String(v));

/** Todos los bloqueos (de todos los facilitadores y años) y los años lectivos. */
export async function listarBloqueos(): Promise<Bloqueos> {
  const r = (await authFetch("facilitadores-bloqueos")) as {
    data?: Record<string, unknown>[];
    anios?: Record<string, unknown>[];
    largo?: number;
  };
  return {
    bloqueos: (r.data ?? []).map((x) => ({
      id: Number(x.id_bloqueo),
      idFacilitador: Number(x.id_facilitador),
      idAnio: Number(x.id_anio),
      anio: x.anio == null ? null : Number(x.anio),
      dias: Object.fromEntries(DIAS.map((d) => [d.clave, s(x[d.clave])])) as DiasBloqueo,
      cargadoEl: s(x.cargado_el),
      cargadoPor: s(x.cargado_por),
      modificadoEl: s(x.modificado_el),
      modificadoPor: s(x.modificado_por),
    })),
    anios: (r.anios ?? []).map((a) => ({
      id: Number(a.id_anio),
      anio: Number(a.anio),
      vigente: a.vigente === "S",
    })),
    largo: Number(r.largo ?? 100),
  };
}

/**
 * Alta (`id` null: con facilitador y año) o modificación (solo los días: el
 * facilitador y el año son los de la fila). Devuelve el id.
 */
export async function guardarBloqueo(
  id: number | null,
  d: { idFacilitador: number; idAnio: number; dias: DiasBloqueo },
): Promise<number> {
  const r = (await authFetch(
    id == null ? "facilitadores-bloqueos" : `facilitadores-bloqueos/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_facilitador: d.idFacilitador, id_anio: d.idAnio, ...d.dias }),
    },
  )) as { id_bloqueo?: number };
  return Number(r.id_bloqueo ?? id ?? 0);
}

export async function eliminarBloqueo(id: number): Promise<void> {
  await authFetch(`facilitadores-bloqueos/${id}`, { method: "DELETE" });
}

const RE_FRANJA = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
const dos = (n: string) => n.padStart(2, "0");

/**
 * El texto de un día → sus franjas. Lo que no se entiende (un dato cargado a
 * mano en la base) vuelve en `sobrante`, para mostrarlo en vez de perderlo
 * sin aviso.
 */
export function leerFranjas(texto: string): { franjas: Franja[]; sobrante: string[] } {
  const franjas: Franja[] = [];
  const sobrante: string[] = [];
  for (const parte of texto.split(",")) {
    const p = parte.trim();
    if (!p) continue;
    const m = p.match(RE_FRANJA);
    if (m) franjas.push({ desde: `${dos(m[1])}:${m[2]}`, hasta: `${dos(m[3])}:${m[4]}` });
    else sobrante.push(p);
  }
  return { franjas, sobrante };
}

/** Las franjas → el texto que se guarda, en orden de hora. Las vacías no van. */
export function textoFranjas(franjas: Franja[]): string {
  return franjas
    .filter((f) => f.desde || f.hasta)
    .sort((a, b) => (minutos(a.desde) ?? 0) - (minutos(b.desde) ?? 0))
    .map((f) => `${f.desde} - ${f.hasta}`)
    .join(", ");
}

/** Cuántas franjas tiene un bloqueo entre los cinco días. */
export function cuantasFranjas(b: Bloqueo): number {
  return DIAS.reduce((n, d) => n + leerFranjas(b.dias[d.clave]).franjas.length, 0);
}

/**
 * El año con que abre el modal: el vigente, o el más nuevo si no hay uno
 * activo. `vigente` lo marca el backend con `FN_ANIO_LECTIVO_ACTUAL()`, el
 * mismo "año actual" de horarios, pre-horarios y postulaciones.
 */
export function anioVigente(anios: AnioBloqueo[]): AnioBloqueo | undefined {
  return anios.find((a) => a.vigente) ?? anios[0];
}

export const keysBloqueos = {
  todo: ["facilitadores-bloqueos"] as const,
};
