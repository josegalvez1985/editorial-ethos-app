import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileDown,
  Loader2,
  Route as RouteIcon,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ChipsSeleccion, MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { keysInventario, listarSucursales } from "@/lib/inventarios";
import { abrirPdfEnPestana, generarPdfTransferencias } from "@/lib/pdf-transferencias";
import { useSession } from "@/lib/session";
import {
  agruparPorTransferencia,
  historialTransferencias,
  keysTransferencias,
  resumirManuales,
  resumirRutas,
  type FiltrosHistorialTransf,
  type TransferenciaAgrupada,
} from "@/lib/transferencias";

export const Route = createFileRoute("/consulta-transferencias/")({
  head: () => ({
    meta: [
      { title: "Consulta de transferencias — Juventud con Valores" },
      {
        name: "description",
        content: "Transferencias de manuales entre sucursales, por ruta y por manual, con PDF.",
      },
    ],
  }),
  component: ConsultaTransferenciasPage,
});

type Estado = "" | "N" | "S";

const ESTADOS: { valor: Estado; texto: string }[] = [
  { valor: "", texto: "Todas" },
  { valor: "N", texto: "En camino" },
  { valor: "S", texto: "Recibidas" },
];

/** `YYYY-MM-DD` local, armado a mano para no depender del locale. */
function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ddmmyyyy = (s: string) => s.split("-").reverse().join("/");
const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/**
 * Consulta de transferencias: qué manuales se movieron entre sucursales, en un
 * período, y su PDF.
 *
 * ## TRES CAPAS, DE LO GENERAL AL DETALLE
 *
 * 1. **Resumen**: cuántas, cuántos libros, cuántas siguen en camino.
 * 2. **Panorama**: por RUTA (origen → destino) y por MANUAL, de mayor a menor.
 *    Contestan de un vistazo "¿qué se mueve y hacia dónde?".
 * 3. **Detalle**: cada transferencia con sus manuales. Tocarla abre la
 *    transferencia (para recibirla, si está en camino).
 *
 * Es de SOLO LECTURA: cargar y recibir se hace en Transferencias de manuales.
 *
 * Sucursal, estado y fechas van al backend; el filtro de manuales se aplica
 * acá, sobre las líneas que ya llegaron, así marcar y desmarcar es instantáneo.
 * Con manuales elegidos, cada transferencia muestra SOLO esas líneas y los
 * totales cuentan solo esos libros.
 */
function ConsultaTransferenciasPage() {
  const { sesion } = useSession();
  const hoy = new Date();

  const [sucursal, setSucursal] = useState("");
  const [estado, setEstado] = useState<Estado>("");
  const [desde, setDesde] = useState(iso(new Date(hoy.getFullYear(), 0, 1)));
  const [hasta, setHasta] = useState(iso(hoy));
  const [manualesSel, setManualesSel] = useState<string[]>([]);
  const [generando, setGenerando] = useState(false);

  const sucursales = useQuery({
    queryKey: keysInventario.sucursales,
    queryFn: listarSucursales,
  });

  const filtros: FiltrosHistorialTransf = {
    id_sucursal: sucursal ? Number(sucursal) : undefined,
    estado: estado || undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  };
  const rangoInvalido = !!desde && !!hasta && desde > hasta;

  const historial = useQuery({
    queryKey: keysTransferencias.historial(filtros),
    queryFn: () => historialTransferencias(filtros),
    enabled: !rangoInvalido,
  });

  const todas = useMemo(() => historial.data?.data ?? [], [historial.data]);
  const manualesDisponibles = useMemo(
    () => [...new Set(todas.map((l) => l.manual))].sort((a, b) => a.localeCompare(b)),
    [todas],
  );

  const lineas = useMemo(() => {
    if (!manualesSel.length) return todas;
    const elegidos = new Set(manualesSel);
    return todas.filter((l) => elegidos.has(l.manual));
  }, [todas, manualesSel]);

  const transf = useMemo(() => agruparPorTransferencia(lineas), [lineas]);
  const rutas = useMemo(() => resumirRutas(transf), [transf]);
  const manuales = useMemo(() => resumirManuales(lineas), [lineas]);

  const enCamino = transf.filter((x) => !x.recibida).length;
  const unidades = transf.reduce((s, x) => s + x.unidades, 0);

  const nombreSucursal =
    sucursales.data?.find((s) => String(s.id_sucursal) === sucursal)?.descripcion ??
    "Todas las sucursales";

  function generarPdf() {
    setGenerando(true);
    // SIN await antes de esta llamada: la pestaña se abre dentro del clic o el
    // navegador la bloquea como popup. Ver `abrirPdfEnPestana`.
    abrirPdfEnPestana(
      () =>
        generarPdfTransferencias(lineas, {
          sucursal: nombreSucursal,
          estado: ESTADOS.find((e) => e.valor === estado)!.texto,
          periodo:
            desde || hasta
              ? `${desde ? ddmmyyyy(desde) : "inicio"} al ${hasta ? ddmmyyyy(hasta) : "hoy"}`
              : "Todo",
          manuales: manualesSel.length ? manualesSel.join(", ") : "Todos",
          usuario: sesion?.nombre ?? "",
        }),
      `transferencias-${nombreSucursal.toLowerCase().replace(/\W+/g, "-")}-${iso(new Date())}.pdf`,
    )
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo generar el PDF"))
      .finally(() => setGenerando(false));
  }

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Consulta de transferencias</h1>
            <p className="text-xs text-muted-foreground">
              Qué manuales se movieron entre sucursales, y hacia dónde
            </p>
          </div>
          <button
            type="button"
            onClick={generarPdf}
            disabled={generando || !transf.length}
            title={
              !transf.length
                ? "No hay transferencias para imprimir"
                : "Abre el PDF en una pestaña nueva"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {generando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            PDF
          </button>
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <SelectorModal
            label="Sucursal"
            descripcion="Las transferencias que salen o llegan a esta sucursal"
            value={sucursal}
            onChange={setSucursal}
            opciones={[
              { valor: "", texto: "Todas las sucursales" },
              ...(sucursales.data ?? []).map((s) => ({
                valor: String(s.id_sucursal),
                texto: s.descripcion,
              })),
            ]}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Manuales"
            placeholder="Todos los manuales"
            descripcion="Los que viajaron con los filtros elegidos"
            value={manualesSel}
            onChange={setManualesSel}
            opciones={manualesDisponibles.map((m) => ({ valor: m, texto: m }))}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Desde</label>
              <input
                type="date"
                value={desde}
                max={hasta || undefined}
                onChange={(e) => setDesde(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Hasta</label>
              <input
                type="date"
                value={hasta}
                min={desde || undefined}
                onChange={(e) => setHasta(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Estado</label>
            <div className="flex h-11 rounded-xl border border-input bg-card p-0.5 text-sm">
              {ESTADOS.map((e) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => setEstado(e.valor)}
                  aria-pressed={estado === e.valor}
                  className={`flex-1 rounded-[10px] px-2 font-medium whitespace-nowrap transition-colors ${
                    estado === e.valor
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {e.texto}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-4">
          <ChipsSeleccion
            valores={manualesSel}
            onQuitar={(m) => setManualesSel((prev) => prev.filter((x) => x !== m))}
            onLimpiar={() => setManualesSel([])}
          />
        </div>

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {rangoInvalido ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            La fecha «desde» es posterior a «hasta».
          </p>
        ) : historial.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : historial.isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudo cargar la consulta.
          </p>
        ) : !transf.length ? (
          <div className="py-12 text-center">
            <Truck className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              No hay transferencias con estos filtros.
            </p>
          </div>
        ) : (
          <>
            {historial.data?.truncado && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                Se muestran las primeras {numero.format(historial.data.tope)} líneas. Achicá el
                período o elegí una sucursal para verlas todas.
              </div>
            )}

            {/* ── 1. Resumen ──────────────────────────────────────────── */}
            <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Transferencias" valor={numero.format(transf.length)} />
              <Resumen etiqueta="Libros movidos" valor={numero.format(unidades)} />
              <Resumen
                etiqueta="En camino"
                valor={numero.format(enCamino)}
                clase={enCamino ? "text-amber-600" : ""}
                ayuda="Todavía no se confirmó la recepción: las existencias no se movieron"
              />
              <Resumen etiqueta="Recibidas" valor={numero.format(transf.length - enCamino)} />
            </div>

            {/* ── 2. Panorama ─────────────────────────────────────────── */}
            <div className="mb-5 grid gap-3 lg:grid-cols-2">
              <Ranking
                titulo="Por ruta"
                icono={<RouteIcon className="size-4" />}
                filas={rutas.map((r) => ({
                  clave: `${r.origen}>${r.destino}`,
                  etiqueta: (
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate">{r.origen}</span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.destino}</span>
                    </span>
                  ),
                  valor: r.unidades,
                  detalle: plural(r.transferencias, "envío", "envíos"),
                }))}
              />
              <Ranking
                titulo="Manuales más movidos"
                icono={<BookOpen className="size-4" />}
                filas={manuales.map((m) => ({
                  clave: m.manual,
                  etiqueta: <span className="truncate">{m.manual}</span>,
                  valor: m.unidades,
                  detalle: plural(m.transferencias, "envío", "envíos"),
                }))}
              />
            </div>

            {/* ── 3. Detalle ──────────────────────────────────────────── */}
            <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-lg font-bold">Detalle</span>
              <span className="text-xs text-muted-foreground">
                {plural(transf.length, "transferencia", "transferencias")}, de la más nueva a la más
                vieja
              </span>
            </h2>
            <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {transf.map((x) => (
                <TarjetaTransferencia key={x.id_transferencia} x={x} />
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Resumen({
  etiqueta,
  valor,
  ayuda,
  clase = "",
}: {
  etiqueta: string;
  valor: string;
  ayuda?: string;
  clase?: string;
}) {
  return (
    <div title={ayuda} className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${clase}`}>{valor}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranking con barras                                                         */
/* -------------------------------------------------------------------------- */

/** Cuántas filas se ven antes de "Ver todas". */
const VISIBLES = 6;

/**
 * Una lista de mayor a menor con una barra proporcional debajo de cada fila.
 *
 * Una sola serie, así que un solo color (el primario de la paleta elegida) y
 * sin leyenda: el título dice qué se mide. El número va ESCRITO en cada fila,
 * en texto: la barra da la proporción de un vistazo, pero el valor no depende
 * de ella.
 */
function Ranking({
  titulo,
  icono,
  filas,
}: {
  titulo: string;
  icono: React.ReactNode;
  filas: { clave: string; etiqueta: React.ReactNode; valor: number; detalle: string }[];
}) {
  const [todas, setTodas] = useState(false);
  const max = Math.max(1, ...filas.map((f) => f.valor));
  const visibles = todas ? filas : filas.slice(0, VISIBLES);

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icono}</span>
        {titulo}
      </h3>
      <ul className="space-y-3">
        {visibles.map((f) => (
          <li key={f.clave}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 font-medium">{f.etiqueta}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                <span className="text-sm font-semibold text-foreground tabular-nums">
                  {numero.format(f.valor)}
                </span>{" "}
                libros · {f.detalle}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${(f.valor / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {filas.length > VISIBLES && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          className="mt-3 text-xs font-semibold text-primary"
        >
          {todas ? "Ver menos" : `Ver ${filas.length - VISIBLES} más`}
        </button>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Una transferencia                                                          */
/* -------------------------------------------------------------------------- */

/** Cuántos manuales se ven como chips antes de "+N más". */
const CHIPS = 4;

function TarjetaTransferencia({ x }: { x: TransferenciaAgrupada }) {
  const ocultos = x.lineas.length - CHIPS;

  return (
    <li>
      <Link
        to="/transferencias/$id"
        params={{ id: String(x.id_transferencia) }}
        className="flex h-full flex-col rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft hover:border-primary/40"
      >
        <div className="flex items-start gap-3">
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${
              x.recibida ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-600"
            }`}
          >
            {x.recibida ? <CheckCircle2 className="size-5" /> : <Truck className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="min-w-0 truncate">{x.origen}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{x.destino}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              #{x.id_transferencia} · {x.fecha}
              {x.recibida && x.recibida_el && ` · recibida ${x.recibida_el}`}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </div>

        {/* Los manuales como chips: se ve QUÉ viajó sin abrirla. */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {x.lineas.slice(0, CHIPS).map((l) => (
            <span
              key={l.manual}
              className="flex max-w-full items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 text-xs"
            >
              <span className="truncate">{l.manual}</span>
              <span className="shrink-0 font-semibold tabular-nums">× {l.cantidad}</span>
            </span>
          ))}
          {ocultos > 0 && (
            <span className="rounded-lg px-2 py-1 text-xs text-muted-foreground">
              +{ocultos} más
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs">
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
              x.recibida
                ? "bg-muted text-muted-foreground"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-500"
            }`}
          >
            {x.recibida ? "Recibida" : "En camino"}
          </span>
          <span className="text-muted-foreground">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {numero.format(x.unidades)}
            </span>{" "}
            libros
          </span>
        </div>
      </Link>
    </li>
  );
}
