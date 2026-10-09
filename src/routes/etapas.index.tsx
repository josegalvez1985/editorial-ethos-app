import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Loader2, Lock, Milestone, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eliminarEtapa, guardarEtapa, keysEtapas, listarEtapas, type Etapa } from "@/lib/etapas";
import { textoUsos } from "@/lib/facilitadores";
import { cuandoEs, diaISO, diasEntre, fechaCorta, hoyISO, sumarDias } from "@/lib/fechas";
import { usePermisos } from "@/lib/permisos";

export const Route = createFileRoute("/etapas/")({
  head: () => ({
    meta: [
      { title: "Etapas — Juventud con Valores" },
      { name: "description", content: "Las etapas de cada año, con su inicio y su fin." },
    ],
  }),
  component: EtapasPage,
});

const RUTA = "/etapas";
const MESES = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const anioDe = (f: string) => Number(f.slice(0, 4));

/** Una etapa con su número dentro del año ("2ª etapa 2026"). */
type Numerada = Etapa & { n: number; anio: number };

function numerar(etapas: Etapa[]): Numerada[] {
  const porAnio = new Map<number, number>();
  return etapas.map((e) => {
    const anio = anioDe(e.inicio);
    const n = (porAnio.get(anio) ?? 0) + 1;
    porAnio.set(anio, n);
    return { ...e, n, anio };
  });
}

const nombre = (e: Numerada) => `${e.n}ª etapa ${e.anio}`;

/** "16 semanas" o "12 días". */
function duracion(inicio: string, fin: string) {
  const d = diasEntre(inicio, fin);
  return d >= 14 ? `${Math.round(d / 7)} semanas · ${d} días` : `${d} ${d === 1 ? "día" : "días"}`;
}

function estadoDe(e: Etapa, hoy: string) {
  if (hoy < e.inicio) return "proxima" as const;
  if (hoy > e.fin) return "termino" as const;
  return "curso" as const;
}

const seSuperponen = (a: Etapa, b: Etapa) => a.inicio <= b.fin && b.inicio <= a.fin;

/**
 * Etapas: la página 79 de APEX (un IG sobre `ETAPAS`) y su modal 80 (Crear
 * etapa), que acá es el diálogo de la pantalla con los permisos de la 79.
 * Backend: `backend/etapas.sql`. El ícono es el que ya tenía en el menú
 * (`Milestone`).
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Numeradas por año** ("2ª etapa 2026"): la tabla no tiene nombre y el IG
 *   mostraba solo dos fechas.
 * - **La etapa en curso arriba**, con cuánto va y cuánto falta (o cuándo
 *   empieza la próxima).
 * - **Una línea de tiempo del año** con cada etapa y el día de hoy: se ven de
 *   un vistazo los huecos y las que se pisan.
 * - El alta **propone la siguiente**: empieza el día después de la última y
 *   dura lo mismo. Avisa si se pisa con otra.
 * - Cada etapa dice qué datos la usan; en uso no se borra.
 */
function EtapasPage() {
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA, "insertar");

  const { data, isLoading, error } = useQuery({ queryKey: keysEtapas.todo, queryFn: listarEtapas });
  const [anio, setAnio] = useState<number | null>(null);
  /** `null` cerrado, `"nueva"` alta, o la etapa que se abre. */
  const [abierta, setAbierta] = useState<Numerada | "nueva" | null>(null);

  const etapas = numerar(data ?? []);
  const hoy = hoyISO();
  const actual = anioDe(hoy);
  const anios = [...new Set([actual, ...etapas.map((e) => e.anio)])].sort((a, b) => b - a);
  const elegido = anio ?? actual;
  const delAnio = etapas.filter((e) => e.anio === elegido);
  const enCurso = etapas.find((e) => estadoDe(e, hoy) === "curso");
  const proxima = etapas.find((e) => estadoDe(e, hoy) === "proxima");

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Etapas</h1>
            <p className="text-xs text-muted-foreground">
              Los períodos de cada año, con su inicio y su fin.
            </p>
          </div>
          {puedeAgregar && !isLoading && !error && (
            <button
              type="button"
              onClick={() => setAbierta("nueva")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nueva etapa</span>
              <span className="sm:hidden">Nueva</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar las etapas" />
        ) : (
          <>
            {(enCurso ?? proxima) && (
              <Destacada
                e={(enCurso ?? proxima)!}
                hoy={hoy}
                onAbrir={() => setAbierta((enCurso ?? proxima)!)}
              />
            )}

            {anios.length > 1 && (
              <div role="tablist" aria-label="Año" className="mb-3 flex flex-wrap gap-2">
                {anios.map((a) => (
                  <Pastilla
                    key={a}
                    activa={elegido === a}
                    onClick={() => setAnio(a)}
                    cuenta={etapas.filter((e) => e.anio === a).length}
                  >
                    {a}
                  </Pastilla>
                ))}
              </div>
            )}

            {!delAnio.length ? (
              <div className="py-12 text-center">
                <Milestone className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Todavía no hay etapas en {elegido}.
                </p>
                {puedeAgregar && (
                  <button
                    type="button"
                    onClick={() => setAbierta("nueva")}
                    className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                  >
                    <Plus className="size-4" />
                    Cargar una
                  </button>
                )}
              </div>
            ) : (
              <>
                <Linea anio={elegido} etapas={delAnio} hoy={hoy} />
                <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {delAnio.map((e) => (
                    <li key={e.id}>
                      <Tarjeta
                        e={e}
                        hoy={hoy}
                        pisa={etapas.find((o) => o.id !== e.id && seSuperponen(o, e))}
                        onAbrir={() => setAbierta(e)}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {abierta != null && (
        <Editor
          key={abierta === "nueva" ? "nueva" : abierta.id}
          etapa={abierta === "nueva" ? null : abierta}
          todas={etapas}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </AppShell>
  );
}

function Pastilla({
  activa,
  onClick,
  cuenta,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  cuenta: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={`tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      <span
        className={`rounded-full px-1.5 text-[11px] tabular-nums ${activa ? "bg-white/20" : "bg-muted"}`}
      >
        {cuenta}
      </span>
    </button>
  );
}

/** La etapa en curso (o la próxima, si no hay ninguna en curso). */
function Destacada({ e, hoy, onAbrir }: { e: Numerada; hoy: string; onAbrir: () => void }) {
  const curso = estadoDe(e, hoy) === "curso";
  const total = Math.max(1, diaISO(e.fin) - diaISO(e.inicio));
  const pct = curso ? Math.round(((diaISO(hoy) - diaISO(e.inicio)) / total) * 100) : 0;
  const faltan = diaISO(e.fin) - diaISO(hoy);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap mb-4 block w-full overflow-hidden rounded-3xl border border-primary/25 bg-card text-left shadow-soft hover:border-primary/50"
    >
      <div className="bg-hero-gradient flex items-center justify-between gap-3 px-5 py-3 text-on-brand">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold opacity-90">
            {curso ? "Etapa en curso" : `Próxima etapa · empieza ${cuandoEs(e.inicio)}`}
          </p>
          <p className="font-display text-2xl leading-tight font-bold">{nombre(e)}</p>
        </div>
        <ChevronRight className="size-5 shrink-0 opacity-80" />
      </div>
      <div className="space-y-2 px-5 py-3">
        <p className="text-[12.5px] text-muted-foreground">
          {fechaCorta(e.inicio)} → {fechaCorta(e.fin)} · {duracion(e.inicio, e.fin)}
        </p>
        {curso && (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[12px] text-muted-foreground">
              {pct}% ·{" "}
              {faltan === 0 ? "termina hoy" : `faltan ${faltan} ${faltan === 1 ? "día" : "días"}`}
            </p>
          </>
        )}
      </div>
    </button>
  );
}

/** El año de enero a diciembre, con cada etapa y el día de hoy. */
function Linea({ anio, etapas, hoy }: { anio: number; etapas: Numerada[]; hoy: string }) {
  const ini = diaISO(`${anio}-01-01`);
  const largo = diaISO(`${anio}-12-31`) - ini + 1;
  const pos = (f: string) => Math.min(100, Math.max(0, ((diaISO(f) - ini) / largo) * 100));
  const hoyEnAnio = anioDe(hoy) === anio;
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="relative h-10 rounded-lg bg-muted/60">
        {etapas.map((e) => {
          const izq = pos(e.inicio);
          const ancho = Math.max(1.5, pos(sumarDias(e.fin, 1)) - izq);
          const curso = estadoDe(e, hoy) === "curso";
          return (
            <div
              key={e.id}
              title={`${nombre(e)}: ${fechaCorta(e.inicio)} → ${fechaCorta(e.fin)}`}
              className={`absolute inset-y-1 grid place-items-center overflow-hidden rounded-md text-[11px] font-bold ${
                curso
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/25 text-primary ring-1 ring-primary/30"
              }`}
              style={{ left: `${izq}%`, width: `${ancho}%` }}
            >
              {e.n}ª
            </div>
          );
        })}
        {hoyEnAnio && (
          <div
            aria-label="Hoy"
            className="absolute -inset-y-1 w-0.5 rounded-full bg-destructive"
            style={{ left: `${pos(hoy)}%` }}
          />
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-12 text-center text-[10px] font-medium text-muted-foreground">
        {MESES.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
    </div>
  );
}

function Tarjeta({
  e,
  hoy,
  pisa,
  onAbrir,
}: {
  e: Numerada;
  hoy: string;
  pisa?: Numerada;
  onAbrir: () => void;
}) {
  const estado = estadoDe(e, hoy);
  const usos = textoUsos(e.usos);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        estado === "termino" ? "opacity-70" : ""
      }`}
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold ${
          estado === "curso" ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary"
        }`}
      >
        {e.n}ª
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-sm font-semibold">
            {fechaCorta(e.inicio)} → {fechaCorta(e.fin)}
          </span>
          <span
            className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
              estado === "curso" ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {estado === "curso" ? "En curso" : estado === "proxima" ? "Próxima" : "Terminó"}
          </span>
        </span>
        <span className="block text-[12px] text-muted-foreground">{duracion(e.inicio, e.fin)}</span>
        {pisa ? (
          <span className="flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            Se pisa con la {nombre(pisa)}
          </span>
        ) : (
          usos && (
            <span className="block truncate text-[11.5px] text-muted-foreground">Usada {usos}</span>
          )
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición (el modal 80)                                               */
/* -------------------------------------------------------------------------- */

function Editor({
  etapa,
  todas,
  onCerrar,
}: {
  etapa: Numerada | null;
  todas: Numerada[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nueva = etapa == null;
  const puedeGuardar = puedeRuta(RUTA, nueva ? "insertar" : "actualizar");
  const puedeBorrar = !nueva && puedeRuta(RUTA, "borrar");

  // El alta propone la siguiente: el día después de la última, con su largo.
  const ultima = todas.reduce<Numerada | undefined>(
    (u, e) => (!u || e.fin > u.fin ? e : u),
    undefined,
  );
  const inicioPropuesto = ultima ? sumarDias(ultima.fin, 1) : hoyISO();
  const largoPropuesto = ultima ? diasEntre(ultima.inicio, ultima.fin) : 90;
  const inicial = {
    inicio: etapa?.inicio ?? inicioPropuesto,
    fin: etapa?.fin ?? sumarDias(inicioPropuesto, largoPropuesto - 1),
  };
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fin, setFin] = useState(inicial.fin);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const fechasMal = !!inicio && !!fin && inicio > fin;
  const otras = todas.filter((e) => e.id !== etapa?.id);
  const pisa =
    inicio && fin && !fechasMal
      ? otras.find((e) => seSuperponen(e, { id: 0, inicio, fin, usos: [] }))
      : undefined;
  const repetida = otras.find((e) => e.inicio === inicio && e.fin === fin);
  const enUso = !!etapa?.usos.length;
  const sinCambios = !nueva && inicio === inicial.inicio && fin === inicial.fin;
  const listo = puedeGuardar && !!inicio && !!fin && !fechasMal && !repetida && !sinCambios;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysEtapas.todo });

  const guardar = useMutation({
    mutationFn: () => guardarEtapa(etapa?.id ?? null, { fecha_inicio: inicio, fecha_fin: fin }),
    onSuccess: () => {
      invalidar();
      toast.success(nueva ? "Etapa agregada" : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarEtapa(etapa!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`${nombre(etapa!)} eliminada`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nueva ? "Nueva etapa" : nombre(etapa)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nueva
              ? ultima
                ? `Te propongo la siguiente a la ${nombre(ultima)}, con el mismo largo.`
                : "Elegí el inicio y el fin."
              : enUso
                ? `Usada ${textoUsos(etapa.usos)}.`
                : "Todavía no la usa nada."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate();
          }}
          className="space-y-4"
        >
          <fieldset disabled={!puedeGuardar || ocupado} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Texto etiqueta="Inicio" req tipo="date" valor={inicio} onCambio={setInicio} />
              <Texto etiqueta="Fin" req tipo="date" valor={fin} onCambio={setFin} />
            </div>
            {fechasMal ? (
              <p className="-mt-2 text-xs text-destructive">
                El inicio no puede ser después del fin.
              </p>
            ) : repetida ? (
              <p className="-mt-2 text-xs text-destructive">
                Ya está cargada con esas fechas: {nombre(repetida)}.
              </p>
            ) : (
              inicio &&
              fin && (
                <p className="-mt-2 text-xs text-muted-foreground">
                  {duracion(inicio, fin)}
                  {pisa && (
                    <span className="mt-0.5 block text-amber-700 dark:text-amber-400">
                      Ojo: se pisa con la {nombre(pisa)} ({fechaCorta(pisa.inicio)} →{" "}
                      {fechaCorta(pisa.fin)}).
                    </span>
                  )}
                </p>
              )
            )}
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nueva ? "agregar" : "modificar"} etapas.`}
            />
          )}

          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar: hay datos que la usan.
            </p>
          )}

          <div className="flex gap-2">
            {puedeBorrar && !enUso && (
              <BotonBorrar
                confirmar={confirmarBorrado}
                pendiente={borrar.isPending}
                deshabilitado={ocupado}
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
              />
            )}
            {puedeGuardar && (
              <button
                type="submit"
                disabled={ocupado || !listo}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
              >
                {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
                {nueva ? "Agregar" : sinCambios ? "Sin cambios" : "Guardar cambios"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
