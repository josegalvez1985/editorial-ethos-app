import { Loader2, Lock, MapPin } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PickerModal } from "@/components/picker-modal";
import { StarRating } from "@/components/star-rating";
import type { Evaluacion, EvaluacionInput } from "@/lib/evaluaciones";

/* -------------------------------------------------------------------------- */
/* Piezas de layout                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Bloque de campos con título.
 *
 * Se eligió un formulario de scroll único con secciones en vez de un wizard por
 * pasos: son 12 campos y en un wizard el usuario no puede revisar el conjunto
 * antes de guardar ni volver atrás sin perder el hilo.
 */
function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <h2 className="mb-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {titulo}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Campo({
  label,
  requerido,
  hint,
  children,
}: {
  label: string;
  requerido?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {requerido ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const inputCls =
  "h-12 w-full rounded-xl border border-input bg-card px-4 text-base outline-none transition-colors focus:border-primary/40";

/* -------------------------------------------------------------------------- */
/* Estado inicial                                                             */
/* -------------------------------------------------------------------------- */

const hoy = () => new Date().toISOString().slice(0, 10);

function desdeEvaluacion(e?: Evaluacion): EvaluacionInput {
  return {
    id_facilitador: e?.id_facilitador ?? null,
    id_institucion: e?.id_institucion ?? null,
    id_ciudad: e?.id_ciudad ?? null,
    fecha_desde: e?.fecha_desde ?? hoy(),
    fecha_hasta: e?.fecha_hasta ?? hoy(),
    evaluado_por: e?.evaluado_por ?? "",
    id_area: e?.id_area ?? null,
    id_evaluacion: e?.id_evaluacion ?? null,
    calificacion_estrellas: e?.calificacion_estrellas ?? null,
    aspectos_positivos: e?.aspectos_positivos ?? "",
    aspectos_mejorar: e?.aspectos_mejorar ?? "",
    calificacion: e?.calificacion ?? "",
  };
}

/**
 * Mismas reglas que valida el paquete PL/SQL, para no gastar un viaje al
 * servidor en un error que ya se sabe. El backend igual las revalida: esto es
 * comodidad, no seguridad.
 */
function validar(v: EvaluacionInput): string | null {
  if (!v.id_facilitador) return "Elegí el facilitador";
  if (!v.id_institucion) return "Elegí la institución";
  if (!v.id_ciudad) return "Elegí la ciudad";
  if (!v.fecha_desde || !v.fecha_hasta) return "Completá las dos fechas";
  if (v.fecha_hasta < v.fecha_desde) return "La fecha hasta no puede ser anterior a la desde";
  if (!v.evaluado_por.trim()) return "Indicá quién evaluó";
  if (!v.id_area) return "Elegí el área";
  if (!v.id_evaluacion) return "Elegí la evaluación";
  return null;
}

/* -------------------------------------------------------------------------- */
/* Formulario                                                                 */
/* -------------------------------------------------------------------------- */

export function EvaluacionForm({
  inicial,
  guardando,
  onSubmit,
  textoBoton,
}: {
  inicial?: Evaluacion;
  guardando: boolean;
  onSubmit: (v: EvaluacionInput) => void;
  textoBoton: string;
}) {
  const [v, setV] = useState<EvaluacionInput>(() => desdeEvaluacion(inicial));
  const [error, setError] = useState<string | null>(null);

  // Textos de los combos ya elegidos, para no tener que abrir la hoja al editar.
  const [textos, setTextos] = useState({
    facilitador: inicial?.facilitador ?? null,
    institucion: inicial?.institucion ?? null,
    ciudad: inicial?.ciudad ?? null,
    area: inicial?.area ?? null,
    evaluacion: inicial?.evaluacion ?? null,
  });

  const set = <K extends keyof EvaluacionInput>(k: K, valor: EvaluacionInput[K]) =>
    setV((prev) => ({ ...prev, [k]: valor }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problema = validar(v);
    setError(problema);
    if (!problema) onSubmit(v);
  };

  return (
    // pb-32: hueco para el footer fijo del botón guardar
    <form onSubmit={submit} className="space-y-4 px-5 pt-5 pb-32">
      <Seccion titulo="Quién y dónde">
        <PickerModal
          label="Facilitador"
          nombre="facilitadores"
          requerido
          value={v.id_facilitador}
          valueText={textos.facilitador}
          // incluirId: si se dio de baja después de crearse la evaluación, el
          // combo por defecto no lo traería y el campo quedaría vacío.
          incluirId={inicial?.id_facilitador}
          onChange={(o) => {
            const cambio = o.id !== v.id_facilitador;
            set("id_facilitador", o.id);
            setTextos((t) => ({ ...t, facilitador: o.texto }));
            // Cambiar de facilitador cambia la lista de instituciones: la que
            // estaba elegida puede no ser suya. Se limpia junto con la ciudad,
            // que se deriva de ella.
            if (cambio) {
              set("id_institucion", null);
              set("id_ciudad", null);
              setTextos((t) => ({ ...t, institucion: null, ciudad: null }));
            }
          }}
        />

        <PickerModal
          label="Institución"
          nombre="instituciones"
          requerido
          value={v.id_institucion}
          valueText={textos.institucion}
          incluirId={inicial?.id_institucion}
          // Solo las instituciones donde este facilitador tiene postulaciones.
          idFacilitador={v.id_facilitador}
          disabledReason={v.id_facilitador ? undefined : "Elegí primero el facilitador"}
          onChange={(o) => {
            set("id_institucion", o.id);
            setTextos((t) => ({ ...t, institucion: o.texto }));
            // La ciudad viene con la institución: se carga sola.
            // `undefined` = la lista no la trajo; `null` = la institución no
            // tiene ciudad asignada. En los dos casos hay que pedirla a mano.
            set("id_ciudad", o.idCiudad ?? null);
            setTextos((t) => ({ ...t, ciudad: o.ciudad ?? null }));
          }}
        />

        {/*
          Ciudad: no se elige, se hereda de la institución. Solo se vuelve
          seleccionable cuando la institución no tiene ciudad cargada, porque en
          EVALUACIONES_FACILITADORES la columna es NOT NULL y sin ella no se
          puede guardar.
        */}
        {v.id_institucion && v.id_ciudad ? (
          <Campo label="Ciudad" hint="Se carga de la institución">
            <div className="flex h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/50 px-4">
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-base font-medium">
                {textos.ciudad ?? `#${v.id_ciudad}`}
              </span>
              <Lock className="size-3.5 shrink-0 text-muted-foreground" />
            </div>
          </Campo>
        ) : (
          <PickerModal
            label="Ciudad"
            nombre="ciudades"
            requerido
            value={v.id_ciudad}
            valueText={textos.ciudad}
            disabledReason={v.id_institucion ? undefined : "Elegí primero la institución"}
            placeholder={
              v.id_institucion ? "La institución no tiene ciudad: elegila" : "Seleccionar"
            }
            onChange={(o) => {
              set("id_ciudad", o.id);
              setTextos((t) => ({ ...t, ciudad: o.texto }));
            }}
          />
        )}
      </Seccion>

      <Seccion titulo="Período">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Desde" requerido>
            {/* input date nativo: abre el selector del sistema operativo, que en
                móvil siempre va a ser mejor que un calendario propio */}
            <input
              type="date"
              required
              value={v.fecha_desde}
              onChange={(e) => set("fecha_desde", e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Hasta" requerido>
            <input
              type="date"
              required
              value={v.fecha_hasta}
              min={v.fecha_desde || undefined}
              onChange={(e) => set("fecha_hasta", e.target.value)}
              className={inputCls}
            />
          </Campo>
        </div>
      </Seccion>

      <Seccion titulo="Qué se evaluó">
        <PickerModal
          label="Área"
          nombre="areas"
          requerido
          value={v.id_area}
          valueText={textos.area}
          onChange={(o) => {
            const cambio = o.id !== v.id_area;
            set("id_area", o.id);
            setTextos((t) => ({ ...t, area: o.texto }));
            // La evaluación pertenece a un área: si cambia el área, la elegida
            // deja de ser válida y el backend responde 400. Se limpia acá.
            if (cambio) {
              set("id_evaluacion", null);
              setTextos((t) => ({ ...t, evaluacion: null }));
            }
          }}
        />

        <PickerModal
          label="Evaluación"
          nombre="evaluaciones"
          requerido
          value={v.id_evaluacion}
          valueText={textos.evaluacion}
          idArea={v.id_area}
          disabledReason={v.id_area ? undefined : "Elegí primero el área"}
          onChange={(o) => {
            set("id_evaluacion", o.id);
            setTextos((t) => ({ ...t, evaluacion: o.texto }));
          }}
        />

        <Campo label="Evaluado por" requerido hint="Nombre de quien hizo la evaluación">
          <input
            type="text"
            required
            maxLength={255}
            value={v.evaluado_por}
            onChange={(e) => set("evaluado_por", e.target.value)}
            placeholder="Nombre y apellido"
            className={inputCls}
          />
        </Campo>
      </Seccion>

      <Seccion titulo="Resultado">
        <Campo label="Calificación en estrellas">
          <StarRating
            value={v.calificacion_estrellas}
            onChange={(n) => set("calificacion_estrellas", n)}
          />
        </Campo>

        <Campo label="Calificación" hint="Texto libre, hasta 100 caracteres">
          <input
            type="text"
            maxLength={100}
            value={v.calificacion}
            onChange={(e) => set("calificacion", e.target.value)}
            placeholder="Muy bueno, A, 9/10…"
            className={inputCls}
          />
        </Campo>

        <Campo label="Aspectos positivos">
          <textarea
            rows={4}
            value={v.aspectos_positivos}
            onChange={(e) => set("aspectos_positivos", e.target.value)}
            placeholder="Qué funcionó bien"
            className="w-full resize-y rounded-xl border border-input bg-card p-4 text-base outline-none transition-colors focus:border-primary/40"
          />
        </Campo>

        <Campo label="Aspectos a mejorar">
          <textarea
            rows={4}
            value={v.aspectos_mejorar}
            onChange={(e) => set("aspectos_mejorar", e.target.value)}
            placeholder="Qué conviene ajustar"
            className="w-full resize-y rounded-xl border border-input bg-card p-4 text-base outline-none transition-colors focus:border-primary/40"
          />
        </Campo>
      </Seccion>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Footer fijo: el botón guardar siempre a la vista, no al final de un
          scroll de 12 campos. */}
      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border/60 pb-safe">
        <div className="mx-auto max-w-[480px] px-5 py-3">
          <button
            type="submit"
            disabled={guardando}
            className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
            {guardando ? "Guardando…" : textoBoton}
          </button>
        </div>
      </div>
    </form>
  );
}
