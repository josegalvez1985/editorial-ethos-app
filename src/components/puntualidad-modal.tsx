/**
 * El detalle de puntualidad de un facilitador: cada marcación con su atraso.
 *
 * Se abre al tocar una barra del gráfico. Responde la pregunta que el promedio
 * deja abierta: **de dónde sale ese número** — si es un mes parejo o un par de
 * días malos que arrastran la media.
 *
 * Por eso cada fila muestra las DOS horas —la de la clase y la marcada— y no
 * solo la diferencia: con el atraso solo no se puede verificar nada, y el dato
 * es sobre el cumplimiento de una persona.
 */

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Clock, MapPin } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nombreTurno } from "@/lib/evaluaciones";
import {
  atrasoMinutos,
  formatearAtraso,
  MESES,
  type Intervencion,
  type ResumenFacilitador,
} from "@/lib/intervenciones";

const fecha = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "EEE d MMM", { locale: es });
  } catch {
    // La vista puede traer la fecha ya formateada como texto: se muestra tal cual
    // antes que romper la fila por no poder parsearla.
    return iso;
  }
};

/**
 * El color del atraso. Es **estado**, no serie: por eso usa los tokens de
 * destructive/foreground y no un color de gráfico.
 *
 * Nunca va solo — al lado siempre está el número en texto, así que la
 * información no depende del color.
 */
function tonoAtraso(min: number | null) {
  if (min === null) return "text-muted-foreground";
  if (min === 0) return "text-muted-foreground";
  if (min >= 15) return "text-destructive";
  return "text-foreground";
}

function Fila({ i }: { i: Intervencion }) {
  const turno = nombreTurno(i.turno);
  // La conversión vive en `atrasoMinutos`: la columna del backend viene en horas
  // y con el signo invertido. Ver `lib/intervenciones.ts`.
  const atraso = atrasoMinutos(i);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">{fecha(i.fecha)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {/* La vista llama `NOMBRE` a secas al nombre de la institución. */}
            {i.nombre ?? "—"}
            {i.grado && ` · ${i.grado}`}
            {i.seccion && ` "${i.seccion}"`}
          </p>
        </div>

        {/* El atraso, que es el dato que se vino a ver. */}
        <div className="shrink-0 text-right">
          <p className={`text-[15px] leading-none font-bold ${tonoAtraso(atraso)}`}>
            {formatearAtraso(atraso)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {atraso === 0 ? "en horario" : atraso === null ? "sin hora" : "de atraso"}
          </p>
        </div>
      </div>

      {/*
        Las dos horas. Sin esto el atraso no se puede verificar, y es un dato
        sobre el cumplimiento de una persona: tiene que ser auditable.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          Clase {i.hora_desde ?? "—"}
          {i.hora_hasta && `-${i.hora_hasta}`}
        </span>
        <span>
          Marcó <span className="font-semibold text-foreground">{i.hora ?? "—"}</span>
        </span>
        {turno && <span>{turno}</span>}
      </div>

      {/* El motivo solo existe cuando el índice NO se desarrolló. */}
      {i.motivo_desarrollo && (
        <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold">No se desarrolló:</span> {i.motivo_desarrollo}
        </p>
      )}

      {i.ubicacion_institucion && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{i.ubicacion_institucion}</span>
        </p>
      )}
    </div>
  );
}

export function PuntualidadModal({
  facilitador,
  anio,
  mes,
  onClose,
}: {
  /** `null` = cerrado. Es lo que dispara la consulta del detalle. */
  facilitador: ResumenFacilitador | null;
  anio: string;
  mes: number;
  onClose: () => void;
}) {
  const abierto = facilitador !== null;

  /*
   * NO hay consulta acá: las filas ya vinieron con el agrupado del gráfico.
   *
   * El backend devuelve el historial completo del período en una sola llamada y
   * `agruparPorFacilitador` reparte esas filas por persona, así que abrir el
   * modal no toca la red. Antes esto pedía un endpoint de detalle aparte.
   */
  const filas = facilitador?.filas ?? [];

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-5 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-xl">
            {facilitador?.nombre_facilitador ?? ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {MESES[mes - 1]} {anio}
            {facilitador &&
              ` · ${formatearAtraso(facilitador.promedio)} de atraso promedio en ` +
                `${facilitador.marcaciones} ${facilitador.marcaciones === 1 ? "clase" : "clases"}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
          {filas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay marcaciones en este período.
            </p>
          ) : (
            filas.map((i) => <Fila key={i.id_intervencion} i={i} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
