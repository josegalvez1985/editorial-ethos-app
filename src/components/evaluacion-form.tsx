import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, MapPin, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { PickerModal } from "@/components/picker-modal";
import { PostulacionPicker } from "@/components/postulacion-picker";
import { CalificacionDisplay, StarToggle } from "@/components/star-rating";
import {
  ESCALA_MAXIMA,
  formatearNombre,
  keys,
  lista,
  STALE_LISTAS,
  type Cabecera,
  type Detalle,
  type EvaluacionAgrupada,
  type Opcion,
} from "@/lib/evaluaciones";

/* -------------------------------------------------------------------------- */
/* Piezas de layout                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Bloque de campos con título.
 *
 * Se eligió un formulario de scroll único con secciones en vez de un wizard por
 * pasos: el usuario tiene que poder revisar el conjunto antes de guardar, y con
 * los detalles eso es más cierto todavía — la calificación depende de cuántas
 * estrellas marcó en total, así que necesita verlas juntas.
 */
function Seccion({
  titulo,
  children,
  extra,
}: {
  titulo: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {titulo}
        </h2>
        {extra}
      </div>
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

function cabeceraInicial(e?: EvaluacionAgrupada): Cabecera {
  return {
    id_facilitador: e?.id_facilitador ?? null,
    id_institucion: e?.id_institucion ?? null,
    id_ciudad: e?.id_ciudad ?? null,
    fecha_desde: e?.fecha_desde ?? hoy(),
    fecha_hasta: e?.fecha_hasta ?? hoy(),
    evaluado_por: e?.evaluado_por ?? "",
    aspectos_positivos: e?.aspectos_positivos ?? "",
    aspectos_mejorar: e?.aspectos_mejorar ?? "",
    observacion_admin: e?.observacion_admin ?? "",
    // Una evaluación nueva nace abierta, siempre.
    cerrada: e?.cerrada ?? false,
    // Al editar se recupera la que quedó guardada —sea elegida a mano o deducida
    // por el backend—, así que la tarjeta correspondiente aparece marcada.
    id_postulacion: e?.id_postulacion ?? null,
  };
}

/** Las áreas que ya tiene la evaluación, sin repetir, en orden de aparición. */
function areasIniciales(e?: EvaluacionAgrupada) {
  const vistas = new Map<number, string>();
  for (const d of e?.detalles ?? []) {
    if (!vistas.has(d.id_area)) vistas.set(d.id_area, d.area ?? `Área ${d.id_area}`);
  }
  return [...vistas].map(([id, texto]) => ({ id, texto }));
}

/**
 * Mismas reglas que valida el paquete PL/SQL, más la del modelo de detalle.
 * El backend igual las revalida: esto es comodidad, no seguridad.
 */
function validar(cab: Cabecera): string | null {
  if (!cab.id_facilitador) return "Elegí el facilitador";
  if (!cab.id_institucion) return "Elegí la institución";
  if (!cab.id_ciudad) return "Elegí la ciudad";
  if (!cab.fecha_desde || !cab.fecha_hasta) return "Completá las dos fechas";
  if (cab.fecha_hasta < cab.fecha_desde) return "La fecha hasta no puede ser anterior a la desde";
  if (!cab.evaluado_por.trim()) return "Indicá quién evaluó";
  // NO se exigen áreas. Antes sí: cada fila de la tabla es un detalle y una
  // evaluación sin ítems no podía existir. Desde que ID_AREA e ID_EVALUACION
  // son NULLABLE (04/08/2026) se puede guardar la cabecera e ir a cargar las
  // áreas después, que es cómo se trabaja en la práctica.
  return null;
}

/* -------------------------------------------------------------------------- */
/* Detalle de un área                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Los ítems de evaluación de un área, cada uno con su estrella.
 *
 * Carga la lista del área y le avisa al formulario cuáles son (`onItems`), que es
 * lo que le permite al padre armar los detalles a guardar. La marca vive en el
 * padre, no acá: si viviera acá, quitar y volver a poner un área perdería lo
 * marcado, y el conteo total tendría que ir preguntándole a cada hijo.
 */
function AreaDetalle({
  area,
  items,
  onItems,
  onToggle,
  onQuitar,
}: {
  area: { id: number; texto: string };
  items: Detalle[];
  onItems: (idArea: number, area: string, opciones: Opcion[]) => void;
  onToggle: (idEvaluacion: number, marcada: boolean) => void;
  onQuitar: (idArea: number) => void;
}) {
  const params = { id_area: area.id };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: keys.lista("evaluaciones", params),
    queryFn: () => lista("evaluaciones", params),
    staleTime: STALE_LISTAS,
  });

  useEffect(() => {
    if (data) onItems(area.id, area.texto, data);
  }, [data, area.id, area.texto, onItems]);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm leading-snug font-semibold">{area.texto}</p>
        <button
          type="button"
          onClick={() => onQuitar(area.id)}
          aria-label={`Quitar ${area.texto}`}
          className="tap grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Cargando evaluaciones…
        </div>
      ) : isError ? (
        <p className="py-3 text-xs text-destructive">
          {error instanceof Error ? error.message : "No se pudieron cargar las evaluaciones"}
        </p>
      ) : items.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">
          Esta área no tiene evaluaciones cargadas
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((d) => (
            <li
              key={d.id_evaluacion}
              className="flex items-center gap-2 rounded-lg bg-card px-2 py-1"
            >
              {/* Sin truncate: la descripción de la evaluación puede ser larga y
                  es justo lo que distingue un ítem de otro. */}
              <span className="min-w-0 flex-1 text-[13px] leading-snug">
                {d.evaluacion ?? `#${d.id_evaluacion}`}
              </span>
              <StarToggle
                marcada={d.marcada}
                onChange={(m) => onToggle(d.id_evaluacion, m)}
                etiqueta={d.evaluacion ?? `Evaluación ${d.id_evaluacion}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  inicial?: EvaluacionAgrupada;
  guardando: boolean;
  onSubmit: (cab: Cabecera, detalles: Detalle[]) => void;
  textoBoton: string;
}) {
  const [cab, setCab] = useState<Cabecera>(() => cabeceraInicial(inicial));
  const [areas, setAreas] = useState(() => areasIniciales(inicial));
  const [detalles, setDetalles] = useState<Detalle[]>(() => inicial?.detalles ?? []);
  const [error, setError] = useState<string | null>(null);

  // Textos de los combos ya elegidos, para no tener que abrir la hoja al editar.
  const [textos, setTextos] = useState({
    facilitador: inicial?.facilitador ?? null,
    institucion: inicial?.institucion ?? null,
    ciudad: inicial?.ciudad ?? null,
  });

  /*
   * Cuántas áreas hay en total, para saber cuándo ya se agregaron todas y dejar
   * de ofrecer el botón de sumar.
   *
   * MISMA queryKey que la del PickerModal de áreas (`keys.lista("areas", {...})`
   * con los params en su forma por defecto): react-query comparte la caché entre
   * los dos, así que esto no agrega un request — reusa el que el picker ya hizo,
   * o lo hace una vez y el picker lo aprovecha.
   *
   * Las áreas son pocas y casi no cambian; `STALE_LISTAS` (5 min) evita repetir
   * la consulta mientras se completa el formulario.
   */
  const paramsAreas = {
    buscar: undefined,
    id_area: undefined,
    id_facilitador: undefined,
    incluir_id: undefined,
  };
  const { data: todasLasAreas } = useQuery({
    queryKey: keys.lista("areas", paramsAreas),
    queryFn: () => lista("areas", paramsAreas),
    staleTime: STALE_LISTAS,
  });

  /*
   * No quedan áreas por agregar.
   *
   * Se compara POR ID y no por cantidad: si una evaluación vieja tiene un área
   * que después se dio de baja, esa sigue en `areas` pero ya no viene en la
   * lista, y los dos conteos podrían empatar sin que se hayan agregado todas.
   * Preguntar "¿queda alguna de la lista que no esté agregada?" no tiene ese
   * problema.
   *
   * Mientras la consulta viaja (`todasLasAreas` undefined) esto da `false` y el
   * botón se muestra: es el estado seguro, y evita que parpadee en cada apertura
   * del formulario.
   */
  const sinAreasDisponibles = Boolean(
    todasLasAreas && !todasLasAreas.some((o) => !areas.some((a) => a.id === o.id)),
  );

  const set = <K extends keyof Cabecera>(k: K, valor: Cabecera[K]) =>
    setCab((prev) => ({ ...prev, [k]: valor }));

  /**
   * Fusiona los ítems de un área con lo que ya había.
   *
   * Conserva `id` y `marcada` de los ítems que ya estaban: al editar, eso es lo
   * que evita que la lista recién cargada pise las estrellas guardadas y que un
   * PUT se convierta en un POST duplicado.
   */
  const onItems = useCallback((idArea: number, area: string, opciones: Opcion[]) => {
    setDetalles((prev) => {
      const otras = prev.filter((d) => d.id_area !== idArea);
      const delArea = opciones.map((o): Detalle => {
        const ya = prev.find((d) => d.id_area === idArea && d.id_evaluacion === o.id);
        return ya
          ? { ...ya, area, evaluacion: o.texto }
          : {
              id: null,
              id_area: idArea,
              area,
              id_evaluacion: o.id,
              evaluacion: o.texto,
              marcada: false,
            };
      });
      return [...otras, ...delArea];
    });
  }, []);

  const onToggle = useCallback((idEvaluacion: number, marcada: boolean) => {
    setDetalles((prev) =>
      prev.map((d) => (d.id_evaluacion === idEvaluacion ? { ...d, marcada } : d)),
    );
  }, []);

  const onQuitarArea = useCallback((idArea: number) => {
    setAreas((prev) => prev.filter((a) => a.id !== idArea));
    // Los detalles ya guardados de esta área desaparecen de la lista, y por eso
    // `guardarEvaluacion` los va a borrar: quedan fuera de los ids vigentes.
    setDetalles((prev) => prev.filter((d) => d.id_area !== idArea));
  }, []);

  const marcadas = detalles.filter((d) => d.marcada).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problema = validar(cab);
    setError(problema);
    if (!problema) onSubmit(cab, detalles);
  };

  return (
    // pb-32: hueco para el footer fijo del botón guardar
    <form onSubmit={submit} className="space-y-4 px-5 pt-5 pb-32">
      {/*
        Aviso + reapertura. Va arriba de todo porque explica por qué el resto
        del formulario está deshabilitado: sin esto, los campos grises no se
        entienden.
      */}
      {cab.cerrada && (
        <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/60 p-4">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">Evaluación cerrada</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
              No se puede editar ni eliminar. Reabrila para poder modificarla.
            </p>
          </div>
          {/*
            FUERA del fieldset deshabilitado, a propósito: es el único control
            que tiene que seguir andando con la evaluación cerrada.

            Reabrir NO guarda solo: destilda el campo y deja el formulario
            editable. El cambio viaja recién con "Guardar", que es un PUT con
            ind_cerrado='N' — el único que el backend le acepta a una fila
            cerrada.
          */}
          <button
            type="button"
            onClick={() => set("cerrada", false)}
            className="tap shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Reabrir
          </button>
        </div>
      )}

      {/*
        `fieldset disabled` y no `disabled` en cada input: son más de quince
        controles y basta olvidarse de uno para dejar un agujero por el que se
        edita algo cerrado. El navegador lo propaga a todo lo de adentro,
        incluidos los botones de los pickers.

        El candado REAL está en el backend (409 en PUT y DELETE). Esto es para
        que no se ofrezca una acción que va a fallar.
      */}
      <fieldset disabled={cab.cerrada} className="space-y-4 border-0 p-0 disabled:opacity-60">
        <Seccion titulo="Quién y dónde">
          <PickerModal
            label="Facilitador"
            nombre="facilitadores"
            requerido
            value={cab.id_facilitador}
            valueText={textos.facilitador}
            // incluirId: si se dio de baja después de crearse la evaluación, el
            // combo por defecto no lo traería y el campo quedaría vacío.
            incluirId={inicial?.id_facilitador}
            onChange={(o) => {
              const cambio = o.id !== cab.id_facilitador;
              set("id_facilitador", o.id);
              setTextos((t) => ({ ...t, facilitador: o.texto }));
              // Cambiar de facilitador cambia la lista de instituciones: la que
              // estaba elegida puede no ser suya. Se limpia junto con la ciudad,
              // que se deriva de ella, y con la postulación, que es de un
              // facilitador Y una institución concretos: si no se limpiara,
              // quedaría apuntando a la clase de otra persona. El backend la
              // descartaría igual (`f_postulacion_final` valida que corresponda),
              // pero la tarjeta se vería marcada y sería mentira.
              if (cambio) {
                set("id_institucion", null);
                set("id_ciudad", null);
                set("id_postulacion", null);
                setTextos((t) => ({ ...t, institucion: null, ciudad: null }));
              }
            }}
          />

          <PickerModal
            label="Institución"
            nombre="instituciones"
            requerido
            value={cab.id_institucion}
            valueText={textos.institucion}
            incluirId={inicial?.id_institucion}
            // Solo las instituciones donde este facilitador tiene postulaciones.
            idFacilitador={cab.id_facilitador}
            disabledReason={cab.id_facilitador ? undefined : "Elegí primero el facilitador"}
            onChange={(o) => {
              const cambio = o.id !== cab.id_institucion;
              set("id_institucion", o.id);
              setTextos((t) => ({ ...t, institucion: o.texto }));
              // La ciudad viene con la institución: se carga sola.
              // `undefined` = la lista no la trajo; `null` = la institución no
              // tiene ciudad asignada. En los dos casos hay que pedirla a mano.
              set("id_ciudad", o.idCiudad ?? null);
              setTextos((t) => ({ ...t, ciudad: o.ciudad ?? null }));
              // Igual que al cambiar de facilitador: la postulación elegida es
              // de la institución anterior y acá ya no significa nada.
              if (cambio) set("id_postulacion", null);
            }}
          />

          {/*
          Ciudad: no se elige, se hereda de la institución. Solo se vuelve
          seleccionable cuando la institución no tiene ciudad cargada, porque en
          EVALUACIONES_FACILITADORES la columna es NOT NULL y sin ella no se
          puede guardar.
        */}
          {cab.id_institucion && cab.id_ciudad ? (
            <Campo label="Ciudad" hint="Se carga de la institución">
              <div className="flex h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/50 px-4">
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-base font-medium">
                  {textos.ciudad ?? `#${cab.id_ciudad}`}
                </span>
                <Lock className="size-3.5 shrink-0 text-muted-foreground" />
              </div>
            </Campo>
          ) : (
            <PickerModal
              label="Ciudad"
              nombre="ciudades"
              requerido
              value={cab.id_ciudad}
              valueText={textos.ciudad}
              disabledReason={cab.id_institucion ? undefined : "Elegí primero la institución"}
              placeholder={
                cab.id_institucion ? "La institución no tiene ciudad: elegila" : "Seleccionar"
              }
              onChange={(o) => {
                set("id_ciudad", o.id);
                setTextos((t) => ({ ...t, ciudad: o.texto }));
              }}
            />
          )}

          {/*
            Las postulaciones del facilitador en esta institución. Va acá, al
            final de "Quién y dónde", porque depende de los dos campos de arriba
            y responde a la misma pregunta: qué se está evaluando.

            Se muestra solo (`return null` adentro) hasta que haya facilitador e
            institución: el backend exige los dos y responde 400 sin ellos.
          */}
          <PostulacionPicker
            idFacilitador={cab.id_facilitador}
            idInstitucion={cab.id_institucion}
            value={cab.id_postulacion}
            onChange={(id) => set("id_postulacion", id)}
          />
        </Seccion>

        <Seccion titulo="Período">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Desde" requerido>
              {/* input date nativo: abre el selector del sistema operativo, que en
                móvil siempre va a ser mejor que un calendario propio */}
              <input
                type="date"
                required
                value={cab.fecha_desde}
                onChange={(e) => set("fecha_desde", e.target.value)}
                className={inputCls}
              />
            </Campo>
            <Campo label="Hasta" requerido>
              <input
                type="date"
                required
                value={cab.fecha_hasta}
                min={cab.fecha_desde || undefined}
                onChange={(e) => set("fecha_hasta", e.target.value)}
                className={inputCls}
              />
            </Campo>
          </div>

          <Campo
            label="Evaluado por"
            requerido
            hint="Nombre y apellido. Para varios, separalos con coma"
          >
            {/*
            El formato ("jose galvez" -> "Jose Galvez") se aplica al SALIR del
            campo, no en cada tecla: capitalizar mientras se tipea hace saltar
            el cursor y no deja escribir. Al guardar se vuelve a normalizar
            —ver filaInput()— así que el dato queda parejo aunque el usuario
            mande el formulario sin sacar el foco de acá.
          */}
            <input
              type="text"
              required
              maxLength={255}
              value={cab.evaluado_por}
              onChange={(e) => set("evaluado_por", e.target.value)}
              onBlur={(e) => set("evaluado_por", formatearNombre(e.target.value))}
              placeholder="Jose Galvez, Elena Baez"
              // Ayuda en el celular: el teclado arranca en mayúscula por palabra.
              autoCapitalize="words"
              className={inputCls}
            />
          </Campo>
        </Seccion>

        {/*
        El detalle. Cada ítem marcado es una fila con ESCALA = 1
        en la base; los no marcados también se guardan, con NULL. La calificación
        no se elige: sale de cuántos hay marcados.
      */}
        <Seccion
          titulo="Áreas evaluadas"
          extra={<CalificacionDisplay marcadas={marcadas} total={detalles.length} />}
        >
          {areas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no agregaste áreas. Cada área trae sus evaluaciones y marcás las que cumple.
            </p>
          ) : (
            <div className="space-y-3">
              {areas.map((a) => (
                <AreaDetalle
                  key={a.id}
                  area={a}
                  items={detalles.filter((d) => d.id_area === a.id)}
                  onItems={onItems}
                  onToggle={onToggle}
                  onQuitar={onQuitarArea}
                />
              ))}
            </div>
          )}

          {/*
            El picker desaparece cuando ya se agregaron TODAS las áreas: lo único
            que haría es abrir un modal vacío. Vuelve solo en cuanto se quita
            alguna.
          */}
          {sinAreasDisponibles ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Ya agregaste todas las áreas disponibles.
            </p>
          ) : (
            <PickerModal
              label="Agregar área"
              nombre="areas"
              // value siempre null: es un botón para sumar, no un campo con valor.
              value={null}
              // Las áreas ya agregadas no se vuelven a ofrecer: elegir una
              // repetida no hacía nada (el onChange las ignora) y parecía que el
              // modal estaba roto. Al quitar un área vuelve sola a la lista.
              excluirIds={areas.map((a) => a.id)}
              placeholder={areas.length ? "Agregar otra área" : "Elegir área"}
              onChange={(o) => {
                // El guard se queda igual: `excluirIds` es la UI, esto es la regla.
                setAreas((prev) =>
                  prev.some((a) => a.id === o.id) ? prev : [...prev, { id: o.id, texto: o.texto }],
                );
              }}
            />
          )}

          {marcadas > ESCALA_MAXIMA ? (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Hay {marcadas} ítems marcados y la escala de calificaciones llega hasta{" "}
              {ESCALA_MAXIMA}: se aplica el tramo más alto.
            </p>
          ) : null}
        </Seccion>

        <Seccion titulo="Observaciones">
          <Campo label="Aspectos positivos">
            <textarea
              rows={4}
              value={cab.aspectos_positivos}
              onChange={(e) => set("aspectos_positivos", e.target.value)}
              placeholder="Qué funcionó bien"
              className="w-full resize-y rounded-xl border border-input bg-card p-4 text-base outline-none transition-colors focus:border-primary/40"
            />
          </Campo>

          <Campo label="Aspectos a mejorar">
            <textarea
              rows={4}
              value={cab.aspectos_mejorar}
              onChange={(e) => set("aspectos_mejorar", e.target.value)}
              placeholder="Qué conviene ajustar"
              className="w-full resize-y rounded-xl border border-input bg-card p-4 text-base outline-none transition-colors focus:border-primary/40"
            />
          </Campo>

          {/*
          Va último y separado de los dos de arriba: esos son del EVALUADOR
          —lo que vio en la visita— y este es de quien REVISA la evaluación
          después. Se guarda igual que el resto; el nombre no implica un
          permiso, porque hoy no hay roles en la base.
        */}
          <Campo label="Observación administrativa" hint="Nota de quien revisa la evaluación">
            <textarea
              rows={3}
              value={cab.observacion_admin}
              onChange={(e) => set("observacion_admin", e.target.value)}
              placeholder="Seguimiento, acuerdos o aclaraciones internas"
              className="w-full resize-y rounded-xl border border-input bg-card p-4 text-base outline-none transition-colors focus:border-primary/40"
            />
          </Campo>

          {/*
          Cerrar la evaluación. Aparece SOLO AL EDITAR una ya guardada.

          En el alta no va, a propósito: cerrar algo que todavía no existe no
          significa nada, y lo único que lograría es que naciera bloqueada y
          hubiera que reabrirla para terminar de cargarla. Primero se guarda,
          después se cierra.

          Tampoco aparece si ya está cerrada: ahí el formulario entero está
          deshabilitado y lo que se ofrece es el botón "Reabrir" de arriba.

          No se guarda al tildar — viaja con el resto en el "Guardar".
        */}
          {inicial && !cab.cerrada && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4">
              <input
                type="checkbox"
                checked={cab.cerrada}
                onChange={(e) => set("cerrada", e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">Cerrar la evaluación</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                  Al guardar queda bloqueada: no se podrá editar ni eliminar hasta que alguien la
                  reabra.
                </span>
              </span>
            </label>
          )}
        </Seccion>
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Footer fijo: el botón guardar siempre a la vista, no al final de un
          scroll largo. Dice cuántas filas va a tocar, porque son N llamadas y
          conviene que se vea que no es una sola operación. */}
      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border/60 pb-safe">
        <div className="mx-auto max-w-[480px] px-5 py-3">
          {/*
            Con la evaluación cerrada el botón queda inhabilitado: el PUT sería
            rechazado con 409 y no tiene sentido ofrecerlo. Para volver a
            habilitarlo hay que tocar "Reabrir" arriba.

            Va fuera del fieldset (está en el footer fijo), así que el disabled
            se pone a mano.
          */}
          <button
            type="submit"
            disabled={guardando || cab.cerrada}
            className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {cab.cerrada ? (
              <Lock className="size-4" />
            ) : guardando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {cab.cerrada
              ? "Evaluación cerrada"
              : guardando
                ? "Guardando…"
                : detalles.length
                  ? `${textoBoton} (${detalles.length} ítems)`
                  : // Sin áreas se guarda igual —la cabecera sola es válida— pero
                    // el botón lo dice, para que no parezca que se perdió algo.
                    `${textoBoton} sin áreas`}
          </button>
        </div>
      </div>
    </form>
  );
}
