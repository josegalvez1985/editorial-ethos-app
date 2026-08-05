/**
 * El detalle de las marcaciones que un facilitador hizo lejos de la institución.
 *
 * Se abre al tocar una barra del gráfico de ubicación. Cada fila muestra la
 * distancia y **dos accesos a Google Maps**, que es lo que permite verificar:
 * un número de kilómetros solo no dice si el facilitador estaba en su casa, en
 * otro colegio o si el GPS falló.
 *
 * ── POR QUÉ DOS LINKS Y NO UNO ───────────────────────────────────────────────
 *
 * - **"Ver recorrido"** abre Maps con los dos puntos y la línea entre ellos. Es
 *   el que responde la pregunta de un vistazo: qué tan lejos está uno del otro.
 * - **"Dónde marcó"** abre solo ese punto. Sirve para reconocer el lugar —una
 *   casa, otra escuela— que en la vista de recorrido queda chico.
 *
 * Los links se abren en pestaña nueva (`_blank`) con `rel="noreferrer"`: dentro
 * del APK eso lo toma el navegador del sistema, así que la app no se pierde.
 */

import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { MapPin, Navigation } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatearDistancia,
  linkMapaComparativo,
  linkMapaPunto,
  MESES,
  type Intervencion,
  type ResumenUbicacion,
} from "@/lib/intervenciones";

const fecha = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "EEE d MMM", { locale: es });
  } catch {
    // La vista puede traer la fecha ya formateada: se muestra tal cual antes
    // que romper la fila por no poder parsearla.
    return iso;
  }
};

/**
 * El color de la distancia. Es **estado**, no serie.
 *
 * Nunca informa solo: al lado siempre está el número en texto. El corte en 5 km
 * separa "se pasó del radio" de "estaba en otro lado", que son dos situaciones
 * distintas de leer.
 */
function tonoDistancia(metros: number) {
  return metros >= 5000 ? "text-destructive" : "text-foreground";
}

function Fila({ i }: { i: Intervencion }) {
  const recorrido = linkMapaComparativo(i);
  const punto = linkMapaPunto(i.latitud, i.longitud);

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

        {/* La distancia, que es el dato que se vino a ver. */}
        <div className="shrink-0 text-right">
          <p
            className={`text-[15px] leading-none font-bold ${tonoDistancia(
              i.distancia_metros ?? 0,
            )}`}
          >
            {formatearDistancia(i.distancia_metros)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">de distancia</p>
        </div>
      </div>

      {/*
        Los accesos al mapa. Van abajo y a lo ancho porque son objetivos
        táctiles: en un teléfono, un link de texto corto al lado del número es
        muy fácil de errar.
      */}
      {(recorrido || punto) && (
        <div className="mt-2 flex gap-2 border-t border-border/60 pt-2">
          {recorrido && (
            <a
              href={recorrido}
              target="_blank"
              rel="noreferrer"
              className="tap flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted/60 py-1.5 text-[11px] font-semibold text-primary"
            >
              <Navigation className="size-3 shrink-0" />
              Ver recorrido
            </a>
          )}
          {punto && (
            <a
              href={punto}
              target="_blank"
              rel="noreferrer"
              className="tap flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted/60 py-1.5 text-[11px] font-semibold text-primary"
            >
              <MapPin className="size-3 shrink-0" />
              Dónde marcó
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function UbicacionModal({
  facilitador,
  anio,
  mes,
  onClose,
}: {
  /** `null` = cerrado. */
  facilitador: ResumenUbicacion | null;
  anio: string;
  mes: number;
  onClose: () => void;
}) {
  const abierto = facilitador !== null;
  // Sin consulta: las filas ya vinieron con el agrupado del gráfico.
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
              ` · ${facilitador.fuera} ${
                facilitador.fuera === 1 ? "marcación" : "marcaciones"
              } fuera de rango · hasta ${formatearDistancia(facilitador.peor)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
          {filas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay marcaciones fuera de rango en este período.
            </p>
          ) : (
            filas.map((i) => <Fila key={i.id_intervencion} i={i} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
