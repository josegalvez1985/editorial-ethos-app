import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { usePostulacionesPorAnio } from "@/lib/postulaciones";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-instituciones-facilitadores/")({
  head: () => ({
    meta: [
      { title: "Instituciones y Facilitadores — Juventud con Valores" },
      {
        name: "description",
        content: "Qué facilitadores van a cada institución, por año y ubicación.",
      },
    ],
  }),
  component: InstitucionesFacilitadoresPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

/** El valor del filtro de facilitador para las postulaciones que no tienen. */
const SIN = "-";

/**
 * Una fila del reporte de APEX: `select distinct` institución, facilitador,
 * departamento, ciudad, barrio y año. La ubicación es la de la institución.
 */
type Par = {
  clave: string;
  idInstitucion: number;
  institucion: string;
  idFacilitador: number | null;
  facilitador: string;
  anio: string;
  departamento: string;
  ciudad: string;
  barrio: string;
  busqueda: string;
};

/**
 * Las columnas del reporte, en el orden de APEX (`display_sequence`). Cada
 * una se ordena y se filtra desde su encabezado (`lib/tabla-reporte.ts`).
 */
const COLUMNAS: ColumnaReporte<Par>[] = [
  { clave: "institucion", titulo: "Nombre Institución", valor: (p) => p.institucion },
  { clave: "facilitador", titulo: "Nombre Facilitador", valor: (p) => p.facilitador },
  { clave: "anio", titulo: "Año", valor: (p) => p.anio },
  { clave: "departamento", titulo: "Departamento", valor: (p) => p.departamento },
  { clave: "ciudad", titulo: "Nombre Ciudad", valor: (p) => p.ciudad },
  { clave: "barrio", titulo: "Nombre Barrio", valor: (p) => p.barrio },
];

/**
 * El orden de entrada de APEX: institución y después facilitador (las dos con
 * `default_sort_column_sequence` 1). Un orden elegido en un encabezado se
 * aplica encima de este.
 */
function ordenDeEntrada(a: Par, b: Par) {
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

type Faceta = "departamentos" | "ciudades" | "barrios" | "instituciones" | "facilitadores";
type Filtros = Record<Faceta, string[]> & { texto: string };

/**
 * Las facetas de APEX en su orden (Año va aparte: cambia lo que se pide).
 * Ubicación por nombre, como APEX; institución y facilitador por id, porque
 * dos pueden llamarse igual.
 */
const FACETAS: {
  clave: Faceta;
  titulo: string;
  valor: (p: Par) => string;
  texto: (p: Par) => string;
  extra?: (p: Par) => string;
}[] = [
  {
    clave: "departamentos",
    titulo: "Departamento",
    valor: (p) => p.departamento,
    texto: (p) => p.departamento || "Sin departamento",
  },
  {
    clave: "ciudades",
    titulo: "Ciudad",
    valor: (p) => p.ciudad,
    texto: (p) => p.ciudad || "Sin ciudad",
    extra: (p) => p.departamento,
  },
  {
    clave: "barrios",
    titulo: "Barrio",
    valor: (p) => p.barrio,
    texto: (p) => p.barrio || "Sin barrio",
    extra: (p) => p.ciudad,
  },
  {
    clave: "instituciones",
    titulo: "Institución",
    valor: (p) => String(p.idInstitucion),
    texto: (p) => p.institucion,
    extra: (p) => p.ciudad,
  },
  {
    clave: "facilitadores",
    titulo: "Facilitador",
    valor: (p) => (p.idFacilitador == null ? SIN : String(p.idFacilitador)),
    texto: (p) => (p.idFacilitador == null ? "Sin facilitador" : p.facilitador),
  },
];

const SIN_FILTROS: Filtros = {
  departamentos: [],
  ciudades: [],
  barrios: [],
  instituciones: [],
  facilitadores: [],
  texto: "",
};

/** Si el par pasa los filtros; `salvo` ignora una faceta, para contar sus opciones. */
function pasa(p: Par, f: Filtros, salvo?: Faceta) {
  for (const x of FACETAS) {
    if (x.clave === salvo) continue;
    if (f[x.clave].length && !f[x.clave].includes(x.valor(p))) return false;
  }
  const q = normalizar(f.texto.trim());
  return !q || p.busqueda.includes(q);
}

/**
 * Instituciones y Facilitadores: la página 44 de APEX (una búsqueda con
 * facetas sobre `select distinct` institución, facilitador, departamento,
 * ciudad, barrio y año de `V_POSTULACIONES`). Qué facilitadores van a cada
 * institución. El ícono es el que ya tenía en el menú (`Network`).
 *
 * Backend: `postulaciones/todas` de `backend/postulaciones.sql`, el mismo de
 * la 20 y la 24, sin SQL propio. Trae un año por llamada; "Todos los años"
 * pide uno por cada año que tiene la tabla. La ubicación sale de la
 * institución (`GET instituciones`). Como APEX, cuenta todas las
 * postulaciones, también las inactivas: la consulta no filtraba el estado.
 *
 * **El detalle es el reporte de APEX** (a pedido, 12/10/2026): los pares sin
 * repetir con sus seis columnas en el mismo orden, ordenados por institución
 * y facilitador, 50 filas por página y la descarga "Excel" con las mismas
 * columnas. Cada columna se ordena y se filtra desde su encabezado, como el
 * menú de columna de APEX (`lib/tabla-reporte.ts`).
 *
 * Los filtros, como en las otras consultas del sitio: año, departamento,
 * ciudad, barrio, institución y facilitador, que se combinan y dicen cuántas
 * instituciones quedan con los otros puestos (ordenados por cantidad, como el
 * `sort_by_top_counts` de APEX); el buscador; y Restablecer. Distinto de APEX:
 *
 * - **Entra con el año lectivo actual**, no con todos los años mezclados;
 *   "Todos los años" queda en el filtro.
 * - El filtro de facilitador tiene **"Sin facilitador"**.
 * - Un resumen arriba.
 */
function InstitucionesFacilitadoresPage() {
  /** `null` = el año lectivo actual. */
  const [anio, setAnio] = useState<string | null>(null);
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);

  // Las postulaciones del año elegido (o de todos): ver `usePostulacionesPorAnio`.
  const post = usePostulacionesPorAnio(anio);
  const { elegido, todos, anioBase } = post;
  const insts = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });

  // Los pares distintos institución + facilitador + año, como el
  // `select distinct` de APEX.
  const pares = useMemo<Par[]>(() => {
    const lugar = new Map((insts.data?.items ?? []).map((i) => [i.id, i]));
    const m = new Map<string, Par>();
    for (const p of post.items) {
      const clave = `${p.idInstitucion}|${p.idFacilitador ?? ""}|${p.anio}`;
      if (m.has(clave)) continue;
      const i = lugar.get(p.idInstitucion);
      const departamento = i?.departamento ?? "";
      const ciudad = i?.ciudad ?? "";
      const barrio = i?.barrio ?? "";
      m.set(clave, {
        clave,
        idInstitucion: p.idInstitucion,
        institucion: p.institucion,
        idFacilitador: p.idFacilitador,
        facilitador: p.facilitador,
        anio: p.anio,
        departamento,
        ciudad,
        barrio,
        busqueda: normalizar(
          [p.institucion, p.facilitador, departamento, ciudad, barrio].join(" "),
        ),
      });
    }
    return [...m.values()];
  }, [post.items, insts.data]);

  const filtrados = useMemo(() => pares.filter((p) => pasa(p, f)).sort(ordenDeEntrada), [pares, f]);
  // Encima de los filtros, el orden y los filtros de cada columna.
  const tabla = useTablaReporte(filtrados, COLUMNAS);
  const visibles = tabla.visibles;

  // Las opciones de cada filtro, con cuántas instituciones quedan con los
  // otros puestos (de facilitador: cuántas instituciones tiene cada uno).
  // Las que quedan en cero se esconden, salvo si están elegidas.
  const opciones = useMemo(() => {
    const r = {} as Record<Faceta, { valor: string; texto: string; extra: string; n: number }[]>;
    for (const x of FACETAS) {
      const cuenta = new Map<string, Set<number>>();
      const vistas = new Map<string, Par>();
      for (const p of pares) {
        const v = x.valor(p);
        if (!vistas.has(v)) vistas.set(v, p);
        if (!pasa(p, f, x.clave)) continue;
        const s = cuenta.get(v) ?? new Set<number>();
        s.add(p.idInstitucion);
        cuenta.set(v, s);
      }
      r[x.clave] = [...vistas]
        .filter(([v]) => cuenta.get(v)?.size || f[x.clave].includes(v))
        .map(([v, p]) => {
          const n = cuenta.get(v)?.size ?? 0;
          return {
            valor: v,
            texto: x.texto(p),
            n,
            extra: [x.extra?.(p), plural(n, "institución", "instituciones")]
              .filter(Boolean)
              .join(" · "),
          };
        })
        .sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto, "es"));
    }
    return r;
  }, [pares, f]);

  const nInstituciones = new Set(visibles.map((p) => p.idInstitucion)).size;
  const nFacilitadores = new Set(
    visibles.filter((p) => p.idFacilitador != null).map((p) => p.idFacilitador),
  ).size;
  const sinFacilitador = new Set(
    visibles.filter((p) => p.idFacilitador == null).map((p) => p.idInstitucion),
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
  const chips = FACETAS.flatMap((x) =>
    f[x.clave].map((v) => ({
      clave: `${x.clave}-${v}`,
      texto: opciones[x.clave].find((o) => o.valor === v)?.texto ?? v,
      quitar: () => cambiar({ [x.clave]: f[x.clave].filter((y) => y !== v) }),
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
            <h1 className="font-display text-2xl font-bold">Instituciones y Facilitadores</h1>
            <p className="text-xs text-muted-foreground">
              Qué facilitadores van a cada institución, por año y ubicación
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
          {FACETAS.map((x) => (
            <MultiSelectorModal
              key={x.clave}
              label={x.titulo}
              placeholder={
                x.clave === "departamentos" || x.clave === "facilitadores" ? "Todos" : "Todas"
              }
              descripcion="Debajo de cada uno, cuántas instituciones quedan con los otros filtros"
              value={f[x.clave]}
              onChange={(v) => cambiar({ [x.clave]: v })}
              opciones={opciones[x.clave]}
              className="min-h-11 px-3.5 py-2 text-sm"
            />
          ))}
        </div>

        <div className="[&>div]:mb-3">
          <Buscador
            valor={f.texto}
            onCambio={(v) => cambiar({ texto: v })}
            placeholder="Buscar institución, facilitador, ciudad, barrio…"
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
              <Resumen etiqueta="Filas" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Instituciones" valor={numero.format(nInstituciones)} />
              <Resumen etiqueta="Facilitadores" valor={numero.format(nFacilitadores)} />
              <Resumen
                etiqueta="Con postulaciones sin facilitador"
                valor={numero.format(sinFacilitador)}
                alerta={sinFacilitador > 0}
                detalle={sinFacilitador ? "Instituciones a cubrir" : "Todas cubiertas"}
              />
            </div>

            {/* "Resultados de la Búsqueda": el reporte de APEX. */}
            <section className="rounded-lg border border-border bg-card shadow-soft">
              <FiltrosColumnas tabla={tabla} />
              {!visibles.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
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
                        {enPagina.map((p) => (
                          <tr key={p.clave} className="hover:bg-muted/40">
                            {COLUMNAS.map((c) => (
                              <td
                                key={c.clave}
                                className={`border-r border-b border-border/60 px-3 py-1.5 last:border-r-0 ${
                                  c.clave === "anio" ? "tabular-nums" : ""
                                }`}
                              >
                                {c.valor(p)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2 text-[12.5px]">
                    <div className="flex items-center gap-1">
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

function Resumen({
  etiqueta,
  valor,
  detalle,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
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
      {detalle && <p className="mt-1 text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * El link "Excel" de APEX: todos los pares filtrados (no solo la página), en
 * el orden en que se ven y con las columnas del reporte. Ver `lib/excel.ts`.
 */
function descargarCsv(pares: Par[], sufijo: string) {
  descargarExcel(
    `instituciones-facilitadores-${sufijo || "anio"}`,
    COLUMNAS.map((c): ColumnaExcel<Par> => [c.titulo, c.valor]),
    pares,
  );
}
