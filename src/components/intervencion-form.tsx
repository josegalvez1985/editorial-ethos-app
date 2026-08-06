/**
 * El formulario de carga manual de una intervención. Alta y edición.
 *
 * ============================================================================
 * LA POSTULACIÓN ES EL EJE, NO UN CAMPO MÁS
 * ============================================================================
 *
 * Facilitador → Institución → Postulación, en cascada. De la postulación elegida
 * salen **seis campos** que el formulario no pide: institución, facilitador,
 * turno, grado, sección y énfasis. Los deriva el backend a partir del
 * `id_postulacion`.
 *
 * Es lo que hace imposible guardar una intervención cuya institución no sea la
 * de su propia clase. Si se pidieran por separado, esa inconsistencia sería un
 * descuido a un clic de distancia.
 *
 * ============================================================================
 * FECHA Y HORA SON OBLIGATORIAS, Y NO ES UN CAPRICHO
 * ============================================================================
 *
 * `TRG_INTERVENCIONES_SET_FECHA` completa `FECHA_HORA` con la de hoy si llega
 * vacía. Para una intervención atrasada eso es doblemente malo: la pone en el
 * día equivocado **y** la mete en el mes equivocado de los gráficos.
 *
 * La HORA además es la que alimenta el gráfico de puntualidad: se compara contra
 * el horario de la clase para calcular el desvío. Sin hora real ese número sería
 * inventado.
 *
 * ============================================================================
 * LA UBICACIÓN ES OPT-IN, Y AVISA
 * ============================================================================
 *
 * `navigator.geolocation` devuelve dónde estás **ahora**. En una carga atrasada
 * eso es la oficina, no la escuela de hace dos semanas — y guardarlo así crearía
 * una infracción de ubicación que nunca ocurrió.
 *
 * Por eso: el botón la captura, se muestra a qué distancia de la institución
 * quedó, y se puede descartar. Sin coordenadas se guarda '0'/'0', que el backend
 * lee como "no se sabe" y no cuenta como infracción.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Crosshair, Loader2, MapPin, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PickerModal } from "@/components/picker-modal";
import { PostulacionPicker } from "@/components/postulacion-picker";
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
import { lista, nombreTurno, STALE_LISTAS, type Postulacion } from "@/lib/evaluaciones";
import {
  actualizarIntervencion,
  crearIntervencion,
  ddmmyyyyAIso,
  distanciaMetros,
  eliminarIntervencion,
  isoADdmmyyyy,
  listarManuales,
  ubicacionActual,
  type IntervencionCrud,
  type IntervencionInput,
} from "@/lib/intervenciones-crud";
import { formatearDistancia } from "@/lib/intervenciones";

/** El estado del formulario. Todo texto: es lo que dan los inputs. */
type Estado = {
  id_facilitador: number | null;
  nombre_facilitador: string;
  id_institucion: number | null;
  nombre_institucion: string;
  id_postulacion: number | null;
  /** La postulación elegida, para mostrar grado/turno y proponer el índice. */
  postulacion: Postulacion | null;
  /**
   * El manual elegido A MANO. Vacío = se usa el que propone la postulación.
   *
   * Existe porque una postulación sin intervenciones previas no propone ninguno,
   * y sin manual no se puede listar los índices. Ver la nota del componente.
   */
  manual: string;
  id_indice: number | null;
  indice_texto: string;
  si_no: "Si" | "No";
  /** `YYYY-MM-DD`, que es lo que da un `<input type="date">`. */
  fecha: string;
  /** `HH:MM`. */
  hora: string;
  motivo_desarrollo: string;
  observacion: string;
  latitud: string;
  longitud: string;
};

/** Hoy en `YYYY-MM-DD`, armado a mano para no depender del locale. */
function hoyIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function estadoInicial(previa?: IntervencionCrud): Estado {
  return {
    id_facilitador: previa?.id_facilitador ?? null,
    nombre_facilitador: previa?.nombre_facilitador ?? "",
    id_institucion: previa?.id_institucion ?? null,
    nombre_institucion: previa?.institucion ?? "",
    id_postulacion: previa?.id_postulacion ?? null,
    postulacion: null,
    // Al editar se precarga el manual guardado: la postulación puede proponer
    // otro distinto (el siguiente), y eso cambiaría el índice ya elegido.
    manual: previa?.manual ?? "",
    id_indice: previa?.id_indice ?? null,
    indice_texto: previa
      ? `${previa.nro_indice != null ? `${previa.nro_indice}. ` : ""}${previa.indice_titulo ?? ""}`
      : "",
    si_no: (previa?.si_no.toUpperCase() === "NO" ? "No" : "Si") as "Si" | "No",
    fecha: previa?.fecha ? ddmmyyyyAIso(previa.fecha) : hoyIso(),
    hora: previa?.hora ?? "",
    motivo_desarrollo: previa?.motivo_desarrollo ?? "",
    observacion: previa?.observacion ?? "",
    // (0,0) es "sin ubicación": se muestra vacío para no invitar a conservarlo.
    latitud: previa?.latitud && previa.latitud !== "0" ? previa.latitud : "",
    longitud: previa?.longitud && previa.longitud !== "0" ? previa.longitud : "",
  };
}

export function IntervencionForm({ previa }: { previa?: IntervencionCrud }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editando = previa != null;

  const [e, setE] = useState<Estado>(() => estadoInicial(previa));
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [ubicando, setUbicando] = useState(false);

  const set = <K extends keyof Estado>(k: K, v: Estado[K]) =>
    setE((prev) => ({ ...prev, [k]: v }));

  /*
   * ── EL MANUAL: DE DÓNDE SALE Y POR QUÉ HAY UN SELECTOR ──────────────────
   *
   * Los índices se piden de UN manual y no de todos: cada manual tiene ~15
   * índices y la lista completa pasa los cien, sin forma de saber cuál
   * corresponde a la clase.
   *
   * La postulación PROPONE el manual, pero solo cuando ya viene desarrollando
   * uno: `p.manual` sale del índice siguiente, que el backend calcula a partir
   * de la última intervención con 'Si'. **Una postulación sin ninguna
   * intervención cargada no propone nada** (el caso `SIN_INICIAR`), y eso en
   * carga atrasada es lo habitual — es justamente la clase que nadie registró.
   *
   * Por eso el manual se puede elegir a mano. `manualManual` (valga) pisa a la
   * propuesta cuando el usuario elige uno: si no, cambiar de manual sería
   * imposible una vez que la postulación propuso el suyo.
   */
  const manualPropuesto = e.postulacion?.manual ?? previa?.manual ?? null;
  const manual = e.manual || manualPropuesto;

  // Devuelve STRINGS, no `Opcion`: el identificador de un manual es su propio
  // texto porque no hay tabla de manuales. Ver `listarManuales`.
  const { data: manuales } = useQuery({
    queryKey: ["manuales"],
    queryFn: listarManuales,
    staleTime: STALE_LISTAS,
  });

  const { data: indices } = useQuery({
    queryKey: ["indices", manual],
    queryFn: () => lista("indices", { manual: manual! }),
    enabled: manual != null,
    staleTime: STALE_LISTAS,
  });

  /* ---------------------------------------------------------------------- */
  /* Ubicación                                                              */
  /* ---------------------------------------------------------------------- */

  async function capturarUbicacion() {
    setUbicando(true);
    try {
      const c = await ubicacionActual();
      setE((prev) => ({ ...prev, latitud: c.latitud, longitud: c.longitud }));
    } catch (err) {
      // El mensaje ya viene escrito para mostrar: ver `ubicacionActual`.
      toast.error(err instanceof Error ? err.message : "No se pudo obtener la ubicación.");
    } finally {
      setUbicando(false);
    }
  }

  /*
   * A qué distancia de la institución quedó lo capturado.
   *
   * Es LA advertencia que evita cargar una infracción falsa: si estás en la
   * oficina y la escuela está a 30 km, esto lo dice antes de guardar.
   *
   * Las coordenadas de referencia salen de la postulación cuando la trae; si no
   * hay con qué comparar, no se muestra nada en vez de un número sin sentido.
   */
  const distancia =
    e.latitud && e.longitud
      ? distanciaMetros(
          Number(e.latitud),
          Number(e.longitud),
          previa?.latitud ? Number(previa.latitud) : null,
          previa?.longitud ? Number(previa.longitud) : null,
        )
      : null;

  /* ---------------------------------------------------------------------- */
  /* Guardar                                                                */
  /* ---------------------------------------------------------------------- */

  const guardar = useMutation({
    mutationFn: async () => {
      const input: IntervencionInput = {
        id_postulacion: e.id_postulacion!,
        id_indice: e.id_indice!,
        si_no: e.si_no,
        fecha_hora: `${isoADdmmyyyy(e.fecha)} ${e.hora}`,
        // El motivo solo viaja con 'No'. Con 'Si' un trigger lo borra igual,
        // pero mandarlo sería decirle a la base algo que no va a respetar.
        motivo_desarrollo: e.si_no === "No" ? e.motivo_desarrollo.trim() : undefined,
        observacion: e.observacion.trim() || undefined,
        latitud: e.latitud || undefined,
        longitud: e.longitud || undefined,
      };
      return editando
        ? actualizarIntervencion(previa!.id_intervencion, input)
        : crearIntervencion(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intervenciones-crud"] });
      // También los gráficos del inicio: acaban de cambiar los datos que leen.
      qc.invalidateQueries({ queryKey: ["intervenciones"] });
      qc.invalidateQueries({ queryKey: ["intervenciones-por-dia"] });
      toast.success(editando ? "Intervención actualizada" : "Intervención registrada");
      navigate({ to: "/intervenciones" });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarIntervencion(previa!.id_intervencion),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["intervenciones-crud"] });
      qc.invalidateQueries({ queryKey: ["intervenciones"] });
      qc.invalidateQueries({ queryKey: ["intervenciones-por-dia"] });

      // El borrado NO reabre la postulación: no hay trigger inverso. Se avisa
      // en vez de dejar el estado mal en silencio. Ver `eliminarIntervencion`.
      if (r.postulacion_finalizada) {
        toast.warning(
          `Intervención eliminada. OJO: la postulación #${r.id_postulacion} sigue marcada como "Finalizado" — revisala si corresponde.`,
          { duration: 12_000 },
        );
      } else {
        toast.success("Intervención eliminada");
      }
      navigate({ to: "/intervenciones" });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
  });

  /* ---------------------------------------------------------------------- */
  /* Validación                                                             */
  /* ---------------------------------------------------------------------- */

  /*
   * Se valida acá lo mismo que valida el backend, para no gastar un viaje de red
   * en decir lo obvio. El backend NO confía en esto: vuelve a validar todo.
   */
  const falta: string | null =
    e.id_postulacion == null
      ? "Elegí la postulación"
      : e.id_indice == null
        ? "Elegí el índice"
        : !e.fecha
          ? "Falta la fecha"
          : !e.hora
            ? "Falta la hora"
            : e.si_no === "No" && !e.motivo_desarrollo.trim()
              ? "Con 'No' el motivo es obligatorio"
              : null;

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <div className="space-y-5 pb-28">
      {/* ── Quién y dónde ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <PickerModal
          label="Facilitador"
          nombre="facilitadores"
          value={e.id_facilitador}
          valueText={e.nombre_facilitador}
          incluirId={previa?.id_facilitador ?? null}
          requerido
          onChange={(o) =>
            setE((prev) => ({
              ...prev,
              id_facilitador: o.id,
              nombre_facilitador: o.texto,
              // Cambiar de facilitador invalida todo lo que colgaba de él. Sin
              // esto quedaría una postulación de otra persona seleccionada.
              id_institucion: null,
              nombre_institucion: "",
              id_postulacion: null,
              postulacion: null,
              id_indice: null,
              indice_texto: "",
            }))
          }
        />

        <PickerModal
          label="Institución"
          nombre="instituciones"
          value={e.id_institucion}
          valueText={e.nombre_institucion}
          idFacilitador={e.id_facilitador}
          incluirId={previa?.id_institucion ?? null}
          requerido
          disabledReason={e.id_facilitador == null ? "Elegí primero el facilitador" : undefined}
          onChange={(o) =>
            setE((prev) => ({
              ...prev,
              id_institucion: o.id,
              nombre_institucion: o.texto,
              id_postulacion: null,
              postulacion: null,
              id_indice: null,
              indice_texto: "",
            }))
          }
        />

        {/*
          `todosPorDefecto`: en carga atrasada el filtro "clases de hoy" no sirve
          por definición — se está cargando una clase de la semana pasada.
        */}
        <PostulacionPicker
          idFacilitador={e.id_facilitador}
          idInstitucion={e.id_institucion}
          value={e.id_postulacion}
          todosPorDefecto
          onChange={(p) =>
            setE((prev) => ({
              ...prev,
              id_postulacion: p?.id_postulacion ?? null,
              postulacion: p,
              // El índice que propone la postulación: es el que le toca a esa
              // clase según lo ya desarrollado. Se puede cambiar abajo.
              id_indice: p?.id_indice ?? prev.id_indice,
              indice_texto:
                p?.indice_titulo != null
                  ? `${p.nro_indice != null ? `${p.nro_indice}. ` : ""}${p.indice_titulo}`
                  : prev.indice_texto,
            }))
          }
        />

        {/* Lo que se deriva de la postulación, a la vista: son campos que se van
            a guardar y que el formulario no pide. */}
        {e.postulacion && (
          <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            Se guarda con{" "}
            <span className="font-medium text-foreground">
              {[
                e.postulacion.grado,
                e.postulacion.seccion && `Sec. ${e.postulacion.seccion}`,
                nombreTurno(e.postulacion.turno),
                e.postulacion.enfasis,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        )}
      </section>

      {/* ── Qué se dio ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        {/*
          EL MANUAL, ANTES DEL ÍNDICE. Es la cascada Manual → Índice.

          Se muestra siempre, no solo cuando falta: la postulación propone uno
          pero puede no ser el correcto —o no proponer ninguno, si es la primera
          intervención que se le carga—, y en los dos casos hay que poder elegir.
        */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Manual <span className="text-destructive">*</span>
          </label>
          <select
            value={manual ?? ""}
            onChange={(ev) =>
              setE((prev) => ({
                ...prev,
                manual: ev.target.value,
                // Cambiar de manual invalida el índice: los de un manual no
                // existen en otro, y quedaría uno de otro manual guardado.
                id_indice: null,
                indice_texto: "",
              }))
            }
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
          >
            <option value="">Elegí el manual…</option>
            {manuales?.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {/* De dónde salió, cuando lo propuso la postulación: sin esto el campo
              aparece lleno y no se sabe si lo eligió alguien o vino solo. */}
          {manualPropuesto && !e.manual && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Propuesto por la postulación · es el que viene desarrollando
            </p>
          )}
        </div>

        <PickerModal
          label="Índice"
          // Tal cual vienen: `lista()` ya devuelve `Opcion`, con el `busqueda`
          // que el modal usa para filtrar en memoria.
          opciones={indices ?? []}
          value={e.id_indice}
          valueText={e.indice_texto}
          requerido
          disabledReason={!manual ? "Elegí primero el manual" : undefined}
          onChange={(o) =>
            setE((prev) => ({ ...prev, id_indice: o.id, indice_texto: o.texto }))
          }
        />

        {/* ¿Se desarrolló? Dos botones y no un select: son dos opciones y el
            valor cambia qué campos siguen siendo obligatorios. */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">¿Se desarrolló?</label>
          <div className="grid grid-cols-2 gap-2">
            {(["Si", "No"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => set("si_no", v)}
                className={`h-11 rounded-xl border text-sm font-semibold transition-colors ${
                  e.si_no === v
                    ? v === "Si"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-destructive bg-destructive text-white"
                    : "border-input bg-card text-muted-foreground"
                }`}
              >
                {v === "Si" ? "Sí, se desarrolló" : "No se desarrolló"}
              </button>
            ))}
          </div>
        </div>

        {/*
          El motivo aparece SOLO con 'No', y ahí es obligatorio: lo exige
          TRG_INTERV_SINO_MOTIVO con un RAISE_APPLICATION_ERROR. Con 'Si' el
          trigger lo borra, así que mostrarlo sería ofrecer escribir algo que se
          va a descartar.
        */}
        {e.si_no === "No" && (
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Motivo <span className="text-destructive">*</span>
            </label>
            <textarea
              value={e.motivo_desarrollo}
              onChange={(ev) => set("motivo_desarrollo", ev.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Por qué no se desarrolló la clase"
              className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary/40"
            />
          </div>
        )}
      </section>

      {/* ── Cuándo ───────────────────────────────────────────────────── */}
      <section>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Fecha <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              value={e.fecha}
              onChange={(ev) => set("fecha", ev.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Hora <span className="text-destructive">*</span>
            </label>
            <input
              type="time"
              value={e.hora}
              onChange={(ev) => set("hora", ev.target.value)}
              className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-primary/40"
            />
          </div>
        </div>
        {/* Por qué la hora importa: sin esto se completa cualquier cosa y el
            gráfico de puntualidad queda con datos inventados. */}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          La hora es la que se marcó, no la de la clase: de ahí sale el atraso.
        </p>
      </section>

      {/* ── Ubicación ────────────────────────────────────────────────── */}
      <section>
        <label className="mb-1.5 block text-sm font-medium">Ubicación</label>
        <button
          type="button"
          onClick={capturarUbicacion}
          disabled={ubicando}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-input bg-card text-sm font-medium disabled:opacity-60"
        >
          {ubicando ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          {ubicando ? "Buscando…" : e.latitud ? "Actualizar ubicación" : "Usar mi ubicación"}
        </button>

        {e.latitud && e.longitud ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] break-all">
                {e.latitud}, {e.longitud}
              </p>
              {distancia != null && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  A {formatearDistancia(distancia)} de la ubicación anterior
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setE((prev) => ({ ...prev, latitud: "", longitud: "" }))}
              aria-label="Descartar ubicación"
              className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          /*
            LA ADVERTENCIA QUE EVITA UNA INFRACCIÓN FALSA. El GPS dice dónde
            estás AHORA; en una carga atrasada eso no es donde estuvo el
            facilitador ese día.
          */
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Sin ubicación se guarda como <span className="font-medium">no registrada</span>, y
              no cuenta en el gráfico de ubicación. Usá el botón solo si estás en la institución:
              tu posición actual no es donde se dio la clase.
            </p>
          </div>
        )}
      </section>

      {/* ── Observación ──────────────────────────────────────────────── */}
      <section>
        <label className="mb-1.5 block text-sm font-medium">Observación</label>
        <textarea
          value={e.observacion}
          onChange={(ev) => set("observacion", ev.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Opcional"
          className="w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm outline-none focus:border-primary/40"
        />
      </section>

      {/* ── Acciones ─────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-card/95 p-4 backdrop-blur md:relative md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-2xl gap-2">
          {editando && (
            <button
              type="button"
              onClick={() => setConfirmarBorrado(true)}
              disabled={ocupado}
              aria-label="Eliminar"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-destructive/40 text-destructive disabled:opacity-60"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => guardar.mutate()}
            disabled={ocupado || falta != null}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {/* El botón dice QUÉ FALTA en vez de solo estar gris: si no, no hay
                forma de saber por qué no se puede guardar. */}
            {falta ?? (editando ? "Guardar cambios" : "Registrar intervención")}
          </button>
        </div>
      </div>

      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta intervención?</AlertDialogTitle>
            <AlertDialogDescription>
              No se puede deshacer. Si esta intervención había finalizado su postulación, esa
              postulación va a seguir marcada como «Finalizado» y hay que revisarla a mano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => borrar.mutate()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
