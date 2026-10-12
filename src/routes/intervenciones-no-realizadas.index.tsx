import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { nombreTurno } from "@/lib/evaluaciones";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysIntervenciones,
  listarNoRealizadas,
  MESES,
  type IntervencionNoRealizada,
} from "@/lib/intervenciones";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/intervenciones-no-realizadas/")({
  head: () => ({
    meta: [
      { title: "Intervenciones no realizadas — Juventud con Valores" },
      {
        name: "description",
        content: "Las intervenciones con el índice no desarrollado, y por qué.",
      },
    ],
  }),
  component: IntervencionesNoRealizadasPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

/** El valor del filtro de año que trae todos (APEX traía todo junto). */
const TODOS = "TODOS";

type Fila = IntervencionNoRealizada & { indice: string; turnoTexto: string; busqueda: string };

/**
 * Las columnas visibles del reporte de APEX, en su orden. Cada una se ordena y
 * se filtra desde su encabezado (`lib/tabla-reporte.ts`).
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  { clave: "fecha", titulo: "Fecha", valor: (f) => f.fecha, orden: (f) => ordenFecha(f.fecha) },
  { clave: "motivo", titulo: "Motivo Desarrollo", valor: (f) => f.motivo_desarrollo },
  { clave: "observacion", titulo: "Observación", valor: (f) => f.observacion },
  { clave: "manual", titulo: "Manual", valor: (f) => f.manual },
  { clave: "indice", titulo: "Índice", valor: (f) => f.indice, orden: (f) => f.nro_indice },
  { clave: "turno", titulo: "Turno", valor: (f) => f.turnoTexto, orden: (f) => f.turno },
  { clave: "grado", titulo: "Grado", valor: (f) => f.grado },
  { clave: "seccion", titulo: "Sección", valor: (f) => f.seccion },
];

/* Las facetas de APEX que se cuentan en el navegador (Año va aparte: se pide). */
type Faceta = "meses" | "fechas" | "motivos" | "instituciones" | "facilitadores";
type Filtros = Record<Faceta, string[]> & { texto: string };

const FACETAS: { clave: Faceta; valor: (f: Fila) => string; texto: (f: Fila) => string }[] = [
  { clave: "meses", valor: (f) => String(f.mes), texto: (f) => MESES[f.mes - 1] ?? String(f.mes) },
  { clave: "fechas", valor: (f) => f.fecha, texto: (f) => f.fecha },
  {
    clave: "motivos",
    valor: (f) => f.motivo_desarrollo ?? "",
    texto: (f) => f.motivo_desarrollo || "Sin motivo",
  },
  {
    clave: "instituciones",
    valor: (f) => String(f.id_institucion),
    texto: (f) => f.institucion,
  },
  {
    clave: "facilitadores",
    valor: (f) => String(f.id_facilitador),
    texto: (f) => f.facilitador,
  },
];

const SIN_FILTROS: Filtros = {
  meses: [],
  fechas: [],
  motivos: [],
  instituciones: [],
  facilitadores: [],
  texto: "",
};

function pasa(f: Fila, x: Filtros, salvo?: Faceta) {
  for (const fa of FACETAS) {
    if (fa.clave === salvo) continue;
    if (x[fa.clave].length && !x[fa.clave].includes(fa.valor(f))) return false;
  }
  const q = normalizar(x.texto.trim());
  return !q || f.busqueda.includes(q);
}

/**
 * Intervenciones no realizadas: la página 69 de APEX (una búsqueda con
 * facetas): las marcaciones con el índice NO desarrollado, con el motivo y la
 * observación. El ícono es el que ya tenía en el menú (`CalendarX`).
 *
 * Backend: `GET intervenciones/no-realizadas` de `backend/intervenciones.sql`:
 * la consulta de APEX tal cual (`nvl(si_no,'Si') = 'No'` y su agrupado por
 * turno, sección y énfasis).
 *
 * Como en APEX:
 *
 * - Las facetas Año, Mes, Fecha, Motivo Desarrollo, Institución y Facilitador,
 *   el buscador (fecha, manual, observación, motivo, institución, grado,
 *   sección, énfasis, mes, horas y facilitador) y Restablecer.
 * - El reporte con sus columnas visibles en el mismo orden, la última
 *   intervención primero, y Excel.
 *
 * Distinto de APEX, a propósito:
 *
 * - **Se pide por año** (entra con el actual; "Todos los años" está en el
 *   filtro): APEX traía todo el historial junto. Las otras facetas se cuentan
 *   en el navegador, cada una con cuántas quedan con las otras puestas
 *   (APEX no mostraba cuentas en esta página).
 * - **50 filas por página** con la paginación abajo: APEX las mostraba todas
 *   en una sola lista.
 * - Un resumen arriba: no realizadas, facilitadores, instituciones y el motivo
 *   más frecuente.
 * - Orden y filtro por columna.
 */
function IntervencionesNoRealizadasPage() {
  const anioActual = String(new Date().getFullYear());
  const [anio, setAnio] = useState(anioActual);
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);

  const datos = useQuery({
    queryKey: keysIntervenciones.noRealizadas(anio),
    queryFn: () => listarNoRealizadas(anio),
  });

  const filas = useMemo<Fila[]>(
    () =>
      (datos.data?.data ?? []).map((i) => {
        const indice =
          i.nro_indice != null
            ? `${i.nro_indice}${i.indice_titulo ? ` - ${i.indice_titulo}` : ""}`
            : i.id_indice != null
              ? `#${i.id_indice}`
              : "";
        return {
          ...i,
          indice,
          turnoTexto: nombreTurno(i.turno) ?? "",
          // Las columnas de P69_SEARCH.
          busqueda: normalizar(
            [
              i.fecha,
              i.manual,
              i.observacion,
              i.motivo_desarrollo,
              i.institucion,
              i.grado,
              i.seccion,
              i.enfasis,
              MESES[i.mes - 1],
              i.hora,
              i.hora_desde,
              i.hora_hasta,
              i.facilitador,
              indice,
              i.anio,
            ].join(" "),
          ),
        };
      }),
    [datos.data],
  );

  const filtradas = useMemo(() => filas.filter((x) => pasa(x, f)), [filas, f]);
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  // Las opciones de cada faceta con cuántas quedan con las otras puestas. Los
  // meses en su orden; las fechas de la más nueva a la más vieja; el resto por
  // cantidad.
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
          return { valor, texto, n, extra: plural(n, "intervención", "intervenciones") };
        })
        .sort((a, b) =>
          fa.clave === "meses"
            ? Number(a.valor) - Number(b.valor)
            : fa.clave === "fechas"
              ? ordenFecha(b.valor).localeCompare(ordenFecha(a.valor))
              : b.n - a.n || a.texto.localeCompare(b.texto, "es"),
        );
    }
    return r;
  }, [filas, f]);

  const nFacilitadores = new Set(visibles.map((x) => x.id_facilitador)).size;
  const nInstituciones = new Set(visibles.map((x) => x.id_institucion)).size;
  const motivoTop = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of visibles) {
      const k = x.motivo_desarrollo || "Sin motivo";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [visibles]);

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setPagina(0);
  };
  const restablecer = () => {
    setAnio(anioActual);
    setF(SIN_FILTROS);
    tabla.limpiar();
    setPagina(0);
  };

  const anios = [...new Set([anioActual, ...(datos.data?.anios ?? [])])].sort((a, b) =>
    b.localeCompare(a),
  );
  const nombreDe = (fa: Faceta, v: string) => opciones[fa].find((o) => o.valor === v)?.texto ?? v;
  const chips = FACETAS.flatMap((fa) =>
    f[fa.clave].map((v) => ({
      clave: `${fa.clave}-${v}`,
      texto: nombreDe(fa.clave, v),
      quitar: () => cambiar({ [fa.clave]: f[fa.clave].filter((y) => y !== v) }),
    })),
  );
  const hayFiltros = chips.length > 0 || f.texto.trim() !== "" || anio !== anioActual;

  const filtro = (fa: Faceta, label: string, placeholder: string) => (
    <MultiSelectorModal
      label={label}
      placeholder={placeholder}
      descripcion="Debajo de cada uno, cuántas quedan con los otros filtros"
      value={f[fa]}
      onChange={(v) => cambiar({ [fa]: v })}
      opciones={opciones[fa]}
      className="min-h-11 px-3.5 py-2 text-sm"
    />
  );

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Intervenciones no realizadas</h1>
            <p className="text-xs text-muted-foreground">
              Las intervenciones con el índice no desarrollado, y por qué
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                `intervenciones-no-realizadas-${anio === TODOS ? "todas" : anio}`,
                COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                visibles,
              )
            }
            deshabilitado={!visibles.length}
          />
        </div>

        {/* ── Filtros: las facetas de APEX ─────────────────────────────── */}
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
          <SelectorModal
            label="Año"
            descripcion="Las no realizadas de ese año, o de todos"
            value={anio}
            onChange={(a) => {
              setAnio(a);
              setF(SIN_FILTROS);
              setPagina(0);
            }}
            opciones={[
              ...anios.map((a) => ({
                valor: a,
                texto: a,
                extra: a === anioActual ? "El año en curso" : undefined,
              })),
              { valor: TODOS, texto: "Todos los años" },
            ]}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          {filtro("meses", "Mes", "Todos")}
          {filtro("fechas", "Fecha", "Todas")}
          {filtro("motivos", "Motivo Desarrollo", "Todos")}
          {filtro("instituciones", "Institución", "Todas")}
          {filtro("facilitadores", "Facilitador", "Todos")}
        </div>

        <div className="[&>div]:mb-3">
          <Buscador
            valor={f.texto}
            onCambio={(v) => cambiar({ texto: v })}
            placeholder="Buscar facilitador, institución, motivo, observación…"
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

        {datos.data?.truncado && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Se muestran las primeras {numero.format(datos.data.limite)}: elegí un año para verlas
            todas.
          </p>
        )}

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {datos.isLoading ? (
          <Cargando />
        ) : datos.isError ? (
          <Fallo error={datos.error} texto="No se pudieron cargar las intervenciones" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="No realizadas" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Facilitadores" valor={numero.format(nFacilitadores)} />
              <Resumen etiqueta="Instituciones" valor={numero.format(nInstituciones)} />
              <Resumen
                etiqueta="Motivo más frecuente"
                valor={motivoTop ? motivoTop[0] : "—"}
                detalle={motivoTop ? plural(motivoTop[1], "vez", "veces") : undefined}
                texto
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
                    <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-[13px]">
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
                            key={`${x.id_intervencion}-${x.turno}-${x.seccion}-${x.grado}`}
                            className="align-top hover:bg-muted/40"
                          >
                            <Td>{x.facilitador}</Td>
                            <Td>{x.institucion}</Td>
                            <Td numero>{x.fecha}</Td>
                            <Td>{x.motivo_desarrollo}</Td>
                            <Td>{x.observacion}</Td>
                            <Td>{x.manual}</Td>
                            <Td>{x.indice}</Td>
                            <Td>{x.turnoTexto}</Td>
                            <Td>{x.grado}</Td>
                            <Td>{x.seccion}</Td>
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
function Td({ children, numero: num }: { children: ReactNode; numero?: boolean }) {
  return (
    <td
      className={`border-r border-b border-border/60 px-3 py-1.5 last:border-r-0 ${
        num ? "whitespace-nowrap tabular-nums" : ""
      }`}
    >
      {children}
    </td>
  );
}

function Resumen({
  etiqueta,
  valor,
  detalle,
  texto,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  /** Un valor de texto (no un número): más chico y cortado si no entra. */
  texto?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p
        className={`mt-0.5 font-bold ${texto ? "truncate text-base" : "text-xl tabular-nums"}`}
        title={texto ? valor : undefined}
      >
        {valor}
      </p>
      {detalle && <p className="mt-1 text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}
