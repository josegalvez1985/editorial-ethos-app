import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Loader2, PartyPopper, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Texto } from "@/components/ficha-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  copiarFeriados,
  eliminarFeriado,
  guardarFeriado,
  keysFeriados,
  listarFeriados,
  type Feriado,
} from "@/lib/feriados";
import { cuandoEs, diaSemana, esFinDeSemana, fechaCorta, hoyISO, nombreMes } from "@/lib/fechas";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/feriados/")({
  head: () => ({
    meta: [
      { title: "Feriados Nacionales — Juventud con Valores" },
      { name: "description", content: "Los feriados nacionales de cada año." },
    ],
  }),
  component: FeriadosPage,
});

const RUTA = "/feriados";

const anioDe = (f: string) => Number(f.slice(0, 4));
/** "12-25": el mismo feriado en cualquier año. */
const diaMes = (f: string) => f.slice(5);

/**
 * Feriados Nacionales: la página 70 de APEX (un IG sobre `FERIADOS`) y su
 * modal 71 (Crear Feriado), que acá es el diálogo de la pantalla con los
 * permisos de la 70. Backend: `backend/feriados.sql`. El ícono es el que ya
 * tenía en el menú (`PartyPopper`).
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **El próximo feriado arriba**, con el día de la semana y cuánto falta.
 * - **Por año**, en pastillas (arranca en el actual), y **agrupados por mes**,
 *   con el día de la semana y si cae sábado o domingo. Los que ya pasaron se
 *   ven apagados.
 * - **"Copiar los de {año anterior}"**: pasa los que faltan con el mismo día y
 *   mes, para no cargar el año entero a mano. Avisa que los móviles (Semana
 *   Santa) hay que corregirlos.
 * - Un día no se carga dos veces: se avisa en el diálogo, antes de guardar.
 * - Buscador por nombre en todos los años.
 */
function FeriadosPage() {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA, "insertar");

  const { data, isLoading, error } = useQuery({
    queryKey: keysFeriados.todo,
    queryFn: listarFeriados,
  });
  const [anio, setAnio] = useState<number | null>(null);
  const [buscar, setBuscar] = useState("");
  /** `null` cerrado, `"nuevo"` alta, o el feriado que se abre. */
  const [abierto, setAbierto] = useState<Feriado | "nuevo" | null>(null);
  const [copiando, setCopiando] = useState(false);

  const feriados = data ?? [];
  const hoy = hoyISO();
  const actual = anioDe(hoy);
  // Los años con feriados, más el actual y el siguiente (para cargarlos o copiarlos).
  const anios = [...new Set([actual, actual + 1, ...feriados.map((f) => anioDe(f.fecha))])].sort(
    (a, b) => b - a,
  );
  const elegido = anio ?? actual;
  const delAnio = feriados.filter((f) => anioDe(f.fecha) === elegido);
  const proximo = feriados.find((f) => f.fecha >= hoy);

  // Copiar: del año anterior con feriados, los días que este todavía no tiene.
  const anterior = anios.find((a) => a < elegido && feriados.some((f) => anioDe(f.fecha) === a));
  const yaEstan = new Set(delAnio.map((f) => diaMes(f.fecha)));
  const paraCopiar = anterior
    ? feriados.filter((f) => anioDe(f.fecha) === anterior && !yaEstan.has(diaMes(f.fecha)))
    : [];

  const q = normalizar(buscar.trim());
  const visibles = q ? feriados.filter((f) => normalizar(f.descripcion).includes(q)) : delAnio;
  // Agrupados por mes (o por año y mes, si se busca en todos).
  const grupos = new Map<string, Feriado[]>();
  for (const f of visibles) {
    const clave = f.fecha.slice(0, 7);
    const l = grupos.get(clave);
    if (l) l.push(f);
    else grupos.set(clave, [f]);
  }

  const copiar = useMutation({
    mutationFn: () => copiarFeriados(anterior!, elegido),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keysFeriados.todo });
      toast.success(
        `${r.copiados} ${r.copiados === 1 ? "feriado copiado" : "feriados copiados"} a ${elegido}`,
        {
          description: `Revisá los que cambian de fecha cada año, como Semana Santa.${
            r.salteados ? ` ${r.salteados} ya estaban o no existen en ${elegido}.` : ""
          }`,
        },
      );
      setCopiando(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo copiar"),
  });

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Feriados Nacionales</h1>
            <p className="text-xs text-muted-foreground">Los días sin clases de cada año.</p>
          </div>
          {puedeAgregar && !isLoading && !error && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo feriado</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar los feriados" />
        ) : (
          <>
            {proximo && !q && (
              <button
                type="button"
                onClick={() => setAbierto(proximo)}
                className="tap mb-4 flex w-full items-center gap-4 overflow-hidden rounded-3xl border border-primary/25 bg-card p-0 text-left shadow-soft hover:border-primary/50"
              >
                <span className="bg-hero-gradient flex w-24 shrink-0 flex-col items-center justify-center self-stretch py-3 text-on-brand">
                  <span className="font-display text-4xl leading-none font-bold tabular-nums">
                    {Number(proximo.fecha.slice(8))}
                  </span>
                  <span className="text-[12px] font-semibold capitalize opacity-90">
                    {nombreMes(proximo.fecha).slice(0, 3)}
                  </span>
                </span>
                <span className="min-w-0 flex-1 py-3 pr-4">
                  <span className="block text-[11.5px] font-semibold text-primary">
                    Próximo feriado · {cuandoEs(proximo.fecha)}
                  </span>
                  <span className="block truncate text-base font-bold">{proximo.descripcion}</span>
                  <span className="block text-[12px] text-muted-foreground capitalize">
                    {diaSemana(proximo.fecha)} {fechaCorta(proximo.fecha)}
                  </span>
                </span>
              </button>
            )}

            {!q && (
              <div role="tablist" aria-label="Año" className="mb-3 flex flex-wrap gap-2">
                {anios.map((a) => {
                  const n = feriados.filter((f) => anioDe(f.fecha) === a).length;
                  return (
                    <Pastilla key={a} activa={elegido === a} onClick={() => setAnio(a)} cuenta={n}>
                      {a}
                    </Pastilla>
                  );
                })}
              </div>
            )}

            {feriados.length > 6 && (
              <Buscador
                valor={buscar}
                onCambio={setBuscar}
                placeholder="Buscar un feriado en todos los años…"
              />
            )}

            {!q && puedeAgregar && anterior && paraCopiar.length > 0 && (
              <button
                type="button"
                onClick={() => setCopiando(true)}
                className={`tap mb-3 flex w-full items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-left ${
                  delAnio.length
                    ? "border-border text-muted-foreground"
                    : "border-primary/40 bg-primary-soft/40 text-primary"
                }`}
              >
                <Copy className="size-5 shrink-0" />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">
                    Copiar {delAnio.length ? "los que faltan" : "los feriados"} de {anterior}
                  </span>
                  <span className="block text-[11.5px] opacity-80">
                    {paraCopiar.length} {paraCopiar.length === 1 ? "feriado" : "feriados"} con el
                    mismo día y mes en {elegido}.
                  </span>
                </span>
              </button>
            )}

            {!visibles.length ? (
              <div className="py-12 text-center">
                <PartyPopper className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {q
                    ? "Ningún feriado coincide con la búsqueda."
                    : `Todavía no hay feriados cargados para ${elegido}.`}
                </p>
                {!q && puedeAgregar && (
                  <button
                    type="button"
                    onClick={() => setAbierto("nuevo")}
                    className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                  >
                    <Plus className="size-4" />
                    Cargar uno
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {[...grupos].map(([clave, lista]) => (
                  <section key={clave}>
                    <h2 className="mb-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {nombreMes(lista[0].fecha)}
                      {q ? ` ${clave.slice(0, 4)}` : ""}
                    </h2>
                    <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                      {lista.map((f) => (
                        <li key={f.id}>
                          <Tarjeta f={f} paso={f.fecha < hoy} onAbrir={() => setAbierto(f)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {abierto != null && (
        <Editor
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          feriado={abierto === "nuevo" ? null : abierto}
          anio={elegido}
          todos={feriados}
          onCerrar={() => setAbierto(null)}
        />
      )}

      <AlertDialog
        open={copiando}
        onOpenChange={(o) => !o && !copiar.isPending && setCopiando(false)}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2.5rem)] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              ¿Copiar los feriados de {anterior} a {elegido}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se agregan {paraCopiar.length} con el mismo día y mes. Los que cambian de fecha cada
              año (como Semana Santa) hay que corregirlos después.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11 rounded-xl" disabled={copiar.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl"
              disabled={copiar.isPending}
              onClick={(e) => {
                e.preventDefault();
                copiar.mutate();
              }}
            >
              {copiar.isPending && <Loader2 className="size-4 animate-spin" />}
              Copiar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function Tarjeta({ f, paso, onAbrir }: { f: Feriado; paso: boolean; onAbrir: () => void }) {
  const finde = esFinDeSemana(f.fecha);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        paso ? "opacity-60" : ""
      }`}
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl text-lg font-bold tabular-nums ${
          paso ? "bg-muted text-muted-foreground" : "bg-primary-soft text-primary"
        }`}
      >
        {Number(f.fecha.slice(8))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{f.descripcion}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
          <span className="capitalize">{diaSemana(f.fecha)}</span>
          <span>· {cuandoEs(f.fecha)}</span>
          {finde && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold">
              Fin de semana
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición (el modal 71)                                               */
/* -------------------------------------------------------------------------- */

function Editor({
  feriado,
  anio,
  todos,
  onCerrar,
}: {
  feriado: Feriado | null;
  /** El año que se está viendo: el alta propone una fecha de ese año. */
  anio: number;
  todos: Feriado[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = feriado == null;
  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");

  const hoy = hoyISO();
  const inicial = {
    fecha: feriado?.fecha ?? (anioDe(hoy) === anio ? hoy : `${anio}-01-01`),
    descripcion: feriado?.descripcion ?? "",
  };
  const [fecha, setFecha] = useState(inicial.fecha);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const desc = descripcion.trim().replace(/\s+/g, " ");
  const repetido = fecha ? todos.find((f) => f.fecha === fecha && f.id !== feriado?.id) : undefined;
  const sinCambios = !nuevo && fecha === inicial.fecha && desc === inicial.descripcion;
  const listo = puedeGuardar && !!fecha && !!desc && !repetido && !sinCambios;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysFeriados.todo });

  const guardar = useMutation({
    mutationFn: () =>
      guardarFeriado(feriado?.id ?? null, { fecha_feriado: fecha, descripcion: desc }),
    onSuccess: () => {
      invalidar();
      toast.success(nuevo ? `"${desc}" agregado` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarFeriado(feriado!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`"${feriado!.descripcion}" eliminado`);
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
            {nuevo ? "Nuevo feriado" : feriado.descripcion}
          </DialogTitle>
          <DialogDescription className="text-xs capitalize">
            {fecha
              ? `${diaSemana(fecha)} ${fechaCorta(fecha)} · ${cuandoEs(fecha)}`
              : "Elegí el día."}
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
            <div>
              <Texto etiqueta="Fecha" req tipo="date" valor={fecha} onCambio={setFecha} />
              {repetido ? (
                <p className="mt-1 text-xs text-destructive">
                  Ese día ya es feriado: {repetido.descripcion}.
                </p>
              ) : (
                fecha &&
                esFinDeSemana(fecha) && (
                  <p className="mt-1 text-xs text-muted-foreground">Cae {diaSemana(fecha)}.</p>
                )
              )}
            </div>
            <Texto
              etiqueta="Descripción"
              req
              largo={255}
              valor={descripcion}
              onCambio={setDescripcion}
              placeholder="Ej.: Día de la Independencia"
            />
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} feriados.`}
            />
          )}

          <div className="flex gap-2">
            {puedeBorrar && (
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
                {nuevo ? "Agregar" : sinCambios ? "Sin cambios" : "Guardar cambios"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
