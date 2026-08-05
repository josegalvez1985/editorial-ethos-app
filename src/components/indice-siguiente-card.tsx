/**
 * El índice que le toca desarrollar a la postulación elegida.
 *
 * ── NO SE ELIGE, SE DEDUCE ───────────────────────────────────────────────────
 *
 * Es un campo de **solo lectura**, como la Ciudad: sale de lo que el facilitador
 * ya registró en `INTERVENCIONES` para esa postulación. La regla la resuelve el
 * backend (`indice_siguiente` en el SQL) y es, en dos pasos:
 *
 *   1. el último índice con `SI_NO = 'Si'` de esa postulación,
 *   2. el inmediato siguiente dentro del mismo manual.
 *
 * Un índice marcado `'No'` no cuenta como avance —no se dio, sigue pendiente— y
 * se vuelve a proponer.
 *
 * ── DEPENDE DE LA POSTULACIÓN, NO DE LA INSTITUCIÓN ──────────────────────────
 *
 * El manual avanza clase a clase, y `ID_POSTULACION` es el grado y sección
 * concretos. Un facilitador con 7mo y 8vo en el mismo colegio lleva dos avances
 * distintos: por eso este campo aparece recién cuando hay postulación elegida, y
 * se recalcula al cambiarla.
 *
 * ── EL VALOR SÍ SE GUARDA ────────────────────────────────────────────────────
 *
 * A diferencia de la tarjeta de directores, esto no es decorativo: el
 * `id_indice` viaja en el JSON de la evaluación. Como el usuario no puede
 * tipearlo, el componente avisa hacia arriba con `onResolve` apenas lo sabe.
 */

import { useQuery } from "@tanstack/react-query";
import { BookMarked, Loader2, Lock } from "lucide-react";
import { useEffect } from "react";

import { obtenerIndiceSiguiente, STALE_LISTAS } from "@/lib/evaluaciones";

export function IndiceSiguienteCard({
  idPostulacion,
  onResolve,
}: {
  idPostulacion: number | null;
  /**
   * El índice resuelto, o `null` si no hay ninguno que proponer. Lo escribe en
   * la cabecera quien monta este componente: el campo es de solo lectura, así
   * que si no lo reportáramos, `id_indice` se guardaría siempre vacío.
   */
  onResolve: (idIndice: number | null) => void;
}) {
  const habilitada = idPostulacion != null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["indice-siguiente", idPostulacion],
    queryFn: () => obtenerIndiceSiguiente(idPostulacion!),
    enabled: habilitada,
    staleTime: STALE_LISTAS,
  });

  /*
   * Sincroniza el valor deducido con el formulario.
   *
   * Va en un efecto y no en el `queryFn` porque también tiene que limpiarse
   * cuando se quita la postulación o cuando el resultado deja de tener índice
   * (FINALIZADO / SIN_INICIAR): si solo se escribiera al encontrar uno, el
   * índice de la postulación anterior quedaría pegado.
   *
   * `data?.id_indice` como dependencia y no `data`: el objeto cambia de
   * identidad en cada refetch aunque el índice sea el mismo.
   */
  const idIndice = data?.id_indice ?? null;
  useEffect(() => {
    if (!habilitada) {
      onResolve(null);
      return;
    }
    // Mientras carga no se toca nada: escribir null acá borraría el índice de
    // una evaluación que se está editando, antes de saber el nuevo.
    if (isLoading) return;
    onResolve(idIndice);
  }, [habilitada, isLoading, idIndice, onResolve]);

  // Sin postulación no hay nada que deducir. Igual que el picker de arriba, no
  // se muestra un "elegí primero…": el formulario ya es largo.
  if (!habilitada) return null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">Índice a desarrollar</label>

      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/50 px-4 py-2.5">
        {isLoading ? (
          <>
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Buscando el índice…</span>
          </>
        ) : isError ? (
          /*
           * Un fallo acá no bloquea el guardado: el índice es trazabilidad y la
           * columna es nullable. Se avisa en gris, no en rojo, porque no hay
           * nada que el evaluador pueda resolver desde el formulario.
           */
          <span className="text-[13px] text-muted-foreground">
            No se pudo calcular el índice. La evaluación se puede guardar igual.
          </span>
        ) : data?.estado === "PENDIENTE" ? (
          <>
            <BookMarked className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium">
                {/* El número delante: es como el evaluador tiene el manual
                    impreso delante, y el título solo no lo ubica. */}
                {data.nro_indice != null ? `${data.nro_indice} · ` : ""}
                {data.titulo ?? `Índice #${data.id_indice}`}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {data.manual}
                {/* De dónde sale la propuesta. Sin esto el número aparece solo y
                    no hay forma de saber si es el correcto. */}
                {data.nro_ultimo != null && ` · sigue al índice ${data.nro_ultimo}`}
              </p>
            </div>
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        ) : data?.estado === "FINALIZADO" ? (
          <span className="text-[13px] text-muted-foreground">
            Esta clase ya desarrolló todos los índices
            {data.manual ? ` de ${data.manual}` : ""}.
          </span>
        ) : (
          /*
           * SIN_INICIAR. No se propone el índice 1: sin intervenciones previas
           * tampoco se sabe qué manual está usando esta clase, así que cualquier
           * propuesta sería inventada.
           */
          <span className="text-[13px] text-muted-foreground">
            Esta clase todavía no tiene índices desarrollados.
          </span>
        )}
      </div>
    </div>
  );
}
