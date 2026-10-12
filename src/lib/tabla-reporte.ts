import { useMemo, useState } from "react";

/*
 * Ordenar y filtrar por columna en los reportes con detalle (pedido el
 * 12/10/2026), como el menú de columna de los reportes de APEX: tocar un
 * encabezado abre Ascendente / Descendente y la lista de valores de esa
 * columna, con cuántas filas tiene cada uno, para quedarse con algunos.
 *
 * Es lo que se aplica DESPUÉS de los filtros de la pantalla: la pantalla
 * decide qué filas llegan (año, facetas, buscador) y la tabla las ordena y las
 * recorta por columna. El Excel baja `visibles`: lo mismo que se ve, en el
 * mismo orden.
 *
 * La pieza visual es `<EncabezadoReporte>` y los chips `<FiltrosColumnas>`, en
 * `components/columna-reporte.tsx`.
 */

/** Una columna que se puede ordenar y filtrar. */
export type ColumnaReporte<T> = {
  clave: string;
  titulo: string;
  /** El texto de la celda: con él se filtra, y se ordena si no hay `orden`. */
  valor: (fila: T) => string | number | null | undefined;
  /**
   * Para ordenar, si el texto no ordena bien: una fecha `DD/MM/YYYY` ordena por
   * su `YYYYMMDD`, un número por el número.
   */
  orden?: (fila: T) => string | number | null | undefined;
  /** `false` en las que no tiene sentido filtrar por valor (ids, links). */
  filtrable?: boolean;
};

export type OrdenReporte = { clave: string; asc: boolean } | null;

/** El texto con el que se filtra; vacío para null. */
export const textoCelda = (v: string | number | null | undefined) => (v == null ? "" : String(v));

/** `DD/MM/YYYY` → `YYYYMMDD`, para ordenar fechas de texto. */
export const ordenFecha = (f: string | null | undefined) =>
  f && /^\d{2}\/\d{2}\/\d{4}/.test(f) ? `${f.slice(6, 10)}${f.slice(3, 5)}${f.slice(0, 2)}` : "";

function comparar(a: string | number | null | undefined, b: string | number | null | undefined) {
  const va = a == null || a === "";
  const vb = b == null || b === "";
  // Los vacíos al final, en los dos sentidos: como el `sort_null` L de APEX.
  if (va || vb) return va === vb ? 0 : va ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es", { numeric: true });
}

/**
 * El orden y los filtros por columna de una tabla. `columnas` tiene que ser
 * estable (una constante del módulo o un `useMemo`): si cambia en cada render,
 * la tabla se recalcula en cada render.
 */
export function useTablaReporte<T>(filas: readonly T[], columnas: readonly ColumnaReporte<T>[]) {
  const [orden, setOrden] = useState<OrdenReporte>(null);
  const [filtros, setFiltros] = useState<Record<string, string[]>>({});

  const porClave = useMemo(() => new Map(columnas.map((c) => [c.clave, c])), [columnas]);

  /** Si la fila pasa los filtros de columna; `salvo` ignora uno, para contar sus valores. */
  const pasa = useMemo(
    () => (f: T, salvo?: string) => {
      for (const [clave, valores] of Object.entries(filtros)) {
        if (clave === salvo || !valores.length) continue;
        const c = porClave.get(clave);
        if (c && !valores.includes(textoCelda(c.valor(f)))) return false;
      }
      return true;
    },
    [filtros, porClave],
  );

  const visibles = useMemo(() => {
    const xs = filas.filter((f) => pasa(f));
    const c = orden && porClave.get(orden.clave);
    if (!c || !orden) return xs;
    const clave = c.orden ?? c.valor;
    return xs.sort((a, b) => {
      const r = comparar(clave(a), clave(b));
      // Los vacíos quedan al final también en descendente.
      const vacio = clave(a) == null || clave(a) === "" || clave(b) == null || clave(b) === "";
      return orden.asc || vacio ? r : -r;
    });
  }, [filas, pasa, orden, porClave]);

  /**
   * Los valores de una columna con cuántas filas tiene cada uno, contando con
   * los OTROS filtros de columna puestos (como las facetas de APEX). En el
   * orden de la columna.
   */
  const valoresDe = (clave: string) => {
    const c = porClave.get(clave);
    if (!c) return [];
    const m = new Map<
      string,
      { valor: string; orden: string | number | null | undefined; n: number }
    >();
    for (const f of filas) {
      if (!pasa(f, clave)) continue;
      const v = textoCelda(c.valor(f));
      const ya = m.get(v);
      if (ya) ya.n++;
      else m.set(v, { valor: v, orden: (c.orden ?? c.valor)(f), n: 1 });
    }
    return [...m.values()].sort((a, b) => comparar(a.orden, b.orden));
  };

  const filtrar = (clave: string, valores: string[]) =>
    setFiltros((x) => {
      const sig = { ...x };
      if (valores.length) sig[clave] = valores;
      else delete sig[clave];
      return sig;
    });

  const limpiar = () => {
    setOrden(null);
    setFiltros({});
  };

  return {
    columnas,
    visibles,
    orden,
    ordenar: setOrden,
    filtros,
    filtrar,
    valoresDe,
    limpiar,
    /** Si hay algo puesto: un orden o algún filtro de columna. */
    activo: orden != null || Object.keys(filtros).length > 0,
  };
}

export type TablaReporte<T> = ReturnType<typeof useTablaReporte<T>>;
