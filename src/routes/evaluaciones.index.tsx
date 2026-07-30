import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  Building2,
  CalendarRange,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { PickerModal } from "@/components/picker-modal";
import { StarsDisplay } from "@/components/star-rating";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  keys,
  LIMITE,
  listarEvaluaciones,
  type Evaluacion,
  type Filtros,
} from "@/lib/evaluaciones";

export const Route = createFileRoute("/evaluaciones/")({
  head: () => ({
    meta: [
      { title: "Evaluaciones — Editorial Ethos" },
      { name: "description", content: "Evaluaciones de facilitadores." },
    ],
  }),
  component: EvaluacionesPage,
});

/** Filtros que se editan en la hoja, separados de la búsqueda por texto. */
type FiltrosAvanzados = {
  id_facilitador: number | null;
  id_institucion: number | null;
  id_area: number | null;
  desde: string;
  hasta: string;
};

const VACIOS: FiltrosAvanzados = {
  id_facilitador: null,
  id_institucion: null,
  id_area: null,
  desde: "",
  hasta: "",
};

const fecha = (iso: string) => {
  try {
    return format(parseISO(iso), "d MMM yyyy", { locale: es });
  } catch {
    return iso;
  }
};

function EvaluacionesPage() {
  const [texto, setTexto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [avanzados, setAvanzados] = useState<FiltrosAvanzados>(VACIOS);

  // Debounce: sin esto cada tecla dispara una consulta contra Oracle.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const filtros: Filtros = {
    buscar: buscar || undefined,
    id_facilitador: avanzados.id_facilitador,
    id_institucion: avanzados.id_institucion,
    id_area: avanzados.id_area,
    desde: avanzados.desde || undefined,
    hasta: avanzados.hasta || undefined,
  };

  const activos =
    Object.values(avanzados).filter((v) => v !== null && v !== "").length + (buscar ? 1 : 0);

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: keys.evaluaciones(filtros),
      queryFn: ({ pageParam }) => listarEvaluaciones({ ...filtros, pagina: pageParam }),
      initialPageParam: 1,
      // El backend devuelve `total`, así que se sabe si quedan páginas sin
      // tener que pedir una vacía para descubrirlo.
      getNextPageParam: (ultima, todas) => {
        const traidas = todas.reduce((n, p) => n + p.data.length, 0);
        return traidas < ultima.total ? ultima.pagina + 1 : undefined;
      },
    });

  const filas = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <AppShell>
      <div className="px-5 pt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Facilitadores
            </p>
            <h1 className="font-display mt-1 text-[2rem] leading-none font-bold">Evaluaciones</h1>
          </div>
          {!isLoading && !isError ? (
            <p className="pb-1 text-sm text-muted-foreground">{total}</p>
          ) : null}
        </div>

        {/* Buscador + filtros */}
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Facilitador, institución, evaluador…"
              aria-label="Buscar evaluaciones"
              className="h-12 w-full rounded-full border border-border/60 bg-muted/60 pr-10 pl-11 text-base outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:bg-card"
            />
            {texto ? (
              <button
                type="button"
                onClick={() => setTexto("")}
                aria-label="Limpiar búsqueda"
                className="tap absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <FiltrosModal
            valor={avanzados}
            onAplicar={setAvanzados}
            activos={activos - (buscar ? 1 : 0)}
          />
        </div>
      </div>

      {/* Resultados */}
      <div className="mt-5 space-y-3 px-5">
        {isLoading ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
            ))}
          </>
        ) : isError ? (
          <div className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : "No se pudieron cargar las evaluaciones"}
          </div>
        ) : filas.length === 0 ? (
          <div className="py-14 text-center">
            <p className="font-display text-xl font-bold">
              {activos > 0 ? "Sin resultados" : "Todavía no hay evaluaciones"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {activos > 0
                ? "Probá con otro texto o limpiá los filtros."
                : "Cargá la primera con el botón de abajo."}
            </p>
            {activos > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setTexto("");
                  setAvanzados(VACIOS);
                }}
                className="tap mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-muted px-5 text-sm font-semibold"
              >
                <RotateCcw className="size-4" />
                Limpiar filtros
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {filas.map((e) => (
              <Tarjeta key={e.id_evaluacion_facilitador} e={e} />
            ))}

            {hasNextPage ? (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card text-sm font-semibold disabled:opacity-60"
              >
                {isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                {isFetchingNextPage ? "Cargando…" : `Cargar más (${filas.length} de ${total})`}
              </button>
            ) : filas.length > LIMITE ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                {total} evaluaciones en total
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Botón de acción flotante, por encima del tab bar */}
      <Link
        to="/evaluaciones/nueva"
        aria-label="Nueva evaluación"
        className="tap fixed bottom-24 left-1/2 z-30 flex h-14 -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-foreground shadow-elegant"
      >
        <Plus className="size-5" />
        Nueva
      </Link>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */

function Tarjeta({ e }: { e: Evaluacion }) {
  return (
    <Link
      to="/evaluaciones/$id"
      params={{ id: String(e.id_evaluacion_facilitador) }}
      className="tap block rounded-2xl border border-border/60 bg-card p-4 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display truncate text-[17px] leading-snug font-bold">
            {e.facilitador ?? `Facilitador #${e.id_facilitador}`}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            <span className="truncate">{e.institucion ?? `#${e.id_institucion}`}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{e.ciudad ?? `#${e.id_ciudad}`}</span>
          </p>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </div>

      {/* Área y evaluación se muestran completas, sin recortar. rounded-lg y no
          rounded-full: una pastilla redonda de dos líneas se ve rota. */}
      <div className="mt-3 flex flex-wrap items-start gap-2">
        {e.area ? (
          <span className="rounded-lg bg-primary-soft px-2.5 py-1 text-[11px] leading-snug font-semibold text-primary">
            {e.area}
          </span>
        ) : null}
        {e.evaluacion ? (
          <span className="rounded-lg bg-muted px-2.5 py-1 text-[11px] leading-snug font-medium text-muted-foreground">
            {e.evaluacion}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarRange className="size-3.5 shrink-0" />
          {fecha(e.fecha_desde)} – {fecha(e.fecha_hasta)}
        </p>
        <StarsDisplay value={e.calificacion_estrellas} />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Filtros en hoja inferior.
 *
 * Estado local mientras está abierta y se aplica al confirmar: si cada toque
 * disparara la consulta, elegir tres filtros costaría tres viajes al servidor y
 * la lista saltaría debajo de la hoja.
 */
function FiltrosModal({
  valor,
  onAplicar,
  activos,
}: {
  valor: FiltrosAvanzados;
  onAplicar: (v: FiltrosAvanzados) => void;
  activos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState(valor);

  // Al abrir, arrancar de lo que está aplicado hoy.
  useEffect(() => {
    if (abierto) setBorrador(valor);
  }, [abierto, valor]);

  return (
    // Modal y no hoja inferior: las listas de valores de adentro también son
    // modales, y anidar el foco de vaul con el de Radix se pelea.
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Filtros"
        className="tap relative grid size-12 shrink-0 place-items-center rounded-full border border-border/60 bg-card"
      >
        <SlidersHorizontal className="size-5" />
        {activos > 0 ? (
          <span className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {activos}
          </span>
        ) : null}
      </button>

      <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-5 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-xl">Filtrar</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 pb-4">
          <PickerModal
            label="Facilitador"
            nombre="facilitadores"
            value={borrador.id_facilitador}
            // Cambiar de facilitador invalida la institución elegida: la lista de
            // instituciones depende de él.
            onChange={(o) =>
              setBorrador((b) => ({
                ...b,
                id_facilitador: o.id,
                id_institucion: o.id === b.id_facilitador ? b.id_institucion : null,
              }))
            }
            placeholder="Cualquiera"
          />
          <PickerModal
            label="Institución"
            nombre="instituciones"
            value={borrador.id_institucion}
            // Si ya se filtró por facilitador, solo sus instituciones.
            idFacilitador={borrador.id_facilitador}
            onChange={(o) => setBorrador((b) => ({ ...b, id_institucion: o.id }))}
            placeholder="Cualquiera"
          />
          <PickerModal
            label="Área"
            nombre="areas"
            value={borrador.id_area}
            onChange={(o) => setBorrador((b) => ({ ...b, id_area: o.id }))}
            placeholder="Cualquiera"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Desde</label>
              <input
                type="date"
                value={borrador.desde}
                onChange={(e) => setBorrador((b) => ({ ...b, desde: e.target.value }))}
                className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus:border-primary/40"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Hasta</label>
              <input
                type="date"
                value={borrador.hasta}
                onChange={(e) => setBorrador((b) => ({ ...b, hasta: e.target.value }))}
                className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base outline-none focus:border-primary/40"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setBorrador(VACIOS);
              onAplicar(VACIOS);
              setAbierto(false);
            }}
            className="tap h-12 flex-1 rounded-xl border border-border/60 text-sm font-semibold"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => {
              onAplicar(borrador);
              setAbierto(false);
            }}
            className="tap h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            Aplicar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
