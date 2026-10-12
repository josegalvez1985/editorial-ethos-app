import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { keysEscala, listarEscala } from "@/lib/escalas-evaluacion";
import { todasLasEvaluaciones, type Evaluacion } from "@/lib/evaluaciones";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/monitoreo-facilitadores/")({
  head: () => ({
    meta: [
      { title: "Monitoreo de Facilitadores — Juventud con Valores" },
      {
        name: "description",
        content: "Las evaluaciones de los facilitadores, ítem por ítem, con su calificación.",
      },
    ],
  }),
  component: MonitoreoFacilitadoresPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

/** El valor del filtro de año que trae todos (APEX traía todo junto). */
const TODOS = "*";

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
const ddmmyyyy = (f: string | null) => (f ? f.slice(0, 10).split("-").reverse().join("/") : "");

/**
 * Una fila de `EVALUACIONES_FACILITADORES` (un ítem evaluado, no una
 * evaluación entera: ver backend/README → "Cabecera y detalle"), con la
 * calificación y la descripción de su escala, como el `LEFT JOIN
 * ESCALAS_EVALUACIONES` de APEX.
 */
type Fila = Evaluacion & {
  fechaDesde: string;
  fechaHasta: string;
  calificacion: string;
  escalaDescripcion: string;
  cerrado: string;
  busqueda: string;
};

/**
 * Las columnas visibles del reporte de APEX, en su orden. Cada una se ordena y
 * se filtra desde su encabezado (`lib/tabla-reporte.ts`).
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "facilitador", titulo: "Nombre Apellido", valor: (f) => f.facilitador },
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  { clave: "ciudad", titulo: "Ciudad", valor: (f) => f.ciudad },
  {
    clave: "desde",
    titulo: "Fecha Desde",
    valor: (f) => f.fechaDesde,
    orden: (f) => ordenFecha(f.fechaDesde),
  },
  {
    clave: "hasta",
    titulo: "Fecha Hasta",
    valor: (f) => f.fechaHasta,
    orden: (f) => ordenFecha(f.fechaHasta),
  },
  { clave: "evaluado_por", titulo: "Evaluado Por", valor: (f) => f.evaluado_por },
  { clave: "area", titulo: "Área", valor: (f) => f.area },
  { clave: "evaluacion", titulo: "Evaluación", valor: (f) => f.evaluacion },
  { clave: "calificacion", titulo: "Calificación", valor: (f) => f.calificacion },
  { clave: "escala", titulo: "Escala Descripción", valor: (f) => f.escalaDescripcion },
  { clave: "positivos", titulo: "Aspectos Positivos", valor: (f) => f.aspectos_positivos },
  { clave: "mejorar", titulo: "Aspectos Mejorar", valor: (f) => f.aspectos_mejorar },
  { clave: "observacion", titulo: "Observación Admin", valor: (f) => f.observacion_admin },
  { clave: "cerrado", titulo: "Cerrado", valor: (f) => f.cerrado },
];

/** El orden de la consulta de APEX: fecha desde (la más nueva) y nombre. */
function ordenDeEntrada(a: Fila, b: Fila) {
  return (
    ordenFecha(b.fechaDesde).localeCompare(ordenFecha(a.fechaDesde)) ||
    (a.facilitador ?? "").localeCompare(b.facilitador ?? "", "es")
  );
}

type Faceta = "facilitadores" | "instituciones";
type Filtros = Record<Faceta, string[]> & { texto: string };

const FACETAS: { clave: Faceta; valor: (f: Fila) => string; texto: (f: Fila) => string }[] = [
  {
    clave: "facilitadores",
    valor: (f) => String(f.id_facilitador),
    texto: (f) => f.facilitador ?? `#${f.id_facilitador}`,
  },
  {
    clave: "instituciones",
    valor: (f) => String(f.id_institucion),
    texto: (f) => f.institucion ?? `#${f.id_institucion}`,
  },
];

const SIN_FILTROS: Filtros = { facilitadores: [], instituciones: [], texto: "" };

function pasa(f: Fila, x: Filtros, salvo?: Faceta) {
  for (const fa of FACETAS) {
    if (fa.clave === salvo) continue;
    if (x[fa.clave].length && !x[fa.clave].includes(fa.valor(f))) return false;
  }
  const q = normalizar(x.texto.trim());
  return !q || f.busqueda.includes(q);
}

/**
 * Monitoreo de Facilitadores: la página 87 de APEX (una búsqueda con facetas
 * sobre `EVALUACIONES_FACILITADORES`): cada ítem evaluado de cada evaluación,
 * con su calificación, los aspectos y la observación del administrador. El
 * ícono es el que ya tenía en el menú (`Activity`).
 *
 * Backend: `GET evaluaciones-facilitadores` de
 * `backend/evaluaciones_facilitadores.sql`, el mismo listado de la pantalla
 * Evaluaciones, sin SQL propio: se piden todas las páginas
 * (`todasLasEvaluaciones`). La calificación y la descripción salen de cruzar
 * la escala de cada fila con `ESCALAS_EVALUACIONES` (`GET escalas-evaluacion`),
 * como el `LEFT JOIN` de APEX.
 *
 * Como en APEX:
 *
 * - Las facetas Facilitador e Institución (con cuántas, por cantidad), el
 *   buscador (facilitador, institución, ciudad, evaluado por, área,
 *   evaluación, calificación y descripción) y Restablecer.
 * - El reporte con sus 14 columnas visibles en el mismo orden, por fecha desde
 *   (la más nueva) y nombre, y Excel.
 *
 * Distinto de APEX, a propósito:
 *
 * - **Se pide por año** (entra con el en curso; "Todos los años" está en el
 *   filtro): APEX traía todo, y son muchas filas (una por ítem evaluado).
 * - El buscador no mira la CI del facilitador (en APEX, columna oculta): el
 *   listado no la trae.
 * - El nombre abre la evaluación.
 * - Un resumen, 50 filas por página (APEX las mostraba todas), orden y
 *   filtro por columna y bordes verticales.
 */
function MonitoreoFacilitadoresPage() {
  const anioActual = new Date().getFullYear();
  const [anio, setAnio] = useState(String(anioActual));
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);

  const rango = anio === TODOS ? {} : { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  const datos = useQuery({
    queryKey: ["monitoreo-facilitadores", anio],
    queryFn: () => todasLasEvaluaciones(rango),
  });
  const escala = useQuery({ queryKey: keysEscala.todo, queryFn: listarEscala });

  const filas = useMemo<Fila[]>(() => {
    const porEscala = new Map(
      (escala.data?.filas ?? []).filter((e) => e.escala != null).map((e) => [e.escala!, e]),
    );
    return (datos.data ?? []).map((e) => {
      const se = e.escala != null ? porEscala.get(e.escala) : undefined;
      const calificacion = se?.calificacion ?? "";
      const escalaDescripcion = se?.descripcion ?? "";
      return {
        ...e,
        fechaDesde: ddmmyyyy(e.fecha_desde),
        fechaHasta: ddmmyyyy(e.fecha_hasta),
        calificacion,
        escalaDescripcion,
        cerrado: e.ind_cerrado === "S" ? "Sí" : "No",
        // Las columnas de P87_SEARCH (sin la CI: el listado no la trae).
        busqueda: normalizar(
          [
            e.facilitador,
            e.institucion,
            e.ciudad,
            e.evaluado_por,
            e.area,
            e.evaluacion,
            calificacion,
            escalaDescripcion,
          ].join(" "),
        ),
      };
    });
  }, [datos.data, escala.data]);

  const filtradas = useMemo(() => filas.filter((x) => pasa(x, f)).sort(ordenDeEntrada), [filas, f]);
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  const opciones = useMemo(() => {
    const r = {} as Record<Faceta, { valor: string; texto: string; extra: string; n: number }[]>;
    for (const fa of FACETAS) {
      const cuenta = new Map<string, number>();
      const textos = new Map<string, string>();
      for (const x of filas) {
        const v = fa.valor(x);
        if (!textos.has(v)) textos.set(v, fa.texto(x));
        if (pasa(x, f, fa.clave)) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
      }
      r[fa.clave] = [...textos]
        .filter(([v]) => cuenta.get(v) || f[fa.clave].includes(v))
        .map(([valor, texto]) => {
          const n = cuenta.get(valor) ?? 0;
          return { valor, texto, n, extra: plural(n, "fila", "filas") };
        })
        .sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto, "es"));
    }
    return r;
  }, [filas, f]);

  const nFacilitadores = new Set(visibles.map((x) => x.id_facilitador)).size;
  const nInstituciones = new Set(visibles.map((x) => x.id_institucion)).size;
  const abiertas = visibles.filter((x) => x.ind_cerrado !== "S").length;

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setPagina(0);
  };
  const restablecer = () => {
    setAnio(String(anioActual));
    setF(SIN_FILTROS);
    tabla.limpiar();
    setPagina(0);
  };

  const chips = FACETAS.flatMap((fa) =>
    f[fa.clave].map((v) => ({
      clave: `${fa.clave}-${v}`,
      texto: opciones[fa.clave].find((o) => o.valor === v)?.texto ?? v,
      quitar: () => cambiar({ [fa.clave]: f[fa.clave].filter((y) => y !== v) }),
    })),
  );
  const hayFiltros = chips.length > 0 || f.texto.trim() !== "" || anio !== String(anioActual);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Monitoreo de Facilitadores</h1>
            <p className="text-xs text-muted-foreground">
              Las evaluaciones de los facilitadores, ítem por ítem, con su calificación
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                `monitoreo-facilitadores-${anio === TODOS ? "todos" : anio}`,
                COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                visibles,
              )
            }
            deshabilitado={!visibles.length}
          />
        </div>

        {/* ── Filtros: las facetas de APEX ─────────────────────────────── */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SelectorModal
            label="Año"
            descripcion="Las evaluaciones de ese año, o de todos"
            value={anio}
            onChange={(a) => {
              setAnio(a);
              setF(SIN_FILTROS);
              setPagina(0);
            }}
            opciones={[
              { valor: String(anioActual), texto: String(anioActual), extra: "El año en curso" },
              { valor: String(anioActual - 1), texto: String(anioActual - 1) },
              { valor: TODOS, texto: "Todos los años" },
            ]}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Facilitador"
            placeholder="Todos"
            descripcion="Debajo de cada uno, cuántas filas quedan con los otros filtros"
            value={f.facilitadores}
            onChange={(v) => cambiar({ facilitadores: v })}
            opciones={opciones.facilitadores}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Institución"
            placeholder="Todas"
            descripcion="Debajo de cada una, cuántas filas quedan con los otros filtros"
            value={f.instituciones}
            onChange={(v) => cambiar({ instituciones: v })}
            opciones={opciones.instituciones}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
        </div>

        <div className="[&>div]:mb-3">
          <Buscador
            valor={f.texto}
            onCambio={(v) => cambiar({ texto: v })}
            placeholder="Buscar facilitador, institución, evaluador, área, calificación…"
          />
        </div>

        {hayFiltros && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.clave}
                className="flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-medium"
              >
                <span className="truncate">{c.texto}</span>
                <button
                  type="button"
                  onClick={c.quitar}
                  aria-label={`Quitar ${c.texto}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={restablecer}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3" />
              Restablecer
            </button>
          </div>
        )}

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {datos.isLoading ? (
          <Cargando />
        ) : datos.isError ? (
          <Fallo error={datos.error} texto="No se pudieron cargar las evaluaciones" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Filas" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Facilitadores" valor={numero.format(nFacilitadores)} />
              <Resumen etiqueta="Instituciones" valor={numero.format(nInstituciones)} />
              <Resumen
                etiqueta="Sin cerrar"
                valor={numero.format(abiertas)}
                alerta={abiertas > 0}
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
                    <table className="w-full min-w-[1900px] border-separate border-spacing-0 text-[13px]">
                      <thead>
                        <tr>
                          {COLUMNAS.map((c) => (
                            <th
                              key={c.clave}
                              className="border-r border-b border-border bg-muted px-3 py-2 text-left text-xs font-semibold last:border-r-0"
                            >
                              <EncabezadoReporte columna={c} tabla={tabla} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((x) => (
                          <tr
                            key={x.id_evaluacion_facilitador}
                            className="align-top hover:bg-muted/40"
                          >
                            <Td>
                              <Link
                                to="/evaluaciones/$id"
                                params={{ id: String(x.id_evaluacion_facilitador) }}
                                className="font-medium text-primary hover:underline"
                              >
                                {x.facilitador}
                              </Link>
                            </Td>
                            <Td>{x.institucion}</Td>
                            <Td>{x.ciudad}</Td>
                            <Td fecha>{x.fechaDesde}</Td>
                            <Td fecha>{x.fechaHasta}</Td>
                            <Td>{x.evaluado_por}</Td>
                            <Td>{x.area}</Td>
                            <Td>{x.evaluacion}</Td>
                            <Td>{x.calificacion}</Td>
                            <Td>{x.escalaDescripcion}</Td>
                            <Td>{x.aspectos_positivos}</Td>
                            <Td>{x.aspectos_mejorar}</Td>
                            <Td>{x.observacion_admin}</Td>
                            <Td>{x.cerrado}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                </>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** La celda, con borde vertical: toda tabla de detalle lleva marcos entre columnas. */
function Td({ children, fecha }: { children: ReactNode; fecha?: boolean }) {
  return (
    <td
      className={`border-r border-b border-border/60 px-3 py-1.5 last:border-r-0 ${
        fecha ? "whitespace-nowrap tabular-nums" : ""
      }`}
    >
      {children}
    </td>
  );
}

function Resumen({
  etiqueta,
  valor,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p
        className={`mt-0.5 text-xl font-bold tabular-nums ${
          alerta ? "text-amber-700 dark:text-amber-400" : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
