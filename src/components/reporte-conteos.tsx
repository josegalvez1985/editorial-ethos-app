import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador } from "@/components/admin-ui";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { historialInventarios, keysInventario, type ConteoHistorial } from "@/lib/inventarios";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

/*
 * El reporte de conteos de inventario de las páginas 76 y 77 de APEX, que son
 * la misma consulta sobre `INVENTARIOS` con las mismas columnas (Sucursal,
 * Manual, Fecha, Cantidad Física) y facetas (Sucursal, Manual):
 *
 * - `modo="ultimo"` (la 76, Inventarios de Manuales): el último conteo de cada
 *   manual en cada sucursal, el `MAX(ID_INVENTARIO)` por sucursal y manual de
 *   APEX. La vista "Último conteo" de `/consulta-inventarios`.
 * - `modo="todos"` (la 77, Historial de Inventarios de Manuales): todos los
 *   conteos. La página `/historial-inventarios`.
 *
 * Backend: `inventarios/historial` sin filtros (todos los conteos, con su
 * tope), la misma consulta de la vista Historial; el último se elige acá.
 *
 * Distinto de APEX, a propósito, en las dos:
 *
 * - **Sin la columna ni la faceta "Título".** La consulta de APEX cruza con
 *   `INDICES_MANUALES` por el manual, y desde el 25/09/2026 el inventario se
 *   cuenta por manual y no por índice: cada conteo salía repetido una vez por
 *   índice, con el título de ese índice. Acá es una fila por conteo.
 * - Un resumen, el total de la cantidad física al pie, una marca en los
 *   conteos que todavía no se cerraron, orden y filtro por columna, bordes
 *   verticales y Excel.
 * - En `todos`, 50 filas por página (APEX las mostraba todas; pueden ser miles).
 *   En `ultimo` van todas: son pocas.
 */

type Fila = ConteoHistorial & { busqueda: string };

const numero = new Intl.NumberFormat("es-PY");

/** Las filas por página en `todos`. */
const POR_PAGINA = 50;

/** "DD/MM/YYYY HH24:MI" → ordenable. */
const ordenFechaHora = (f: string | null) =>
  f && /^\d{2}\/\d{2}\/\d{4}/.test(f)
    ? `${f.slice(6, 10)}${f.slice(3, 5)}${f.slice(0, 2)}${f.slice(11).replace(/:/g, "")}`
    : "";

/** Las columnas visibles del reporte de APEX, en su orden. */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "sucursal", titulo: "Sucursal", valor: (c) => c.sucursal },
  { clave: "manual", titulo: "Manual", valor: (c) => c.manual },
  { clave: "fecha", titulo: "Fecha", valor: (c) => c.fecha, orden: (c) => ordenFechaHora(c.fecha) },
  { clave: "fisica", titulo: "Cantidad Física", valor: (c) => c.cantidad_fisica },
];

/** El orden de la consulta de APEX: fecha (la más nueva), sucursal y manual. */
function ordenDeEntrada(a: Fila, b: Fila) {
  return (
    ordenFechaHora(b.fecha).localeCompare(ordenFechaHora(a.fecha)) ||
    a.sucursal.localeCompare(b.sucursal, "es") ||
    a.manual.localeCompare(b.manual, "es")
  );
}

type Faceta = "sucursales" | "manuales";

/** `YYYY-MM-DD` de hoy, para el nombre del Excel. */
const hoy = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function ReporteConteos({
  modo,
  titulo,
  subtitulo,
  vistas,
}: {
  modo: "ultimo" | "todos";
  titulo: string;
  subtitulo: string;
  /** Algo para poner debajo del título (las pastillas de vista de la 76). */
  vistas?: ReactNode;
}) {
  const [sel, setSel] = useState<Record<Faceta, string[]>>({ sucursales: [], manuales: [] });
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(0);

  const historial = useQuery({
    queryKey: keysInventario.historial({}),
    queryFn: () => historialInventarios({}),
  });

  // Todos los conteos, o el último de cada sucursal + manual.
  const filas = useMemo<Fila[]>(() => {
    const todos = historial.data?.data ?? [];
    let elegidos: ConteoHistorial[] = todos;
    if (modo === "ultimo") {
      const m = new Map<string, ConteoHistorial>();
      for (const c of todos) {
        const clave = `${c.id_sucursal}|${c.manual}`;
        const ya = m.get(clave);
        if (!ya || c.id_inventario > ya.id_inventario) m.set(clave, c);
      }
      elegidos = [...m.values()];
    }
    return elegidos.map((c) => ({ ...c, busqueda: normalizar(`${c.sucursal} ${c.manual}`) }));
  }, [historial.data, modo]);

  const q = normalizar(texto.trim());
  const filtradas = useMemo(
    () =>
      filas
        .filter(
          (c) =>
            (!sel.sucursales.length || sel.sucursales.includes(c.sucursal)) &&
            (!sel.manuales.length || sel.manuales.includes(c.manual)) &&
            (!q || c.busqueda.includes(q)),
        )
        .sort(ordenDeEntrada),
    [filas, sel, q],
  );
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  // Las opciones de cada faceta con cuántas filas quedan con la otra y el
  // buscador puestos, ordenadas por cantidad como `sort_by_top_counts`.
  const opciones = (fa: Faceta, valor: (c: Fila) => string) => {
    const otra: Faceta = fa === "sucursales" ? "manuales" : "sucursales";
    const otroValor = (c: Fila) => (otra === "sucursales" ? c.sucursal : c.manual);
    const m = new Map<string, number>();
    for (const c of filas) {
      if (sel[otra].length && !sel[otra].includes(otroValor(c))) continue;
      if (q && !c.busqueda.includes(q)) continue;
      m.set(valor(c), (m.get(valor(c)) ?? 0) + 1);
    }
    for (const v of sel[fa]) if (!m.has(v)) m.set(v, 0);
    return [...m]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
      .map(([v, n]) => ({
        valor: v,
        texto: v,
        extra: `${numero.format(n)} ${n === 1 ? "fila" : "filas"}`,
      }));
  };

  const sucursales = new Set(visibles.map((c) => c.id_sucursal)).size;
  const fisica = visibles.reduce((s, c) => s + (c.cantidad_fisica ?? 0), 0);
  const abiertos = visibles.filter((c) => c.estado === "ABIERTO").length;
  const hayFiltros = sel.sucursales.length > 0 || sel.manuales.length > 0 || !!texto.trim();

  const paginar = modo === "todos";
  const paginas = paginar ? Math.max(1, Math.ceil(visibles.length / POR_PAGINA)) : 1;
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = paginar ? visibles.slice(desde, desde + POR_PAGINA) : visibles;

  const cambiar = (cambios: Partial<Record<Faceta, string[]>>) => {
    setSel((x) => ({ ...x, ...cambios }));
    setPagina(0);
  };

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{titulo}</h1>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
        <BotonExcel
          onDescargar={() =>
            descargarExcel(
              `inventario-${modo === "ultimo" ? "ultimo-conteo" : "historial"}-${hoy()}`,
              [
                ...COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                ["Cantidad sistema", (c) => c.cantidad_sistema],
                ["Estado", (c) => (c.estado === "ABIERTO" ? "Pendiente" : "Cerrado")],
              ],
              visibles,
            )
          }
          deshabilitado={!visibles.length}
        />
      </div>

      {vistas}

      {/* ── Filtros: las facetas de APEX ─────────────────────────────── */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <MultiSelectorModal
          label="Sucursal"
          placeholder="Todas"
          descripcion="Debajo de cada una, cuántas filas quedan con los otros filtros"
          value={sel.sucursales}
          onChange={(v) => cambiar({ sucursales: v })}
          opciones={opciones("sucursales", (c) => c.sucursal)}
          className="min-h-11 px-3.5 py-2 text-sm"
        />
        <MultiSelectorModal
          label="Manual"
          placeholder="Todos"
          descripcion="Debajo de cada uno, cuántas filas quedan con los otros filtros"
          value={sel.manuales}
          onChange={(v) => cambiar({ manuales: v })}
          opciones={opciones("manuales", (c) => c.manual)}
          className="min-h-11 px-3.5 py-2 text-sm"
        />
        <div className="sm:col-span-2 xl:col-span-1">
          <label className="mb-1.5 block text-sm font-medium">Buscar</label>
          <div className="[&>div]:mb-0">
            <Buscador
              valor={texto}
              onCambio={(v) => {
                setTexto(v);
                setPagina(0);
              }}
              placeholder="Sucursal o manual…"
            />
          </div>
        </div>
      </div>
      {hayFiltros && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => {
              setSel({ sucursales: [], manuales: [] });
              setTexto("");
              tabla.limpiar();
              setPagina(0);
            }}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="size-3" />
            Restablecer
          </button>
        </div>
      )}

      {historial.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Cargando…
        </div>
      ) : historial.isError ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No se pudo cargar la consulta.
        </p>
      ) : (
        <>
          {historial.data?.truncado && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              El historial pasó los {numero.format(historial.data.tope)} conteos y se cortó:{" "}
              {modo === "ultimo"
                ? "algún último conteo puede faltar."
                : "faltan los más viejos de algunas sucursales."}
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Resumen
              etiqueta={modo === "ultimo" ? "Manuales contados" : "Conteos"}
              valor={numero.format(visibles.length)}
            />
            <Resumen etiqueta="Sucursales" valor={numero.format(sucursales)} />
            <Resumen etiqueta="Libros contados" valor={numero.format(fisica)} />
            <Resumen
              etiqueta="Pendientes de cerrar"
              valor={numero.format(abiertos)}
              clase={abiertos ? "text-amber-600" : ""}
            />
          </div>

          {/* "Resultados de la Búsqueda": el reporte de APEX. */}
          <section className="rounded-lg border border-border bg-card shadow-soft">
            <FiltrosColumnas tabla={tabla} />
            {!visibles.length ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No se ha encontrado ningún dato.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
                    <thead>
                      <tr>
                        {COLUMNAS.map((c) => (
                          <th
                            key={c.clave}
                            className={`border-r border-b border-border bg-muted px-3 py-2 text-xs font-semibold last:border-r-0 ${
                              c.clave === "fisica" ? "text-right" : "text-left"
                            }`}
                          >
                            <EncabezadoReporte columna={c} tabla={tabla} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enPagina.map((c) => (
                        <tr key={c.id_inventario} className="hover:bg-muted/40">
                          <td className="border-r border-b border-border/60 px-3 py-1.5">
                            {c.sucursal}
                          </td>
                          <td className="border-r border-b border-border/60 px-3 py-1.5 font-medium">
                            {c.manual}
                          </td>
                          <td className="border-r border-b border-border/60 px-3 py-1.5 whitespace-nowrap tabular-nums">
                            {c.fecha}
                            {c.estado === "ABIERTO" && (
                              <span className="ml-1.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-500">
                                Pendiente
                              </span>
                            )}
                          </td>
                          <td className="border-b border-border/60 px-3 py-1.5 text-right tabular-nums">
                            {c.cantidad_fisica ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* El total de todo lo filtrado, no solo de la página. */}
                    <tfoot>
                      <tr className="bg-muted/60 font-semibold">
                        <td colSpan={3} className="border-r border-border/60 px-3 py-2">
                          Total
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {numero.format(fisica)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {paginar && (
                  <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-2 text-[12.5px]">
                    <button
                      type="button"
                      onClick={() => setPagina(pag - 1)}
                      disabled={pag === 0}
                      aria-label="Anterior"
                      className="grid size-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="px-1 text-muted-foreground tabular-nums">
                      {numero.format(desde + 1)} - {numero.format(desde + enPagina.length)} de{" "}
                      {numero.format(visibles.length)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPagina(pag + 1)}
                      disabled={pag >= paginas - 1}
                      aria-label="Siguiente"
                      className="grid size-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Resumen({
  etiqueta,
  valor,
  clase = "",
}: {
  etiqueta: string;
  valor: string;
  clase?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${clase}`}>{valor}</p>
    </div>
  );
}
