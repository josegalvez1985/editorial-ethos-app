import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
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
  eliminarAnioLectivo,
  guardarAnioLectivo,
  keysAniosLectivos,
  listarAniosLectivos,
  type AnioLectivo,
  type DatosAnioLectivo,
} from "@/lib/anios-lectivos";
import { textoUsos } from "@/lib/facilitadores";
import { diaISO, fechaCorta, hoyISO } from "@/lib/fechas";
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

/** Dónde está hoy respecto del período. */
function avance(a: AnioLectivo) {
  const h = diaISO(hoyISO());
  const d = diaISO(a.desde);
  const t = diaISO(a.hasta);
  if (h < d) return { estado: "antes" as const, dias: d - h, pct: 0 };
  if (h > t) return { estado: "despues" as const, dias: h - t, pct: 100 };
  const total = Math.max(1, t - d);
  return { estado: "durante" as const, dias: t - h, pct: Math.round(((h - d) / total) * 100) };
}

/**
 * Años Lectivos: la página 57 de APEX (un IG sobre `ANIOS_LECTIVOS`) y su
 * modal 59 (Crea Año Lectivo), que acá es el diálogo de la pantalla con los
 * permisos de la 57. Backend: el ABM nuevo de `backend/anios_lectivos.sql`. El
 * ícono es el que ya tenía en el menú (`CalendarRange`).
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **El año vigente arriba, destacado**: su período, cuánto va del año
 *   (o si ya terminó, o todavía no empezó) y qué datos tiene cargados. Si no
 *   hay ninguno vigente se avisa qué pasa con eso.
 * - **"Hacer vigente" en un toque**, con confirmación. El backend desactiva
 *   el anterior en la misma operación: en APEX había que desactivar uno y
 *   activar el otro a mano, y el índice único no dejaba hacerlo al revés.
 * - El alta **propone el año siguiente**, su descripción y las mismas fechas
 *   un año después. Avisa si las fechas caen en otro año o se pisan con otro.
 * - Cada año dice **qué datos tiene** (postulaciones, pre-horarios,
 *   horarios). Con datos no se borra ni cambia de número, y el vigente no se
 *   borra: el diálogo lo explica en vez de dejar que falle.
 */
function AniosLectivosPage() {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const puedeAgregar = puedeRuta(RUTA, "insertar");
  const puedeActualizar = puedeRuta(RUTA, "actualizar");

  const { data, isLoading, error } = useQuery({
    queryKey: keysAniosLectivos.todo,
    queryFn: listarAniosLectivos,
  });
  /** `null` cerrado, `"nuevo"` alta, o el año que se abre. */
  const [abierto, setAbierto] = useState<AnioLectivo | "nuevo" | null>(null);
  const [activando, setActivando] = useState<AnioLectivo | null>(null);

  const anios = data ?? [];
  const vigente = anios.find((a) => a.vigente);
  const otros = anios.filter((a) => !a.vigente);

  const activar = useMutation({
    mutationFn: (a: AnioLectivo) =>
      guardarAnioLectivo(a.id, {
        anio: a.anio,
        descripcion: a.descripcion,
        estado: "A",
        fecha_desde: a.desde,
        fecha_hasta: a.hasta,
      }),
    onSuccess: (_r, a) => {
      // Cambió el año de todo el sistema: horarios, pre-horarios, combos…
      qc.invalidateQueries();
      toast.success(`${a.anio} es el año vigente`);
      setActivando(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo activar"),
  });

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Años Lectivos</h1>
            <p className="text-xs text-muted-foreground">
              El vigente decide el año de horarios, pre-horarios, postulaciones y evaluaciones.
            </p>
          </div>
          {puedeAgregar && !isLoading && !error && (
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
          <div className="space-y-6">
            {vigente ? (
              <Vigente a={vigente} onAbrir={() => setAbierto(vigente)} />
            ) : (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">No hay un año vigente</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug">
                    Horarios y pre-horarios no saben qué año cargar, y los combos de evaluaciones
                    dejan de filtrar por año. Elegí uno abajo y tocá “Hacer vigente”.
                  </p>
                </div>
              </div>
            )}

            {otros.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                  {vigente ? "Otros años" : "Años cargados"}
                </h2>
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {otros.map((a) => (
                    <li key={a.id}>
                      <Tarjeta
                        a={a}
                        sugerido={sugerido(a, vigente, otros)}
                        puedeActivar={puedeActualizar}
                        onAbrir={() => setAbierto(a)}
                        onActivar={() => setActivando(a)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {abierto != null && (
        <Editor
          key={abierto === "nuevo" ? "nuevo" : abierto.id}
          anio={abierto === "nuevo" ? null : abierto}
          todos={anios}
          onCerrar={() => setAbierto(null)}
        />
      )}

      <AlertDialog
        open={activando != null}
        onOpenChange={(o) => !o && !activar.isPending && setActivando(null)}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2.5rem)] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              ¿Hacer vigente {activando?.anio}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vigente ? `${vigente.anio} deja de ser el vigente. ` : ""}
              Horarios, pre-horarios, postulaciones y los combos de evaluaciones pasan a usar{" "}
              {activando?.anio}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11 rounded-xl" disabled={activar.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl"
              disabled={activar.isPending}
              onClick={(e) => {
                // Se cierra al terminar, no antes: si falla queda abierto.
                e.preventDefault();
                if (activando) activar.mutate(activando);
              }}
            >
              {activar.isPending && <Loader2 className="size-4 animate-spin" />}
              Hacer vigente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/**
 * El que conviene activar: el siguiente al vigente cuando el vigente ya
 * terminó, o el más nuevo si no hay vigente.
 */
function sugerido(a: AnioLectivo, vigente: AnioLectivo | undefined, otros: AnioLectivo[]) {
  if (!vigente) return a.id === otros[0]?.id;
  return a.anio === vigente.anio + 1 && avance(vigente).estado === "despues";
}

function Vigente({ a, onAbrir }: { a: AnioLectivo; onAbrir: () => void }) {
  const av = avance(a);
  const datos = usos(a);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap block w-full overflow-hidden rounded-3xl border border-primary/25 bg-card text-left shadow-soft hover:border-primary/50"
    >
      <div className="bg-hero-gradient flex items-end justify-between gap-3 px-5 pt-4 pb-3 text-on-brand">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold opacity-90">
            <CheckCircle2 className="size-4" />
            Año vigente
          </p>
          <p className="font-display text-5xl leading-none font-bold tabular-nums">{a.anio}</p>
        </div>
        <ChevronRight className="mb-1 size-5 shrink-0 opacity-80" />
      </div>
      <div className="space-y-3 px-5 py-4">
        <div>
          <p className="text-sm font-semibold">{a.descripcion}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {fechaCorta(a.desde)} → {fechaCorta(a.hasta)}
          </p>
        </div>
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${av.pct}%` }} />
          </div>
          <p
            className={`mt-1.5 text-[12px] ${
              av.estado === "despues"
                ? "font-semibold text-amber-700 dark:text-amber-400"
                : "text-muted-foreground"
            }`}
          >
            {av.estado === "antes"
              ? `Empieza en ${av.dias} ${av.dias === 1 ? "día" : "días"}`
              : av.estado === "durante"
                ? `${av.pct}% del año · ${av.dias === 0 ? "termina hoy" : `faltan ${av.dias} ${av.dias === 1 ? "día" : "días"}`}`
                : `Terminó hace ${av.dias} ${av.dias === 1 ? "día" : "días"}: ¿ya toca activar ${a.anio + 1}?`}
          </p>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {datos ? `Tiene ${datos}.` : "Todavía no tiene datos cargados."}
        </p>
      </div>
    </button>
  );
}

function Tarjeta({
  a,
  sugerido,
  puedeActivar,
  onAbrir,
  onActivar,
}: {
  a: AnioLectivo;
  sugerido: boolean;
  puedeActivar: boolean;
  onAbrir: () => void;
  onActivar: () => void;
}) {
  const datos = usos(a);
  return (
    <div
      className={`flex h-full flex-col rounded-2xl border bg-card shadow-soft ${
        sugerido ? "border-primary/40" : "border-border/60"
      }`}
    >
      <button
        type="button"
        onClick={onAbrir}
        className="tap flex flex-1 items-center gap-3 p-3 text-left"
      >
        <span className="grid h-11 w-14 shrink-0 place-items-center rounded-xl bg-muted text-base font-bold tabular-nums">
          {a.anio}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{a.descripcion}</span>
          <span className="block text-[12px] text-muted-foreground">
            {fechaCorta(a.desde)} → {fechaCorta(a.hasta)}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {datos ? `Con ${datos}` : "Sin datos"}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {puedeActivar && (
        <button
          type="button"
          onClick={onActivar}
          className={`tap mx-3 mb-3 flex h-9 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold ${
            sugerido
              ? "bg-primary text-primary-foreground"
              : "border border-border/60 text-primary hover:border-primary/40"
          }`}
        >
          <CheckCircle2 className="size-4" />
          Hacer vigente
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición (el modal 59)                                               */
/* -------------------------------------------------------------------------- */

function Editor({
  anio,
  todos,
  onCerrar,
}: {
  anio: AnioLectivo | null;
  todos: AnioLectivo[];
  onCerrar: () => void;
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
  const fueraDelAnio =
    numeroValido &&
    !!desde &&
    !!hasta &&
    Number(desde.slice(0, 4)) !== n &&
    Number(hasta.slice(0, 4)) !== n;
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
      // Si cambió cuál es el vigente, cambió el año de todo el sistema.
      if (esVigente !== inicial.vigente || (esVigente && numero !== inicial.anio)) {
        qc.invalidateQueries();
      } else {
        qc.invalidateQueries({ queryKey: keysAniosLectivos.todo });
      }
      toast.success(
        nuevo ? `${n} agregado` : "Cambios guardados",
        r.desactivado ? { description: `${r.desactivado} dejó de ser el vigente.` } : undefined,
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
              <div>
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
              </div>
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
              (fueraDelAnio || pisa) && (
                <p className="-mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {fueraDelAnio
                    ? `Ojo: las fechas no caen en ${n}.`
                    : `Ojo: se pisa con ${pisa!.anio} (${fechaCorta(pisa!.desde)} → ${fechaCorta(pisa!.hasta)}).`}
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
                  {esVigente
                    ? vigente && vigente.id !== anio?.id
                      ? `${vigente.anio} deja de ser el vigente al guardar.`
                      : "Es el año de horarios, pre-horarios, postulaciones y evaluaciones."
                    : inicial.vigente
                      ? "Sin año vigente, horarios y pre-horarios no sabrán qué año cargar."
                      : "Queda inactivo."}
                </span>
              </span>
            </button>
          </fieldset>

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
