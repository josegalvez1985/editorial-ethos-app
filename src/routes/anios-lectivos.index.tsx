import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarRange, ChevronRight, Loader2, Lock, Plus, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { EditorProcesoPostulacion } from "@/components/editor-proceso-postulacion";
import { Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AVISO_INACTIVAR,
  eliminarAnioLectivo,
  guardarAnioLectivo,
  keysAniosLectivos,
  listarAniosLectivos,
  textoInactivados,
  type AnioLectivo,
  type DatosAnioLectivo,
} from "@/lib/anios-lectivos";
import { textoUsos } from "@/lib/facilitadores";
import { fechaCorta } from "@/lib/fechas";
import { usePermisos } from "@/lib/permisos";

export const Route = createFileRoute("/anios-lectivos/")({
  head: () => ({
    meta: [
      { title: "Años Lectivos — Juventud con Valores" },
      { name: "description", content: "Los años lectivos y cuál es el vigente." },
    ],
  }),
  component: AniosLectivosPage,
});

const RUTA = "/anios-lectivos";

/** El mismo día, `n` años después ("2026-02-01" → "2027-02-01"). */
const sumarAnios = (f: string, n: number) => (f ? `${Number(f.slice(0, 4)) + n}${f.slice(4)}` : "");

/** "128 postulaciones y 40 pre horarios", o null. */
const usos = (a: AnioLectivo) => textoUsos(a.usos)?.replace(/^en /, "") ?? null;

/**
 * Años Lectivos: la página 57 de APEX (un IG sobre `ANIOS_LECTIVOS`) y su
 * modal 59 (Crea Año Lectivo), que acá es el diálogo de la pantalla con los
 * permisos de la 57. Backend: `backend/anios_lectivos.sql`. El ícono es el que
 * ya tenía en el menú (`CalendarRange`).
 *
 * Desde el 24/11/2026, **igual de simple que Materias** (pedido de Jose):
 * tarjetas en grilla y un diálogo. El vigente lleva su marca y se cambia con
 * el interruptor "Año vigente" del diálogo (el backend desactiva el anterior
 * en la misma operación). El **proceso de postulación** (`PROCESO_POSTULACION`,
 * en Markdown, lo lee otra app) se abre desde el diálogo de cada año.
 */
function AniosLectivosPage() {
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA, "insertar");

  const { data, isLoading, error } = useQuery({
    queryKey: keysAniosLectivos.todo,
    queryFn: listarAniosLectivos,
  });
  /** `null` cerrado, `"nuevo"` alta, o el año que se abre. */
  const [abierto, setAbierto] = useState<AnioLectivo | "nuevo" | null>(null);
  /** El año cuyo proceso de postulación se edita. */
  const [proceso, setProceso] = useState<AnioLectivo | null>(null);

  const anios = data ?? [];
  const hayVigente = anios.some((a) => a.vigente);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Años Lectivos
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {anios.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              El vigente decide el año de horarios, pre-horarios, postulaciones y evaluaciones.
            </p>
          </div>
          {puedeAgregar && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo año</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar los años lectivos" />
        ) : !anios.length ? (
          <div className="py-12 text-center">
            <CalendarRange className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">Todavía no hay años lectivos.</p>
            {puedeAgregar && (
              <button
                type="button"
                onClick={() => setAbierto("nuevo")}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar el primero
              </button>
            )}
          </div>
        ) : (
          <>
            {!hayVigente && (
              <p className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-300">
                No hay un año vigente: abrí uno y activá “Año vigente”.
              </p>
            )}
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {anios.map((a) => (
                <li key={a.id}>
                  <Tarjeta a={a} onAbrir={() => setAbierto(a)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {abierto != null && (
        <Editor
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          anio={abierto === "nuevo" ? null : abierto}
          todos={anios}
          onCerrar={() => setAbierto(null)}
          onProceso={(a) => {
            setAbierto(null);
            setProceso(a);
          }}
        />
      )}

      {proceso && (
        <EditorProcesoPostulacion
          key={proceso.id}
          anio={proceso}
          anterior={anios.find((a) => a.anio < proceso.anio && a.proceso.trim())}
          puedeEditar={puedeRuta(RUTA, "actualizar")}
          onCerrar={() => setProceso(null)}
        />
      )}
    </AppShell>
  );
}

function Tarjeta({ a, onAbrir }: { a: AnioLectivo; onAbrir: () => void }) {
  const datos = usos(a);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={`tap flex h-full w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left shadow-soft hover:border-primary/40 ${
        a.vigente ? "border-primary/40" : "border-border/60"
      }`}
    >
      <span
        className={`grid h-10 w-14 shrink-0 place-items-center rounded-xl text-base font-bold tabular-nums ${
          a.vigente ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary"
        }`}
      >
        {a.anio}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{a.descripcion}</span>
          {a.vigente && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">
              Vigente
            </span>
          )}
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {fechaCorta(a.desde)} → {fechaCorta(a.hasta)} · {datos ? `Con ${datos}` : "Sin uso"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición (el modal 59)                                               */
/* -------------------------------------------------------------------------- */

function Editor({
  anio,
  todos,
  onCerrar,
  onProceso,
}: {
  anio: AnioLectivo | null;
  todos: AnioLectivo[];
  onCerrar: () => void;
  onProceso: (a: AnioLectivo) => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = anio == null;
  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");

  const vigente = todos.find((a) => a.vigente);
  // El alta propone el siguiente al más nuevo, con sus fechas un año después.
  const ultimo = todos[0];
  const propuesto = ultimo ? ultimo.anio + 1 : new Date().getFullYear();
  const inicial = {
    anio: String(anio?.anio ?? propuesto),
    descripcion: anio?.descripcion ?? `Año lectivo ${propuesto}`,
    desde: anio?.desde ?? (ultimo ? sumarAnios(ultimo.desde, 1) : `${propuesto}-02-01`),
    hasta: anio?.hasta ?? (ultimo ? sumarAnios(ultimo.hasta, 1) : `${propuesto}-11-30`),
    // Sin ninguno vigente, el alta se propone como vigente.
    vigente: anio?.vigente ?? !vigente,
  };
  const [numero, setNumero] = useState(inicial.anio);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  // La descripción sigue al año mientras sea la propuesta ("Año lectivo 2027").
  const [descripcionTocada, setDescripcionTocada] = useState(!nuevo);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [esVigente, setEsVigente] = useState(inicial.vigente);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const n = Number(numero);
  const numeroValido = /^\d{4}$/.test(numero.trim());
  const otros = todos.filter((a) => a.id !== anio?.id);
  const repetido = numeroValido ? otros.find((a) => a.anio === n) : undefined;
  const conDatos = !!anio?.usos.length;
  // Con datos no cambia de número (el backend lo frena igual: 409).
  const numeroBloqueado = conDatos;
  const fechasMal = !!desde && !!hasta && desde > hasta;
  const pisa =
    desde && hasta && !fechasMal
      ? otros.find((a) => a.desde && a.hasta && desde <= a.hasta && hasta >= a.desde)
      : undefined;
  const desc = descripcion.trim().replace(/\s+/g, " ");

  const faltan = [
    ...(numeroValido ? [] : ["el año (4 cifras)"]),
    ...(desc ? [] : ["la descripción"]),
    ...(desde ? [] : ["la fecha desde"]),
    ...(hasta ? [] : ["la fecha hasta"]),
  ];
  const sinCambios =
    !nuevo &&
    numero === inicial.anio &&
    desc === inicial.descripcion &&
    desde === inicial.desde &&
    hasta === inicial.hasta &&
    esVigente === inicial.vigente;
  const listo = puedeGuardar && !faltan.length && !repetido && !fechasMal && !sinCambios;
  // El vigente cambia al guardar: avisar lo que se inactiva.
  const cambiaVigente =
    (esVigente && !!vigente && vigente.id !== anio?.id) || (!esVigente && inicial.vigente);

  const guardar = useMutation({
    mutationFn: () => {
      const d: DatosAnioLectivo = {
        anio: n,
        descripcion: desc,
        estado: esVigente ? "A" : "I",
        fecha_desde: desde,
        fecha_hasta: hasta,
      };
      return guardarAnioLectivo(anio?.id ?? null, d);
    },
    onSuccess: (r) => {
      // Si cambió cuál es el vigente, cambió el año de todo el sistema (y se
      // inactivaron instituciones y facilitadores).
      const inactivados = textoInactivados(r);
      if (esVigente !== inicial.vigente || (esVigente && numero !== inicial.anio) || inactivados) {
        qc.invalidateQueries();
      } else {
        qc.invalidateQueries({ queryKey: keysAniosLectivos.todo });
      }
      const detalle = [
        ...(r.desactivado ? [`${r.desactivado} dejó de ser el vigente.`] : []),
        ...(inactivados ? [inactivados] : []),
      ].join(" ");
      toast.success(
        nuevo ? `${n} agregado` : "Cambios guardados",
        detalle ? { description: detalle, duration: inactivados ? 8000 : undefined } : undefined,
      );
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarAnioLectivo(anio!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keysAniosLectivos.todo });
      toast.success(`${anio!.anio} eliminado`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const conProceso = !!anio?.proceso.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo año lectivo" : `Año lectivo ${anio.anio}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? "Te propongo el siguiente, con las mismas fechas un año después."
              : conDatos
                ? `Tiene ${usos(anio)}.`
                : "Todavía no tiene datos cargados."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (faltan.length) {
              toast.error(`Falta completar ${faltan.join(", ")}`);
              return;
            }
            if (listo) guardar.mutate();
          }}
          className="space-y-4"
        >
          <fieldset disabled={!puedeGuardar || ocupado} className="space-y-4">
            <div className="grid grid-cols-[7rem_1fr] gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  Año <span className="text-destructive">*</span>
                </span>
                <input
                  value={numero}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setNumero(v);
                    if (!descripcionTocada) setDescripcion(`Año lectivo ${v}`);
                  }}
                  inputMode="numeric"
                  disabled={numeroBloqueado}
                  autoComplete="off"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base font-semibold tabular-nums outline-none focus:border-primary/40 disabled:opacity-60 lg:text-sm"
                />
              </label>
              <Texto
                etiqueta="Descripción"
                req
                largo={100}
                valor={descripcion}
                onCambio={(v) => {
                  setDescripcion(v);
                  setDescripcionTocada(true);
                }}
              />
            </div>
            {repetido && <p className="-mt-2 text-xs text-destructive">{n} ya está cargado.</p>}
            {numeroBloqueado && (
              <p className="-mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                <Lock className="mt-px size-3 shrink-0" />
                El año no se cambia: sus datos quedarían colgados del número viejo.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Texto etiqueta="Desde" req tipo="date" valor={desde} onCambio={setDesde} />
              <Texto etiqueta="Hasta" req tipo="date" valor={hasta} onCambio={setHasta} />
            </div>
            {fechasMal ? (
              <p className="-mt-2 text-xs text-destructive">
                “Desde” no puede ser después de “Hasta”.
              </p>
            ) : (
              pisa && (
                <p className="-mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Ojo: se pisa con {pisa.anio}.
                </p>
              )
            )}

            <button
              type="button"
              role="switch"
              aria-checked={esVigente}
              onClick={() => setEsVigente((v) => !v)}
              className={`tap flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
                esVigente ? "border-primary/40 bg-primary-soft/50" : "border-border/60"
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  esVigente ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`size-5 rounded-full bg-white shadow transition-transform ${
                    esVigente ? "translate-x-4" : ""
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Año vigente</span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground">
                  {esVigente && vigente && vigente.id !== anio?.id
                    ? `${vigente.anio} deja de ser el vigente al guardar.`
                    : esVigente
                      ? "Es el año que usa todo el sistema."
                      : "Queda inactivo."}
                  {cambiaVigente && (
                    <span className="mt-1 block font-medium text-amber-700 dark:text-amber-400">
                      {AVISO_INACTIVAR}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </fieldset>

          {/* Proceso de postulación: se edita aparte (Markdown, lo lee otra app). */}
          {!nuevo && (
            <button
              type="button"
              onClick={() => onProceso(anio)}
              disabled={ocupado || !sinCambios}
              className="tap flex w-full items-center gap-3 rounded-xl border border-border/60 p-3 text-left hover:border-primary/40 disabled:opacity-60"
            >
              <ScrollText className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Proceso de postulación</span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {!sinCambios
                    ? "Guardá los cambios del año antes de abrirlo."
                    : conProceso
                      ? "Cargado. Tocá para verlo o editarlo."
                      : "Sin cargar."}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )}

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} años lectivos.`}
            />
          )}

          {puedeBorrar && (anio.vigente || conDatos) && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              <span>
                {anio.vigente
                  ? "No se puede eliminar: es el año vigente. Activá otro antes."
                  : "No se puede eliminar: tiene datos cargados."}
              </span>
            </p>
          )}

          <div className="flex gap-2">
            {puedeBorrar && !anio.vigente && !conDatos && (
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
                disabled={ocupado || (!listo && !faltan.length)}
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
