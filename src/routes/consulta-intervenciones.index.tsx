import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { LupaPlanilla } from "@/components/lupa-planilla";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysIntervenciones,
  linkMapaPunto,
  listarRealizadas,
  MESES,
  type IntervencionRealizada,
} from "@/lib/intervenciones";
import { usePlanilla } from "@/lib/lupa";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-intervenciones/")({
  head: () => ({
    meta: [
      { title: "Intervenciones Realizadas — Juventud con Valores" },
      {
        name: "description",
        content: "Las marcaciones de los facilitadores, con su horario y su diferencia.",
      },
    ],
  }),
  component: IntervencionesRealizadasPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

type Fila = IntervencionRealizada & { indice: string; busqueda: string };

/** "12 - Respeto": el índice como lo mostraba la LOV de APEX. */
const textoIndice = (i: IntervencionRealizada) =>
  i.nro_indice != null
    ? `${i.nro_indice}${i.indice_titulo ? ` - ${i.indice_titulo}` : ""}`
    : i.id_indice != null
      ? `#${i.id_indice}`
      : "";

/** ¿Desarrollo? de la tabla ('Si' / 'No') sin depender de mayúsculas. */
const desarrollo = (f: Fila): "Si" | "No" | "" => {
  const v = normalizar(f.si_no ?? "");
  return v === "si" ? "Si" : v === "no" ? "No" : "";
};

/*
 * Los colores de APEX: el CSS en línea de la página 52 para las tres horas y
 * los del `CASE` de DIFERENCIA_MINUTOS.
 */
const COLOR_HORA: CSSProperties = { backgroundColor: "#ffeb3b", color: "#000" };
const COLOR_DESDE: CSSProperties = { backgroundColor: "#4caf50", color: "#fff" };
const COLOR_HASTA: CSSProperties = { backgroundColor: "#ff9800", color: "#fff" };
const colorDiferencia = (d: number): CSSProperties =>
  d < 0
    ? { backgroundColor: "#e74c3c", color: "#fff" }
    : d > 0
      ? { backgroundColor: "#3498db", color: "#fff" }
      : { backgroundColor: "#bdc3c7", color: "#000" };

/** El verde de los botones "Todos los meses" y "Todas las fechas" de APEX. */
const VERDE_APEX: CSSProperties = { backgroundColor: "#4caf50", color: "#fff" };

/**
 * Las columnas del reporte que se ordenan y filtran, en el orden de APEX. El
 * lápiz y el mapa van aparte: son links, no datos.
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "fecha", titulo: "Fecha", valor: (f) => f.fecha, orden: (f) => ordenFecha(f.fecha) },
  { clave: "hora", titulo: "Hora", valor: (f) => f.hora },
  { clave: "hora_desde", titulo: "Hora Desde", valor: (f) => f.hora_desde },
  { clave: "hora_hasta", titulo: "Hora Hasta", valor: (f) => f.hora_hasta },
  { clave: "diferencia", titulo: "Dif. Min.", valor: (f) => f.diferencia },
  { clave: "manual", titulo: "Manual", valor: (f) => f.manual },
  { clave: "indice", titulo: "Índice", valor: (f) => f.indice, orden: (f) => f.nro_indice },
  { clave: "si_no", titulo: "Desarrollo", valor: (f) => f.si_no },
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  { clave: "grado", titulo: "Grado", valor: (f) => f.grado },
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "observacion", titulo: "Observación", valor: (f) => f.observacion },
  { clave: "motivo", titulo: "Motivo", valor: (f) => f.motivo_desarrollo },
  {
    clave: "id",
    titulo: "Id Intervención",
    valor: (f) => f.id_intervencion,
    filtrable: false,
  },
];
const col = (clave: string) => COLUMNAS.find((c) => c.clave === clave)!;

/** El ancho de cada columna, en el orden en que se pintan (para la lupa). */
const ANCHOS = [
  32, // lápiz
  84, // fecha
  56, // hora
  64, // hora desde
  64, // hora hasta
  66, // dif. min.
  84, // manual
  170, // índice
  78, // desarrollo
  180, // institución
  210, // grado
  160, // facilitador
  180, // observación
  150, // motivo
  48, // mapa
  84, // id
];
const ANCHO_TABLA = ANCHOS.reduce((n, c) => n + c, 0);

/* Las facetas que se cuentan en el navegador, sobre lo que llegó del período. */
type Faceta = "fechas" | "facilitadores" | "instituciones";
type Filtros = Record<Faceta, string[]> & { desarrollo: "" | "Si" | "No"; texto: string };

const FACETAS: { clave: Faceta; valor: (f: Fila) => string; texto: (f: Fila) => string }[] = [
  { clave: "fechas", valor: (f) => f.fecha, texto: (f) => f.fecha },
  {
    clave: "facilitadores",
    valor: (f) => String(f.id_facilitador),
    texto: (f) => f.facilitador,
  },
  {
    clave: "instituciones",
    valor: (f) => String(f.id_institucion),
    texto: (f) => f.institucion,
  },
];

const SIN_FILTROS: Filtros = {
  fechas: [],
  facilitadores: [],
  instituciones: [],
  desarrollo: "",
  texto: "",
};

function pasa(f: Fila, x: Filtros, salvo?: Faceta | "desarrollo") {
  for (const fa of FACETAS) {
    if (fa.clave === salvo) continue;
    if (x[fa.clave].length && !x[fa.clave].includes(fa.valor(f))) return false;
  }
  if (salvo !== "desarrollo" && x.desarrollo && desarrollo(f) !== x.desarrollo) return false;
  const q = normalizar(x.texto.trim());
  return !q || f.busqueda.includes(q);
}

/**
 * Intervenciones Realizadas: la página 52 de APEX, lo más parecida posible
 * (pedido el 12/10/2026). Una búsqueda con facetas sobre
 * `V_HISTORIAL_INTERVENCIONES`: cada marcación de los facilitadores con su
 * horario, la diferencia en minutos, el índice, si se desarrolló y dónde. El
 * ícono es el que ya tenía en el menú (`ListChecks`).
 *
 * Backend: `GET intervenciones/realizadas` de `backend/intervenciones.sql` (la
 * consulta de APEX tal cual, con todas las marcaciones y no solo las
 * desviadas como el `GET intervenciones` del Inicio).
 *
 * Como en APEX:
 *
 * - Los filtros Año, ¿Desarrollo?, Fecha, Mes, Facilitador e Institución, cada
 *   uno con cuántas filas quedan con los otros puestos; el buscador; y los
 *   botones verdes **"Todos los meses"** y **"Todas las fechas"**.
 * - El reporte con sus columnas en orden: el lápiz que abre la intervención
 *   (la página 51; en el sitio, `/intervenciones/$id`), Hora en amarillo, Hora
 *   Desde en verde, Hora Hasta en naranja, Dif. Min. en rojo si llegó tarde, en
 *   azul si llegó antes y en gris si en hora, con su total al pie; el link al
 *   mapa; 50 filas por página con la paginación arriba a la derecha; y Excel.
 *
 * Distinto de APEX, a propósito:
 *
 * - **Entra con el mes en curso** (o, en otro año, el último mes con datos), y
 *   el año y los meses se piden al backend: el historial entero son más de
 *   70.000 marcaciones y APEX las paginaba en el servidor. "Todos los meses"
 *   trae el año entero (con un tope; la pantalla avisa si se corta).
 * - Cada columna se ordena y se filtra desde su encabezado
 *   (`lib/tabla-reporte.ts`), como el menú de columna de APEX.
 * - El reporte tiene la lupa de las otras planillas.
 */
function IntervencionesRealizadasPage() {
  const hoy = new Date();
  const anioActual = String(hoy.getFullYear());
  const mesActual = hoy.getMonth() + 1;

  const [anio, setAnio] = useState(anioActual);
  /** `null` = los meses de entrada (ver `mesesEntrada`). `[]` = todo el año. */
  const [mesesSel, setMesesSel] = useState<number[] | null>(null);
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(ANCHO_TABLA);

  // Los años y cuántas filas tiene cada mes, sin filas: `meses=0` no matchea
  // ningún mes. Sirve para elegir el mes de entrada de otro año y para las
  // cuentas de las pastillas de mes.
  const resumen = useQuery({
    queryKey: keysIntervenciones.realizadas(anio, [0]),
    queryFn: () => listarRealizadas(anio, [0]),
  });
  const mesesConDatos = resumen.data?.meses ?? [];
  const mesesEntrada =
    anio === anioActual
      ? [mesActual]
      : mesesConDatos.length
        ? [mesesConDatos[mesesConDatos.length - 1].mes]
        : [];
  const meses = mesesSel ?? mesesEntrada;
  const mesesListos = mesesSel !== null || anio === anioActual || resumen.isSuccess;

  const datos = useQuery({
    queryKey: keysIntervenciones.realizadas(anio, meses),
    queryFn: () => listarRealizadas(anio, meses),
    enabled: mesesListos,
  });

  const anios = [...new Set([anioActual, ...(resumen.data?.anios ?? [])].filter(Boolean))].sort(
    (a, b) => b.localeCompare(a),
  );

  const filas = useMemo<Fila[]>(
    () =>
      (datos.data?.data ?? []).map((i) => {
        const indice = textoIndice(i);
        return {
          ...i,
          indice,
          // Las columnas de P52_SEARCH: fecha, manual, observación, ¿desarrollo?,
          // institución, grado (con sección y énfasis), mes, hora y facilitador.
          busqueda: normalizar(
            [
              i.fecha,
              i.manual,
              i.observacion,
              i.si_no,
              i.institucion,
              i.grado,
              MESES[i.mes - 1],
              i.hora,
              i.facilitador,
              indice,
            ].join(" "),
          ),
        };
      }),
    [datos.data],
  );

  const filtradas = useMemo(() => filas.filter((x) => pasa(x, f)), [filas, f]);
  const tabla = useTablaReporte(filtradas, COLUMNAS);

  // Las opciones de cada faceta con cuántas filas quedan con las otras puestas,
  // ordenadas por cantidad como `sort_by_top_counts`; las fechas, de la más
  // nueva a la más vieja, como la LOV de P52_FECHA.
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
          fa.clave === "fechas"
            ? ordenFecha(b.valor).localeCompare(ordenFecha(a.valor))
            : b.n - a.n || a.texto.localeCompare(b.texto, "es"),
        );
    }
    return r;
  }, [filas, f]);

  const porDesarrollo = useMemo(() => {
    const m = { Si: 0, No: 0 };
    for (const x of filas) {
      const d = desarrollo(x);
      if (d && pasa(x, f, "desarrollo")) m[d]++;
    }
    return m;
  }, [filas, f]);

  const total = tabla.visibles.length;
  const sumaDiferencia = tabla.visibles.reduce((s, x) => s + (x.diferencia ?? 0), 0);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = tabla.visibles.slice(desde, desde + POR_PAGINA);

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setPagina(0);
  };
  const cambiarMeses = (m: number[]) => {
    setMesesSel(m);
    // Las fechas elegidas pueden no estar en los meses nuevos.
    setF((x) => ({ ...x, fechas: [] }));
    setPagina(0);
  };
  const alternarMes = (m: number) =>
    cambiarMeses(
      meses.includes(m) ? meses.filter((x) => x !== m) : [...meses, m].sort((a, b) => a - b),
    );
  const restablecer = () => {
    setAnio(anioActual);
    setMesesSel(null);
    setF(SIN_FILTROS);
    tabla.limpiar();
    setPagina(0);
  };

  // Los filtros puestos, como chips (el "active_facets" de APEX).
  const nombreDe = (fa: Faceta, v: string) => opciones[fa].find((o) => o.valor === v)?.texto ?? v;
  const chips = [
    ...(f.desarrollo
      ? [
          {
            clave: "d",
            texto: `Desarrollo: ${f.desarrollo === "Si" ? "Sí" : "No"}`,
            quitar: () => cambiar({ desarrollo: "" }),
          },
        ]
      : []),
    ...FACETAS.flatMap((fa) =>
      f[fa.clave].map((v) => ({
        clave: `${fa.clave}-${v}`,
        texto: nombreDe(fa.clave, v),
        quitar: () => cambiar({ [fa.clave]: f[fa.clave].filter((y) => y !== v) }),
      })),
    ),
  ];
  const hayFiltros =
    chips.length > 0 || f.texto.trim() !== "" || anio !== anioActual || mesesSel !== null;

  const nombreArchivo = `intervenciones-${anio}-${meses.length ? meses.join("-") : "todo-el-anio"}`;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Intervenciones Realizadas</h1>
            <p className="text-xs text-muted-foreground">
              Cada marcación de los facilitadores, con su horario y su diferencia
            </p>
          </div>
          <BotonExcel
            onDescargar={() => descargarCsv(tabla.visibles, nombreArchivo)}
            deshabilitado={!total}
          />
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <SelectorModal
            label="Año"
            descripcion="Las marcaciones de ese año"
            value={anio}
            onChange={(a) => {
              setAnio(a);
              setMesesSel(null);
              setF(SIN_FILTROS);
              setPagina(0);
            }}
            opciones={anios.map((a) => ({
              valor: a,
              texto: a,
              extra: a === anioActual ? "El año en curso" : undefined,
            }))}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Fecha"
            placeholder="Todas"
            descripcion="Las fechas de los meses elegidos, de la más nueva a la más vieja"
            value={f.fechas}
            onChange={(v) => cambiar({ fechas: v })}
            opciones={opciones.fechas}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Facilitador"
            placeholder="Todos"
            descripcion="Debajo de cada uno, cuántas intervenciones quedan con los otros filtros"
            value={f.facilitadores}
            onChange={(v) => cambiar({ facilitadores: v })}
            opciones={opciones.facilitadores}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Institución"
            placeholder="Todas"
            descripcion="Debajo de cada una, cuántas intervenciones quedan con los otros filtros"
            value={f.instituciones}
            onChange={(v) => cambiar({ instituciones: v })}
            opciones={opciones.instituciones}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
        </div>

        {/* El mes (faceta P52_MES), en pastillas con su cuenta. Sin ninguno
            marcado es el año entero, como en APEX. */}
        <div className="mb-3">
          <p className="mb-1.5 text-sm font-medium">Mes</p>
          <div className="flex flex-wrap gap-1.5">
            {mesesConDatos.map((m) => {
              const marcado = meses.includes(m.mes);
              return (
                <button
                  key={m.mes}
                  type="button"
                  onClick={() => alternarMes(m.mes)}
                  aria-pressed={marcado}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${
                    marcado
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/80 bg-card hover:border-primary/40"
                  }`}
                >
                  {MESES[m.mes - 1]}
                  <span className="text-[11px] tabular-nums opacity-80">
                    {numero.format(m.cantidad)}
                  </span>
                </button>
              );
            })}
            {!mesesConDatos.length && !resumen.isLoading && (
              <span className="text-sm text-muted-foreground">Sin marcaciones en {anio}</span>
            )}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* "Seleccionar todos": los dos botones verdes de APEX. */}
          <button
            type="button"
            onClick={() => cambiarMeses([])}
            style={VERDE_APEX}
            className="h-11 rounded-xl px-4 text-sm font-semibold shadow-soft hover:opacity-90"
          >
            Todos los meses
          </button>
          <button
            type="button"
            onClick={() => cambiar({ fechas: [] })}
            style={VERDE_APEX}
            className="h-11 rounded-xl px-4 text-sm font-semibold shadow-soft hover:opacity-90"
          >
            Todas las fechas
          </button>

          {/* ¿Desarrollo? (P52_SI_NO), con sus cuentas. */}
          <div
            role="radiogroup"
            aria-label="¿Desarrollo?"
            className="flex h-11 w-full rounded-xl border border-input bg-card p-0.5 text-sm sm:w-auto"
          >
            {(
              [
                { valor: "", texto: "Todas", n: porDesarrollo.Si + porDesarrollo.No },
                { valor: "Si", texto: "Desarrolladas", n: porDesarrollo.Si },
                { valor: "No", texto: "No desarrolladas", n: porDesarrollo.No },
              ] as const
            ).map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={f.desarrollo === o.valor}
                onClick={() => cambiar({ desarrollo: o.valor })}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2.5 font-medium whitespace-nowrap transition-colors ${
                  f.desarrollo === o.valor
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.texto}
                <span className="text-[11px] tabular-nums opacity-80">{numero.format(o.n)}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 basis-56 [&>div]:mb-0">
            <Buscador
              valor={f.texto}
              onCambio={(v) => cambiar({ texto: v })}
              placeholder="Buscar fecha, institución, grado, facilitador…"
            />
          </div>
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
            Se muestran las primeras {numero.format(datos.data.limite)}: elegí menos meses para
            verlas todas.
          </p>
        )}

        {/* ── "Resultados de la Búsqueda" ──────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {!mesesListos || datos.isLoading ? (
            <Cargando />
          ) : datos.isError ? (
            <div className="p-4">
              <Fallo error={datos.error} texto="No se pudieron cargar las intervenciones" />
            </div>
          ) : (
            <>
              {/* Arriba: la lupa y la paginación (APEX la ponía arriba a la derecha). */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-[12.5px]">
                <span className="font-semibold tabular-nums">
                  {plural(total, "intervención", "intervenciones")}
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />
                  {total > 0 && (
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
                        {numero.format(total)}
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
                </div>
              </div>
              <FiltrosColumnas tabla={tabla} />

              {!total ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato
                </p>
              ) : (
                <div ref={marco} className={cabe ? "" : "overflow-x-auto"}>
                  <table
                    style={{ zoom, width: ANCHO_TABLA }}
                    className={`table-fixed border-separate border-spacing-0 text-[12px] ${zoom >= 1 ? "min-w-full" : ""}`}
                  >
                    <colgroup>
                      {ANCHOS.map((c, i) => (
                        <col key={i} style={{ width: c }} />
                      ))}
                    </colgroup>
                    <thead
                      className={cabe ? "sticky z-10" : ""}
                      style={cabe ? { top: topEncabezado } : undefined}
                    >
                      <tr>
                        <Th />
                        {COLUMNAS.slice(0, 13).map((c) => (
                          <Th
                            key={c.clave}
                            centro={["hora", "hora_desde", "hora_hasta", "diferencia"].includes(
                              c.clave,
                            )}
                          >
                            <EncabezadoReporte
                              columna={c}
                              tabla={tabla}
                              centro={["hora", "hora_desde", "hora_hasta", "diferencia"].includes(
                                c.clave,
                              )}
                            />
                          </Th>
                        ))}
                        <Th centro>Mapa</Th>
                        <Th>
                          <EncabezadoReporte columna={col("id")} tabla={tabla} />
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {enPagina.map((x) => {
                        const mapa = linkMapaPunto(x.latitud, x.longitud);
                        return (
                          <tr key={x.id_intervencion} className="hover:bg-muted/40">
                            <td className="border-r border-b border-border/40 text-center">
                              <Link
                                to="/intervenciones/$id"
                                params={{ id: String(x.id_intervencion) }}
                                aria-label="Editar"
                                title="Editar la intervención"
                                className="inline-grid size-6 place-items-center rounded text-primary hover:bg-primary-soft"
                              >
                                <Pencil className="size-3.5" />
                              </Link>
                            </td>
                            <Td texto={x.fecha} num />
                            <Td texto={x.hora ?? ""} num estilo={COLOR_HORA} negrita />
                            <Td texto={x.hora_desde ?? ""} num estilo={COLOR_DESDE} negrita />
                            <Td texto={x.hora_hasta ?? ""} num estilo={COLOR_HASTA} negrita />
                            <td className="border-r border-b border-border/40 px-1 py-1 text-center">
                              {x.diferencia != null && (
                                <span
                                  className="inline-block min-w-10 rounded-md px-1.5 py-0.5 font-bold tabular-nums"
                                  style={colorDiferencia(x.diferencia)}
                                >
                                  {x.diferencia}
                                </span>
                              )}
                            </td>
                            <Td texto={x.manual ?? ""} />
                            <Td texto={x.indice} />
                            <Td texto={x.si_no ?? ""} />
                            <Td texto={x.institucion} />
                            <Td texto={x.grado ?? ""} />
                            <Td texto={x.facilitador} />
                            <Td texto={x.observacion ?? ""} />
                            <Td texto={x.motivo_desarrollo ?? ""} />
                            <td className="border-r border-b border-border/40 text-center">
                              {mapa && (
                                <a
                                  href={mapa}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Ver en el mapa"
                                  title="Ver dónde marcó, en Google Maps"
                                  className="inline-grid size-6 place-items-center rounded text-primary hover:bg-primary-soft"
                                >
                                  <MapPin className="size-3.5" />
                                </a>
                              )}
                            </td>
                            <Td texto={String(x.id_intervencion)} num />
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* El total de Dif. Min. (`sum_column` de APEX), de todo lo filtrado. */}
                    <tfoot>
                      <tr className="bg-muted/60 font-semibold">
                        <td className="border-r border-border/40" />
                        <td
                          colSpan={4}
                          className="border-r border-border/40 px-1 py-1.5 text-right"
                        >
                          Total
                        </td>
                        <td className="border-r border-border/40 px-1 py-1.5 text-center tabular-nums">
                          {numero.format(sumaDiferencia)}
                        </td>
                        <td colSpan={10} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Th({ children, centro }: { children?: ReactNode; centro?: boolean }) {
  return (
    <th
      className={`border-r border-b border-border/60 bg-muted px-1 py-1.5 text-[11px] font-semibold ${
        centro ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/** La celda compacta: lo que no entra se corta con "…" y se lee entero al pasar el mouse. */
function Td({
  texto,
  num,
  estilo,
  negrita,
}: {
  texto: string;
  num?: boolean;
  estilo?: CSSProperties;
  negrita?: boolean;
}) {
  return (
    <td
      title={texto || undefined}
      style={estilo}
      className={`truncate border-r border-b border-border/40 px-1 py-1 ${
        num ? "text-center tabular-nums" : ""
      } ${negrita ? "font-bold" : ""}`}
    >
      {texto}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * El "Excel" de APEX: todo lo filtrado, en el orden en que se ve, con las
 * columnas exportables del reporte (el mapa como link). Ver `lib/excel.ts`.
 */
function descargarCsv(filas: Fila[], nombre: string) {
  descargarExcel(
    nombre,
    [
      ...COLUMNAS.filter((c) => c.clave !== "id").map((c): ColumnaExcel<Fila> => [
        c.titulo,
        c.valor,
      ]),
      ["Mapa", (x) => linkMapaPunto(x.latitud, x.longitud) ?? ""],
      ["Id Intervención", (x) => x.id_intervencion],
    ],
    filas,
  );
}
