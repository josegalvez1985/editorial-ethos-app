/**
 * Las postulaciones de un facilitador en una institución, como tarjetas
 * seleccionables.
 *
 * ── QUÉ PROBLEMA RESUELVE ────────────────────────────────────────────────────
 *
 * Un facilitador puede dar clase en varios grados de la misma institución. Hasta
 * ahora la evaluación no decía en cuál: el backend intentaba deducirlo cruzando
 * facilitador + institución + año, y cuando había más de un candidato guardaba
 * `NULL` antes que adivinar (ver `f_postulacion` en el SQL, que dejaba anotado
 * que la salida correcta era exactamente esto).
 *
 * Con estas tarjetas lo elige una persona, que es la única que sabe cuál fue.
 *
 * ── POR QUÉ TARJETAS Y NO UN PickerModal ─────────────────────────────────────
 *
 * El resto de los combos del formulario usan `PickerModal`, que muestra una
 * línea de texto por opción. Acá no alcanza: para distinguir dos postulaciones
 * del mismo facilitador hay que ver grado, sección, turno y docente A LA VEZ.
 * Concatenar todo en un renglón —"7mo · A · Mañana · Margarita"— es ilegible en
 * un teléfono, que es donde se carga esto.
 *
 * Además son pocas (las de un facilitador en una institución), así que caben en
 * pantalla sin buscador ni modal.
 */

import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, Loader2, Users } from "lucide-react";

import {
  listarPostulaciones,
  nombreTurno,
  STALE_LISTAS,
  type Postulacion,
} from "@/lib/evaluaciones";

/** El título de la tarjeta: "7mo grado · Sección A", con lo que haya. */
function titulo(p: Postulacion) {
  const partes = [
    p.grado ? `${p.grado} grado` : null,
    p.seccion ? `Sección ${p.seccion}` : null,
  ].filter(Boolean);

  // Sin grado ni sección la tarjeta necesita ALGO que la identifique, o quedan
  // dos tarjetas visualmente idénticas y la elección se vuelve una lotería.
  return partes.length ? partes.join(" · ") : `Postulación #${p.id_postulacion}`;
}

function Tarjeta({
  p,
  elegida,
  onElegir,
  disabled,
}: {
  p: Postulacion;
  elegida: boolean;
  onElegir: () => void;
  disabled?: boolean;
}) {
  const turno = nombreTurno(p.turno);
  // El énfasis y la materia dicen lo mismo desde dos tablas distintas y suelen
  // venir uno u otro: se muestran juntos y sin repetir.
  const materias = [...new Set([p.enfasis, p.materia].filter(Boolean))] as string[];

  return (
    <button
      type="button"
      onClick={onElegir}
      disabled={disabled}
      aria-pressed={elegida}
      className={`tap w-full rounded-2xl border p-3.5 text-left transition-colors ${
        elegida
          ? "border-primary bg-primary-soft"
          : "border-border/60 bg-card hover:border-primary/40"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] leading-snug font-bold">{titulo(p)}</h3>
            {turno && (
              <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {turno}
              </span>
            )}
          </div>

          {/* La matrícula. Es el VALOR de la columna del grado, no un id: ver
              `lov_postulaciones` en el SQL. */}
          {p.alumnos != null && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Users className="size-3.5 shrink-0" />
              {p.alumnos} alumnos
            </p>
          )}

          {p.docente && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
              Docente: <span className="font-medium text-foreground">{p.docente}</span>
            </p>
          )}

          {materias.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <BookOpen className="size-3.5 shrink-0" />
              <span className="truncate">{materias.join(" · ")}</span>
            </p>
          )}

          {p.programa && (
            <span className="mt-2 inline-block rounded-lg bg-muted px-2.5 py-1 text-[11px] leading-snug font-semibold text-muted-foreground">
              {p.programa}
            </span>
          )}
        </div>

        {/* El check ocupa lugar SIEMPRE (size-5 con o sin ícono): si apareciera
            solo al elegir, el texto se correría al hacer clic. */}
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          {elegida && <Check className="size-5 text-primary" />}
        </span>
      </div>
    </button>
  );
}

export function PostulacionPicker({
  idFacilitador,
  idInstitucion,
  value,
  onChange,
  disabled,
}: {
  idFacilitador: number | null;
  idInstitucion: number | null;
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  /*
   * `enabled`: los dos ids son OBLIGATORIOS en el backend, que responde 400 sin
   * ellos. Sin esta guarda, abrir el formulario vacío dispararía una llamada
   * fallida antes de que el usuario elija nada.
   */
  const habilitada = idFacilitador != null && idInstitucion != null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["postulaciones", idFacilitador, idInstitucion],
    queryFn: () => listarPostulaciones(idFacilitador!, idInstitucion!),
    enabled: habilitada,
    staleTime: STALE_LISTAS,
  });

  // Antes de elegir institución no se muestra nada: un bloque vacío con un
  // "elegí primero…" suma ruido a un formulario que ya es largo.
  if (!habilitada) return null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">Postulación</label>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Buscando postulaciones…
        </div>
      ) : isError ? (
        /*
         * Un fallo acá NO bloquea el guardado: la postulación es trazabilidad,
         * no un dato obligatorio, y el backend la deduce igual. Por eso es un
         * aviso y no un error rojo que sugiera que hay que resolverlo.
         */
        <p className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          No se pudieron cargar las postulaciones. La evaluación se puede guardar igual.
        </p>
      ) : !data?.length ? (
        <p className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          Este facilitador no tiene postulaciones cargadas en esta institución para el año lectivo
          actual.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {data.map((p) => (
              <Tarjeta
                key={p.id_postulacion}
                p={p}
                elegida={p.id_postulacion === value}
                disabled={disabled}
                /*
                 * Volver a tocar la elegida la deselecciona. Sin esto, un clic
                 * por error deja un dato que no se puede sacar sin recargar —y
                 * "ninguna" es un estado válido: el backend vuelve a deducirla.
                 */
                onElegir={() => onChange(p.id_postulacion === value ? null : p.id_postulacion)}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Opcional. Indica qué grado se evaluó cuando el facilitador tiene varios en esta
            institución.
          </p>
        </>
      )}
    </div>
  );
}
