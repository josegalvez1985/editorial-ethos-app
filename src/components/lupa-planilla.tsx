import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { PASO_ZOOM, ZOOM_MAX, ZOOM_MIN } from "@/lib/lupa";

/**
 * Los botones de la lupa de una planilla (`usePlanilla` en `lib/lupa.ts`):
 * achicar, el porcentaje (vuelve a 100 %), agrandar y "Ajustar", que la deja
 * del tamaño justo para ver todas las columnas de un pantallazo.
 */
export function LupaPlanilla({
  zoom,
  setZoom,
  ajustar,
}: {
  zoom: number;
  setZoom: (z: number) => void;
  ajustar: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <span className="mr-1 text-[11.5px] text-muted-foreground">Tamaño de la planilla</span>
      <button
        type="button"
        onClick={() => setZoom(zoom - PASO_ZOOM)}
        disabled={zoom <= ZOOM_MIN}
        aria-label="Achicar la planilla"
        title="Achicar"
        className="grid size-8 place-items-center rounded-lg border border-border/80 bg-card hover:border-primary/40 disabled:opacity-40"
      >
        <ZoomOut className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => setZoom(1)}
        aria-label="Volver al tamaño normal"
        title="Tamaño normal (100 %)"
        className="h-8 min-w-14 rounded-lg px-2 text-[12.5px] font-semibold tabular-nums hover:bg-muted"
      >
        {Math.round(zoom * 100)} %
      </button>
      <button
        type="button"
        onClick={() => setZoom(zoom + PASO_ZOOM)}
        disabled={zoom >= ZOOM_MAX}
        aria-label="Agrandar la planilla"
        title="Agrandar"
        className="grid size-8 place-items-center rounded-lg border border-border/80 bg-card hover:border-primary/40 disabled:opacity-40"
      >
        <ZoomIn className="size-4" />
      </button>
      <button
        type="button"
        onClick={ajustar}
        title="Ver todas las columnas en el ancho de la pantalla"
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-card px-2.5 text-[12.5px] font-semibold hover:border-primary/40"
      >
        <Maximize2 className="size-3.5" />
        Ajustar
      </button>
    </div>
  );
}
