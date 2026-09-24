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
 * | Buscador | sí, contra el servidor + memoria | opcional (`buscador`), en memoria |
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
 * ## EL BUSCADOR SE PIDE, NO SE DEDUCE
 *
 * `buscador` agrega un campo arriba de la lista que la filtra mientras se
 * escribe. Es opt-in, y no "a partir de N opciones" como en `PickerModal`: con
 * ese criterio lo recibirían también los selectores de mes (trece filas que se
 * leen de un vistazo), donde es un campo de más. Va donde la lista no entra en
 * la pantalla, como las tablas de Auditoría.
 *
 * ## POR QUÉ UN MODAL Y NO UN `<select>`
 *
 * El `<select>` nativo abre la rueda del sistema operativo, que en Android es
 * una lista gris con la tipografía del sistema: rompe el tema de la app, ignora
 * la paleta elegida en Mi cuenta y no puede mostrar una segunda línea de
 * contexto. Con listas de una palabra se tolera; con "Solo las que no
 * desarrollaron el índice" ya no entra.
 */

import { Check, ChevronDown, Search, X } from "lucide-react";
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
  /** Campo para filtrar las opciones mientras se escribe. Ver el encabezado. */
  buscador?: boolean;
};

/**
 * Texto comparable: sin mayúsculas, sin tildes y con `_` como espacio, así
 * "evaluaciones facilitadores" encuentra `EVALUACIONES_FACILITADORES`.
 */
function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/_/g, " ");
}

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
  buscador = false,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");

  const elegida = opciones.find((o) => o.valor === value);

  const q = normalizar(texto.trim());
  const visibles =
    buscador && q
      ? opciones.filter((o) => normalizar(`${o.texto} ${o.extra ?? ""}`).includes(q))
      : opciones;

  // La búsqueda se borra al cerrar, se haya elegido o no: al volver a abrir,
  // una búsqueda vieja escondería opciones sin que se note por qué.
  const abrirOCerrar = (abrir: boolean) => {
    setAbierto(abrir);
    if (!abrir) setTexto("");
  };

  const elegir = (valor: string) => {
    onChange(valor);
    abrirOCerrar(false);
  };

  return (
    /*
     * `min-w-0` SIEMPRE, con o sin etiqueta.
     *
     * Sin él, dentro de una grilla o un flex un valor largo —"Colegio Nacional
     * Dr. Luis Alberto de Herrera"— estira la celda en vez de dejar que el
     * `truncate` de adentro haga su trabajo, y la fila entera queda despareja.
     *
     * El `flex-1` sigue solo en el caso sin etiqueta: ahí el control vive en
     * una fila flex y tiene que repartirse el ancho.
     */
    <div className={mostrarLabel ? "min-w-0" : "min-w-0 flex-1"}>
      {mostrarLabel ? (
        <label className="mb-1.5 block truncate text-sm font-medium">
          {label}
          {requerido ? <span className="ml-0.5 text-destructive">*</span> : null}
        </label>
      ) : null}

      <Dialog open={abierto} onOpenChange={abrirOCerrar}>
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
        <DialogContent
          className={`grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md gap-0 overflow-hidden rounded-2xl p-0 ${
            // Una fila por hijo: con buscador son tres, no dos.
            buscador ? "grid-rows-[auto_auto_1fr]" : "grid-rows-[auto_1fr]"
          }`}
        >
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-xl">{label}</DialogTitle>
            <DialogDescription className="text-xs">{descripcion}</DialogDescription>
          </DialogHeader>

          {/* El mismo campo que el de `PickerModal`. */}
          {buscador ? (
            <div className="relative px-5 pb-3">
              <Search className="pointer-events-none absolute top-1/2 left-8 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar…"
                aria-label={`Buscar en ${label}`}
                // text-base = 16px: con menos, iOS hace zoom al enfocar.
                className="h-11 w-full rounded-full border border-input bg-muted/60 pr-10 pl-10 text-base outline-none focus:border-primary/40 focus:bg-card"
              />
              {texto ? (
                <button
                  type="button"
                  onClick={() => setTexto("")}
                  aria-label="Limpiar"
                  className="tap absolute top-1/2 right-7 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-[10rem] overflow-y-auto overscroll-contain px-3 pb-4">
            {visibles.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {opciones.length === 0
                  ? "No hay opciones disponibles"
                  : `Nada coincide con “${texto.trim()}”`}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {visibles.map((o) => {
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
