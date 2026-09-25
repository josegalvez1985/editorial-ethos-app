/**
 * Lista de valores con CHECKS, en modal: elegir varios de una vez.
 *
 * Es el hermano de `SelectorModal` (uno solo) y se ve igual —mismo botón,
 * mismo `DialogContent`, mismas filas de 48px—, con tres diferencias:
 *
 * 1. **Cada fila es un check**, y tocarla no cierra el modal: se marcan varias.
 * 2. **Se trabaja sobre un borrador.** Lo marcado se aplica con el botón de
 *    abajo ("Aplicar (3)"); cerrar sin aplicar lo descarta. Así, explorar la
 *    lista no cambia la pantalla de atrás a cada toque.
 * 3. **"Todos" y "Ninguno"** arriba, que actúan sobre lo que se VE: con una
 *    búsqueda escrita, "Todos" marca solo lo que coincide.
 *
 * Lo usan el filtro de manuales de Inventario y el "Agregar manuales" de
 * Transferencias. Las claves son `string` por lo mismo que en `SelectorModal`:
 * el identificador de un manual es su texto.
 */

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { OpcionFija } from "@/components/selector-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  /** Encabezado del modal y etiqueta del campo. */
  label: string;
  mostrarLabel?: boolean;
  opciones: OpcionFija[];
  value: string[];
  onChange: (valores: string[]) => void;
  /** Qué dice el botón sin nada marcado. */
  placeholder?: string;
  descripcion?: string;
  /** Texto del botón de abajo. Se le agrega el conteo: "Aplicar (3)". */
  confirmar?: string;
  className?: string;
  /**
   * Un disparador propio en lugar del botón-campo. Lo usa Transferencias para
   * "Agregar manuales", que es una acción y no un filtro.
   */
  disparador?: ReactNode;
};

/** Sin mayúsculas ni tildes: "matematica" encuentra "Matemática". */
function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function MultiSelectorModal({
  label,
  mostrarLabel = true,
  opciones,
  value,
  onChange,
  placeholder = "Todos",
  descripcion = "Marcá los que quieras",
  confirmar = "Aplicar",
  className = "",
  disparador,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [borrador, setBorrador] = useState<Set<string>>(new Set());

  const q = normalizar(texto.trim());
  const visibles = q
    ? opciones.filter((o) => normalizar(`${o.texto} ${o.extra ?? ""}`).includes(q))
    : opciones;

  // Al abrir se copia lo aplicado; al cerrar se descarta la búsqueda. Una
  // búsqueda vieja escondería opciones sin que se note por qué.
  const abrirOCerrar = (abrir: boolean) => {
    if (abrir) setBorrador(new Set(value));
    else setTexto("");
    setAbierto(abrir);
  };

  const alternar = (valor: string) =>
    setBorrador((prev) => {
      const sig = new Set(prev);
      if (sig.has(valor)) sig.delete(valor);
      else sig.add(valor);
      return sig;
    });

  const marcarVisibles = (marcar: boolean) =>
    setBorrador((prev) => {
      const sig = new Set(prev);
      for (const o of visibles) {
        if (marcar) sig.add(o.valor);
        else sig.delete(o.valor);
      }
      return sig;
    });

  const aplicar = () => {
    // En el orden de `opciones`, no en el orden en que se tocaron: la pantalla
    // de atrás los muestra ordenados.
    onChange(opciones.filter((o) => borrador.has(o.valor)).map((o) => o.valor));
    abrirOCerrar(false);
  };

  const textoBoton =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (opciones.find((o) => o.valor === value[0])?.texto ?? value[0])
        : `${value.length} seleccionados`;

  return (
    <div className="min-w-0">
      {mostrarLabel && !disparador ? (
        <label className="mb-1.5 block truncate text-sm font-medium">{label}</label>
      ) : null}

      <Dialog open={abierto} onOpenChange={abrirOCerrar}>
        <DialogTrigger asChild>
          {disparador ?? (
            <button
              type="button"
              aria-label={label}
              className={`tap flex w-full items-center gap-2 rounded-xl border bg-card text-left ${
                value.length
                  ? "border-primary/40 font-medium"
                  : "border-input hover:border-primary/40"
              } ${className}`}
            >
              <span
                className={`min-w-0 flex-1 truncate ${value.length ? "" : "text-muted-foreground"}`}
              >
                {textoBoton}
              </span>
              {value.length > 1 ? (
                <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {value.length}
                </span>
              ) : null}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </DialogTrigger>

        <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_auto_1fr_auto] gap-0 overflow-hidden rounded-2xl p-0">
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-xl">{label}</DialogTitle>
            <DialogDescription className="text-xs">{descripcion}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2 px-5 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
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
                  className="tap absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => marcarVisibles(true)}
                className="rounded-lg px-2 py-1 font-semibold text-primary hover:bg-primary-soft"
              >
                {q ? "Marcar los encontrados" : "Todos"}
              </button>
              <button
                type="button"
                onClick={() => marcarVisibles(false)}
                className="rounded-lg px-2 py-1 font-semibold text-muted-foreground hover:bg-muted"
              >
                Ninguno
              </button>
              <span className="ml-auto text-muted-foreground">
                {borrador.size} de {opciones.length}
              </span>
            </div>
          </div>

          <div className="min-h-[10rem] overflow-y-auto overscroll-contain px-3 pb-3">
            {visibles.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {opciones.length === 0
                  ? "No hay opciones disponibles"
                  : `Nada coincide con “${texto.trim()}”`}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {visibles.map((o) => {
                  const marcado = borrador.has(o.valor);
                  return (
                    <li key={o.valor}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={marcado}
                        onClick={() => alternar(o.valor)}
                        className={`tap flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                          marcado
                            ? "border-primary bg-primary-soft"
                            : "border-border/60 bg-card hover:border-primary/40"
                        }`}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-md border-2 transition-colors ${
                            marcado
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {marcado ? <Check className="size-3.5" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] leading-snug">{o.texto}</span>
                          {o.extra ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {o.extra}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex gap-2 border-t border-border/60 px-5 py-3">
            <button
              type="button"
              onClick={() => abrirOCerrar(false)}
              className="h-11 flex-1 rounded-xl border border-input text-sm font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={aplicar}
              className="h-11 flex-[2] rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft"
            >
              {confirmar} ({borrador.size})
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Lo elegido, como chips que se pueden quitar. Va debajo del selector: con
 * "3 seleccionados" en el botón no se sabe CUÁLES son.
 */
export function ChipsSeleccion({
  valores,
  onQuitar,
  onLimpiar,
}: {
  valores: string[];
  onQuitar: (valor: string) => void;
  onLimpiar: () => void;
}) {
  if (valores.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {valores.map((v) => (
        <span
          key={v}
          className="flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-medium"
        >
          <span className="truncate">{v}</span>
          <button
            type="button"
            onClick={() => onQuitar(v)}
            aria-label={`Quitar ${v}`}
            className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {valores.length > 1 ? (
        <button
          type="button"
          onClick={onLimpiar}
          className="rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          Quitar todos
        </button>
      ) : null}
    </div>
  );
}
