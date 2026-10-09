/**
 * La escala de calificación de las evaluaciones (`ESCALAS_EVALUACIONES`): una
 * fila por cantidad de ítems marcados (0..32 hoy) con la calificación que le
 * toca. En la práctica son **tramos** que repiten el mismo texto. Contrato del
 * backend: `backend/escalas_evaluaciones.sql`.
 *
 * Reemplaza a la página 85 de APEX y a su modal 86 (Crear Escala), que en el
 * sitio es el diálogo de `/escalas-evaluacion`. La pantalla edita por tramos
 * (`PUT escalas-evaluacion/tramos`) y también fila por fila, como APEX.
 *
 * OJO: el formulario de evaluación todavía usa los tramos copiados en
 * `ESCALA` de `lib/evaluaciones.ts`. Si se cambian acá, hay que tocar eso.
 */

import { authFetch } from "@/lib/api";

export type FilaEscala = {
  id: number;
  /** Cuántos ítems marcados. `null` en una fila vieja sin número. */
  escala: number | null;
  calificacion: string;
  descripcion: string;
  /** Evaluaciones con este valor en `ESCALA` (FK por el valor). */
  usos: number;
};

export type Tramo = {
  desde: number;
  hasta: number;
  calificacion: string;
  descripcion: string;
  usos: number;
};

export type ListaEscala = {
  filas: FilaEscala[];
  largoCalificacion: number;
  largoDescripcion: number;
};

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarEscala(): Promise<ListaEscala> {
  const r = (await authFetch("escalas-evaluacion")) as {
    data?: Record<string, unknown>[];
    largo_calificacion?: number;
    largo_descripcion?: number;
  };
  return {
    filas: (r.data ?? []).map((x) => ({
      id: Number(x.id_escala),
      escala: x.escala == null || x.escala === "" ? null : Number(x.escala),
      calificacion: s(x.calificacion),
      descripcion: s(x.descripcion),
      usos: Number(x.usos ?? 0),
    })),
    largoCalificacion: Number(r.largo_calificacion ?? 100),
    largoDescripcion: Number(r.largo_descripcion ?? 500),
  };
}

/**
 * Las filas agrupadas en tramos: escalas seguidas con el mismo texto. Un hueco
 * en la numeración corta el tramo (y la pantalla lo avisa).
 */
export function aTramos(filas: FilaEscala[]): Tramo[] {
  const tramos: Tramo[] = [];
  for (const f of filas) {
    if (f.escala == null) continue;
    const t = tramos[tramos.length - 1];
    if (
      t &&
      t.hasta === f.escala - 1 &&
      t.calificacion.trim() === f.calificacion.trim() &&
      t.descripcion.trim() === f.descripcion.trim()
    ) {
      t.hasta = f.escala;
      t.usos += f.usos;
    } else {
      tramos.push({
        desde: f.escala,
        hasta: f.escala,
        calificacion: f.calificacion,
        descripcion: f.descripcion,
        usos: f.usos,
      });
    }
  }
  return tramos;
}

/** Reescribe la escala entera por tramos (el primero empieza en 0). */
export async function guardarTramos(
  tramos: { hasta: number; calificacion: string; descripcion: string }[],
): Promise<void> {
  await authFetch("escalas-evaluacion/tramos", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datos: JSON.stringify(tramos) }),
  });
}

/** Una fila: alta (`id` null) o modificación. */
export async function guardarFilaEscala(
  id: number | null,
  d: { escala: number; calificacion: string; descripcion: string },
): Promise<number> {
  const r = (await authFetch(id == null ? "escalas-evaluacion" : `escalas-evaluacion/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(d),
  })) as { id_escala?: number };
  return Number(r.id_escala ?? id ?? 0);
}

/** Baja de una fila. 409 si alguna evaluación la usa. */
export async function eliminarFilaEscala(id: number): Promise<void> {
  await authFetch(`escalas-evaluacion/${id}`, { method: "DELETE" });
}

export const keysEscala = {
  todo: ["escalas-evaluacion"] as const,
};
