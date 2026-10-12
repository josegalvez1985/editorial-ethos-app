import { useQuery } from "@tanstack/react-query";
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
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { GRADOS, type ClaveGrado, usePostulacionesPorAnio } from "@/lib/postulaciones";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-alumnos-grado/")({
  head: () => ({
    meta: [
      { title: "Cantidad de Alumnos por Grado — Juventud con Valores" },
      {
        name: "description",
        content: "Cuántos alumnos hay en cada grado, por institución y facilitador.",
      },
    ],
  }),
  component: AlumnosPorGradoPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

/** El valor del filtro de facilitador para las postulaciones que no tienen. */
const SIN = "-";

/**
 * Una fila del reporte de APEX: la suma de alumnos de cada grado de las
 * postulaciones activas, agrupada por institución, facilitador y año (con la
 * ubicación de la institución).
 */
type Fila = {
  clave: string;
  idInstitucion: number;
  institucion: string;
  idFacilitador: number | null;
  facilitador: string;
  anio: string;
  departamento: string;
  ciudad: string;
  barrio: string;
  grados: Record<ClaveGrado, number>;
  /** La suma de todos los grados: no es una columna de APEX, sirve al resumen. */
  alumnos: number;
  busqueda: string;
};

/** El encabezado de un grado como en APEX: "2°" … "9°", "1M", "2M", "3M". */
const tituloGrado = (corto: string) => corto.replace("°M", "M");

/**
 * Las columnas del reporte, en el orden de APEX (`display_sequence`): la
 * institución, los once grados, el facilitador, el año y la ubicación. Cada
 * una se ordena y se filtra desde su encabezado (`lib/tabla-reporte.ts`). Un
 * grado sin alumnos va vacío, como el `SUM` de APEX sobre columnas vacías.
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  ...GRADOS.map((g): ColumnaReporte<Fila> => ({
    clave: g.clave,
    titulo: tituloGrado(g.corto),
    valor: (f) => f.grados[g.clave] || null,
  })),
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "anio", titulo: "Año", valor: (f) => f.anio },
  { clave: "departamento", titulo: "Departamento", valor: (f) => f.departamento },
  { clave: "ciudad", titulo: "Ciudad", valor: (f) => f.ciudad },
  { clave: "barrio", titulo: "Barrio", valor: (f) => f.barrio },
];
const esGrado = (clave: string) => GRADOS.some((g) => g.clave === clave);

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

type Faceta = "facilitadores" | "departamentos" | "ciudades" | "barrios" | "instituciones";
type Filtros = Record<Faceta, string[]> & { texto: string };

/**
 * Las facetas de APEX en su orden (Año va aparte: cambia lo que se pide).
 * Ubicación por nombre, como APEX; institución y facilitador por id, porque
 * dos pueden llamarse igual.
 */
const FACETAS: {
  clave: Faceta;
  titulo: string;
  valor: (f: Fila) => string;
  texto: (f: Fila) => string;
  extra?: (f: Fila) => string;
}[] = [
  {
    clave: "facilitadores",
    titulo: "Facilitador",
    valor: (f) => (f.idFacilitador == null ? SIN : String(f.idFacilitador)),
    texto: (f) => (f.idFacilitador == null ? "Sin facilitador" : f.facilitador),
  },
  {
    clave: "departamentos",
    titulo: "Departamento",
    valor: (f) => f.departamento,
    texto: (f) => f.departamento || "Sin departamento",
  },
  {
    clave: "ciudades",
    titulo: "Ciudad",
    valor: (f) => f.ciudad,
    texto: (f) => f.ciudad || "Sin ciudad",
    extra: (f) => f.departamento,
  },
  {
    clave: "barrios",
    titulo: "Barrio",
    valor: (f) => f.barrio,
    texto: (f) => f.barrio || "Sin barrio",
    extra: (f) => f.ciudad,
  },
  {
    clave: "instituciones",
    titulo: "Institución",
    valor: (f) => String(f.idInstitucion),
    texto: (f) => f.institucion,
    extra: (f) => f.ciudad,
  },
];

const SIN_FILTROS: Filtros = {
  facilitadores: [],
  departamentos: [],
  ciudades: [],
  barrios: [],
  instituciones: [],
  texto: "",
};

/** Si la fila pasa los filtros; `salvo` ignora una faceta, para contar sus opciones. */
function pasa(f: Fila, x: Filtros, salvo?: Faceta) {
  for (const fa of FACETAS) {
    if (fa.clave === salvo) continue;
    if (x[fa.clave].length && !x[fa.clave].includes(fa.valor(f))) return false;
  }
  const q = normalizar(x.texto.trim());
  return !q || f.busqueda.includes(q);
}

const sinGrados = () =>
  Object.fromEntries(GRADOS.map((g) => [g.clave, 0])) as Record<ClaveGrado, number>;

/**
 * Cantidad de Alumnos por Grado: la página 49 de APEX (una búsqueda con
 * facetas sobre `V_POSTULACIONES`): cuántos alumnos hay en cada grado, sumando
 * las postulaciones activas de cada institución y facilitador. El ícono es el
 * que ya tenía en el menú (`GraduationCap`).
 *
 * Backend: `postulaciones/todas` de `backend/postulaciones.sql`, el mismo de
 * la 20, la 24 y la 44, sin SQL propio: la suma por grado se arma en el
 * navegador. Trae un año por llamada; "Todos los años" pide uno por cada año
 * que tiene la tabla. La ubicación sale de la institución
 * (`GET instituciones`). Como APEX, solo las activas
 * (`nvl(estado,'Activo') <> 'Inactivo'`).
 *
 * **El detalle es el reporte de APEX:** sus columnas en el mismo orden, los
 * grados con su total al pie (`sum_column`), ordenado por institución y
 * facilitador, 50 filas por página con la paginación arriba a la derecha, el
 * orden y el filtro por columna, y Excel.
 *
 * Los filtros, como en las otras consultas del sitio: año, facilitador,
 * departamento, ciudad, barrio e institución, que se combinan y dicen cuántas
 * filas quedan con los otros puestos (ordenados por cantidad, como el
 * `sort_by_top_counts` de APEX); el buscador (institución, facilitador, año y
 * departamento, como P49_SEARCH); y Restablecer. Distinto de APEX:
 *
 * - **Entra con el año lectivo actual**, no con todos los años mezclados;
 *   "Todos los años" queda en el filtro.
 * - El filtro de facilitador tiene **"Sin facilitador"**.
 * - Un resumen arriba, con el total de alumnos.
 */
function AlumnosPorGradoPage() {
  /** `null` = el año lectivo actual. */
  const [anio, setAnio] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);

  // Las postulaciones del año elegido (o de todos): ver `usePostulacionesPorAnio`.
  const post = usePostulacionesPorAnio(anio);
  const { elegido, todos, anioBase } = post;
  const insts = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });

  // El GROUP BY de APEX: institución + facilitador + año, sumando cada grado.
  const filas = useMemo<Fila[]>(() => {
    const lugar = new Map((insts.data?.items ?? []).map((i) => [i.id, i]));
    const m = new Map<string, Fila>();
    for (const p of post.items) {
      if (!p.activa) continue;
      const clave = `${p.idInstitucion}|${p.idFacilitador ?? ""}|${p.anio}`;
      let fila = m.get(clave);
      if (!fila) {
        const i = lugar.get(p.idInstitucion);
        const departamento = i?.departamento ?? "";
        fila = {
          clave,
          idInstitucion: p.idInstitucion,
          institucion: p.institucion,
          idFacilitador: p.idFacilitador,
          facilitador: p.facilitador,
          anio: p.anio,
          departamento,
          ciudad: i?.ciudad ?? "",
          barrio: i?.barrio ?? "",
          grados: sinGrados(),
          alumnos: 0,
          busqueda: normalizar([p.institucion, p.facilitador, p.anio, departamento].join(" ")),
        };
        m.set(clave, fila);
      }
      for (const g of GRADOS) {
        fila.grados[g.clave] += p.grados[g.clave];
        fila.alumnos += p.grados[g.clave];
      }
    }
    return [...m.values()];
  }, [post.items, insts.data]);

  const filtradas = useMemo(() => filas.filter((x) => pasa(x, f)).sort(ordenDeEntrada), [filas, f]);
  // Encima de los filtros, el orden y los filtros de cada columna.
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  // Las opciones de cada filtro, con cuántas filas y alumnos quedan con los
  // otros puestos. Las que quedan en cero se esconden, salvo si están elegidas.
  const opciones = useMemo(() => {
    const r = {} as Record<Faceta, { valor: string; texto: string; extra: string; n: number }[]>;
    for (const fa of FACETAS) {
      const cuenta = new Map<string, { n: number; alumnos: number }>();
      const vistas = new Map<string, Fila>();
      for (const x of filas) {
        const v = fa.valor(x);
        if (!vistas.has(v)) vistas.set(v, x);
        if (!pasa(x, f, fa.clave)) continue;
        const c = cuenta.get(v) ?? { n: 0, alumnos: 0 };
        c.n++;
        c.alumnos += x.alumnos;
        cuenta.set(v, c);
      }
      r[fa.clave] = [...vistas]
        .filter(([v]) => cuenta.get(v)?.n || f[fa.clave].includes(v))
        .map(([v, x]) => {
          const c = cuenta.get(v) ?? { n: 0, alumnos: 0 };
          return {
            valor: v,
            texto: fa.texto(x),
            n: c.n,
            extra: [
              fa.extra?.(x),
              plural(c.n, "fila", "filas"),
              plural(c.alumnos, "alumno", "alumnos"),
            ]
              .filter(Boolean)
              .join(" · "),
          };
        })
        .sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto, "es"));
    }
    return r;
  }, [filas, f]);

  // Los totales de cada grado (`sum_column` de APEX), de todo lo filtrado.
  const totales = useMemo(() => {
    const t = sinGrados();
    for (const x of visibles) for (const g of GRADOS) t[g.clave] += x.grados[g.clave];
    return t;
  }, [visibles]);
  const alumnos = GRADOS.reduce((s, g) => s + totales[g.clave], 0);
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

  const cargando = post.cargando || insts.isLoading;
  const error = post.error ?? insts.error;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Cantidad de Alumnos por Grado</h1>
            <p className="text-xs text-muted-foreground">
              Cuántos alumnos hay en cada grado, por institución y facilitador
            </p>
          </div>
          <BotonExcel
            onDescargar={() => descargarCsv(visibles, todos ? "todos" : elegido)}
            deshabilitado={cargando || !!error || !visibles.length}
          />
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
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
              placeholder={
                fa.clave === "departamentos" || fa.clave === "facilitadores" ? "Todos" : "Todas"
              }
              descripcion="Debajo de cada uno, cuántas filas y alumnos quedan con los otros filtros"
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
            placeholder="Buscar institución, facilitador, año, departamento…"
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
        {cargando ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar las postulaciones" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Alumnos" valor={numero.format(alumnos)} />
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
                  <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[13px]">
                    <thead>
                      <tr>
                        {COLUMNAS.map((c) => (
                          <Th key={c.clave} numero={esGrado(c.clave)}>
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
                                esGrado(c.clave) || c.clave === "anio"
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
                    {/* El total de cada grado, de todo lo filtrado (no solo la página). */}
                    <tfoot>
                      <tr className="bg-muted/60 font-semibold">
                        <td className="border-r border-border/60 px-3 py-2">Total</td>
                        {GRADOS.map((g) => (
                          <td
                            key={g.clave}
                            className="border-r border-border/60 px-3 py-2 text-right tabular-nums"
                          >
                            {numero.format(totales[g.clave])}
                          </td>
                        ))}
                        <td colSpan={5} className="px-3 py-2 text-muted-foreground">
                          {plural(alumnos, "alumno", "alumnos")}
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
    `alumnos-por-grado-${sufijo || "anio"}`,
    COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
    filas,
  );
}
