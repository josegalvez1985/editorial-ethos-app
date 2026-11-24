import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck2, ChevronRight, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Pastillas, Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fechaCorta } from "@/lib/fechas";
import {
  eliminarPeriodoPostulacion,
  estadoPeriodo,
  guardarPeriodoPostulacion,
  keysPeriodosPostulacion,
  listarPeriodosPostulacion,
  type AnioPeriodo,
  type EstadoPeriodo,
} from "@/lib/periodos-postulacion";
import { usePermisos } from "@/lib/permisos";

export const Route = createFileRoute("/periodos-postulacion/")({
  head: () => ({
    meta: [
      { title: "Períodos de Postulación — Juventud con Valores" },
      {
        name: "description",
        content: "Desde cuándo y hasta cuándo se puede postular en cada año lectivo.",
      },
    ],
  }),
  component: PeriodosPostulacionPage,
});

const RUTA = "/periodos-postulacion";
const LARGO_MOTIVO = 500;

/** El mismo día, `n` años después ("2026-02-01" → "2027-02-01"). */
const sumarAnios = (f: string, n: number) => (f ? `${Number(f.slice(0, 4)) + n}${f.slice(4)}` : "");

/** "Abierta", "Abre en 5 días", "Cerrada"… */
function textoEstado(e: EstadoPeriodo) {
  switch (e.tipo) {
    case "abierta":
      return "Abierta";
    case "extraordinaria":
      return "Abierta (extraordinaria)";
    case "proxima":
      return e.faltan === 1 ? "Abre mañana" : `Abre en ${e.faltan} días`;
    case "cerrada":
      return "Cerrada";
  }
}

const COLOR: Record<EstadoPeriodo["tipo"], string> = {
  abierta: "text-emerald-700 dark:text-emerald-400",
  extraordinaria: "text-amber-700 dark:text-amber-400",
  proxima: "text-sky-700 dark:text-sky-400",
  cerrada: "text-muted-foreground",
};

/**
 * Períodos de Postulación (24/11/2026, pantalla nueva, no de APEX): la tabla
 * `PERIODOS_POSTULACION`, que **comparte con otra app** sobre la misma base.
 * Backend: `backend/periodos_postulacion.sql`.
 *
 * **Tan simple como Materias** (pedido de Jose): una tarjeta por período con
 * sus fechas y si hoy está abierta, y un diálogo para el alta (eligiendo un año
 * lectivo que todavía no tenga) y la edición. La habilitación extraordinaria
 * abre la postulación aunque esté fuera de fecha, y pide el motivo.
 */
function PeriodosPostulacionPage() {
  const { puedeRuta } = usePermisos();
  const { data, isLoading, error } = useQuery({
    queryKey: keysPeriodosPostulacion.todo,
    queryFn: listarPeriodosPostulacion,
  });
  /** `null` cerrado, `"nuevo"` alta, o el año cuyo período se abre. */
  const [abierto, setAbierto] = useState<AnioPeriodo | "nuevo" | null>(null);

  const anios = data ?? [];
  const conPeriodo = anios.filter((a) => a.periodo);
  const sinPeriodo = anios.filter((a) => !a.periodo);
  const puedeAgregar = puedeRuta(RUTA, "insertar") && sinPeriodo.length > 0;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Períodos de Postulación
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {conPeriodo.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Desde cuándo y hasta cuándo se puede postular en cada año lectivo.
            </p>
          </div>
          {puedeAgregar && (
            <button
              type="button"
              onClick={() => setAbierto("nuevo")}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo período</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar los períodos" />
        ) : !conPeriodo.length ? (
          <div className="py-12 text-center">
            <CalendarCheck2 className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {anios.length
                ? "Todavía no hay períodos de postulación."
                : "Primero cargá un año lectivo en Años Lectivos."}
            </p>
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
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {conPeriodo.map((a) => (
              <li key={a.idAnio}>
                <Tarjeta a={a} onAbrir={() => setAbierto(a)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {abierto != null && (
        <Editor
          key={abierto === "nuevo" ? "nuevo" : abierto.idAnio}
          anio={abierto === "nuevo" ? null : abierto}
          todos={anios}
          sinPeriodo={sinPeriodo}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Tarjeta({ a, onAbrir }: { a: AnioPeriodo; onAbrir: () => void }) {
  const p = a.periodo!;
  const e = estadoPeriodo(p);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
    >
      <span className="grid h-10 w-14 shrink-0 place-items-center rounded-xl bg-primary-soft text-base font-bold text-primary tabular-nums">
        {a.anio}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {fechaCorta(p.inicio)} → {fechaCorta(p.fin)}
        </span>
        <span className={`block truncate text-[11.5px] font-medium ${COLOR[e.tipo]}`}>
          {textoEstado(e)}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición                                                             */
/* -------------------------------------------------------------------------- */

function Editor({
  anio,
  todos,
  sinPeriodo,
  onCerrar,
}: {
  anio: AnioPeriodo | null;
  todos: AnioPeriodo[];
  sinPeriodo: AnioPeriodo[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const actual = anio?.periodo ?? null;
  const nuevo = actual == null;
  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");

  // El alta propone el año vigente si no tiene período, o el más nuevo.
  const [idAnio, setIdAnio] = useState<number | null>(
    anio?.idAnio ?? (sinPeriodo.find((a) => a.vigente) ?? sinPeriodo[0])?.idAnio ?? null,
  );
  const elegido = todos.find((a) => a.idAnio === idAnio);
  // Las fechas del año anterior, un año después.
  const propuesta = (id: number | null) => {
    const a = todos.find((x) => x.idAnio === id);
    const ant = a && todos.find((x) => x.anio === a.anio - 1)?.periodo;
    return { inicio: ant ? sumarAnios(ant.inicio, 1) : "", fin: ant ? sumarAnios(ant.fin, 1) : "" };
  };

  const inicial = {
    inicio: actual?.inicio ?? propuesta(idAnio).inicio,
    fin: actual?.fin ?? propuesta(idAnio).fin,
    extraordinaria: actual?.extraordinaria ?? false,
    motivo: actual?.motivo ?? "",
  };
  const [inicio, setInicio] = useState(inicial.inicio);
  const [fin, setFin] = useState(inicial.fin);
  const [extraordinaria, setExtraordinaria] = useState(inicial.extraordinaria);
  const [motivo, setMotivo] = useState(inicial.motivo);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const mot = motivo.trim();
  const fechasMal = !!inicio && !!fin && fin < inicio;
  const faltan = [
    ...(idAnio ? [] : ["el año lectivo"]),
    ...(inicio ? [] : ["la fecha de inicio"]),
    ...(fin ? [] : ["la fecha de fin"]),
    ...(extraordinaria && !mot ? ["el motivo de la habilitación"] : []),
  ];
  const sinCambios =
    !nuevo &&
    inicio === inicial.inicio &&
    fin === inicial.fin &&
    extraordinaria === inicial.extraordinaria &&
    mot === inicial.motivo.trim();
  const listo = puedeGuardar && !faltan.length && !fechasMal && !sinCambios;

  const alTerminar = (texto: string) => {
    qc.invalidateQueries({ queryKey: keysPeriodosPostulacion.todo });
    toast.success(texto);
    onCerrar();
  };

  const guardar = useMutation({
    mutationFn: () =>
      guardarPeriodoPostulacion(actual?.id ?? null, {
        ...(nuevo ? { id_anio: idAnio! } : {}),
        fecha_inicio: inicio,
        fecha_fin: fin,
        habilitacion_extraordinaria: extraordinaria ? "SI" : "NO",
        motivo_habilitacion: mot,
      }),
    onSuccess: () =>
      alTerminar(nuevo ? `Período de ${elegido?.anio} agregado` : "Cambios guardados"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarPeriodoPostulacion(actual!.id),
    onSuccess: () => alTerminar(`Período de ${anio?.anio} eliminado`),
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo período" : `Período ${anio?.anio}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Las fechas en que se acepta postulación para el año lectivo.
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
            {nuevo && (
              <Pastillas
                etiqueta="Año lectivo"
                req
                opciones={sinPeriodo.map((a) => ({
                  valor: String(a.idAnio),
                  mostrar: String(a.anio),
                }))}
                valor={idAnio == null ? "" : String(idAnio)}
                onCambio={(v) => {
                  const id = v ? Number(v) : null;
                  setIdAnio(id);
                  // Si las fechas siguen siendo la propuesta, siguen al año.
                  const antes = propuesta(idAnio);
                  if (inicio === antes.inicio && fin === antes.fin) {
                    const p = propuesta(id);
                    setInicio(p.inicio);
                    setFin(p.fin);
                  }
                }}
              />
            )}

            <div className="grid grid-cols-2 gap-3">
              <Texto etiqueta="Inicio" req tipo="date" valor={inicio} onCambio={setInicio} />
              <Texto etiqueta="Fin" req tipo="date" valor={fin} onCambio={setFin} />
            </div>
            {fechasMal && (
              <p className="-mt-2 text-xs text-destructive">
                El fin no puede ser antes del inicio.
              </p>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={extraordinaria}
              onClick={() => setExtraordinaria((v) => !v)}
              className={`tap flex w-full items-start gap-3 rounded-xl border p-3 text-left ${
                extraordinaria ? "border-amber-500/40 bg-amber-500/10" : "border-border/60"
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  extraordinaria ? "bg-amber-500" : "bg-muted"
                }`}
              >
                <span
                  className={`size-5 rounded-full bg-white shadow transition-transform ${
                    extraordinaria ? "translate-x-4" : ""
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Habilitación extraordinaria</span>
                <span className="block text-[11.5px] leading-snug text-muted-foreground">
                  Permite postular aunque esté fuera de las fechas.
                </span>
              </span>
            </button>

            {extraordinaria && (
              <Texto
                etiqueta="Motivo"
                req
                multilinea
                largo={LARGO_MOTIVO}
                valor={motivo}
                onCambio={setMotivo}
                placeholder="Por qué se habilita fuera de fecha"
              />
            )}
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} períodos de postulación.`}
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
