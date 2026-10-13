/**
 * Transferencias de manuales entre sucursales: cabecera (`TRANSFERENCIAS`) y
 * detalle (`TRANSFERENCIAS_DETALLE`).
 *
 * **Cada línea va a un facilitador y una institución** (12/10/2026): manual,
 * cantidad, `ID_FACILITADOR` e `ID_INSTITUCION`, los dos obligatorios al
 * guardar. Una transferencia reparte manuales entre varios; el mismo manual
 * puede repetirse si va a otro facilitador o a otra institución. Las líneas
 * viejas no los tienen (`null`): se ven como "Sin asignar" y hay que
 * completarlas para volver a guardar.
 *
 * Contrato del backend: `backend/transferencias.sql`.
 *
 * ============================================================================
 * LAS EXISTENCIAS SE MUEVEN AL RECIBIR, NO AL ENVIAR (25/09/2026)
 * ============================================================================
 *
 * Las mueve el trigger `TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS` al confirmar la
 * recepción: resta del origen y suma al destino. Hasta entonces nada se movió,
 * y de ahí salen las reglas de esta pantalla:
 *
 * 1. **Disponible ≠ existencia.** Mientras una transferencia viaja, el origen
 *    todavía "tiene" esos manuales. Lo disponible es la existencia menos lo
 *    comprometido en otras pendientes que salen de la misma sucursal.
 * 2. **Una recibida no se edita.** Primero se **revierte la recepción**
 *    (29/09/2026): el backend devuelve las existencias —suma al origen, resta
 *    al destino— y la deja pendiente. Eliminar una recibida hace lo mismo y
 *    después la borra.
 * 3. **Recibir antes de inventariar.** Si se cierra un inventario del origen con
 *    una transferencia en viaje, al recibirla se descuenta dos veces. Al revés
 *    también: revertir una recepción después de inventariar descuadra el conteo.
 *
 * Si se envía más de lo disponible, se avisa pero se permite: las existencias
 * pueden estar desactualizadas (decidido el 25/09/2026).
 */

import { authFetch } from "@/lib/api";
import {
  MANUALES,
  type ClaveManual,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { normalizar } from "@/lib/utils";

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
  /** Los facilitadores, separados por coma. */
  facilitadores: string | null;
};

/** A quién va una línea. `null` en las líneas de antes del 12/10/2026. */
export type Destinatario = {
  id_facilitador: number | null;
  facilitador: string | null;
  id_institucion: number | null;
  institucion: string | null;
};

export type LineaDetalle = Destinatario & { manual: string; cantidad: number };

export type TransferenciaDetalle = Omit<
  Transferencia,
  "lineas" | "unidades" | "resumen" | "facilitadores"
> & {
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

/** Al guardar, facilitador e institución son obligatorios. */
export type LineaInput = {
  manual: string;
  cantidad: number;
  id_facilitador: number;
  id_institucion: number;
};

export type TransferenciaInput = {
  id_sucursal_origen: number;
  id_sucursal_destino: number;
  lineas: LineaInput[];
};

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

function mapearDestinatario(row: Record<string, unknown>): Destinatario {
  return {
    id_facilitador: num(row.id_facilitador),
    facilitador: txt(row.facilitador),
    id_institucion: num(row.id_institucion),
    institucion: txt(row.institucion),
  };
}

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
      facilitadores: txt(row.facilitadores),
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
      ...mapearDestinatario(l),
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
 * (`"Manual%201:5:12:34;..."` = manual, cantidad, facilitador, institución) y
 * no como array JSON: ORDS bindea solo los campos escalares. El manual va con
 * `encodeURIComponent` porque es texto libre y podría traer `:` o `;`, que
 * son los separadores.
 */
function cuerpo(input: TransferenciaInput) {
  return JSON.stringify({
    id_sucursal_origen: input.id_sucursal_origen,
    id_sucursal_destino: input.id_sucursal_destino,
    items: input.lineas
      .map(
        (l) =>
          `${encodeURIComponent(l.manual)}:${l.cantidad}:${l.id_facilitador}:${l.id_institucion}`,
      )
      .join(";"),
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

/** Confirma la recepción: el trigger mueve las existencias. Se deshace con `revertirRecepcion`. */
export async function recibirTransferencia(id: number): Promise<void> {
  await authFetch(`transferencias/${id}/recibir`, { method: "POST" });
}

/**
 * Deshace la recepción: devuelve las existencias (suma al origen, resta al
 * destino) y la transferencia vuelve a quedar pendiente, editable.
 */
export async function revertirRecepcion(id: number): Promise<void> {
  await authFetch(`transferencias/${id}/revertir`, { method: "POST" });
}

/** Baja. Si estaba recibida, el backend antes devuelve las existencias. */
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
export type LineaHistorial = Destinatario & {
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
      ...mapearDestinatario(row),
      recibida_el: txt(row.recibida_el),
      manual: String(row.manual ?? ""),
      cantidad: Number(row.cantidad ?? 0),
    })),
  };
}

/** Una transferencia armada a partir de sus líneas. */
export type TransferenciaAgrupada = Omit<
  LineaHistorial,
  "manual" | "cantidad" | keyof Destinatario
> & {
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
      const {
        manual: _m,
        cantidad: _c,
        id_facilitador: _f,
        facilitador: _fn,
        id_institucion: _i,
        institucion: _in,
        ...cab
      } = l;
      t = { ...cab, lineas: [], unidades: 0 };
      m.set(l.id_transferencia, t);
    }
    t.lineas.push({
      manual: l.manual,
      cantidad: l.cantidad,
      id_facilitador: l.id_facilitador,
      facilitador: l.facilitador,
      id_institucion: l.id_institucion,
      institucion: l.institucion,
    });
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

/** "Ana Pérez · Esc. San José", o "Sin asignar" en las líneas viejas. */
export function textoDestinatario(d: Destinatario): string {
  if (d.id_facilitador == null && d.id_institucion == null) return "Sin asignar";
  return [d.facilitador ?? "Sin facilitador", d.institucion ?? "Sin institución"].join(" · ");
}

export type FacilitadorMovido = {
  facilitador: string;
  unidades: number;
  instituciones: number;
};

/** Cuánto recibió cada facilitador (en cuántas instituciones), de mayor a menor. */
export function resumirFacilitadores(lineas: LineaHistorial[]): FacilitadorMovido[] {
  const m = new Map<string, FacilitadorMovido & { insts: Set<string> }>();
  for (const l of lineas) {
    const k = l.id_facilitador == null ? "" : String(l.id_facilitador);
    const r = m.get(k) ?? {
      facilitador: l.facilitador ?? "Sin asignar",
      unidades: 0,
      instituciones: 0,
      insts: new Set(),
    };
    r.unidades += l.cantidad;
    if (l.id_institucion != null) r.insts.add(String(l.id_institucion));
    m.set(k, r);
  }
  return [...m.values()]
    .map(({ insts, ...r }) => ({ ...r, instituciones: insts.size }))
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

/* -------------------------------------------------------------------------- */
/* La cantidad sugerida por las postulaciones (13/10/2026)                    */
/* -------------------------------------------------------------------------- */

/*
 * Cada tarjeta (facilitador + institución) sugiere cuántos de cada manual
 * mandar: la suma de ese manual en las postulaciones ACTIVAS del año lectivo
 * actual de esa institución con ese facilitador. El criterio de Cantidad de
 * Manuales (la página 50), y la misma consulta: `postulaciones/todas` con
 * `id_institucion` (su caché la comparten las pantallas de postulaciones). Sin
 * SQL propio.
 *
 * El problema es el NOMBRE: acá un manual es el texto de
 * `INDICES_MANUALES.MANUAL`, y en POSTULACIONES son siete columnas fijas (SER …
 * LIDERAZGO). Jose confirmó el 13/10/2026 que el catálogo usa esos mismos
 * siete nombres (los de Envíos de Gráficas), así que se relacionan por el
 * nombre sin tildes ni mayúsculas ("Carácter" = "CARACTER"). Por las dudas, si
 * alguno no está igual se toma el ÚNICO que lo contenga como palabra ("Manual
 * Ser"); si no hay ninguno, o hay varios, no se adivina: la tarjeta lo avisa.
 */

/** Los siete manuales en cero. */
const sinManuales = () =>
  Object.fromEntries(MANUALES.map((m) => [m.clave, 0])) as Record<ClaveManual, number>;

/** La sugerencia de una tarjeta. */
export type SugerenciaTransferencia = {
  /** El año de las postulaciones: el lectivo actual (lo decide el backend). */
  anio: string;
  postulaciones: number;
  manuales: Record<ClaveManual, number>;
  total: number;
};

/** `postulaciones/todas` de una institución en el año lectivo actual. */
export const filtrosPostulacionesDe = (idInstitucion: number): FiltrosPostulaciones => ({
  anio: "",
  idDepartamento: null,
  idCiudad: null,
  idBarrio: null,
  idInstitucion,
  turno: null,
});

/** La suma por manual de las postulaciones activas del facilitador. */
export function sugerirPorPostulaciones(
  r: { anio: string; items: PostulacionFila[] },
  idFacilitador: number,
): SugerenciaTransferencia {
  const manuales = sinManuales();
  let postulaciones = 0;
  for (const p of r.items) {
    if (!p.activa || p.idFacilitador !== idFacilitador) continue;
    postulaciones++;
    for (const m of MANUALES) manuales[m.clave] += Number(p.manuales[m.clave]) || 0;
  }
  return {
    anio: r.anio,
    postulaciones,
    manuales,
    total: MANUALES.reduce((a, m) => a + manuales[m.clave], 0),
  };
}

const sinTildes = (s: string) =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * El manual del catálogo que corresponde a cada columna de POSTULACIONES, o
 * `null` si no hay uno solo (ver arriba).
 */
export function manualesDelCatalogo(catalogo: string[]): Record<ClaveManual, string | null> {
  const limpios = catalogo.map((c) => ({ c, n: sinTildes(c) }));
  return Object.fromEntries(
    MANUALES.map((m) => {
      const nombre = sinTildes(m.nombre);
      const igual = limpios.filter((x) => x.n === nombre);
      if (igual.length === 1) return [m.clave, igual[0].c];
      const contiene = limpios.filter((x) => ` ${x.n} `.includes(` ${nombre} `));
      return [m.clave, igual.length === 0 && contiene.length === 1 ? contiene[0].c : null];
    }),
  ) as Record<ClaveManual, string | null>;
}

/** La columna de POSTULACIONES de un manual del catálogo, o `null`. */
export function claveDeManual(
  manual: string,
  porClave: Record<ClaveManual, string | null>,
): ClaveManual | null {
  return MANUALES.find((m) => porClave[m.clave] === manual)?.clave ?? null;
}
