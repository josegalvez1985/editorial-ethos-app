/**
 * Inventario de manuales por sucursal. **Escribe sobre `INVENTARIOS`** y, al
 * cerrar, un trigger actualiza `EXISTENCIAS`.
 *
 * Contrato del backend: `backend/inventarios.sql`.
 *
 * ============================================================================
 * SE CUENTA POR MANUAL, NO POR ÍNDICE (cambiado el 25/09/2026)
 * ============================================================================
 *
 * La primera versión contaba cada índice; se sacó `INVENTARIOS.ID_INDICE` porque
 * lo que hay en el estante son manuales. `INDICES_MANUALES` no tiene tabla de
 * manuales: el `DISTINCT MANUAL` es el catálogo, así que **el identificador de un
 * manual es su texto**. Ver `listarManuales` en `lib/intervenciones-crud.ts`.
 *
 * ============================================================================
 * DOS TABLAS: LO DE HOY Y EL HISTORIAL
 * ============================================================================
 *
 * | Tabla | Qué guarda |
 * | --- | --- |
 * | `EXISTENCIAS` | lo que hay **hoy**: una fila por (manual, sucursal) |
 * | `INVENTARIOS` | el **historial**: una fila por cada inventario hecho |
 *
 * Por manual y sucursal hay a lo sumo **un conteo abierto** (lo garantiza un
 * índice único en la base). Al cerrar, pasa a la historia y el inventario
 * siguiente abre una fila nueva: los cerrados no se reabren.
 *
 * ============================================================================
 * LAS DOS CANTIDADES (decidido el 25/09/2026)
 * ============================================================================
 *
 * Se carga solo la **física** (lo que hay en el estante). La **de sistema** la
 * toma el backend de `EXISTENCIAS` en cada guardado: es lo que el sistema creía
 * que había cuando se contó. Al cerrar, `EXISTENCIAS` queda con la física.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

export type Sucursal = {
  id_sucursal: number;
  descripcion: string;
  /** Manuales con un conteo abierto (sin cerrar). */
  abiertos: number;
};

/**
 * `ABIERTO`: hay un conteo en curso. `CERRADO`: no hay conteo en curso, pero sí
 * inventarios anteriores. `SIN`: nunca se contó en esta sucursal.
 */
export type EstadoConteo = "SIN" | "ABIERTO" | "CERRADO";

/** Un manual en la planilla, se haya contado o no. */
export type FilaInventario = {
  /** El texto ES la clave: no hay tabla de manuales. */
  manual: string;
  /** Cuántos índices tiene: solo para mostrar. */
  indices: number;
  /** El conteo abierto. `null` si no hay uno en curso. */
  id_inventario: number | null;
  estado: EstadoConteo;
  /** Del conteo abierto. */
  cantidad_fisica: number | null;
  /** Lo que decía `EXISTENCIAS` cuando se hizo el conteo abierto. */
  cantidad_sistema: number | null;
  /** `DD/MM/YYYY HH24:MI` del conteo abierto. */
  fecha: string | null;
  /**
   * Lo que dice `EXISTENCIAS` **hoy**. `null` si el manual no tiene fila ahí,
   * que para el sistema es lo mismo que 0.
   */
  existencia_actual: number | null;
  fecha_existencia: string | null;
  /** El último inventario cerrado, como referencia. */
  cierre_cantidad: number | null;
  cierre_fecha: string | null;
};

/** Lo que va a tocar "Cerrar": todos los conteos abiertos de la sucursal. */
export type ResumenSucursal = {
  id_sucursal: number;
  descripcion: string;
  abiertos: number;
  /** Abiertos sin cantidad física o sin manual (solo desde APEX). Bloquean el cierre. */
  sin_cantidad: number;
};

export type Planilla = {
  resumen: ResumenSucursal;
  data: FilaInventario[];
};

/** Un cambio de la planilla. `cantidad: null` = borrar el conteo abierto. */
export type CambioConteo = { manual: string; cantidad: number | null };

export type ResultadoConteo = { guardados: number; borrados: number };

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const txt = (v: unknown) => (v == null || v === "" ? null : String(v));

export async function listarSucursales(): Promise<Sucursal[]> {
  const r = (await authFetch("inventarios/sucursales")) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map((row) => ({
    id_sucursal: Number(row.id_sucursal),
    descripcion: String(row.descripcion ?? ""),
    abiertos: Number(row.abiertos ?? 0),
  }));
}

/** La planilla de una sucursal: todos los manuales del catálogo. */
export async function obtenerPlanilla(idSucursal: number): Promise<Planilla> {
  const r = (await authFetch(`inventarios?id_sucursal=${idSucursal}`)) as {
    resumen?: Record<string, unknown>;
    data?: Record<string, unknown>[];
  };
  const s = r.resumen ?? {};

  return {
    resumen: {
      id_sucursal: Number(s.id_sucursal ?? idSucursal),
      descripcion: String(s.descripcion ?? ""),
      abiertos: Number(s.abiertos ?? 0),
      sin_cantidad: Number(s.sin_cantidad ?? 0),
    },
    data: (r.data ?? []).map((row) => ({
      manual: String(row.manual ?? ""),
      indices: Number(row.indices ?? 0),
      id_inventario: num(row.id_inventario),
      estado: (["ABIERTO", "CERRADO"].includes(String(row.estado))
        ? row.estado
        : "SIN") as EstadoConteo,
      cantidad_fisica: num(row.cantidad_fisica),
      cantidad_sistema: num(row.cantidad_sistema),
      fecha: txt(row.fecha),
      existencia_actual: num(row.existencia_actual),
      fecha_existencia: txt(row.fecha_existencia),
      cierre_cantidad: num(row.cierre_cantidad),
      cierre_fecha: txt(row.cierre_fecha),
    })),
  };
}

/**
 * Guarda varios conteos en una sola transacción: o entran todos o ninguno.
 *
 * Viajan como texto (`"Manual%201:5;Manual%202:"`) y no como array JSON: ORDS
 * bindea solo los campos escalares del body. El manual va con
 * `encodeURIComponent` porque es texto libre y podría traer `:` o `;`, que son
 * los separadores; el backend lo decodifica con `UTL_URL.UNESCAPE`.
 */
export async function guardarConteo(
  idSucursal: number,
  cambios: CambioConteo[],
): Promise<ResultadoConteo> {
  const items = cambios.map((c) => `${encodeURIComponent(c.manual)}:${c.cantidad ?? ""}`).join(";");
  const r = (await authFetch("inventarios/conteo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_sucursal: idSucursal, items }),
  })) as Record<string, unknown>;
  return {
    guardados: Number(r.guardados ?? 0),
    borrados: Number(r.borrados ?? 0),
  };
}

/**
 * Cierra todos los conteos abiertos de la sucursal y un trigger pasa las
 * cantidades físicas a `EXISTENCIAS`. **Desde la app no se deshace.**
 */
export async function cerrarInventario(idSucursal: number): Promise<number> {
  const r = (await authFetch("inventarios/cerrar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_sucursal: idSucursal }),
  })) as { cerrados?: number };
  return Number(r.cerrados ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * La cantidad de sistema contra la que se compara la física.
 *
 * Con un conteo abierto es la foto que tomó el backend al guardar. Si no, es lo
 * que dice `EXISTENCIAS` hoy, que es lo que el backend va a tomar al guardar.
 */
export function sistemaDe(f: FilaInventario): number {
  return f.estado === "ABIERTO" ? (f.cantidad_sistema ?? 0) : (f.existencia_actual ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Consulta de detalle (historial)                                            */
/* -------------------------------------------------------------------------- */

/** Un conteo del historial: una fila de `INVENTARIOS`, abierta o cerrada. */
export type ConteoHistorial = {
  id_inventario: number;
  id_sucursal: number;
  sucursal: string;
  manual: string;
  cantidad_sistema: number | null;
  cantidad_fisica: number | null;
  /** `DD/MM/YYYY HH24:MI` del conteo. */
  fecha: string | null;
  /** `ABIERTO` = pendiente de cerrar. */
  estado: "ABIERTO" | "CERRADO";
};

export type FiltrosHistorial = {
  /** Sin valor, todas las sucursales. */
  id_sucursal?: number;
  /** `N` pendientes, `S` cerrados. Sin valor, los dos. */
  estado?: "N" | "S";
  /** `YYYY-MM-DD`, inclusive. Es lo que da un `<input type="date">`. */
  desde?: string;
  hasta?: string;
};

export type Historial = {
  data: ConteoHistorial[];
  /**
   * El backend corta en `tope` filas: es un reporte sin paginar. Si llegó al
   * tope, lo que se ve —y el PDF— está incompleto, y la pantalla lo avisa.
   */
  truncado: boolean;
  tope: number;
};

export async function historialInventarios(f: FiltrosHistorial): Promise<Historial> {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v != null && v !== "") sp.set(k, String(v));
  const q = sp.toString();

  const r = (await authFetch(`inventarios/historial${q ? `?${q}` : ""}`)) as {
    data?: Record<string, unknown>[];
    truncado?: boolean;
    tope?: number;
  };
  return {
    truncado: r.truncado === true,
    tope: Number(r.tope ?? 0),
    data: (r.data ?? []).map((row) => ({
      id_inventario: Number(row.id_inventario),
      id_sucursal: Number(row.id_sucursal),
      sucursal: String(row.sucursal ?? ""),
      manual: String(row.manual ?? ""),
      cantidad_sistema: num(row.cantidad_sistema),
      cantidad_fisica: num(row.cantidad_fisica),
      fecha: txt(row.fecha),
      estado: String(row.estado) === "CERRADO" ? "CERRADO" : "ABIERTO",
    })),
  };
}

/** Física − sistema. `null` si falta alguna de las dos. */
export function diferenciaDe(c: ConteoHistorial): number | null {
  return c.cantidad_fisica == null || c.cantidad_sistema == null
    ? null
    : c.cantidad_fisica - c.cantidad_sistema;
}

export const keysInventario = {
  todo: ["inventarios"] as const,
  sucursales: ["inventarios", "sucursales"] as const,
  planilla: (idSucursal: number) => ["inventarios", "planilla", idSucursal] as const,
  historial: (f: FiltrosHistorial) => ["inventarios", "historial", f] as const,
};
