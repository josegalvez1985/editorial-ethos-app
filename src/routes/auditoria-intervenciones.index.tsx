import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronLeft, ChevronRight, Eraser, MapPin } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { LupaPlanilla } from "@/components/lupa-planilla";
import { SelectorModal } from "@/components/selector-modal";
import { SelectorPeriodo } from "@/components/selector-periodo";
import {
  keysAuditoriaIntervenciones,
  listarAuditoriaIntervenciones,
  OPERACIONES,
  type MovimientoIntervencion,
} from "@/lib/auditoria-intervenciones";
import { nombreTurno } from "@/lib/evaluaciones";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { linkMapaPunto } from "@/lib/intervenciones";
import { usePlanilla } from "@/lib/lupa";
import { otroInicial, rangoDe, rangoValido, type Periodo } from "@/lib/periodos";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";

export const Route = createFileRoute("/auditoria-intervenciones/")({
  head: () => ({
    meta: [
      { title: "Auditoría de Intervenciones — Juventud con Valores" },
      {
        name: "description",
        content: "Quién insertó, modificó o borró cada intervención, y cuándo.",
      },
    ],
  }),
  component: AuditoriaIntervencionesPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

type Fila = MovimientoIntervencion & { indice: string; turnoTexto: string };

/** `DD/MM/YYYY HH24:MI:SS` → `YYYYMMDDHH24MISS`, para ordenar. */
const ordenFechaHora = (f: string | null) =>
  f && /^\d{2}\/\d{2}\/\d{4}/.test(f)
    ? `${f.slice(6, 10)}${f.slice(3, 5)}${f.slice(0, 2)}${f.slice(11).replace(/:/g, "")}`
    : "";

/** El texto de la operación, como lo mostraba APEX. */
const textoOperacion = (op: string) => OPERACIONES[op]?.texto ?? op;

/**
 * Las columnas del reporte que se ordenan y filtran, en el orden del reporte
 * de APEX. El mapa va aparte: es un link.
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "id_auditoria", titulo: "Id Auditoría", valor: (f) => f.id_auditoria, filtrable: false },
  { clave: "operacion", titulo: "Operación", valor: (f) => textoOperacion(f.operacion) },
  { clave: "usuario", titulo: "Usuario", valor: (f) => f.usuario },
  {
    clave: "fecha_auditoria",
    titulo: "Fecha Auditoría",
    valor: (f) => f.fecha_auditoria,
    orden: (f) => f.orden_auditoria,
  },
  { clave: "institucion", titulo: "Institución", valor: (f) => f.institucion },
  { clave: "indice", titulo: "Índice", valor: (f) => f.indice, orden: (f) => f.nro_indice },
  { clave: "si_no", titulo: "Desarrollo", valor: (f) => f.si_no },
  { clave: "grado", titulo: "Grado", valor: (f) => f.grado },
  { clave: "enfasis", titulo: "Énfasis", valor: (f) => f.enfasis },
  { clave: "motivo", titulo: "Motivo", valor: (f) => f.motivo_desarrollo },
  { clave: "seccion", titulo: "Sección", valor: (f) => f.seccion },
  { clave: "turno", titulo: "Turno", valor: (f) => f.turnoTexto, orden: (f) => f.turno },
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  {
    clave: "fecha_intervencion",
    titulo: "Fecha Intervención",
    valor: (f) => f.fecha_intervencion,
    orden: (f) => ordenFechaHora(f.fecha_intervencion),
  },
  { clave: "manual", titulo: "Manual", valor: (f) => f.manual },
  { clave: "latitud", titulo: "Latitud", valor: (f) => f.latitud, filtrable: false },
  { clave: "longitud", titulo: "Longitud", valor: (f) => f.longitud, filtrable: false },
  { clave: "observacion", titulo: "Observación", valor: (f) => f.observacion },
  {
    clave: "id_intervencion",
    titulo: "Id Intervención",
    valor: (f) => f.id_intervencion,
    filtrable: false,
  },
  {
    clave: "id_postulacion",
    titulo: "Id Postulación",
    valor: (f) => f.id_postulacion,
    filtrable: false,
  },
  {
    clave: "usuario_facilitador",
    titulo: "Usuario Facilitador",
    valor: (f) => f.usuario_facilitador,
  },
];

/** El ancho de cada columna, en el orden en que se pintan (para la lupa). */
const ANCHOS = [
  70, 90, 110, 130, 170, 160, 76, 60, 110, 150, 60, 70, 150, 130, 80, 90, 90, 170, 84, 84, 110, 44,
];
const ANCHO_TABLA = ANCHOS.reduce((n, c) => n + c, 0);
const CENTRADAS = [
  "id_auditoria",
  "operacion",
  "grado",
  "seccion",
  "id_intervencion",
  "id_postulacion",
];

type Operacion = "" | "INS" | "UPD" | "DEL";

/**
 * Auditoría de Intervenciones: la página 58 de APEX. Quién insertó, modificó o
 * borró cada intervención, y cuándo, con todos sus datos tal como quedaron en
 * la bitácora `INTERVENCIONES_JN`. El ícono es el que ya tenía en el menú
 * (`FileClock`).
 *
 * Backend: `GET auditoria-intervenciones` de
 * `backend/auditoria_intervenciones.sql` (un paquete propio, como cada tabla).
 *
 * Como en APEX:
 *
 * - Los parámetros Usuario (los facilitadores, por nombre), Fecha desde /
 *   hasta y Operación (Todos, Insertó, Actualizó, Borró), y Limpiar Filtros.
 * - El reporte con sus columnas en el mismo orden, la operación en una
 *   pastilla verde, azul o roja, ordenado por intervención (la más nueva
 *   primero), el link al mapa y la descarga.
 *
 * Distinto de APEX, a propósito:
 *
 * - **Sin botón "Consultar"**, con el período en atajos y "Otro período";
 *   entra con este mes (APEX entraba vacío). Usuario y operación se eligen
 *   sobre lo que trajo el período, cada uno con cuántos movimientos tiene.
 * - **La fecha de auditoría está en hora de Paraguay.** APEX mostraba la del
 *   servidor (UTC), tres horas adelantada; es la misma corrección de la
 *   pantalla Auditoría.
 * - Los ids se ven con su nombre (institución, índice, énfasis, facilitador,
 *   turno), como los mostraban las LOV de APEX.
 * - Cada columna se ordena y se filtra desde su encabezado.
 */
function AuditoriaIntervencionesPage() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [otro, setOtro] = useState(otroInicial);
  const [usuario, setUsuario] = useState("");
  const [operacion, setOperacion] = useState<Operacion>("");
  const [pagina, setPagina] = useState(0);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(ANCHO_TABLA);

  const { desde, hasta } = rangoDe(periodo, otro);
  const valido = rangoValido({ desde, hasta });

  const datos = useQuery({
    queryKey: keysAuditoriaIntervenciones.periodo(desde, hasta),
    queryFn: () => listarAuditoriaIntervenciones(desde, hasta),
    enabled: valido,
    // La bitácora trae datos de las intervenciones de todos: no se guarda en el
    // dispositivo, como las consultas de la pantalla Auditoría.
    meta: { persistir: false },
  });

  const filas = useMemo<Fila[]>(
    () =>
      (datos.data?.data ?? []).map((m) => ({
        ...m,
        indice:
          m.nro_indice != null
            ? `${m.nro_indice}${m.indice_titulo ? ` - ${m.indice_titulo}` : ""}`
            : m.id_indice != null
              ? `#${m.id_indice}`
              : "",
        turnoTexto: nombreTurno(m.turno) ?? "",
      })),
    [datos.data],
  );

  // Los usuarios y las operaciones del período, cada uno con cuántos
  // movimientos tiene con el otro elegido.
  const usuarios = useMemo(() => {
    const m = new Map<string, { valor: string; texto: string; n: number }>();
    for (const f of filas) {
      if (operacion && f.operacion !== operacion) continue;
      const v = f.usuario ?? "";
      const o = m.get(v) ?? {
        valor: v,
        texto: f.nombre_usuario ? `${f.nombre_usuario} (${v})` : v || "(sin usuario)",
        n: 0,
      };
      o.n++;
      m.set(v, o);
    }
    return [...m.values()]
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"))
      .map((o) => ({ ...o, extra: plural(o.n, "movimiento", "movimientos") }));
  }, [filas, operacion]);
  const porOperacion = useMemo(() => {
    const m: Record<string, number> = { INS: 0, UPD: 0, DEL: 0 };
    for (const f of filas) {
      if (usuario && (f.usuario ?? "") !== usuario) continue;
      m[f.operacion] = (m[f.operacion] ?? 0) + 1;
    }
    return m;
  }, [filas, usuario]);

  const filtradas = useMemo(
    () =>
      filas.filter(
        (f) =>
          (!usuario || (f.usuario ?? "") === usuario) && (!operacion || f.operacion === operacion),
      ),
    [filas, usuario, operacion],
  );
  const tabla = useTablaReporte(filtradas, COLUMNAS);

  const total = tabla.visibles.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desdeFila = pag * POR_PAGINA;
  const enPagina = tabla.visibles.slice(desdeFila, desdeFila + POR_PAGINA);

  const limpiar = () => {
    setPeriodo("mes");
    setUsuario("");
    setOperacion("");
    tabla.limpiar();
    setPagina(0);
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Auditoría de Intervenciones</h1>
            <p className="text-xs text-muted-foreground">
              Quién insertó, modificó o borró cada intervención, y cuándo
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                `auditoria-intervenciones-${desde}-a-${hasta}`,
                [
                  ...COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                  ["Mapa", (f) => linkMapaPunto(f.latitud, f.longitud) ?? ""],
                ],
                tabla.visibles,
              )
            }
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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto]">
            <SelectorModal
              label="Usuario"
              descripcion="Quién hizo los cambios en el período"
              value={usuario}
              onChange={(v) => {
                setUsuario(v);
                setPagina(0);
              }}
              opciones={[{ valor: "", texto: "Todos" }, ...usuarios]}
              placeholder="Todos"
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <div>
              <p className="mb-1.5 text-sm font-medium">Operación</p>
              <div
                role="radiogroup"
                aria-label="Operación"
                className="flex h-11 flex-wrap rounded-xl border border-input bg-card p-0.5 text-sm"
              >
                {(
                  [
                    { valor: "", texto: "Todos" },
                    { valor: "INS", texto: "Insertó" },
                    { valor: "UPD", texto: "Actualizó" },
                    { valor: "DEL", texto: "Borró" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={operacion === o.valor}
                    onClick={() => {
                      setOperacion(o.valor);
                      setPagina(0);
                    }}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2.5 font-medium whitespace-nowrap transition-colors ${
                      operacion === o.valor
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.texto}
                    {o.valor && (
                      <span className="text-[11px] tabular-nums opacity-80">
                        {numero.format(porOperacion[o.valor] ?? 0)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={limpiar}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-input bg-card px-4 text-sm font-semibold hover:border-primary/40"
              >
                <Eraser className="size-4" />
                Limpiar Filtros
              </button>
            </div>
          </div>
        </section>

        {datos.data?.truncado && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Se muestran los primeros {numero.format(datos.data.limite)} movimientos: elegí un
            período más corto para verlos todos.
          </p>
        )}

        {/* ── "Datos": el reporte ──────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {!valido ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí un período válido.
            </p>
          ) : datos.isLoading ? (
            <Cargando />
          ) : datos.isError ? (
            <div className="p-4">
              <Fallo error={datos.error} texto="No se pudo cargar la auditoría" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-[12.5px]">
                <span className="font-semibold tabular-nums">
                  {plural(total, "movimiento", "movimientos")}
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
                          {COLUMNAS.map((c) => (
                            <Th key={c.clave} centro={CENTRADAS.includes(c.clave)}>
                              <EncabezadoReporte
                                columna={c}
                                tabla={tabla}
                                centro={CENTRADAS.includes(c.clave)}
                              />
                            </Th>
                          ))}
                          <Th centro>Mapa</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((f, i) => {
                          const mapa = linkMapaPunto(f.latitud, f.longitud);
                          const op = OPERACIONES[f.operacion];
                          return (
                            <tr
                              key={`${f.id_auditoria}-${f.orden_auditoria}-${i}`}
                              className="hover:bg-muted/40"
                            >
                              <Td texto={String(f.id_auditoria ?? "")} centro />
                              <td className="border-r border-b border-border/40 px-1 py-1 text-center">
                                <span
                                  className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-white"
                                  style={{ backgroundColor: op?.color ?? "gray" }}
                                >
                                  {textoOperacion(f.operacion)}
                                </span>
                              </td>
                              <Td texto={f.usuario ?? ""} titulo={f.nombre_usuario ?? undefined} />
                              <Td texto={f.fecha_auditoria} />
                              <Td texto={f.institucion ?? ""} />
                              <Td texto={f.indice} />
                              <Td texto={f.si_no ?? ""} />
                              <Td texto={f.grado ?? ""} centro />
                              <Td texto={f.enfasis ?? ""} />
                              <Td texto={f.motivo_desarrollo ?? ""} />
                              <Td texto={f.seccion ?? ""} centro />
                              <Td texto={f.turnoTexto} />
                              <Td texto={f.facilitador ?? ""} />
                              <Td texto={f.fecha_intervencion ?? ""} />
                              <Td texto={f.manual ?? ""} />
                              <Td texto={f.latitud ?? ""} />
                              <Td texto={f.longitud ?? ""} />
                              <Td texto={f.observacion ?? ""} />
                              <Td texto={String(f.id_intervencion ?? "")} centro />
                              <Td texto={String(f.id_postulacion ?? "")} centro />
                              <Td texto={f.usuario_facilitador ?? ""} />
                              <td className="border-b border-border/40 text-center">
                                {mapa && (
                                  <a
                                    href={mapa}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Ver en el mapa"
                                    title="Ver dónde se marcó, en Google Maps"
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
    </AppShell>
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
function Td({ texto, centro, titulo }: { texto: string; centro?: boolean; titulo?: string }) {
  return (
    <td
      title={titulo ?? (texto || undefined)}
      className={`truncate border-r border-b border-border/40 px-1 py-1 ${
        centro ? "text-center tabular-nums" : ""
      }`}
    >
      {texto}
    </td>
  );
}
