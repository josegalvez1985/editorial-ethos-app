import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, Eraser, FileSearch, MapPin } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { LupaPlanilla } from "@/components/lupa-planilla";
import { SelectorModal } from "@/components/selector-modal";
import { SelectorPeriodo } from "@/components/selector-periodo";
import { TotalesPago } from "@/components/totales-pago";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysIntervenciones,
  linkMapaPunto,
  listarResumenPeriodo,
  SUELDO_INICIAL,
  type IntervencionResumen,
} from "@/lib/intervenciones";
import { usePlanilla } from "@/lib/lupa";
import { otroInicial, rangoDe, rangoValido, type Periodo } from "@/lib/periodos";
import {
  DIAS,
  GRADOS,
  keysPostulaciones,
  listarPostulaciones,
  MANUALES,
} from "@/lib/postulaciones";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/resumen-intervenciones/")({
  head: () => ({
    meta: [
      { title: "Resumen de Intervenciones — Juventud con Valores" },
      {
        name: "description",
        content: "Las intervenciones de un período y lo que se le paga a cada facilitador.",
      },
    ],
  }),
  component: ResumenIntervencionesPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

type Fila = IntervencionResumen & { indice: string; diaTexto: string };

/** "LUNES" → "Lunes". */
const capital = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : "");

/*
 * Los colores de APEX: el CSS en línea de la página 53 (las tres horas y los
 * tres campos de totales) y los del `CASE` de DIFERENCIA_MINUTOS.
 */
const COLOR_HORA: CSSProperties = { backgroundColor: "#ffeb3b", color: "#000" };
const COLOR_DESDE: CSSProperties = { backgroundColor: "#4caf50", color: "#fff" };
const COLOR_HASTA: CSSProperties = { backgroundColor: "#ff9800", color: "#fff" };
const colorDiferencia = (d: number): CSSProperties =>
  d >= 0
    ? { backgroundColor: "#2196F3", color: "#fff" }
    : { backgroundColor: "#f44336", color: "#fff" };

/**
 * Las columnas del reporte que se ordenan y filtran, en el orden del reporte
 * de APEX. El ícono de postulaciones y el mapa van aparte: son links.
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "fecha", titulo: "Fecha", valor: (f) => f.fecha, orden: (f) => ordenFecha(f.fecha) },
  { clave: "hora", titulo: "Hora", valor: (f) => f.hora },
  { clave: "hora_desde", titulo: "Hora Desde", valor: (f) => f.hora_desde },
  { clave: "hora_hasta", titulo: "Hora Hasta", valor: (f) => f.hora_hasta },
  { clave: "diferencia", titulo: "Dif. Min.", valor: (f) => f.diferencia },
  { clave: "manual", titulo: "Manual", valor: (f) => f.manual },
  { clave: "indice", titulo: "Índice", valor: (f) => f.indice, orden: (f) => f.nro_indice },
  { clave: "postulaciones", titulo: "Postulaciones", valor: (f) => f.postulaciones },
  { clave: "historial", titulo: "Historial", valor: (f) => f.diaTexto },
];
const col = (clave: string) => COLUMNAS.find((c) => c.clave === clave)!;
const CENTRADAS = ["hora", "hora_desde", "hora_hasta", "diferencia"];

/** El ancho de cada columna, en el orden en que se pintan (para la lupa). */
const ANCHOS = [
  180, // institución
  160, // facilitador
  84, // fecha
  56, // hora
  64, // hora desde
  64, // hora hasta
  66, // dif. min.
  84, // manual
  170, // índice
  260, // postulaciones (texto)
  44, // postulaciones (lupa)
  90, // historial
  44, // mapa
];
const ANCHO_TABLA = ANCHOS.reduce((n, c) => n + c, 0);

/** El orden de entrada del reporte de APEX: Fecha descendente, Hora Desde ascendente. */
function ordenDeEntrada(a: Fila, b: Fila) {
  return (
    ordenFecha(b.fecha).localeCompare(ordenFecha(a.fecha)) ||
    (a.hora_desde ?? "~").localeCompare(b.hora_desde ?? "~")
  );
}

/**
 * Resumen de Intervenciones: la página 53 de APEX. Lo que se le paga a cada
 * facilitador: las intervenciones de un período, una por clase y día (ver
 * `IntervencionResumen`), con el total de intervenciones y el total del salario a
 * razón de un sueldo por intervención. El ícono es el que ya tenía en el menú
 * (`ChartPie`).
 *
 * Backend: `GET intervenciones/resumen-periodo` de
 * `backend/intervenciones.sql` (la consulta de APEX).
 *
 * Como en APEX:
 *
 * - Los parámetros Fecha desde / hasta, Institución, Facilitadores (que se
 *   recortan por la institución), Desarrollo (Sí / No) y Sueldo por
 *   intervención (30.000 de entrada), y Limpiar.
 * - Los tres totales con sus colores: Sueldo en verde, Total Intervenciones en
 *   azul y Total Salario en naranja.
 * - El reporte con sus columnas en orden, ordenado por fecha (de la más nueva)
 *   y hora de inicio: Hora en amarillo, Hora Desde en verde, Hora Hasta en
 *   naranja, Dif. Min. en azul si llegó antes o en hora y en rojo si llegó
 *   tarde, las postulaciones de la clase, la lupa que las abre (la página 54),
 *   el Historial (la 56) y el mapa. Y la descarga (APEX: CSV, XLSX, PDF…; acá
 *   Excel).
 *
 * Distinto de APEX, a propósito:
 *
 * - **Sin botón "Consultar":** se actualiza al cambiar un parámetro, y entra
 *   con este mes y las desarrolladas (APEX entraba vacío).
 * - **El período con atajos** (Este mes, Mes anterior, semanas) y "Otro
 *   período" con las dos fechas; hasta un año.
 * - **Institución y facilitador se eligen sobre lo que trajo el período**, cada
 *   uno con cuántas intervenciones tiene, sin volver a consultar.
 * - **Los totales cuentan lo que se ve:** con un filtro de columna puesto, el
 *   total y el salario son los de esas filas.
 * - Postulaciones (la 54) e Historial (la 56) son diálogos de esta pantalla.
 *   El historial muestra las de ese facilitador, institución y día de la
 *   semana **dentro del período elegido**.
 * - Cada columna se ordena y se filtra desde su encabezado.
 */
function ResumenIntervencionesPage() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [otro, setOtro] = useState(otroInicial);
  const [siNo, setSiNo] = useState<"Si" | "No">("Si");
  const [idInst, setIdInst] = useState("");
  const [idFac, setIdFac] = useState("");
  const [sueldo, setSueldo] = useState(String(SUELDO_INICIAL));
  const [pagina, setPagina] = useState(0);
  const [postulacionesDe, setPostulacionesDe] = useState<Fila | null>(null);
  const [historialDe, setHistorialDe] = useState<Fila | null>(null);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(ANCHO_TABLA);

  const { desde, hasta } = rangoDe(periodo, otro);
  const valido = rangoValido({ desde, hasta });

  const datos = useQuery({
    queryKey: keysIntervenciones.resumenPeriodo(desde, hasta, siNo),
    queryFn: () => listarResumenPeriodo(desde, hasta, siNo),
    enabled: valido,
  });

  const filas = useMemo<Fila[]>(
    () =>
      (datos.data?.data ?? []).map((i) => ({
        ...i,
        indice:
          i.nro_indice != null
            ? `${i.nro_indice}${i.indice_titulo ? ` - ${i.indice_titulo}` : ""}`
            : i.id_indice != null
              ? `#${i.id_indice}`
              : "",
        diaTexto: capital(i.dia),
      })),
    [datos.data],
  );

  // Las instituciones y los facilitadores del período, cada uno con cuántas
  // intervenciones tiene con el otro elegido (los facilitadores se recortan
  // por la institución, como la LOV en cascada de APEX).
  const opciones = useMemo(() => {
    const contar = (
      xs: Fila[],
      id: (f: Fila) => number,
      nombre: (f: Fila) => string,
      elegido: string,
    ) => {
      const m = new Map<string, { valor: string; texto: string; n: number }>();
      for (const f of xs) {
        const v = String(id(f));
        const o = m.get(v) ?? { valor: v, texto: nombre(f), n: 0 };
        o.n++;
        m.set(v, o);
      }
      const lista = [...m.values()].sort((a, b) => a.texto.localeCompare(b.texto, "es"));
      if (elegido && !m.has(elegido)) {
        const f = filas.find((x) => String(id(x)) === elegido);
        if (f) lista.push({ valor: elegido, texto: nombre(f), n: 0 });
      }
      return lista.map((o) => ({ ...o, extra: plural(o.n, "intervención", "intervenciones") }));
    };
    return {
      instituciones: contar(
        filas.filter((f) => !idFac || String(f.id_facilitador) === idFac),
        (f) => f.id_institucion,
        (f) => f.institucion,
        idInst,
      ),
      facilitadores: contar(
        filas.filter((f) => !idInst || String(f.id_institucion) === idInst),
        (f) => f.id_facilitador,
        (f) => f.facilitador,
        idFac,
      ),
    };
  }, [filas, idInst, idFac]);

  const filtradas = useMemo(
    () =>
      filas
        .filter(
          (f) =>
            (!idInst || String(f.id_institucion) === idInst) &&
            (!idFac || String(f.id_facilitador) === idFac),
        )
        .sort(ordenDeEntrada),
    [filas, idInst, idFac],
  );
  const tabla = useTablaReporte(filtradas, COLUMNAS);

  const total = tabla.visibles.length;

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desdeFila = pag * POR_PAGINA;
  const enPagina = tabla.visibles.slice(desdeFila, desdeFila + POR_PAGINA);

  const limpiar = () => {
    setPeriodo("mes");
    setSiNo("Si");
    setIdInst("");
    setIdFac("");
    setSueldo(String(SUELDO_INICIAL));
    tabla.limpiar();
    setPagina(0);
  };

  const nombreArchivo = `resumen-intervenciones-${desde}-a-${hasta}`;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Resumen de Intervenciones</h1>
            <p className="text-xs text-muted-foreground">
              Las intervenciones de un período y lo que se le paga a cada facilitador
            </p>
          </div>
          <BotonExcel
            onDescargar={() => descargarCsv(tabla.visibles, nombreArchivo)}
            deshabilitado={!total}
          />
        </div>

        {/* ── "Parametros" ─────────────────────────────────────────────── */}
        <section className="mb-4 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <SelectorPeriodo
            periodo={periodo}
            otro={otro}
            onPeriodo={(p) => {
              setPeriodo(p);
              setPagina(0);
            }}
            onOtro={setOtro}
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SelectorModal
              label="Institución"
              descripcion="Las que tienen intervenciones en el período"
              value={idInst}
              onChange={(v) => {
                setIdInst(v);
                setPagina(0);
              }}
              opciones={[{ valor: "", texto: "Todas" }, ...opciones.instituciones]}
              placeholder="Todas"
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <SelectorModal
              label="Facilitadores"
              descripcion={
                idInst
                  ? "Los que tienen intervenciones en esa institución en el período"
                  : "Los que tienen intervenciones en el período"
              }
              value={idFac}
              onChange={(v) => {
                setIdFac(v);
                setPagina(0);
              }}
              opciones={[{ valor: "", texto: "Todos" }, ...opciones.facilitadores]}
              placeholder="Todos"
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <div>
              <p className="mb-1.5 text-sm font-medium">Desarrollo (Sí/No)</p>
              <div
                role="radiogroup"
                aria-label="Desarrollo"
                className="flex h-11 rounded-xl border border-input bg-card p-0.5 text-sm"
              >
                {(
                  [
                    { valor: "Si", texto: "Sí" },
                    { valor: "No", texto: "No" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={siNo === o.valor}
                    onClick={() => {
                      setSiNo(o.valor);
                      setPagina(0);
                    }}
                    className={`flex-1 rounded-[10px] font-medium transition-colors ${
                      siNo === o.valor
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={limpiar}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-input bg-card text-sm font-semibold hover:border-primary/40"
              >
                <Eraser className="size-4" />
                Limpiar
              </button>
            </div>
          </div>
        </section>

        {/* Los tres campos de totales de APEX, con sus colores. */}
        <div className="mb-4">
          <TotalesPago sueldo={sueldo} onSueldo={setSueldo} intervenciones={total} />
        </div>

        {datos.data?.truncado && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Se muestran las primeras {numero.format(datos.data.limite)}: elegí un período más corto
            para verlas todas (y para que el total sea el real).
          </p>
        )}

        {/* ── "Resumen de Intervenciones": el reporte ──────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {!valido ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí un período válido.
            </p>
          ) : datos.isLoading ? (
            <Cargando />
          ) : datos.isError ? (
            <div className="p-4">
              <Fallo error={datos.error} texto="No se pudieron cargar las intervenciones" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-[12.5px]">
                <span className="font-semibold tabular-nums">
                  {plural(total, "intervención", "intervenciones")}
                </span>
                <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />
              </div>
              <FiltrosColumnas tabla={tabla} />
              {!total ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato.
                </p>
              ) : (
                <>
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
                          {COLUMNAS.slice(0, 10).map((c) => (
                            <Th key={c.clave} centro={CENTRADAS.includes(c.clave)}>
                              <EncabezadoReporte
                                columna={c}
                                tabla={tabla}
                                centro={CENTRADAS.includes(c.clave)}
                              />
                            </Th>
                          ))}
                          <Th centro>
                            <span title="Ver las postulaciones de la clase">Post.</span>
                          </Th>
                          <Th>
                            <EncabezadoReporte columna={col("historial")} tabla={tabla} />
                          </Th>
                          <Th centro>Mapa</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((x) => {
                          const mapa = linkMapaPunto(x.latitud, x.longitud);
                          return (
                            <tr key={x.id_intervencion} className="hover:bg-muted/40">
                              <Td texto={x.institucion} />
                              <Td texto={x.facilitador} />
                              <Td texto={x.fecha} centro />
                              <Td texto={x.hora ?? ""} centro estilo={COLOR_HORA} />
                              <Td texto={x.hora_desde ?? ""} centro estilo={COLOR_DESDE} />
                              <Td texto={x.hora_hasta ?? ""} centro estilo={COLOR_HASTA} />
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
                              <Td texto={x.postulaciones ?? ""} />
                              <td className="border-r border-b border-border/40 text-center">
                                <button
                                  type="button"
                                  onClick={() => setPostulacionesDe(x)}
                                  aria-label="Ver las postulaciones"
                                  title="Ver las postulaciones de la clase"
                                  className="inline-grid size-6 place-items-center rounded text-primary hover:bg-primary-soft"
                                >
                                  <FileSearch className="size-3.5" />
                                </button>
                              </td>
                              <td className="border-r border-b border-border/40 px-1 py-1">
                                <button
                                  type="button"
                                  onClick={() => setHistorialDe(x)}
                                  title={`Las de los ${x.diaTexto.toLowerCase()} en esta institución`}
                                  className="truncate font-medium text-primary hover:underline"
                                >
                                  {x.diaTexto}
                                </button>
                              </td>
                              <td className="border-b border-border/40 text-center">
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
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* La paginación abajo a la derecha, como el reporte interactivo de APEX. */}
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
                      {numero.format(desdeFila + 1)} - {numero.format(desdeFila + enPagina.length)}{" "}
                      de {numero.format(total)}
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
            </>
          )}
        </section>
      </div>

      {postulacionesDe && (
        <DialogoPostulaciones fila={postulacionesDe} onCerrar={() => setPostulacionesDe(null)} />
      )}
      {historialDe && (
        <DialogoHistorial fila={historialDe} filas={filas} onCerrar={() => setHistorialDe(null)} />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Los diálogos (las páginas 54 y 56 de APEX)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Las postulaciones de la clase: las de esa institución y ese facilitador en
 * ese día y hora de inicio (la página 54 de APEX, que recibía institución,
 * facilitador y "día + hora"). Del año de la intervención.
 */
function DialogoPostulaciones({ fila, onCerrar }: { fila: Fila; onCerrar: () => void }) {
  const anio = fila.fecha.slice(6, 10);
  const q = useQuery({
    queryKey: keysPostulaciones.institucion(fila.id_institucion, anio),
    queryFn: () => listarPostulaciones(fila.id_institucion, anio),
  });
  const dia = DIAS.find((d) => d.clave === normalizar(fila.dia));
  const de = (q.data?.items ?? []).filter(
    (p) =>
      p.idFacilitador === fila.id_facilitador &&
      (!dia || !fila.hora_desde || p.dias[dia.clave].desde === fila.hora_desde),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Postulaciones</DialogTitle>
          <DialogDescription className="text-xs">
            {fila.institucion} · {fila.facilitador} · {fila.diaTexto}
            {fila.hora_desde ? ` ${fila.hora_desde}` : ""} · {anio}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Cargando />
        ) : q.isError ? (
          <Fallo error={q.error} texto="No se pudieron cargar las postulaciones" />
        ) : !de.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay postulaciones de este facilitador en ese día y hora.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  {["Sección", "Grados", "Materia", "Profesor", "Manuales", "Horario"].map((t) => (
                    <th
                      key={t}
                      className="border-r border-b border-border bg-muted px-2 py-1.5 text-left text-xs font-semibold last:border-r-0"
                    >
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {de.map((p) => {
                  const celdas = [
                    p.seccion,
                    GRADOS.filter((g) => p.grados[g.clave])
                      .map((g) => `${g.corto}: ${p.grados[g.clave]}`)
                      .join(", "),
                    p.materia,
                    p.docente,
                    MANUALES.filter((m) => p.manuales[m.clave])
                      .map((m) => `${m.nombre}: ${p.manuales[m.clave]}`)
                      .join(", "),
                    dia ? `${p.dias[dia.clave].desde}-${p.dias[dia.clave].hasta}` : "",
                  ];
                  return (
                    <tr key={p.id}>
                      {celdas.map((c, i) => (
                        <td
                          key={i}
                          className="border-r border-b border-border/60 px-2 py-1.5 last:border-r-0"
                        >
                          {c}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * El historial (la página 56 de APEX, que recibía facilitador, institución,
 * desarrollo y día): las intervenciones de ese facilitador en esa institución
 * los mismos días de la semana, **dentro del período elegido**.
 */
function DialogoHistorial({
  fila,
  filas,
  onCerrar,
}: {
  fila: Fila;
  filas: Fila[];
  onCerrar: () => void;
}) {
  const de = filas
    .filter(
      (x) =>
        x.id_facilitador === fila.id_facilitador &&
        x.id_institucion === fila.id_institucion &&
        x.dia === fila.dia,
    )
    .sort(ordenDeEntrada);

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Historial · {fila.diaTexto}</DialogTitle>
          <DialogDescription className="text-xs">
            {fila.facilitador} en {fila.institucion}, los {fila.diaTexto.toLowerCase()} del período
            · {plural(de.length, "intervención", "intervenciones")}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {["Fecha", "Hora", "Desde", "Hasta", "Dif. Min.", "Manual", "Índice"].map((t) => (
                  <th
                    key={t}
                    className="border-r border-b border-border bg-muted px-2 py-1.5 text-left text-xs font-semibold last:border-r-0"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {de.map((x) => (
                <tr key={x.id_intervencion}>
                  <Celda>{x.fecha}</Celda>
                  <Celda estilo={COLOR_HORA}>{x.hora}</Celda>
                  <Celda estilo={COLOR_DESDE}>{x.hora_desde}</Celda>
                  <Celda estilo={COLOR_HASTA}>{x.hora_hasta}</Celda>
                  <Celda>
                    {x.diferencia != null && (
                      <span
                        className="inline-block min-w-10 rounded-md px-1.5 py-0.5 text-center font-bold tabular-nums"
                        style={colorDiferencia(x.diferencia)}
                      >
                        {x.diferencia}
                      </span>
                    )}
                  </Celda>
                  <Celda>{x.manual}</Celda>
                  <Celda>{x.indice}</Celda>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Th({ children, centro }: { children?: ReactNode; centro?: boolean }) {
  return (
    <th
      className={`border-r border-b border-border/60 bg-muted px-1 py-1.5 text-[11px] font-semibold last:border-r-0 ${
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
  centro,
  estilo,
}: {
  texto: string;
  centro?: boolean;
  estilo?: CSSProperties;
}) {
  return (
    <td
      title={texto || undefined}
      style={estilo}
      className={`truncate border-r border-b border-border/40 px-1 py-1 ${
        centro ? "text-center tabular-nums" : ""
      } ${estilo ? "font-bold" : ""}`}
    >
      {texto}
    </td>
  );
}

function Celda({ children, estilo }: { children: ReactNode; estilo?: CSSProperties }) {
  return (
    <td
      style={estilo}
      className={`border-r border-b border-border/60 px-2 py-1.5 tabular-nums last:border-r-0 ${
        estilo ? "text-center font-bold" : ""
      }`}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La descarga del reporte: lo filtrado, en el orden en que se ve, con sus
 * columnas (el mapa como link). Ver `lib/excel.ts`.
 */
function descargarCsv(filas: Fila[], nombre: string) {
  descargarExcel(
    nombre,
    [
      ...COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
      ["Mapa", (x) => linkMapaPunto(x.latitud, x.longitud) ?? ""],
    ],
    filas,
  );
}
