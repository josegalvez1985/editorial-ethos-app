/**
 * ABM de los índices de los manuales (Núcleo de Datos). Contrato del backend:
 * `backend/indices.sql`.
 *
 * Es la página 28 de APEX (Índices) y su modal 29 (Crear Índice), que en el
 * sitio es el diálogo de `/indices`, con los permisos de la 28.
 *
 * `INDICES_MANUALES` **no tiene tabla de manuales**: `MANUAL` es el texto de
 * cada fila y el `DISTINCT` de esa columna es el catálogo que usan
 * evaluaciones, intervenciones, inventario y transferencias. Por eso guardar
 * acá refresca también sus listas (ver {@link invalidarIndices}).
 */

import type { QueryClient } from "@tanstack/react-query";

import type { Uso } from "@/components/catalogo-nombre";
import { authFetch } from "@/lib/api";
import { keysInventario } from "@/lib/inventarios";
import { keysTransferencias } from "@/lib/transferencias";

export type Indice = {
  id: number;
  manual: string;
  nro: number;
  titulo: string;
  usos: Uso[];
};

export type ListaIndices = { items: Indice[]; tablas: string[] };

export type DatosIndice = { manual: string; nro: number; titulo: string };

const s = (v: unknown) => (v == null ? "" : String(v));

export async function listarIndices(): Promise<ListaIndices> {
  const r = (await authFetch("indices")) as {
    data?: Record<string, unknown>[];
    tablas?: unknown[];
  };
  return {
    items: (r.data ?? []).map((x) => ({
      id: Number(x.id_indice),
      manual: s(x.manual),
      nro: Number(x.nro_indice ?? 0),
      titulo: s(x.titulo),
      usos: ((x.usos as Record<string, unknown>[] | undefined) ?? []).map((u) => ({
        tabla: s(u.tabla),
        cantidad: Number(u.cantidad ?? 0),
      })),
    })),
    tablas: (r.tablas ?? []).map(String),
  };
}

/**
 * Alta (`id` null) o modificación. Devuelve el id y el manual **con la grafía
 * con que quedó**: si se escribió "manual 7" y ya existía "Manual 7", el
 * backend guarda el de siempre.
 */
export async function guardarIndice(
  id: number | null,
  d: DatosIndice,
): Promise<{ id: number; manual: string }> {
  const r = (await authFetch(id == null ? "indices" : `indices/${id}`, {
    method: id == null ? "POST" : "PUT",
    headers: { "Content-Type": "application/json" },
    // El número como texto: el backend lo lee con punto sin depender del NLS.
    body: JSON.stringify({ manual: d.manual, nro_indice: String(d.nro), titulo: d.titulo }),
  })) as { id_indice?: number; manual?: string };
  return { id: Number(r.id_indice ?? id ?? 0), manual: s(r.manual) || d.manual };
}

/** Baja. El backend responde 409 si una intervención o una evaluación lo usa. */
export async function eliminarIndice(id: number): Promise<void> {
  await authFetch(`indices/${id}`, { method: "DELETE" });
}

export const keysIndices = {
  todo: ["indices-manuales"] as const,
};

/**
 * Todo lo que lee `INDICES_MANUALES` por otro lado: los combos Manual → Índice
 * de Intervenciones (`["manuales"]`, `["indices", manual]`) y de Evaluaciones
 * (`["lista", "indices", …]`), el índice que le toca a una postulación, y las
 * planillas de Inventario y Transferencias, que listan un renglón por manual.
 */
export function invalidarIndices(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: keysIndices.todo });
  qc.invalidateQueries({ queryKey: ["manuales"] });
  qc.invalidateQueries({ queryKey: ["indices"] });
  qc.invalidateQueries({ queryKey: ["lista", "indices"] });
  qc.invalidateQueries({ queryKey: ["indice-siguiente"] });
  qc.invalidateQueries({ queryKey: keysInventario.todo });
  qc.invalidateQueries({ queryKey: keysTransferencias.todo });
}
