import { Star } from "lucide-react";

import { calificacionDeConteo } from "@/lib/evaluaciones";

/**
 * Una sola estrella, marcada o desmarcada.
 *
 * No es una escala de 1 a 5: cada detalle de la evaluación vale una estrella y la
 * calificación del conjunto sale de contar cuántas están marcadas. En la base eso
 * es `ESCALA = 1` o `NULL` (nunca 0, lo rechaza el CHECK).
 *
 * El botón mide 44px aunque el icono sea de 28: es el mínimo para tocar con el
 * dedo sin errarle.
 */
export function StarToggle({
  marcada,
  onChange,
  etiqueta,
}: {
  marcada: boolean;
  onChange: (marcada: boolean) => void;
  /** Qué se está marcando; va al aria-label porque el icono no lo dice. */
  etiqueta: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!marcada)}
      role="switch"
      aria-checked={marcada}
      aria-label={etiqueta}
      className="tap grid size-11 shrink-0 place-items-center rounded-full"
    >
      <Star
        className={`size-7 transition-colors ${
          marcada ? "fill-primary text-primary" : "text-muted-foreground/40"
        }`}
      />
    </button>
  );
}

/**
 * Resultado de una evaluación: cuántos ítems se marcaron y qué calificación da.
 *
 * Muestra una estrella sola y el conteo, no cinco estrellas: el total de ítems
 * varía según las áreas evaluadas, así que "7 de 12" dice más que un dibujo de
 * estrellas que habría que inventar sobre una escala fija.
 */
export function CalificacionDisplay({
  marcadas,
  total,
  className,
}: {
  marcadas: number;
  /** Ítems evaluados en total. Si no viene, solo se muestra el conteo marcado. */
  total?: number;
  className?: string;
}) {
  const c = calificacionDeConteo(marcadas);

  if (!c) {
    return (
      <span className={`text-xs text-muted-foreground ${className ?? ""}`}>Sin calificar</span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ""}`}
      title={c.descripcion}
      aria-label={`${c.calificacion}: ${marcadas} marcadas${total ? ` de ${total}` : ""}`}
    >
      <Star className="size-3.5 shrink-0 fill-primary text-primary" />
      <span className="text-xs font-semibold">{c.calificacion}</span>
      <span className="text-xs text-muted-foreground">
        {marcadas}
        {total ? `/${total}` : ""}
      </span>
    </span>
  );
}
