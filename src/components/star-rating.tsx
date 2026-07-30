import { Star } from "lucide-react";

const ETIQUETAS = ["", "Muy bajo", "Bajo", "Regular", "Bueno", "Excelente"] as const;

/**
 * Estrellas para tocar con el dedo: botones de 44px, no iconos de 16.
 *
 * Permite volver a 0 tocando la estrella ya elegida, porque
 * CALIFICACION_ESTRELLAS es nullable y "sin calificar" es un estado válido —
 * sin eso, un toque accidental sería irreversible.
 */
export function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const lleno = (value ?? 0) >= n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(value === n ? null : n)}
              aria-label={`${n} de 5`}
              aria-pressed={lleno}
              className="tap grid size-11 place-items-center rounded-full"
            >
              <Star
                className={`size-7 transition-colors ${
                  lleno ? "fill-primary text-primary" : "text-muted-foreground/40"
                }`}
              />
            </button>
          );
        })}
      </div>
      <p className="mt-1 h-4 text-xs text-muted-foreground">
        {value ? ETIQUETAS[value] : "Sin calificar"}
      </p>
    </div>
  );
}

/** Versión compacta de solo lectura, para las tarjetas del listado. */
export function StarsDisplay({ value, className }: { value: number | null; className?: string }) {
  if (!value) {
    return (
      <span className={`text-xs text-muted-foreground ${className ?? ""}`}>Sin calificar</span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      aria-label={`${value} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`size-3.5 ${
            n <= value ? "fill-primary text-primary" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </span>
  );
}
