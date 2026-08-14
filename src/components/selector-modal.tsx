/**
 * Lista de valores FIJA en modal: un botón como campo y las opciones adentro.
 *
 * ## POR QUÉ NO ES `PickerModal`
 *
 * Son la misma idea con dos dominios distintos, y el que los separa es el tipo
 * de la clave:
 *
 * | | `PickerModal` | este |
 * | --- | --- | --- |
 * | De dónde salen las filas | `listas/:nombre` del backend | del front, cableadas |
 * | La clave | `number` (`ID_FACILITADOR`…) | `string` (`"2026"`, `"SI"`, `""`) |
 * | Buscador | sí, contra el servidor + memoria | no: son pocas y se ven todas |
 *
 * Los valores que maneja este —un mes, un año, "¿desarrolló?", el nombre de un
 * manual— **no tienen id numérico**: son el valor mismo. Meterlos en `Opcion`
 * obligaría a inventarles un id y a traducirlo de ida y de vuelta en cada
 * pantalla, que es exactamente el tipo de mapeo que se desincroniza en silencio.
 *
 * Lo que sí se comparte es el ASPECTO: mismo botón con `ChevronDown`, mismo
 * `DialogContent` redondeado, mismas filas de 48px con su `Check`. Para quien
 * usa la app son el mismo control; la diferencia es de dónde sale el dato.
 *
 * ## POR QUÉ UN MODAL Y NO UN `<select>`
 *
 * El `<select>` nativo abre la rueda del sistema operativo, que en Android es
 * una lista gris con la tipografía del sistema: rompe el tema de la app, ignora
 * la paleta elegida en Mi cuenta y no puede mostrar una segunda línea de
 * contexto. Con listas de una palabra se tolera; con "Solo las que no
 * desarrollaron el índice" ya no entra.
 */

import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Una opción de la lista. El `valor` ES la clave: no hay id aparte. */
export type OpcionFija = {
  valor: string;
  texto: string;
  /** Segunda línea, para lo que el texto solo no explica. Opcional. */
  extra?: string;
};

type Props = {
  /** Encabezado del modal y etiqueta del campo. */
  label: string;
  /** Si se muestra la etiqueta arriba del botón. En una fila de filtros estorba. */
  mostrarLabel?: boolean;
  opciones: OpcionFija[];
  value: string;
  onChange: (valor: string) => void;
  /** Qué dice el botón cuando el valor no matchea ninguna opción. */
  placeholder?: string;
  /** Frase corta abajo del título del modal. */
  descripcion?: string;
  /** Clases extra para el botón: lo usan las filas de filtros para el ancho. */
  className?: string;
  requerido?: boolean;
};

export function SelectorModal({
  label,
  mostrarLabel = true,
  opciones,
  value,
  onChange,
  placeholder = "Seleccionar",
  descripcion = "Elegí una opción",
  className = "",
  requerido = false,
}: Props) {
  const [abierto, setAbierto] = useState(false);

  const elegida = opciones.find((o) => o.valor === value);

  const elegir = (valor: string) => {
    onChange(valor);
    setAbierto(false);
  };

  return (
    <div className={mostrarLabel ? undefined : "min-w-0 flex-1"}>
      {mostrarLabel ? (
        <label className="mb-1.5 block text-sm font-medium">
          {label}
          {requerido ? <span className="ml-0.5 text-destructive">*</span> : null}
        </label>
      ) : null}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogTrigger asChild>
          <button
            type="button"
            // `aria-label` siempre: sin etiqueta visible —el caso de las filas de
            // filtros— el botón diría solo "Agosto" y un lector de pantalla no
            // tendría cómo saber de qué es ese valor.
            aria-label={label}
            className={`tap flex w-full items-center gap-2 rounded-xl border bg-card text-left ${
              elegida ? "border-primary/40 font-medium" : "border-input hover:border-primary/40"
            } ${className}`}
          >
            <span className={`min-w-0 flex-1 truncate ${elegida ? "" : "text-muted-foreground"}`}>
              {elegida ? elegida.texto : placeholder}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DialogTrigger>

        {/* Mismas medidas que `PickerModal`: los dos controles se abren igual. */}
        <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-xl">{label}</DialogTitle>
            <DialogDescription className="text-xs">{descripcion}</DialogDescription>
          </DialogHeader>

          <div className="min-h-[10rem] overflow-y-auto overscroll-contain px-3 pb-4">
            {opciones.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                No hay opciones disponibles
              </p>
            ) : (
              <ul className="space-y-1.5">
                {opciones.map((o) => {
                  const activo = o.valor === value;
                  return (
                    <li key={o.valor}>
                      <button
                        type="button"
                        onClick={() => elegir(o.valor)}
                        className={`tap flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                          activo
                            ? "border-primary bg-primary-soft"
                            : "border-border/60 bg-card hover:border-primary/40"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] leading-snug">{o.texto}</span>
                          {o.extra ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {o.extra}
                            </span>
                          ) : null}
                        </span>
                        {activo ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
