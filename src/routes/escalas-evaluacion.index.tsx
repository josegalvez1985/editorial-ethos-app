import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronDown, Gauge, Loader2, Lock, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
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
import {
  aTramos,
  eliminarFilaEscala,
  guardarFilaEscala,
  guardarTramos,
  keysEscala,
  listarEscala,
  type FilaEscala,
  type Tramo,
} from "@/lib/escalas-evaluacion";
import { usePermisos } from "@/lib/permisos";

export const Route = createFileRoute("/escalas-evaluacion/")({
  head: () => ({
    meta: [
      { title: "Escalas de Evaluaciones — Juventud con Valores" },
      {
        name: "description",
        content: "Qué calificación sale según cuántos ítems se marcan en la evaluación.",
      },
    ],
  }),
  component: EscalasPage,
});

const RUTA = "/escalas-evaluacion";

/**
 * Los tramos son una calificación ORDENADA (de peor a mejor): escala
 * secuencial de un solo color, de claro a oscuro, sin semáforo. Clases
 * literales para que Tailwind las genere.
 */
const TONOS = [
  "bg-primary/20",
  "bg-primary/35",
  "bg-primary/50",
  "bg-primary/65",
  "bg-primary/80",
  "bg-primary",
];
const tono = (i: number, n: number) =>
  TONOS[n <= 1 ? TONOS.length - 1 : Math.round((i / (n - 1)) * (TONOS.length - 1))];
/** Sobre los tonos más oscuros, texto claro. */
const oscuro = (i: number, n: number) => n > 1 && i / (n - 1) > 0.55;

const rango = (t: Tramo) =>
  t.desde === t.hasta ? `${t.desde} marcados` : `De ${t.desde} a ${t.hasta} marcados`;

/**
 * Escalas de Evaluaciones: la página 85 de APEX (un IG sobre
 * `ESCALAS_EVALUACIONES`) y su modal 86 (Crear Escala), que acá son los
 * diálogos de la pantalla con los permisos de la 85. Backend:
 * `backend/escalas_evaluaciones.sql`. El ícono es el que ya tenía en el menú
 * (`Gauge`).
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Por tramos, no por fila**: la tabla son 33 filas (una por cantidad de
 *   ítems marcados) que repiten cinco textos. Se ven como cinco tramos con su
 *   rango, sobre una barra de 0 al máximo.
 * - **"Editar tramos"** cambia los topes y los textos de todos a la vez, en
 *   una sola operación: los textos de un tramo no pueden quedar distintos
 *   fila por fila (pasó el 08/10/2026).
 * - Avisa si faltan números en la escala.
 * - Las filas sueltas siguen a mano ("Ver las 33 filas"), como en APEX. Una
 *   usada por evaluaciones no se borra ni cambia de número (la FK es por el
 *   valor).
 */
function EscalasPage() {
  const { puedeRuta } = usePermisos();
  const puedeEditar = puedeRuta(RUTA, "actualizar");
  const puedeAgregar = puedeRuta(RUTA, "insertar");

  const { data, isLoading, error } = useQuery({ queryKey: keysEscala.todo, queryFn: listarEscala });
  const [editandoTramos, setEditandoTramos] = useState(false);
  const [verFilas, setVerFilas] = useState(false);
  /** `null` cerrado, `"nueva"` alta, o la fila. */
  const [fila, setFila] = useState<FilaEscala | "nueva" | null>(null);

  const filas = data?.filas ?? [];
  const tramos = aTramos(filas);
  const numeradas = filas.filter((f) => f.escala != null).map((f) => f.escala!);
  const maximo = numeradas.length ? Math.max(...numeradas) : 0;
  const faltan = numeradas.length
    ? Array.from({ length: maximo + 1 }, (_, i) => i).filter((i) => !numeradas.includes(i))
    : [];
  const total = maximo + 1;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Escalas de Evaluaciones</h1>
            <p className="text-xs text-muted-foreground">
              Qué calificación sale según cuántos ítems se marcan en la evaluación.
            </p>
          </div>
          {puedeEditar && !isLoading && !error && (
            <button
              type="button"
              onClick={() => setEditandoTramos(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Pencil className="size-4" />
              <span className="hidden sm:inline">Editar tramos</span>
              <span className="sm:hidden">Editar</span>
            </button>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudo cargar la escala" />
        ) : !tramos.length ? (
          <div className="py-12 text-center">
            <Gauge className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">Todavía no hay escala cargada.</p>
            {puedeEditar && (
              <button
                type="button"
                onClick={() => setEditandoTramos(true)}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Armar la escala
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {faltan.length > 0 && (
              <p className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12.5px] text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-px size-4 shrink-0" />
                <span>
                  Faltan {faltan.length === 1 ? "la escala" : "las escalas"} {faltan.join(", ")}:
                  una evaluación con esa cantidad de marcados no tendría calificación.
                  {puedeEditar && " “Editar tramos” las completa."}
                </span>
              </p>
            )}

            {/* La escala de 0 al máximo, un segmento por tramo. */}
            <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
              <div className="flex h-11 gap-0.5 overflow-hidden rounded-lg">
                {tramos.map((t, i) => {
                  const ancho = ((t.hasta - t.desde + 1) / total) * 100;
                  return (
                    <div
                      key={t.desde}
                      title={`${t.calificacion}: ${rango(t).toLowerCase()}`}
                      className={`grid min-w-0 place-items-center px-1 text-[11px] font-semibold ${tono(i, tramos.length)} ${
                        oscuro(i, tramos.length) ? "text-primary-foreground" : "text-foreground"
                      }`}
                      style={{ width: `${ancho}%` }}
                    >
                      {ancho >= 12 && <span className="truncate">{t.calificacion}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
                <span>0 marcados</span>
                <span>{maximo} marcados</span>
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {tramos.map((t, i) => (
                <li key={t.desde}>
                  <div className="flex h-full gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
                    <span
                      aria-hidden
                      className={`mt-0.5 h-10 w-2 shrink-0 rounded-full ${tono(i, tramos.length)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{t.calificacion || "Sin calificación"}</p>
                      <p className="text-[12px] font-medium text-muted-foreground tabular-nums">
                        {rango(t)}
                      </p>
                      {t.descripcion && (
                        <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                          {t.descripcion}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <section className="rounded-2xl border border-border/60 bg-card shadow-soft">
              <button
                type="button"
                onClick={() => setVerFilas((v) => !v)}
                aria-expanded={verFilas}
                className="tap flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold">
                  Ver las {filas.length} filas
                  <span className="block text-[11.5px] font-normal text-muted-foreground">
                    Una por cantidad de marcados, como en APEX.
                  </span>
                </span>
                <ChevronDown
                  className={`size-5 shrink-0 text-muted-foreground transition-transform ${
                    verFilas ? "rotate-180" : ""
                  }`}
                />
              </button>
              {verFilas && (
                <div className="border-t border-border/60 p-3">
                  <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                    {filas.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => setFila(f)}
                          className="tap flex w-full items-center gap-2 rounded-xl border border-border/60 px-2.5 py-2 text-left hover:border-primary/40"
                        >
                          <span className="w-7 shrink-0 text-right text-sm font-bold tabular-nums">
                            {f.escala ?? "—"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">
                            {f.calificacion || "Sin calificación"}
                          </span>
                          {f.usos > 0 && (
                            <Lock
                              aria-label="Usada por evaluaciones"
                              className="size-3 shrink-0 text-muted-foreground"
                            />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {puedeAgregar && (
                    <button
                      type="button"
                      onClick={() => setFila("nueva")}
                      className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-primary hover:bg-primary-soft"
                    >
                      <Plus className="size-3.5" />
                      Nueva fila
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {editandoTramos && data && (
        <EditorTramos
          tramos={tramos}
          filas={filas}
          largoCal={data.largoCalificacion}
          largoDes={data.largoDescripcion}
          onCerrar={() => setEditandoTramos(false)}
        />
      )}

      {fila != null && data && (
        <EditorFila
          key={fila === "nueva" ? "nueva" : fila.id}
          fila={fila === "nueva" ? null : fila}
          filas={filas}
          largoCal={data.largoCalificacion}
          largoDes={data.largoDescripcion}
          onCerrar={() => setFila(null)}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Editar tramos                                                              */
/* -------------------------------------------------------------------------- */

type TramoEditable = { hasta: string; calificacion: string; descripcion: string };

function EditorTramos({
  tramos,
  filas,
  largoCal,
  largoDes,
  onCerrar,
}: {
  tramos: Tramo[];
  filas: FilaEscala[];
  largoCal: number;
  largoDes: number;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const [lista, setLista] = useState<TramoEditable[]>(
    tramos.length
      ? tramos.map((t) => ({
          hasta: String(t.hasta),
          calificacion: t.calificacion,
          descripcion: t.descripcion,
        }))
      : [{ hasta: "10", calificacion: "", descripcion: "" }],
  );

  const set = (i: number, k: keyof TramoEditable, v: string) =>
    setLista((l) => l.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  // El "desde" de cada uno sale del anterior; el primero empieza en 0.
  const desdes: number[] = [];
  lista.forEach((t, i) => {
    desdes.push(i === 0 ? 0 : (Number(lista[i - 1].hasta) || 0) + 1);
  });
  const errores = lista.map((t, i) => {
    const h = Number(t.hasta);
    if (!/^\d+$/.test(t.hasta.trim())) return "El tope tiene que ser un número entero.";
    if (h < desdes[i]) return `Tiene que terminar en ${desdes[i]} o más.`;
    if (!t.calificacion.trim()) return "Falta la calificación.";
    return null;
  });
  const tope = Number(lista[lista.length - 1]?.hasta) || 0;
  // Lo que quedaría afuera no puede estar usado (la FK es por el valor).
  const maxUsada = Math.max(
    -1,
    ...filas.filter((f) => f.usos > 0 && f.escala != null).map((f) => f.escala!),
  );
  const cortaUsadas = maxUsada > tope;
  const listo = !errores.some(Boolean) && !cortaUsadas;

  const guardar = useMutation({
    mutationFn: () =>
      guardarTramos(
        lista.map((t) => ({
          hasta: Number(t.hasta),
          calificacion: t.calificacion.trim().replace(/\s+/g, " "),
          descripcion: t.descripcion.trim(),
        })),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keysEscala.todo });
      toast.success("Escala guardada", {
        description: `${lista.length} ${lista.length === 1 ? "tramo" : "tramos"}, de 0 a ${tope} marcados.`,
      });
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !guardar.isPending && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Editar tramos</DialogTitle>
          <DialogDescription className="text-xs">
            Cada tramo empieza donde termina el anterior. Al guardar, cada fila de 0 a {tope} queda
            con el texto de su tramo.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate();
          }}
          className="space-y-3"
        >
          <fieldset disabled={guardar.isPending} className="space-y-3">
            {lista.map((t, i) => (
              <div key={i} className="space-y-3 rounded-xl border border-border/60 p-3">
                <div className="flex items-end gap-3">
                  <div className="w-20 shrink-0">
                    <span className="mb-1.5 block text-sm font-medium">Desde</span>
                    <span className="flex h-11 items-center rounded-xl bg-muted px-3 text-base font-semibold tabular-nums lg:text-sm">
                      {desdes[i]}
                    </span>
                  </div>
                  <div className="w-24 shrink-0">
                    <Texto
                      etiqueta="Hasta"
                      req
                      inputMode="numeric"
                      valor={t.hasta}
                      onCambio={(v) => set(i, "hasta", v.replace(/\D/g, ""))}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Texto
                      etiqueta="Calificación"
                      req
                      largo={largoCal}
                      valor={t.calificacion}
                      onCambio={(v) => set(i, "calificacion", v)}
                    />
                  </div>
                  {lista.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Quitar el tramo ${i + 1}`}
                      onClick={() => setLista((l) => l.filter((_, j) => j !== i))}
                      className="mb-1 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <Texto
                  etiqueta="Descripción"
                  multilinea
                  largo={largoDes}
                  valor={t.descripcion}
                  onCambio={(v) => set(i, "descripcion", v)}
                />
                {errores[i] && <p className="text-xs text-destructive">{errores[i]}</p>}
              </div>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={() =>
              setLista((l) => [
                ...l,
                { hasta: String(tope + 5), calificacion: "", descripcion: "" },
              ])
            }
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-primary hover:bg-primary-soft"
          >
            <Plus className="size-3.5" />
            Agregar tramo
          </button>

          {cortaUsadas && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <Lock className="mt-px size-3 shrink-0" />
              Hay evaluaciones con la escala {maxUsada}: el último tramo tiene que llegar a{" "}
              {maxUsada} o más.
            </p>
          )}

          <button
            type="submit"
            disabled={guardar.isPending || !listo}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Guardar la escala
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Una fila (el modal 86)                                                     */
/* -------------------------------------------------------------------------- */

function EditorFila({
  fila,
  filas,
  largoCal,
  largoDes,
  onCerrar,
}: {
  fila: FilaEscala | null;
  filas: FilaEscala[];
  largoCal: number;
  largoDes: number;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nueva = fila == null;
  const puedeGuardar = puedeRuta(RUTA, nueva ? "insertar" : "actualizar");
  const puedeBorrar = !nueva && puedeRuta(RUTA, "borrar");

  const siguiente = Math.max(-1, ...filas.map((f) => f.escala ?? -1)) + 1;
  const inicial = {
    escala: String(fila?.escala ?? siguiente),
    calificacion: fila?.calificacion ?? "",
    descripcion: fila?.descripcion ?? "",
  };
  const [escala, setEscala] = useState(inicial.escala);
  const [calificacion, setCalificacion] = useState(inicial.calificacion);
  const [descripcion, setDescripcion] = useState(inicial.descripcion);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const n = Number(escala);
  const valida = /^\d+$/.test(escala.trim());
  const enUso = !!fila?.usos;
  const repetida = valida ? filas.find((f) => f.id !== fila?.id && f.escala === n) : undefined;
  const cal = calificacion.trim().replace(/\s+/g, " ");
  const sinCambios =
    !nueva &&
    escala === inicial.escala &&
    cal === inicial.calificacion.trim() &&
    descripcion.trim() === inicial.descripcion.trim();
  const listo = puedeGuardar && valida && !!cal && !repetida && !sinCambios;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysEscala.todo });

  const guardar = useMutation({
    mutationFn: () =>
      guardarFilaEscala(fila?.id ?? null, {
        escala: n,
        calificacion: cal,
        descripcion: descripcion.trim(),
      }),
    onSuccess: () => {
      invalidar();
      toast.success(nueva ? `Escala ${n} agregada` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarFilaEscala(fila!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`Escala ${fila!.escala ?? ""} eliminada`);
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
            {nueva ? "Nueva fila" : `Escala ${fila.escala ?? "sin número"}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {enUso
              ? `La usan ${fila!.usos} ${fila!.usos === 1 ? "evaluación" : "evaluaciones"}.`
              : "Para cambiar un tramo entero, mejor “Editar tramos”."}
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
            <div className="grid grid-cols-[6rem_1fr] gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">
                  Escala <span className="text-destructive">*</span>
                </span>
                <input
                  value={escala}
                  onChange={(e) => setEscala(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  disabled={enUso}
                  autoComplete="off"
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-base font-semibold tabular-nums outline-none focus:border-primary/40 disabled:opacity-60 lg:text-sm"
                />
              </label>
              <Texto
                etiqueta="Calificación"
                req
                largo={largoCal}
                valor={calificacion}
                onCambio={setCalificacion}
              />
            </div>
            {repetida && <p className="-mt-2 text-xs text-destructive">La {n} ya está cargada.</p>}
            {enUso && (
              <p className="-mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                <Lock className="mt-px size-3 shrink-0" />
                El número no se cambia: hay evaluaciones con esta escala.
              </p>
            )}
            <Texto
              etiqueta="Descripción"
              multilinea
              largo={largoDes}
              valor={descripcion}
              onCambio={setDescripcion}
            />
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nueva ? "agregar" : "modificar"} la escala.`}
            />
          )}

          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar: hay evaluaciones con esta escala.
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
