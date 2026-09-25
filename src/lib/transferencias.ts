/**
 * Transferencias de manuales entre sucursales: cabecera (`TRANSFERENCIAS`) y
 * detalle (`TRANSFERENCIAS_DETALLE`, una línea por manual).
 *
 * Contrato del backend: `backend/transferencias.sql`.
 *
 * ============================================================================
 * LAS EXISTENCIAS SE MUEVEN AL RECIBIR, NO AL ENVIAR (25/09/2026)
 * ============================================================================
 *
 * Las mueve el trigger `TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS` al confirmar la
 * recepción: resta del origen y suma al destino. Hasta entonces nada se movió,
 * y de ahí salen las tres reglas de esta pantalla:
 *
 * 1. **Disponible ≠ existencia.** Mientras una transferencia viaja, el origen
 *    todavía "tiene" esos manuales. Lo disponible es la existencia menos lo
 *    comprometido en otras pendientes que salen de la misma sucursal.
 * 2. **Una recibida no se toca.** Editarla o borrarla no deshace el movimiento.
 * 3. **Recibir antes de inventariar.** Si se cierra un inventario del origen con
 *    una transferencia en viaje, al recibirla se descuenta dos veces.
 *
 * Si se envía más de lo disponible, se avisa pero se permite: las existencias
 * pueden estar desactualizadas (decidido el 25/09/2026).
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type Transferencia = {
  id_transferencia: number;
  id_sucursal_origen: number;
  origen: string;
  id_sucursal_destino: number;
  destino: string;
  /** `DD/MM/YYYY HH24:MI` de la creación. */
  fecha: string | null;
  recibida: boolean;
  /** Cuántos manuales distintos. */
  lineas: number;
  /** Cuántos libros en total. */
  unidades: number;
  /** Los manuales, separados por coma. */
  resumen: string | null;
};

export type LineaDetalle = { manual: string; cantidad: number };

export type TransferenciaDetalle = Omit<Transferencia, "lineas" | "unidades" | "resumen"> & {
  /** Solo si está recibida. Sale de la bitácora: no hay columna. */
  recibida_el: string | null;
  recibida_por: string | null;
  detalle: LineaDetalle[];
};

/** Un manual del catálogo, visto desde la sucursal de origen. */
export type ManualOrigen = {
  manual: string;
  /** `EXISTENCIAS.CANTIDAD_ACTUAL`. `null` si no tiene fila: para el sistema, 0. */
  existencia: number | null;
  /** En otras transferencias pendientes que salen de esta sucursal. */
  comprometido: number;
};

export type FiltrosTransferencias = {
  /** `N` pendientes, `S` recibidas. Sin valor, todas. */
  estado?: "N" | "S";
  /** Las que salen O llegan a esta sucursal. */
  id_sucursal?: number;
  limite?: number;
  pagina?: number;
};

export type PaginaTransferencias = { data: Transferencia[]; total: number };

export type TransferenciaInput = {
  id_sucursal_origen: number;
  id_sucursal_destino: number;
  lineas: LineaDetalle[];
};

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

const txt = (v: unknown) => (v == null || v === "" ? null : String(v));

function mapearCabecera(row: Record<string, unknown>) {
  return {
    id_transferencia: Number(row.id_transferencia),
    id_sucursal_origen: Number(row.id_sucursal_origen),
    origen: String(row.origen ?? ""),
    id_sucursal_destino: Number(row.id_sucursal_destino),
    destino: String(row.destino ?? ""),
    fecha: txt(row.fecha),
    recibida: String(row.ind_recibida ?? "N").toUpperCase() === "S",
  };
}

export async function listarTransferencias(
  f: FiltrosTransferencias = {},
): Promise<PaginaTransferencias> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null) sp.set(k, String(v));
  const q = sp.toString();

  const r = (await authFetch(`transferencias${q ? `?${q}` : ""}`)) as {
    data?: Record<string, unknown>[];
    total?: number;
  };
  return {
    total: Number(r.total ?? 0),
    data: (r.data ?? []).map((row) => ({
      ...mapearCabecera(row),
      lineas: Number(row.lineas ?? 0),
      unidades: Number(row.unidades ?? 0),
      resumen: txt(row.resumen),
    })),
  };
}

export async function obtenerTransferencia(id: number): Promise<TransferenciaDetalle> {
  const r = (await authFetch(`transferencias/${id}`)) as { data?: Record<string, unknown> };
  const d = r.data ?? {};
  return {
    ...mapearCabecera(d),
    recibida_el: txt(d.recibida_el),
    recibida_por: txt(d.recibida_por),
    detalle: ((d.detalle as Record<string, unknown>[] | undefined) ?? []).map((l) => ({
      manual: String(l.manual ?? ""),
      cantidad: Number(l.cantidad ?? 0),
    })),
  };
}

/**
 * El catálogo de manuales con lo que hay en la sucursal de origen.
 *
 * `excluirId` al editar: las líneas de la propia transferencia no cuentan como
 * comprometidas, o editarla "se quitaría stock a sí misma".
 */
export async function manualesDeOrigen(
  idSucursal: number,
  excluirId?: number,
): Promise<ManualOrigen[]> {
  const sp = new URLSearchParams({ id_sucursal: String(idSucursal) });
  if (excluirId) sp.set("excluir_id", String(excluirId));

  const r = (await authFetch(`transferencias/manuales?${sp}`)) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map((row) => ({
    manual: String(row.manual ?? ""),
    existencia: row.existencia == null ? null : Number(row.existencia),
    comprometido: Number(row.comprometido ?? 0),
  }));
}

/** Lo que se puede enviar sin dejar el origen en negativo. */
export function disponible(m: ManualOrigen): number {
  return (m.existencia ?? 0) - m.comprometido;
}

/**
 * El cuerpo de alta y modificación. Las líneas viajan como texto
 * (`"Manual%201:5;Manual%202:3"`) y no como array JSON: ORDS bindea solo los
 * campos escalares. El manual va con `encodeURIComponent` porque es texto
 * libre y podría traer `:` o `;`, que son los separadores.
 */
function cuerpo(input: TransferenciaInput) {
  return JSON.stringify({
    id_sucursal_origen: input.id_sucursal_origen,
    id_sucursal_destino: input.id_sucursal_destino,
    items: input.lineas.map((l) => `${encodeURIComponent(l.manual)}:${l.cantidad}`).join(";"),
  });
}

/** Alta. Devuelve el id generado. */
export async function crearTransferencia(input: TransferenciaInput): Promise<number> {
  const r = (await authFetch("transferencias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: cuerpo(input),
  })) as { id_transferencia?: number };
  return Number(r.id_transferencia ?? 0);
}

/** Modificación. Solo pendientes: el backend rechaza una recibida con 409. */
export async function actualizarTransferencia(
  id: number,
  input: TransferenciaInput,
): Promise<void> {
  await authFetch(`transferencias/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: cuerpo(input),
  });
}

/** Confirma la recepción: el trigger mueve las existencias. **No se deshace.** */
export async function recibirTransferencia(id: number): Promise<void> {
  await authFetch(`transferencias/${id}/recibir`, { method: "POST" });
}

/** Baja de una pendiente. */
export async function eliminarTransferencia(id: number): Promise<void> {
  await authFetch(`transferencias/${id}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* Consulta y reporte (historial)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Una LÍNEA de detalle con su cabecera repetida: así la manda el backend, y de
 * la misma lista salen las tres vistas (por transferencia, por ruta, por
 * manual). Ver `historial` en el SQL.
 */
export type LineaHistorial = {
  id_transferencia: number;
  id_sucursal_origen: number;
  origen: string;
  id_sucursal_destino: number;
  destino: string;
  fecha: string | null;
  recibida: boolean;
  /** Solo si está recibida. Sale de la bitácora. */
  recibida_el: string | null;
  manual: string;
  cantidad: number;
};

export type FiltrosHistorialTransf = {
  estado?: "N" | "S";
  /** Las que salen O llegan a esta sucursal. */
  id_sucursal?: number;
  /** `YYYY-MM-DD`, inclusive, sobre la fecha de alta. */
  desde?: string;
  hasta?: string;
};

export type HistorialTransferencias = {
  data: LineaHistorial[];
  /** El backend corta en `tope` líneas: si llegó, la vista y el PDF están incompletos. */
  truncado: boolean;
  tope: number;
};

export async function historialTransferencias(
  f: FiltrosHistorialTransf,
): Promise<HistorialTransferencias> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") sp.set(k, String(v));
  const q = sp.toString();

  const r = (await authFetch(`transferencias/historial${q ? `?${q}` : ""}`)) as {
    data?: Record<string, unknown>[];
    truncado?: boolean;
    tope?: number;
  };
  return {
    truncado: r.truncado === true,
    tope: Number(r.tope ?? 0),
    data: (r.data ?? []).map((row) => ({
      ...mapearCabecera(row),
      recibida_el: txt(row.recibida_el),
      manual: String(row.manual ?? ""),
      cantidad: Number(row.cantidad ?? 0),
    })),
  };
}

/** Una transferencia armada a partir de sus líneas. */
export type TransferenciaAgrupada = Omit<LineaHistorial, "manual" | "cantidad"> & {
  lineas: LineaDetalle[];
  unidades: number;
};

/**
 * Las líneas agrupadas por transferencia, en el orden en que llegaron (el
 * backend las manda de la más nueva a la más vieja).
 */
export function agruparPorTransferencia(lineas: LineaHistorial[]): TransferenciaAgrupada[] {
  const m = new Map<number, TransferenciaAgrupada>();
  for (const l of lineas) {
    let t = m.get(l.id_transferencia);
    if (!t) {
      const { manual: _m, cantidad: _c, ...cab } = l;
      t = { ...cab, lineas: [], unidades: 0 };
      m.set(l.id_transferencia, t);
    }
    t.lineas.push({ manual: l.manual, cantidad: l.cantidad });
    t.unidades += l.cantidad;
  }
  return [...m.values()];
}

export type Ruta = {
  origen: string;
  destino: string;
  transferencias: number;
  unidades: number;
};

/** Cuánto se movió por cada par origen → destino, de mayor a menor. */
export function resumirRutas(transf: TransferenciaAgrupada[]): Ruta[] {
  const m = new Map<string, Ruta>();
  for (const t of transf) {
    const k = `${t.id_sucursal_origen}>${t.id_sucursal_destino}`;
    const r = m.get(k) ?? { origen: t.origen, destino: t.destino, transferencias: 0, unidades: 0 };
    r.transferencias += 1;
    r.unidades += t.unidades;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.unidades - a.unidades);
}

export type ManualMovido = { manual: string; unidades: number; transferencias: number };

/** Cuánto se movió de cada manual, de mayor a menor. */
export function resumirManuales(lineas: LineaHistorial[]): ManualMovido[] {
  const m = new Map<string, ManualMovido & { ids: Set<number> }>();
  for (const l of lineas) {
    const r = m.get(l.manual) ?? {
      manual: l.manual,
      unidades: 0,
      transferencias: 0,
      ids: new Set(),
    };
    r.unidades += l.cantidad;
    r.ids.add(l.id_transferencia);
    m.set(l.manual, r);
  }
  return [...m.values()]
    .map(({ ids, ...r }) => ({ ...r, transferencias: ids.size }))
    .sort((a, b) => b.unidades - a.unidades);
}

export const keysTransferencias = {
  todo: ["transferencias"] as const,
  lista: (f: FiltrosTransferencias) => ["transferencias", "lista", f] as const,
  uno: (id: number) => ["transferencias", "uno", id] as const,
  manuales: (idSucursal: number, excluirId?: number) =>
    ["transferencias", "manuales", idSucursal, excluirId ?? 0] as const,
  historial: (f: FiltrosHistorialTransf) => ["transferencias", "historial", f] as const,
};
