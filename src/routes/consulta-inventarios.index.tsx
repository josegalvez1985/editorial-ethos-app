import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ClipboardList, FileDown, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ComparativoInventarios } from "@/components/comparativo-inventarios-chart";
import { ChipsSeleccion, MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import {
  diferenciaDe,
  historialInventarios,
  keysInventario,
  listarSucursales,
  type ConteoHistorial,
  type FiltrosHistorial,
} from "@/lib/inventarios";
import { abrirPdfEnPestana, generarPdfHistorial } from "@/lib/pdf-inventario";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/consulta-inventarios/")({
  head: () => ({
    meta: [
      { title: "Consulta de inventarios — Juventud con Valores" },
      { name: "description", content: "Detalle de conteos pendientes y cerrados, con PDF." },
    ],
  }),
  component: ConsultaInventariosPage,
});

type Estado = "" | "N" | "S";

const ESTADOS: { valor: Estado; texto: string }[] = [
  { valor: "", texto: "Todos" },
  { valor: "N", texto: "Pendientes" },
  { valor: "S", texto: "Cerrados" },
];

/** `YYYY-MM-DD` local, armado a mano para no depender del locale. */
function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`, para el PDF. */
const ddmmyyyy = (s: string) => s.split("-").reverse().join("/");

const numero = new Intl.NumberFormat("es-PY");
const conSigno = (n: number) => (n > 0 ? `+${numero.format(n)}` : numero.format(n));

/**
 * Consulta de detalle de los inventarios: los conteos pendientes y cerrados de
 * una sucursal (o de todas) en un período, con su PDF.
 *
 * Es de SOLO LECTURA: para contar o cerrar está Inventario de manuales. Lee
 * `INVENTARIOS` entero —el historial—, no la planilla del conteo en curso.
 *
 * Los filtros de sucursal, estado y fechas van al backend; el de manuales se
 * aplica acá, sobre lo que ya llegó: así marcar y desmarcar manuales es
 * instantáneo y no dispara una consulta por cada check.
 */
function ConsultaInventariosPage() {
  const { sesion } = useSession();
  const hoy = new Date();

  const [sucursal, setSucursal] = useState("");
  const [estado, setEstado] = useState<Estado>("");
  // Por defecto el año en curso: suficiente para ver el último inventario de
  // cada sucursal sin traer años de historial.
  const [desde, setDesde] = useState(iso(new Date(hoy.getFullYear(), 0, 1)));
  const [hasta, setHasta] = useState(iso(hoy));
  const [manualesSel, setManualesSel] = useState<string[]>([]);
  const [generando, setGenerando] = useState(false);

  const sucursales = useQuery({
    queryKey: keysInventario.sucursales,
    queryFn: listarSucursales,
  });

  const filtros: FiltrosHistorial = {
    id_sucursal: sucursal ? Number(sucursal) : undefined,
    estado: estado || undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  };
  const rangoInvalido = !!desde && !!hasta && desde > hasta;

  const historial = useQuery({
    queryKey: keysInventario.historial(filtros),
    queryFn: () => historialInventarios(filtros),
    enabled: !rangoInvalido,
  });

  const todas = useMemo(() => historial.data?.data ?? [], [historial.data]);
  // Los manuales que aparecen en el resultado: marcar uno que no tiene conteos
  // en el período no mostraría nada.
  const manualesDisponibles = useMemo(
    () => [...new Set(todas.map((c) => c.manual))].sort((a, b) => a.localeCompare(b)),
    [todas],
  );
  const elegidos = new Set(manualesSel);
  const filas = elegidos.size ? todas.filter((c) => elegidos.has(c.manual)) : todas;

  const grupos = useMemo(() => {
    const m = new Map<string, ConteoHistorial[]>();
    for (const c of filas) {
      const g = m.get(c.sucursal);
      if (g) g.push(c);
      else m.set(c.sucursal, [c]);
    }
    return [...m.entries()];
  }, [filas]);

  const pendientes = filas.filter((c) => c.estado === "ABIERTO").length;
  const neta = filas.reduce((s, c) => s + (diferenciaDe(c) ?? 0), 0);

  const nombreSucursal =
    sucursales.data?.find((s) => String(s.id_sucursal) === sucursal)?.descripcion ??
    "Todas las sucursales";

  function generarPdf() {
    setGenerando(true);
    // SIN await antes de esta llamada: la pestaña se abre dentro del clic o el
    // navegador la bloquea como popup. Ver `abrirPdfEnPestana`.
    abrirPdfEnPestana(
      () =>
        generarPdfHistorial(filas, {
          sucursal: nombreSucursal,
          estado: ESTADOS.find((e) => e.valor === estado)!.texto,
          periodo:
            desde || hasta
              ? `${desde ? ddmmyyyy(desde) : "inicio"} al ${hasta ? ddmmyyyy(hasta) : "hoy"}`
              : "Todo",
          manuales: manualesSel.length ? manualesSel.join(", ") : "Todos",
          usuario: sesion?.nombre ?? "",
        }),
      `inventario-${nombreSucursal.toLowerCase().replace(/\W+/g, "-")}-${iso(new Date())}.pdf`,
    )
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo generar el PDF"))
      .finally(() => setGenerando(false));
  }

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Consulta de inventarios</h1>
            <p className="text-xs text-muted-foreground">
              Conteos pendientes y cerrados por sucursal
            </p>
          </div>
          <button
            type="button"
            onClick={generarPdf}
            disabled={generando || !filas.length}
            title={
              !filas.length ? "No hay conteos para imprimir" : "Abre el PDF en una pestaña nueva"
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
            descripcion="Una sucursal o todas"
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
            descripcion="Los que tienen conteos con los filtros elegidos"
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
            {/* Segmentado: son tres opciones y se leen de un vistazo. */}
            <div className="flex h-11 rounded-xl border border-input bg-card p-0.5 text-sm">
              {ESTADOS.map((e) => (
                <button
                  key={e.valor}
                  type="button"
                  onClick={() => setEstado(e.valor)}
                  aria-pressed={estado === e.valor}
                  className={`flex-1 rounded-[10px] px-2 font-medium transition-colors ${
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
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <ClipboardList className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No hay conteos con estos filtros.</p>
          </div>
        ) : (
          <>
            {/* Cortado por el tope del backend: el PDF también saldría incompleto. */}
            {historial.data?.truncado && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
                Se muestran los primeros {numero.format(historial.data.tope)} conteos. Achicá el
                período o elegí una sucursal para verlos todos.
              </div>
            )}

            {/* ── Resumen ─────────────────────────────────────────────── */}
            <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Conteos" valor={numero.format(filas.length)} />
              <Resumen
                etiqueta="Pendientes"
                valor={numero.format(pendientes)}
                clase={pendientes ? "text-amber-600" : ""}
              />
              <Resumen etiqueta="Cerrados" valor={numero.format(filas.length - pendientes)} />
              <Resumen
                etiqueta="Diferencia neta"
                valor={conSigno(neta)}
                ayuda="Física menos sistema, sumada: negativo es que faltan libros"
                clase={neta < 0 ? "text-destructive" : neta > 0 ? "text-amber-600" : ""}
              />
            </div>

            {/*
              El gráfico ANTES del detalle: responde la pregunta de un vistazo
              ("¿cambió desde el último inventario?") y la tabla de abajo es su
              vista accesible, con todos los números.
            */}
            <div className="mb-5">
              <ComparativoInventarios conteos={filas} />
            </div>

            <div className="space-y-5">
              {grupos.map(([nombre, conteos]) => (
                <GrupoSucursal key={nombre} nombre={nombre} conteos={conteos} />
              ))}
            </div>
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
/* Una sucursal: tabla en escritorio, tarjetas en el celular                  */
/* -------------------------------------------------------------------------- */

function GrupoSucursal({ nombre, conteos }: { nombre: string; conteos: ConteoHistorial[] }) {
  const pend = conteos.filter((c) => c.estado === "ABIERTO").length;
  const suma = (fn: (c: ConteoHistorial) => number | null) =>
    conteos.reduce((s, c) => s + (fn(c) ?? 0), 0);

  return (
    <section>
      <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-lg font-bold">{nombre}</span>
        <span className="text-xs text-muted-foreground">
          {conteos.length} conteo{conteos.length === 1 ? "" : "s"} · {pend} pendiente
          {pend === 1 ? "" : "s"}
        </span>
      </h2>

      {/* Celular: tarjetas. Una tabla de seis columnas no entra en 380px. */}
      <ul className="grid gap-2 md:hidden">
        {conteos.map((c) => {
          const d = diferenciaDe(c);
          return (
            <li
              key={c.id_inventario}
              className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm leading-snug font-semibold">{c.manual}</p>
                <EstadoChip estado={c.estado} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{c.fecha}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Mini etiqueta="Sistema" valor={c.cantidad_sistema} />
                <Mini etiqueta="Física" valor={c.cantidad_fisica} />
                <Mini etiqueta="Dif." valor={d} diferencia />
              </div>
            </li>
          );
        })}
      </ul>

      {/* Escritorio: tabla, que es como se lee un detalle de conteos. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-soft md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left text-[11px] tracking-wide text-muted-foreground uppercase">
              <th className="px-4 py-2.5 font-semibold">Fecha</th>
              <th className="px-4 py-2.5 font-semibold">Manual</th>
              <th className="px-4 py-2.5 text-right font-semibold">Sistema</th>
              <th className="px-4 py-2.5 text-right font-semibold">Física</th>
              <th className="px-4 py-2.5 text-right font-semibold">Dif.</th>
              <th className="px-4 py-2.5 font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {conteos.map((c) => (
              <tr key={c.id_inventario} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">
                  {c.fecha}
                </td>
                <td className="px-4 py-2.5 font-medium">{c.manual}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.cantidad_sistema ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{c.cantidad_fisica ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <Diferencia valor={diferenciaDe(c)} />
                </td>
                <td className="px-4 py-2.5">
                  <EstadoChip estado={c.estado} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td className="px-4 py-2.5" />
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {numero.format(suma((c) => c.cantidad_sistema))}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {numero.format(suma((c) => c.cantidad_fisica))}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Diferencia valor={suma(diferenciaDe)} />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function EstadoChip({ estado }: { estado: ConteoHistorial["estado"] }) {
  return estado === "ABIERTO" ? (
    <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-500">
      Pendiente
    </span>
  ) : (
    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
      Cerrado
    </span>
  );
}

/** Faltan en rojo, sobran en ámbar: igual que la planilla y el PDF. */
function Diferencia({ valor }: { valor: number | null }) {
  if (valor == null) return <span className="text-muted-foreground">—</span>;
  const clase =
    valor < 0 ? "text-destructive" : valor > 0 ? "text-amber-600" : "text-muted-foreground";
  return <span className={`font-semibold tabular-nums ${clase}`}>{conSigno(valor)}</span>;
}

function Mini({
  etiqueta,
  valor,
  diferencia = false,
}: {
  etiqueta: string;
  valor: number | null;
  diferencia?: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/50 py-1.5">
      <p className="text-[10px] text-muted-foreground">{etiqueta}</p>
      <p className="text-sm font-semibold tabular-nums">
        {diferencia ? <Diferencia valor={valor} /> : (valor ?? "—")}
      </p>
    </div>
  );
}
