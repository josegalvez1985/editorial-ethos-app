import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { MANUALES, type ClaveManual, usePostulacionesPorAnio } from "@/lib/postulaciones";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-cantidad-manuales/")({
  head: () => ({
    meta: [
      { title: "Cantidad de Manuales — Juventud con Valores" },
      {
        name: "description",
        content: "Cuántos manuales de cada uno van a cada institución y facilitador.",
      },
    ],
  }),
  component: CantidadManualesPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

/** El valor del filtro de facilitador para las postulaciones que no tienen. */
const SIN = "-";

/**
 * Una fila del reporte de APEX: la suma de cada manual de las postulaciones
 * activas, agrupada por institución, facilitador y año.
 */
type Fila = {
  clave: string;
  idInstitucion: number;
  institucion: string;
  idFacilitador: number | null;
  facilitador: string;
  anio: string;
  manuales: Record<ClaveManual, number>;
  /** La suma de los siete: no es una columna de APEX, sirve al resumen. */
  total: number;
  busqueda: string;
};

/**
 * Las columnas del reporte, en el orden de APEX (`display_sequence`): la
 * institución, los siete manuales, el facilitador y el año. Cada una se ordena
 * y se filtra desde su encabezado (`lib/tabla-reporte.ts`). Un manual en cero
 * va vacío, como el `SUM` de APEX sobre columnas vacías.
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "institucion", titulo: "Nombre Institución", valor: (f) => f.institucion },
  ...MANUALES.map((m): ColumnaReporte<Fila> => ({
    clave: m.clave,
    titulo: m.nombre,
    valor: (f) => f.manuales[m.clave] || null,
  })),
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "anio", titulo: "Año", valor: (f) => f.anio },
];
const esManual = (clave: string) => MANUALES.some((m) => m.clave === clave);

/**
 * El orden de entrada de APEX: institución y después facilitador (las dos con
 * `default_sort_column_sequence` 1). Un orden elegido en un encabezado se
 * aplica encima de este.
 */
function ordenDeEntrada(a: Fila, b: Fila) {
  const texto = (x: string, y: string) => {
    if (!x !== !y) return x ? -1 : 1;
    return x.localeCompare(y, "es", { numeric: true });
  };
  return (
    texto(a.institucion, b.institucion) ||
    texto(a.facilitador, b.facilitador) ||
    a.anio.localeCompare(b.anio)
  );
}

type Faceta = "instituciones" | "facilitadores";
type Filtros = Record<Faceta, string[]> & { texto: string };

/** Las facetas de APEX en su orden (Año va aparte: cambia lo que se pide). */
const FACETAS: {
  clave: Faceta;
  titulo: string;
  valor: (f: Fila) => string;
  texto: (f: Fila) => string;
}[] = [
  {
    clave: "instituciones",
    titulo: "Institución",
    valor: (f) => String(f.idInstitucion),
    texto: (f) => f.institucion,
  },
  {
    clave: "facilitadores",
    titulo: "Facilitador",
    valor: (f) => (f.idFacilitador == null ? SIN : String(f.idFacilitador)),
    texto: (f) => (f.idFacilitador == null ? "Sin facilitador" : f.facilitador),
  },
];

const SIN_FILTROS: Filtros = { instituciones: [], facilitadores: [], texto: "" };

/** Si la fila pasa los filtros; `salvo` ignora una faceta, para contar sus opciones. */
function pasa(f: Fila, x: Filtros, salvo?: Faceta) {
  for (const fa of FACETAS) {
    if (fa.clave === salvo) continue;
    if (x[fa.clave].length && !x[fa.clave].includes(fa.valor(f))) return false;
  }
  const q = normalizar(x.texto.trim());
  return !q || f.busqueda.includes(q);
}

const sinManuales = () =>
  Object.fromEntries(MANUALES.map((m) => [m.clave, 0])) as Record<ClaveManual, number>;

/**
 * Cantidad de Manuales: la página 50 de APEX (una búsqueda con facetas sobre
 * `V_POSTULACIONES`): cuántos manuales de cada uno (Ser, Hacer, Tener,
 * Carácter, Visión, Coraje y Liderazgo) van a cada institución y facilitador,
 * sumando las postulaciones activas. El ícono es el que ya tenía en el menú
 * (`BookCopy`).
 *
 * Backend: `postulaciones/todas` de `backend/postulaciones.sql`, sin SQL
 * propio: la suma se arma en el navegador, con `usePostulacionesPorAnio`
 * (como la 44 y la 49). Como APEX, solo las activas
 * (`nvl(estado,'Activo') <> 'Inactivo'`).
 *
 * **El detalle es el reporte de APEX:** sus columnas en el mismo orden, cada
 * manual con su total al pie (`sum_column`), ordenado por institución y
 * facilitador, 50 filas por página con la paginación arriba a la derecha, el
 * orden y el filtro por columna, y Excel.
 *
 * Los filtros, como en las otras consultas del sitio: año, institución y
 * facilitador, que se combinan y dicen cuántas filas y manuales quedan con los
 * otros puestos (ordenados por cantidad, como el `sort_by_top_counts` de
 * APEX); el buscador (institución y facilitador, como P50_SEARCH); y
 * Restablecer. Distinto de APEX:
 *
 * - **El año se elige.** La consulta de APEX lo tenía fijo en el código
 *   (`AND ANIO = '2026'`), así que la faceta Año solo mostraba ese. Acá entra
 *   con el año lectivo actual, y está "Todos los años".
 * - El filtro de facilitador tiene **"Sin facilitador"**.
 * - Un resumen arriba, con el total de manuales.
 */
function CantidadManualesPage() {
  /** `null` = el año lectivo actual. */
  const [anio, setAnio] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);

  // Las postulaciones del año elegido (o de todos): ver `usePostulacionesPorAnio`.
  const post = usePostulacionesPorAnio(anio);
  const { elegido, todos, anioBase } = post;

  // El GROUP BY de APEX: institución + facilitador + año, sumando cada manual.
  const filas = useMemo<Fila[]>(() => {
    const m = new Map<string, Fila>();
    for (const p of post.items) {
      if (!p.activa) continue;
      const clave = `${p.idInstitucion}|${p.idFacilitador ?? ""}|${p.anio}`;
      let fila = m.get(clave);
      if (!fila) {
        fila = {
          clave,
          idInstitucion: p.idInstitucion,
          institucion: p.institucion,
          idFacilitador: p.idFacilitador,
          facilitador: p.facilitador,
          anio: p.anio,
          manuales: sinManuales(),
          total: 0,
          busqueda: normalizar([p.institucion, p.facilitador].join(" ")),
        };
        m.set(clave, fila);
      }
      for (const x of MANUALES) {
        fila.manuales[x.clave] += p.manuales[x.clave];
        fila.total += p.manuales[x.clave];
      }
    }
    return [...m.values()];
  }, [post.items]);

  const filtradas = useMemo(() => filas.filter((x) => pasa(x, f)).sort(ordenDeEntrada), [filas, f]);
  // Encima de los filtros, el orden y los filtros de cada columna.
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  // Las opciones de cada filtro, con cuántas filas y manuales quedan con los
  // otros puestos. Las que quedan en cero se esconden, salvo si están elegidas.
  const opciones = useMemo(() => {
    const r = {} as Record<Faceta, { valor: string; texto: string; extra: string; n: number }[]>;
    for (const fa of FACETAS) {
      const cuenta = new Map<string, { n: number; manuales: number }>();
      const vistas = new Map<string, Fila>();
      for (const x of filas) {
        const v = fa.valor(x);
        if (!vistas.has(v)) vistas.set(v, x);
        if (!pasa(x, f, fa.clave)) continue;
        const c = cuenta.get(v) ?? { n: 0, manuales: 0 };
        c.n++;
        c.manuales += x.total;
        cuenta.set(v, c);
      }
      r[fa.clave] = [...vistas]
        .filter(([v]) => cuenta.get(v)?.n || f[fa.clave].includes(v))
        .map(([v, x]) => {
          const c = cuenta.get(v) ?? { n: 0, manuales: 0 };
          return {
            valor: v,
            texto: fa.texto(x),
            n: c.n,
            extra: `${plural(c.n, "fila", "filas")} · ${plural(c.manuales, "manual", "manuales")}`,
          };
        })
        .sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto, "es"));
    }
    return r;
  }, [filas, f]);

  // Los totales de cada manual (`sum_column` de APEX), de todo lo filtrado.
  const totales = useMemo(() => {
    const t = sinManuales();
    for (const x of visibles) for (const m of MANUALES) t[m.clave] += x.manuales[m.clave];
    return t;
  }, [visibles]);
  const manuales = MANUALES.reduce((s, m) => s + totales[m.clave], 0);
  const nInstituciones = new Set(visibles.map((x) => x.idInstitucion)).size;
  const nFacilitadores = new Set(
    visibles.filter((x) => x.idFacilitador != null).map((x) => x.idFacilitador),
  ).size;

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setPagina(0);
  };
  const restablecer = () => {
    setAnio(null);
    setF(SIN_FILTROS);
    tabla.limpiar();
    setPagina(0);
  };

  // Los filtros puestos, como chips que se quitan de a uno.
  const chips = FACETAS.flatMap((fa) =>
    f[fa.clave].map((v) => ({
      clave: `${fa.clave}-${v}`,
      texto: opciones[fa.clave].find((o) => o.valor === v)?.texto ?? v,
      quitar: () => cambiar({ [fa.clave]: f[fa.clave].filter((y) => y !== v) }),
    })),
  );
  const hayFiltros = chips.length > 0 || f.texto.trim() !== "" || anio != null;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Cantidad de Manuales</h1>
            <p className="text-xs text-muted-foreground">
              Cuántos manuales de cada uno van a cada institución y facilitador
            </p>
          </div>
          <BotonExcel
            onDescargar={() => descargarCsv(visibles, todos ? "todos" : elegido)}
            deshabilitado={post.cargando || !!post.error || !visibles.length}
          />
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SelectorModal
            label="Año"
            descripcion="Las postulaciones de ese año lectivo, o de todos"
            value={elegido}
            onChange={(a) => {
              setAnio(a === anioBase ? null : a);
              setPagina(0);
            }}
            opciones={post.opcionesAnio}
            placeholder="Año"
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          {FACETAS.map((fa) => (
            <MultiSelectorModal
              key={fa.clave}
              label={fa.titulo}
              placeholder={fa.clave === "facilitadores" ? "Todos" : "Todas"}
              descripcion="Debajo de cada uno, cuántas filas y manuales quedan con los otros filtros"
              value={f[fa.clave]}
              onChange={(v) => cambiar({ [fa.clave]: v })}
              opciones={opciones[fa.clave]}
              className="min-h-11 px-3.5 py-2 text-sm"
            />
          ))}
        </div>

        <div className="[&>div]:mb-3">
          <Buscador
            valor={f.texto}
            onCambio={(v) => cambiar({ texto: v })}
            placeholder="Buscar institución o facilitador…"
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
        {post.cargando ? (
          <Cargando />
        ) : post.error ? (
          <Fallo error={post.error} texto="No se pudieron cargar las postulaciones" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Manuales" valor={numero.format(manuales)} />
              <Resumen etiqueta="Instituciones" valor={numero.format(nInstituciones)} />
              <Resumen etiqueta="Facilitadores" valor={numero.format(nFacilitadores)} />
              <Resumen etiqueta="Filas" valor={numero.format(visibles.length)} />
            </div>

            {/* "Resultados de la Búsqueda": el reporte de APEX. */}
            <section className="rounded-lg border border-border bg-card shadow-soft">
              {/* La paginación arriba a la derecha, como la ponía APEX. */}
              {visibles.length > 0 && (
                <div className="flex items-center justify-end gap-1 border-b border-border px-4 py-2 text-[12.5px]">
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
              <FiltrosColumnas tabla={tabla} />
              {!visibles.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
                    <thead>
                      <tr>
                        {COLUMNAS.map((c) => (
                          <Th key={c.clave} numero={esManual(c.clave)}>
                            <EncabezadoReporte columna={c} tabla={tabla} />
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {enPagina.map((x) => (
                        <tr key={x.clave} className="hover:bg-muted/40">
                          {COLUMNAS.map((c) => (
                            <td
                              key={c.clave}
                              className={`border-r border-b border-border/60 px-3 py-1.5 last:border-r-0 ${
                                esManual(c.clave) || c.clave === "anio"
                                  ? "text-right tabular-nums"
                                  : ""
                              }`}
                            >
                              {c.valor(x)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {/* El total de cada manual, de todo lo filtrado (no solo la página). */}
                    <tfoot>
                      <tr className="bg-muted/60 font-semibold">
                        <td className="border-r border-border/60 px-3 py-2">Total</td>
                        {MANUALES.map((m) => (
                          <td
                            key={m.clave}
                            className="border-r border-border/60 px-3 py-2 text-right tabular-nums"
                          >
                            {numero.format(totales[m.clave])}
                          </td>
                        ))}
                        <td colSpan={2} className="px-3 py-2 text-muted-foreground">
                          {plural(manuales, "manual", "manuales")}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
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

/** Encabezado con borde vertical: toda tabla de detalle lleva marcos entre columnas. */
function Th({ children, numero: num }: { children: ReactNode; numero?: boolean }) {
  return (
    <th
      className={`border-r border-b border-border bg-muted px-3 py-2 text-xs font-semibold last:border-r-0 ${
        num ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{valor}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * El "Excel" de APEX: todas las filas filtradas (no solo la página), en el
 * orden en que se ven y con las columnas del reporte. Ver `lib/excel.ts`.
 */
function descargarCsv(filas: Fila[], sufijo: string) {
  descargarExcel(
    `cantidad-manuales-${sufijo || "anio"}`,
    COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
    filas,
  );
}
