/**
 * Auditoría: las bitácoras `_JN` de la base. **Solo lectura.**
 *
 * Contrato del backend: `backend/auditoria.sql`.
 *
 * ============================================================================
 * QUÉ ES UNA BITÁCORA
 * ============================================================================
 *
 * Para cada tabla auditada `X` hay una `X_JN` con una fila por cada INSERT,
 * UPDATE y DELETE: las columnas de `X` más seis de control (`JN_OPERATION`,
 * `JN_ORACLE_USER`, `JN_DATETIME`…). La escribe un trigger. `ID_AUDITORIA` es
 * el hilo que une la historia de una misma fila: el trigger lo asigna en el
 * alta y lo repite en cada cambio.
 *
 * ============================================================================
 * LA TRAMPA: NO TODOS LOS TRIGGERS GUARDAN LO MISMO EN UN UPDATE
 * ============================================================================
 *
 * | Trigger | En `UPD` guarda |
 * | --- | --- |
 * | `AUDITORIA_<TABLA>` (el que genera `pr_crear_trigger_auditoria`) | `:OLD`, el ANTES |
 * | `EVALUACIONES_FACILITADORES_JNTRG` (escrito a mano) | `:NEW`, el DESPUÉS |
 *
 * Así que para decir QUÉ cambió en un `UPD` hay que saber cuál es: con `OLD`
 * el valor nuevo está en la fila siguiente (o en la tabla, si fue el último
 * cambio); con `NEW` el valor viejo está en la fila anterior. El backend lo
 * deduce leyendo el trigger (`guarda_en_update`) y {@link reconstruir} arma el
 * diff con eso. Si no se pudo deducir, se asume `NEW` y la pantalla lo avisa.
 *
 * ============================================================================
 * LAS HORAS YA VIENEN EN HORA DE PARAGUAY
 * ============================================================================
 *
 * `JN_DATETIME` es la hora del servidor (UTC) y el backend la corre antes de
 * mandarla. Por eso acá las fechas son texto ISO **sin zona** y se formatean
 * cortando el string, sin pasar por `Date`: parsearlas con `new Date()` las
 * volvería a correr según el huso del navegador.
 */

import { authFetch } from "@/lib/api";

/* -------------------------------------------------------------------------- */
/* Operaciones                                                                */
/* -------------------------------------------------------------------------- */

export type Operacion = "INS" | "UPD" | "DEL";

export const OPERACIONES: Record<Operacion, { label: string; verbo: string }> = {
  INS: { label: "Alta", verbo: "Creó el registro" },
  UPD: { label: "Modificación", verbo: "Modificó el registro" },
  DEL: { label: "Baja", verbo: "Eliminó el registro" },
};

export function esOperacion(op: string): op is Operacion {
  return op === "INS" || op === "UPD" || op === "DEL";
}

/** La etiqueta de una operación. Una desconocida se muestra tal cual. */
export function labelOperacion(op: string): string {
  return esOperacion(op) ? OPERACIONES[op].label : op;
}

/* -------------------------------------------------------------------------- */
/* Tablas auditadas                                                           */
/* -------------------------------------------------------------------------- */

/** Qué guarda el trigger en un `UPD`. `null` = no se pudo deducir. */
export type GuardaEnUpdate = "OLD" | "NEW" | null;

export type TriggerAuditoria = {
  nombre: string;
  habilitado: boolean;
  /** `false` = INVALID: Oracle rechaza los cambios sobre la tabla. */
  valido: boolean;
  guarda_en_update: GuardaEnUpdate;
};

/**
 * Una columna, cruzada contra los tres lugares donde tiene que estar para que
 * sus cambios queden anotados.
 */
export type ColumnaTabla = {
  columna: string;
  /** Como en un DDL: `VARCHAR2(255)`, `NUMBER(10,2)`. */
  tipo: string;
  nulable: boolean;
  /** Sigue existiendo en la tabla. */
  en_tabla: boolean;
  /** La bitácora tiene dónde guardarla. */
  en_jn: boolean;
  /**
   * El trigger la lee. El backend lo saca de la fuente del trigger, no de
   * `USER_TRIGGER_COLS`: esa vista se cuelga en oracleapex.com.
   */
  en_trigger: boolean;
  es_pk: boolean;
};

export type TablaAuditada = {
  tabla: string;
  tabla_jn: string;
  /** `false` = la tabla se borró; queda la bitácora sola. */
  existe_tabla: boolean;
  /** Las columnas de la PK, separadas por coma. `null` si no tiene. */
  clave: string | null;
  triggers: TriggerAuditoria[];
  columnas: ColumnaTabla[];
  /** `null` si no se pudo contar la bitácora (ver `error`). */
  movimientos: number | null;
  inserciones: number | null;
  actualizaciones: number | null;
  eliminaciones: number | null;
  /** ISO local, sin zona. */
  primer_movimiento: string | null;
  ultimo_movimiento: string | null;
  error: string | null;
};

/**
 * El estado de una columna, del mejor al peor caso.
 *
 * | Estado | Qué pasa con sus cambios |
 * | --- | --- |
 * | `auditada` | Quedan anotados |
 * | `control` | Es `ID_AUDITORIA`, el hilo de la bitácora; no es un dato |
 * | `historica` | Ya no está en la tabla; su pasado sigue en la bitácora |
 * | `sin_trigger` | La bitácora tiene la columna pero el trigger no la lee |
 * | `sin_jn` | **Se pierden**: la bitácora no tiene dónde guardarla |
 *
 * `sin_jn` es la típica columna que se agregó a la tabla después de auditarla.
 * Correr `pr_crear_trigger_auditoria` de nuevo la suma a la bitácora y al
 * trigger.
 */
export type EstadoColumna = "auditada" | "control" | "historica" | "sin_trigger" | "sin_jn";

export const ESTADO_COLUMNA: Record<
  EstadoColumna,
  { label: string; ayuda: string; problema: boolean }
> = {
  auditada: { label: "Auditada", ayuda: "Sus cambios quedan anotados", problema: false },
  control: {
    label: "Control",
    ayuda: "ID_AUDITORIA: une la historia de cada fila",
    problema: false,
  },
  historica: {
    label: "Histórica",
    ayuda: "Ya no está en la tabla; su pasado sigue en la bitácora",
    problema: false,
  },
  sin_trigger: {
    label: "Fuera del trigger",
    ayuda: "La bitácora la tiene, pero el trigger no la lee",
    problema: true,
  },
  sin_jn: {
    label: "Sin auditar",
    ayuda: "La bitácora no tiene la columna: sus cambios se pierden",
    problema: true,
  },
};

export function estadoColumna(c: ColumnaTabla): EstadoColumna {
  if (c.columna === "ID_AUDITORIA") return "control";
  if (!c.en_tabla) return "historica";
  if (!c.en_jn) return "sin_jn";
  if (!c.en_trigger) return "sin_trigger";
  return "auditada";
}

/** Las columnas de datos que sí quedan anotadas, y el total de la tabla. */
export function coberturaColumnas(t: TablaAuditada): { auditadas: number; total: number } {
  const deLaTabla = t.columnas.filter((c) => c.en_tabla && c.columna !== "ID_AUDITORIA");
  return {
    auditadas: deLaTabla.filter((c) => estadoColumna(c) === "auditada").length,
    total: deLaTabla.length,
  };
}

export type Alerta = { nivel: "error" | "aviso"; texto: string };

/**
 * Lo que está mal en la auditoría de una tabla, de lo más grave a lo menos.
 *
 * Un trigger INVALID es un error y no un aviso: Oracle intenta recompilarlo en
 * cada INSERT/UPDATE/DELETE, falla, y **rechaza la operación**. La tabla queda
 * de solo lectura para todo el sistema, no solo sin auditar.
 */
export function alertasTabla(t: TablaAuditada): Alerta[] {
  const a: Alerta[] = [];

  if (t.error) a.push({ nivel: "error", texto: `No se pudo leer la bitácora: ${t.error}` });

  if (!t.existe_tabla) {
    a.push({ nivel: "aviso", texto: "La tabla ya no existe: queda solo la bitácora" });
    return a;
  }

  if (!t.triggers.length) {
    a.push({ nivel: "error", texto: "Sin trigger: los cambios no se anotan" });
    return a;
  }

  if (t.triggers.some((tr) => !tr.valido)) {
    a.push({ nivel: "error", texto: "Trigger inválido: Oracle rechaza los cambios en la tabla" });
  }
  if (t.triggers.some((tr) => !tr.habilitado)) {
    a.push({ nivel: "error", texto: "Trigger deshabilitado: los cambios no se anotan" });
  }
  if (t.triggers.length > 1) {
    a.push({
      nivel: "error",
      texto: `${t.triggers.length} triggers escriben la misma bitácora: cada cambio se anota ${t.triggers.length} veces`,
    });
  }

  const sinJn = t.columnas.filter((c) => estadoColumna(c) === "sin_jn").length;
  if (sinJn) {
    a.push({
      nivel: "aviso",
      texto: `${sinJn} columna${sinJn === 1 ? "" : "s"} sin auditar`,
    });
  }
  const sinTrigger = t.columnas.filter((c) => estadoColumna(c) === "sin_trigger").length;
  if (sinTrigger) {
    a.push({
      nivel: "aviso",
      texto: `${sinTrigger} columna${sinTrigger === 1 ? "" : "s"} fuera del trigger`,
    });
  }

  return a;
}

/** Qué convención usa la tabla, para decirlo en la pantalla. */
export function textoConvencion(g: GuardaEnUpdate): string {
  if (g === "OLD") return "En las modificaciones guarda el valor anterior";
  if (g === "NEW") return "En las modificaciones guarda el valor nuevo";
  return "No se pudo deducir qué guarda en las modificaciones";
}

/* -------------------------------------------------------------------------- */
/* Movimientos                                                                */
/* -------------------------------------------------------------------------- */

/** Una fila de alguna bitácora. */
export type Movimiento = {
  tabla: string;
  /** `null` si esa bitácora no tiene `ID_AUDITORIA`: no se puede seguir el registro. */
  id_auditoria: number | null;
  /** `INS` / `UPD` / `DEL`. Tipado como texto: una bitácora vieja podría traer otra cosa. */
  operacion: string;
  usuario: string | null;
  /** ISO local, sin zona. */
  fecha: string | null;
  sesion: string | null;
  aplicacion: string | null;
  notas: string | null;
  /** La PK legible: `"ID_INTERVENCION 123"`. `null` sin PK. */
  clave: string | null;
  /** El ROWID de la fila de bitácora: lo único único de un movimiento. */
  rid: string;
};

export type FiltrosMovimientos = {
  tabla?: string;
  operacion?: Operacion;
  /** Contiene, sin distinguir mayúsculas. */
  usuario?: string;
  /**
   * Contiene, en CUALQUIER columna de datos de la bitácora, sin distinguir
   * mayúsculas. Las fechas se buscan como se ven (`14/08/2026`). Lo que apunta a
   * otra tabla está guardado como ID: se encuentra por el número, no por el
   * nombre. Ver `f_filtro_busqueda` en el backend.
   */
  buscar?: string;
  /** `YYYY-MM-DD`. `hasta` es inclusivo. */
  desde?: string;
  hasta?: string;
  id_auditoria?: number;
  limite?: number;
  pagina?: number;
};

export type PaginaMovimientos = {
  data: Movimiento[];
  /** El total **sin paginar**. */
  total: number;
  pagina: number;
  limite: number;
};

/* -------------------------------------------------------------------------- */
/* Historial de un registro                                                   */
/* -------------------------------------------------------------------------- */

/** Los datos de una fila: columna → valor como texto. */
export type Valores = Record<string, string | null>;

export type ColumnaHistorial = {
  columna: string;
  en_tabla: boolean;
  en_jn: boolean;
  es_pk: boolean;
};

export type EventoHistorial = {
  operacion: string;
  usuario: string | null;
  fecha: string | null;
  sesion: string | null;
  aplicacion: string | null;
  notas: string | null;
  rid: string;
  /** Lo que la bitácora guardó en esa fila. Qué momento es depende de la convención. */
  valores: Valores;
};

export type Historial = {
  tabla: string;
  id_auditoria: number;
  existe_tabla: boolean;
  guarda_en_update: GuardaEnUpdate;
  /** Tope del backend: con esta cantidad de eventos, la lista puede estar cortada. */
  max_eventos: number;
  columnas: ColumnaHistorial[];
  /** De la más vieja a la más nueva. */
  eventos: EventoHistorial[];
  /** La fila como está hoy en la tabla. `null` si ya no está. */
  actual: Valores | null;
};

export type Cambio = { columna: string; antes: string | null; despues: string | null };

/**
 * Un movimiento, con la fila como estaba antes y como quedó después.
 *
 * `antes` / `despues`:
 * - un objeto: se sabe cómo estaba;
 * - `null`: **no existía** (antes de un alta, después de una baja);
 * - `undefined`: existía pero **no se puede saber** cómo estaba.
 */
export type Paso = {
  evento: EventoHistorial;
  antes: Valores | null | undefined;
  despues: Valores | null | undefined;
  /** Solo en `UPD`. `null` = no se puede reconstruir (falta uno de los dos lados). */
  cambios: Cambio[] | null;
};

/** De dónde sale un lado del diff: importa para saber qué columnas comparar. */
type Lado = { valores: Valores; fuente: "jn" | "actual" };

/**
 * Arma el antes y el después de cada movimiento. Ver el encabezado.
 *
 * | Convención | Antes de un `UPD` | Después de un `UPD` |
 * | --- | --- | --- |
 * | `OLD` | su propia fila | la fila siguiente, o la de la tabla hoy |
 * | `NEW` | la fila anterior | su propia fila |
 *
 * El alta siempre guarda la fila nueva y la baja la vieja, en las dos.
 *
 * Los casos sin respuesta, que la pantalla explica en vez de inventar:
 * - `NEW` y el primer movimiento es un `UPD`: la fila ya existía cuando se
 *   empezó a auditar la tabla y no hay registro de cómo estaba.
 * - `OLD` y el último movimiento es un `UPD` pero la fila ya no está en la
 *   tabla: se borró sin pasar por el trigger.
 */
export function reconstruir(h: Historial): Paso[] {
  const ev = h.eventos;
  const convencion = h.guarda_en_update ?? "NEW";
  const hoy: Lado | undefined = h.actual ? { valores: h.actual, fuente: "actual" } : undefined;
  const deJn = (e: EventoHistorial): Lado => ({ valores: e.valores, fuente: "jn" });
  // Conserva la diferencia entre `null` (no existía) y `undefined` (no se sabe).
  const valoresDe = (l: Lado | null | undefined) => (l ? l.valores : l);

  return ev.map((e, i): Paso => {
    let antes: Lado | null | undefined;
    let despues: Lado | null | undefined;

    if (e.operacion === "INS") {
      antes = null;
      despues = deJn(e);
    } else if (e.operacion === "DEL") {
      antes = deJn(e);
      despues = null;
    } else if (convencion === "OLD") {
      antes = deJn(e);
      const sig = ev[i + 1];
      // Un alta después de este cambio no guarda "cómo quedó" este: es otra vida
      // de la fila (el mismo ID_AUDITORIA reusado), no la continuación.
      despues = sig ? (sig.operacion === "INS" ? undefined : deJn(sig)) : hoy;
    } else {
      despues = deJn(e);
      const prev = ev[i - 1];
      antes = prev && prev.operacion !== "DEL" ? deJn(prev) : undefined;
    }

    return {
      evento: e,
      antes: valoresDe(antes),
      despues: valoresDe(despues),
      cambios:
        e.operacion === "UPD" && antes && despues ? diferencias(h.columnas, antes, despues) : null,
    };
  });
}

/**
 * Las columnas que cambiaron entre dos lados.
 *
 * Solo se comparan las que existen en las DOS fuentes: una columna histórica
 * está en la bitácora pero no en la tabla, y compararla contra la fila de hoy
 * la daría siempre por "borrada".
 *
 * Una columna que se sumó a la bitácora después de algunos movimientos aparece
 * como cambio de "vacío" a su valor en el primer movimiento que la anotó. Es
 * real desde el punto de vista de la bitácora y no se puede distinguir de un
 * cambio de verdad.
 */
function diferencias(columnas: ColumnaHistorial[], antes: Lado, despues: Lado): Cambio[] {
  const comparable = (c: ColumnaHistorial, l: Lado) => (l.fuente === "jn" ? c.en_jn : c.en_tabla);
  return columnas
    .filter((c) => comparable(c, antes) && comparable(c, despues))
    .map((c) => ({
      columna: c.columna,
      antes: antes.valores[c.columna] ?? null,
      despues: despues.valores[c.columna] ?? null,
    }))
    .filter((c) => c.antes !== c.despues);
}

/** Cómo está el registro hoy, en una palabra. */
export function estadoRegistro(h: Historial): "vigente" | "eliminado" | "sin_tabla" | "ausente" {
  if (!h.existe_tabla) return "sin_tabla";
  if (h.actual) return "vigente";
  if (h.eventos[h.eventos.length - 1]?.operacion === "DEL") return "eliminado";
  // Ni está en la tabla ni hay una baja anotada: se borró con el trigger apagado.
  return "ausente";
}

/**
 * La clave legible del registro (`"ID_INTERVENCION 123"`), sacada de la fila
 * más reciente que la tenga. `null` si la tabla no tiene PK.
 */
export function claveRegistro(h: Historial): string | null {
  const pk = h.columnas.filter((c) => c.es_pk).map((c) => c.columna);
  if (!pk.length) return null;
  const fuentes = [h.actual, ...[...h.eventos].reverse().map((e) => e.valores)];
  for (const v of fuentes) {
    if (v && pk.every((c) => v[c] != null)) return pk.map((c) => `${c} ${v[c]}`).join(", ");
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Formato                                                                    */
/* -------------------------------------------------------------------------- */

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

/**
 * `"2026-08-14T10:32:05"` → `"14/08/2026 10:32"` (o con segundos).
 *
 * Cortando el texto y no con `Date`: ver el encabezado. Lo que no tiene forma
 * de fecha se devuelve tal cual.
 */
export function formatearFechaHora(iso: string | null, conSegundos = false): string {
  if (!iso) return "—";
  const m = ISO.exec(iso);
  if (!m) return iso;
  const [, a, mes, d, h, min, s] = m;
  return `${d}/${mes}/${a} ${h}:${min}${conSegundos ? `:${s}` : ""}`;
}

/**
 * Un valor de columna para mostrar. Las fechas del backend llegan en ISO: se
 * pasan a `dd/mm/aaaa`, sin hora si es medianoche (una columna DATE que guarda
 * solo el día). El resto, tal cual. `null` sigue siendo `null`: la UI decide
 * cómo dibujar el vacío.
 */
export function formatearValor(v: string | null): string | null {
  if (v == null) return null;
  const m = ISO.exec(v);
  if (!m) return v;
  const [, a, mes, d, h, min, s] = m;
  if (h === "00" && min === "00" && s === "00") return `${d}/${mes}/${a}`;
  return `${d}/${mes}/${a} ${h}:${min}${s === "00" ? "" : `:${s}`}`;
}

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

type Crudo = Record<string, unknown>;

const texto = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const numero = (v: unknown): number | null =>
  v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
const guarda = (v: unknown): GuardaEnUpdate => (v === "OLD" || v === "NEW" ? v : null);

function normalizarTabla(r: Crudo): TablaAuditada {
  return {
    tabla: String(r.tabla),
    tabla_jn: String(r.tabla_jn),
    existe_tabla: r.existe_tabla !== false,
    clave: texto(r.clave),
    triggers: ((r.triggers as Crudo[] | undefined) ?? []).map((t) => ({
      nombre: String(t.nombre),
      habilitado: t.habilitado === true,
      valido: t.valido === true,
      guarda_en_update: guarda(t.guarda_en_update),
    })),
    columnas: ((r.columnas as Crudo[] | undefined) ?? []).map((c) => ({
      columna: String(c.columna),
      tipo: String(c.tipo ?? ""),
      nulable: c.nulable === true,
      en_tabla: c.en_tabla === true,
      en_jn: c.en_jn === true,
      en_trigger: c.en_trigger === true,
      es_pk: c.es_pk === true,
    })),
    movimientos: numero(r.movimientos),
    inserciones: numero(r.inserciones),
    actualizaciones: numero(r.actualizaciones),
    eliminaciones: numero(r.eliminaciones),
    primer_movimiento: texto(r.primer_movimiento),
    ultimo_movimiento: texto(r.ultimo_movimiento),
    error: texto(r.error),
  };
}

export async function listarTablas(): Promise<TablaAuditada[]> {
  const r = (await authFetch("auditoria/tablas")) as { data?: Crudo[] };
  return (r.data ?? []).map(normalizarTabla);
}

export async function listarMovimientos(f: FiltrosMovimientos = {}): Promise<PaginaMovimientos> {
  const r = (await authFetch(`auditoria/movimientos${qs({ ...f })}`)) as {
    data?: Crudo[];
    total?: number;
    pagina?: number;
    limite?: number;
  };

  return {
    data: (r.data ?? []).map((m) => ({
      tabla: String(m.tabla),
      id_auditoria: numero(m.id_auditoria),
      operacion: String(m.operacion ?? ""),
      usuario: texto(m.usuario),
      fecha: texto(m.fecha),
      sesion: texto(m.sesion),
      aplicacion: texto(m.aplicacion),
      notas: texto(m.notas),
      clave: texto(m.clave),
      rid: String(m.rid),
    })),
    total: Number(r.total ?? 0),
    pagina: Number(r.pagina ?? 1),
    limite: Number(r.limite ?? 50),
  };
}

/**
 * La historia de un registro.
 *
 * Cada evento llega PLANO: los datos con el nombre real de la columna
 * (MAYÚSCULAS) y los de control en minúscula. Acá se separan usando la lista
 * de `columnas`, así una columna que se llame `USUARIO` no se confunde con el
 * `usuario` que hizo el cambio.
 */
export async function obtenerHistorial(tabla: string, idAuditoria: number): Promise<Historial> {
  const r = (await authFetch(
    `auditoria/historial${qs({ tabla, id_auditoria: idAuditoria })}`,
  )) as Crudo;

  const columnas: ColumnaHistorial[] = ((r.columnas as Crudo[] | undefined) ?? []).map((c) => ({
    columna: String(c.columna),
    en_tabla: c.en_tabla === true,
    en_jn: c.en_jn === true,
    es_pk: c.es_pk === true,
  }));

  const valores = (fila: Crudo): Valores =>
    Object.fromEntries(columnas.map((c) => [c.columna, texto(fila[c.columna])]));

  const actual = ((r.actual as Crudo[] | undefined) ?? [])[0];

  return {
    tabla: String(r.tabla),
    id_auditoria: Number(r.id_auditoria),
    existe_tabla: r.existe_tabla !== false,
    guarda_en_update: guarda(r.guarda_en_update),
    max_eventos: Number(r.max_eventos ?? 500),
    columnas,
    eventos: ((r.eventos as Crudo[] | undefined) ?? []).map((e) => ({
      operacion: String(e.operacion ?? ""),
      usuario: texto(e.usuario),
      fecha: texto(e.fecha),
      sesion: texto(e.sesion),
      aplicacion: texto(e.aplicacion),
      notas: texto(e.notas),
      rid: String(e.rid),
      valores: valores(e),
    })),
    actual: actual ? valores(actual) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

/** Query string sin claves vacías. Igual que en `lib/evaluaciones.ts`. */
function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* -------------------------------------------------------------------------- */
/* Query keys                                                                 */
/* -------------------------------------------------------------------------- */

export const keysAuditoria = {
  tablas: () => ["auditoria-tablas"] as const,
  movimientos: (f: FiltrosMovimientos = {}) => ["auditoria-movimientos", f] as const,
  historial: (tabla: string, id: number) => ["auditoria-historial", tabla, id] as const,
};

/**
 * `meta` de TODAS las consultas de auditoría: **no se persisten** en
 * `localStorage` (ver `debePersistir` en `lib/query-persist.ts`).
 *
 * La bitácora trae datos de todas las tablas —CLOBs con los textos de las
 * evaluaciones incluidos—: dejarla en el disco del equipo sería guardar lo que
 * el resto de la app se cuida de no guardar, y puede llenar la cuota de
 * `localStorage`, que es la misma que usa el borrador de evaluación.
 */
export const META_AUDITORIA = { persistir: false } as const;
