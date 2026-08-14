import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  Loader2,
  MapPin,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import { nombreTurno } from "@/lib/evaluaciones";
import {
  keysCrud,
  listarCrud,
  type FiltrosCrud,
  type IntervencionCrud,
} from "@/lib/intervenciones-crud";
import { MESES } from "@/lib/intervenciones";

export const Route = createFileRoute("/intervenciones/")({
  head: () => ({
    meta: [
      { title: "Intervenciones — Juventud con Valores" },
      { name: "description", content: "Carga manual de intervenciones." },
    ],
  }),
  component: IntervencionesPage,
});

/**
 * La lista de intervenciones cargadas, con alta manual.
 *
 * ## POR QUÉ ESTE MÓDULO EXISTE
 *
 * Las intervenciones las carga normalmente la app del facilitador, en el
 * momento. Esta pantalla es para las que **quedaron sin cargar**: una clase que
 * se dio hace dos semanas y nadie registró. Por eso todo acá está pensado para
 * fecha pasada — el formulario pide fecha y hora explícitas, y el selector de
 * postulaciones arranca mostrando todas y no solo las de hoy.
 *
 * ## MUESTRA TODAS, NO SOLO LAS DESVIADAS
 *
 * A diferencia de los gráficos del inicio —que piden a `intervenciones` solo las
 * marcaciones con 15+ min o 1+ km de desvío—, esto pide a `intervenciones-crud`,
 * que no filtra nada. Para corregir una fila hay que poder encontrarla aunque
 * haya sido perfectamente puntual.
 */
function IntervencionesPage() {
  const ahora = new Date();

  const [buscar, setBuscar] = useState("");
  const [buscarAplicado, setBuscarAplicado] = useState("");
  const [anio, setAnio] = useState(String(ahora.getFullYear()));
  const [mes, setMes] = useState<number | "">(ahora.getMonth() + 1);

  /*
   * El texto se aplica con retardo: sin esto cada tecla dispara una consulta al
   * backend, que además pagina. 400 ms es lo que tarda una pausa natural al
   * terminar de escribir un nombre.
   */
  useEffect(() => {
    const t = setTimeout(() => setBuscarAplicado(buscar.trim()), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const filtros: FiltrosCrud = {
    anio,
    mes: mes === "" ? undefined : mes,
    buscar: buscarAplicado || undefined,
    limite: 50,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: keysCrud.lista(filtros),
    queryFn: () => listarCrud(filtros),
  });

  const anios = Array.from({ length: 5 }, (_, i) => String(ahora.getFullYear() - i));
  const filas = data?.data ?? [];

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Intervenciones</h1>
            <p className="text-xs text-muted-foreground">
              Carga manual de intervenciones atrasadas
            </p>
          </div>
          <Link
            to="/intervenciones/nueva"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            <Plus className="size-4" />
            Nueva
          </Link>
        </div>

        {/* ── Búsqueda ─────────────────────────────────────────────────── */}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Facilitador, institución o manual…"
            aria-label="Buscar"
            className="h-11 w-full rounded-xl border border-input bg-card pr-9 pl-9 text-sm outline-none focus:border-primary/40"
          />
          {buscar && (
            <button
              onClick={() => setBuscar("")}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* ── Período ──────────────────────────────────────────────────── */}
        <div className="mb-4 flex gap-2">
          <SelectorModal
            label="Mes"
            mostrarLabel={false}
            value={String(mes)}
            // `""` es "todo el año" y NO es un mes: por eso vuelve como string
            // vacío y no pasa por `Number`, que lo convertiría en 0.
            onChange={(v) => setMes(v === "" ? "" : Number(v))}
            opciones={[
              // "Todo el año" primero: al buscar una intervención vieja no
              // siempre se recuerda de qué mes era.
              { valor: "", texto: "Todo el año" },
              ...MESES.map((m, i) => ({ valor: String(i + 1), texto: m })),
            ]}
            className="h-10 px-3 text-sm"
          />
          <div className="w-24 shrink-0">
            <SelectorModal
              label="Año"
              mostrarLabel={false}
              value={anio}
              onChange={setAnio}
              opciones={anios.map((a) => ({ valor: a, texto: a }))}
              className="h-10 px-3 text-sm"
            />
          </div>
        </div>

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudieron cargar las intervenciones.
          </p>
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <CalendarClock className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {buscarAplicado
                ? "Ninguna intervención coincide con la búsqueda."
                : `Sin intervenciones en ${mes === "" ? anio : `${MESES[mes - 1]} de ${anio}`}.`}
            </p>
          </div>
        ) : (
          <>
            {/* El total y no solo lo que se ve: la lista está paginada y sin
                esto no hay forma de saber que hay más. */}
            <p className="mb-2 text-xs text-muted-foreground">
              {data!.total} intervención{data!.total === 1 ? "" : "es"}
              {filas.length < data!.total && ` · mostrando ${filas.length}`}
            </p>
            <ul className="space-y-2">
              {filas.map((i) => (
                <Fila key={i.id_intervencion} i={i} />
              ))}
            </ul>
            {filas.length < data!.total && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Afiná la búsqueda o el período para ver el resto.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Una intervención en la lista. Toda la fila es el enlace a su edición. */
function Fila({ i }: { i: IntervencionCrud }) {
  const turno = nombreTurno(i.turno);

  return (
    <li>
      <Link
        to="/intervenciones/$id"
        params={{ id: String(i.id_intervencion) }}
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {i.nombre_facilitador ?? `Facilitador #${i.id_facilitador}`}
            </p>
            {/* El 'No' se destaca porque es la excepción: significa que la clase
                no se desarrolló y lleva motivo obligatorio. */}
            {i.si_no.toUpperCase() === "NO" && (
              <span className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                NO
              </span>
            )}
          </div>

          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Building2 className="size-3 shrink-0" />
            {i.institucion ?? `Institución #${i.id_institucion}`}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {i.fecha}
              {i.hora && ` · ${i.hora}`}
            </span>
            {i.manual && <span>{i.manual}</span>}
            {i.nro_indice != null && <span>Índice {i.nro_indice}</span>}
            {[i.grado, i.seccion && `Sec. ${i.seccion}`, turno].filter(Boolean).map((t) => (
              <span key={t as string}>{t}</span>
            ))}
            {/* (0,0) es lo que se guarda cuando no hubo GPS. Marcarlo evita que
                alguien lea la fila como "marcó en el Golfo de Guinea". */}
            {i.latitud === "0" && i.longitud === "0" && (
              <span className="flex items-center gap-0.5">
                <MapPin className="size-3" />
                sin ubicación
              </span>
            )}
          </p>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
