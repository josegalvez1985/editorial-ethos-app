import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, Copy, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { Pastillas, Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nombreTurno } from "@/lib/evaluaciones";
import {
  aHora,
  copiarHorario,
  duracion,
  eliminarBloque,
  guardarBloque,
  keysHorario,
  listarHorario,
  minutos,
  opcionesHorario,
  seSuperponen,
  textoDuracion,
  type BloqueHorario,
} from "@/lib/horario-instituciones";
import { keysInstituciones } from "@/lib/instituciones";
import { usePermisos } from "@/lib/permisos";
import type { ValorLista } from "@/lib/utils";

/**
 * La pestaña Horario de la ficha de una institución: el modal 33 de APEX
 * (Horarios), que se abría con el botón "Horario IE" del 21.
 *
 * Distinto de APEX:
 *
 * - **Por año.** El modal mostraba los bloques de todos los años mezclados,
 *   aunque el PDF de postulaciones imprime solo los del año elegido. Acá se
 *   elige el año en pastillas y arranca en el lectivo actual.
 * - **Agrupado por turno**, en orden de hora, con lo que dura cada bloque y el
 *   total del turno. Un bloque que se pisa con otro del mismo turno se marca.
 * - **Copiar el horario de otro año** cuando el actual está vacío: en APEX era
 *   volver a cargarlo a mano, bloque por bloque.
 * - **El "+" de cada turno propone el siguiente bloque**: empieza donde
 *   terminó el último y dura lo mismo. Cargar un horario es casi solo "Agregar".
 *
 * Lo usa también la página 31 (`/horarios-instituciones`), en un diálogo, con
 * `anioInicial` = el año que se estaba mirando allá.
 */
export function HorarioInstitucion({
  idInstitucion,
  anioInicial,
}: {
  idInstitucion: number;
  /** El año con que abre, si la institución lo tiene (o es el actual). */
  anioInicial?: string;
}) {
  const qc = useQueryClient();
  const puede = usePuede();
  const horario = useQuery({
    queryKey: keysHorario.institucion(idInstitucion),
    queryFn: () => listarHorario(idInstitucion),
  });
  const opciones = useQuery({
    queryKey: keysHorario.opciones,
    queryFn: opcionesHorario,
    staleTime: 10 * 60 * 1000,
  });
  const [anio, setAnio] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<{
    bloque: BloqueHorario | null;
    propuesta?: Propuesta;
  } | null>(null);

  const bloques = horario.data?.bloques ?? [];
  const actual = horario.data?.anioActual ?? "";
  // Los años con bloques, más el actual aunque esté vacío. "" = sin año, al final.
  const anios = [...new Set([...(actual ? [actual] : []), ...bloques.map((b) => b.anio)])].sort(
    (a, b) => (a === "" ? 1 : b === "" ? -1 : b.localeCompare(a)),
  );
  const inicial = anioInicial != null && anios.includes(anioInicial) ? anioInicial : undefined;
  const elegido = anio ?? inicial ?? (actual || anios[0] || "");
  const delAnio = bloques.filter((b) => b.anio === elegido);
  const turnos = [...new Set(delAnio.map((b) => b.turno))].sort((a, b) => a - b);
  const listaTurnos = opciones.data?.turno ?? [];
  const nombre = (t: number) =>
    listaTurnos.find((o) => o.valor === String(t))?.mostrar ?? nombreTurno(t) ?? `Turno ${t}`;

  // De dónde copiar si el año actual está vacío: el año más reciente con bloques.
  const origen =
    elegido === actual && !delAnio.length ? anios.find((a) => a !== actual) : undefined;
  const cuantosOrigen = origen != null ? bloques.filter((b) => b.anio === origen).length : 0;

  const copiar = useMutation({
    mutationFn: () => copiarHorario(idInstitucion, origen ?? ""),
    onSuccess: (n) => {
      // `todo`: también la vista de todas las instituciones (la 31).
      qc.invalidateQueries({ queryKey: keysHorario.todo });
      qc.invalidateQueries({ queryKey: keysInstituciones.lista });
      toast.success(`${n} ${n === 1 ? "bloque copiado" : "bloques copiados"} a ${actual}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo copiar"),
  });

  if (horario.isLoading || opciones.isLoading) return <Cargando />;
  if (horario.isError || opciones.isError)
    return <Fallo error={horario.error ?? opciones.error} texto="No se pudo cargar el horario" />;

  // Agregar en "sin año" lo mandaría al actual (lo completa el trigger): no se ofrece.
  const puedeAgregar = puede.insertar && elegido !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {anios.length > 1 ? (
          <div role="tablist" aria-label="Año del horario" className="flex flex-wrap gap-2">
            {anios.map((a) => (
              <button
                key={a || "sin"}
                type="button"
                role="tab"
                aria-selected={elegido === a}
                onClick={() => setAnio(a)}
                className={`tap h-9 rounded-full border px-3.5 text-[13px] font-semibold ${
                  elegido === a
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {a || "Sin año"}
                {a === actual && a !== "" && <span className="ml-1 opacity-70">· actual</span>}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {elegido ? `Horario ${elegido}` : "No hay un año lectivo activo."}
          </p>
        )}
        {puedeAgregar && delAnio.length > 0 && (
          <button
            type="button"
            onClick={() => setAbierto({ bloque: null })}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            <Plus className="size-4" />
            Agregar bloque
          </button>
        )}
      </div>

      {!delAnio.length ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
          <Clock className="mx-auto size-9 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">
            {elegido
              ? `Todavía no hay horario cargado para ${elegido}.`
              : "No hay bloques sin año."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {puede.insertar && origen != null && cuantosOrigen > 0 && (
              <button
                type="button"
                onClick={() => copiar.mutate()}
                disabled={copiar.isPending}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
              >
                {copiar.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
                Copiar el de {origen || "sin año"} ({cuantosOrigen}{" "}
                {cuantosOrigen === 1 ? "bloque" : "bloques"})
              </button>
            )}
            {puedeAgregar && (
              <button
                type="button"
                onClick={() => setAbierto({ bloque: null })}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-4 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar a mano
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {turnos.map((t) => {
            const filas = delAnio
              .filter((b) => b.turno === t)
              .sort((a, b) => a.inicio.localeCompare(b.inicio));
            const total = filas.reduce((acc, b) => acc + duracion(b), 0);
            const ultimo = filas[filas.length - 1];
            return (
              <section
                key={t}
                className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold">{nombre(t)}</h3>
                    <p className="text-[11.5px] text-muted-foreground">
                      {filas.length} {filas.length === 1 ? "bloque" : "bloques"} ·{" "}
                      {textoDuracion(total)}
                    </p>
                  </div>
                  {puedeAgregar && (
                    <button
                      type="button"
                      aria-label={`Agregar bloque a la ${nombre(t).toLowerCase()}`}
                      onClick={() => setAbierto({ bloque: null, propuesta: siguiente(t, ultimo) })}
                      className="grid size-10 shrink-0 place-items-center rounded-xl border border-dashed border-border text-primary hover:border-primary/40"
                    >
                      <Plus className="size-4" />
                    </button>
                  )}
                </div>
                <ol className="space-y-1.5">
                  {filas.map((b) => {
                    const pisa = filas.find((o) => o.id !== b.id && seSuperponen(o, b));
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => setAbierto({ bloque: b })}
                          className="tap flex w-full items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 text-left hover:border-primary/40"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold tabular-nums">
                              {b.inicio} – {b.fin}
                            </span>
                            {b.observacion && (
                              <span className="block text-[12px] text-muted-foreground">
                                {b.observacion}
                              </span>
                            )}
                            {pisa && (
                              <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="size-3 shrink-0" />
                                Se pisa con {pisa.inicio} – {pisa.fin}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
                            {textoDuracion(duracion(b))}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}

      {abierto && (
        <EditorBloque
          key={abierto.bloque?.id ?? "nuevo"}
          idInstitucion={idInstitucion}
          bloque={abierto.bloque}
          propuesta={abierto.propuesta}
          anio={elegido}
          anioActual={actual}
          turnos={listaTurnos}
          otros={delAnio}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

function usePuede() {
  const { puedeRuta } = usePermisos();
  // Modificar la institución alcanza: el modal 33 colgaba del 21.
  const ficha = puedeRuta("/instituciones", "actualizar");
  return {
    insertar: ficha || puedeRuta("/horarios-instituciones", "insertar"),
    actualizar: ficha || puedeRuta("/horarios-instituciones", "actualizar"),
    borrar: ficha || puedeRuta("/horarios-instituciones", "borrar"),
  };
}

type Propuesta = { turno: number; inicio: string; fin: string };

/** El bloque que sigue al último de un turno: arranca donde terminó y dura lo mismo. */
function siguiente(turno: number, ultimo?: BloqueHorario): Propuesta {
  if (!ultimo) return { turno, inicio: "", fin: "" };
  const fin = minutos(ultimo.fin);
  const dura = duracion(ultimo);
  if (fin == null) return { turno, inicio: "", fin: "" };
  return { turno, inicio: aHora(fin), fin: dura ? aHora(fin + dura) : "" };
}

function EditorBloque({
  idInstitucion,
  bloque,
  propuesta,
  anio,
  anioActual,
  turnos,
  otros,
  onCerrar,
}: {
  idInstitucion: number;
  bloque: BloqueHorario | null;
  propuesta?: Propuesta;
  /** El año que se está viendo. */
  anio: string;
  anioActual: string;
  turnos: ValorLista[];
  /** Los demás bloques del año, para avisar si se pisan. */
  otros: BloqueHorario[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const puede = usePuede();
  const nuevo = bloque == null;
  const puedeGuardar = nuevo ? puede.insertar : puede.actualizar;
  const puedeBorrar = !nuevo && puede.borrar;

  const [turno, setTurno] = useState(
    String(bloque?.turno ?? propuesta?.turno ?? turnos[0]?.valor ?? ""),
  );
  const [inicio, setInicio] = useState(bloque?.inicio ?? propuesta?.inicio ?? "");
  const [fin, setFin] = useState(bloque?.fin ?? propuesta?.fin ?? "");
  const [observacion, setObservacion] = useState(bloque?.observacion ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const i = minutos(inicio);
  const f = minutos(fin);
  const dura = i != null && f != null ? f - i : null;
  const pisa = otros.find(
    (o) => o.id !== bloque?.id && String(o.turno) === turno && seSuperponen(o, { inicio, fin }),
  );
  const listo = puedeGuardar && !!turno && dura != null && dura > 0;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysHorario.todo });
    qc.invalidateQueries({ queryKey: keysInstituciones.lista });
  };

  const guardar = useMutation({
    mutationFn: () =>
      guardarBloque(bloque?.id ?? null, idInstitucion, {
        turno: Number(turno),
        inicio,
        fin,
        observacion: observacion.trim(),
        // Alta en otro año que el actual: ese año. Si no, lo pone el backend.
        anio: nuevo && anio !== anioActual ? anio : null,
      }),
    onSuccess: () => {
      invalidar();
      toast.success(nuevo ? "Bloque agregado" : "Bloque actualizado");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarBloque(bloque!.id),
    onSuccess: () => {
      invalidar();
      toast.success("Bloque eliminado");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo bloque" : `${bloque?.inicio} – ${bloque?.fin}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {anio ? `Horario ${anio}.` : "Bloque sin año."}
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
            <Pastillas etiqueta="Turno" req opciones={turnos} valor={turno} onCambio={setTurno} />
            <div className="grid grid-cols-2 gap-3">
              <Texto etiqueta="Desde" req tipo="time" valor={inicio} onCambio={setInicio} />
              <Texto etiqueta="Hasta" req tipo="time" valor={fin} onCambio={setFin} />
            </div>
            {dura != null && (
              <p
                className={`text-[12px] ${dura > 0 ? "text-muted-foreground" : "text-destructive"}`}
              >
                {dura > 0
                  ? `Dura ${textoDuracion(dura)}.`
                  : "La hora de fin tiene que ser posterior a la de inicio."}
              </p>
            )}
            {pisa && dura != null && dura > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Se pisa con el bloque {pisa.inicio} – {pisa.fin} del mismo turno. Se puede guardar
                igual.
              </p>
            )}
            <Texto
              etiqueta="Observación"
              largo={2000}
              multilinea
              valor={observacion}
              onCambio={setObservacion}
              placeholder="Ej.: recreo, acto, horario reducido…"
            />
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} el horario.`}
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
                {nuevo ? "Agregar" : "Guardar cambios"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
