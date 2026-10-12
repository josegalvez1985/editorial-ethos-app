import { ArrowDown, ArrowUp, Check, Filter, RotateCcw, Search, X } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ColumnaReporte, type TablaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

/*
 * El menú de columna de los reportes (ver `lib/tabla-reporte.ts`): tocar el
 * encabezado abre Ascendente / Descendente y los valores de la columna para
 * filtrar. Es un diálogo y no un desplegable pegado al encabezado: la tabla se
 * desplaza de costado dentro de su caja y un desplegable quedaría cortado, y en
 * el celular un diálogo se toca mejor. Es el mismo diálogo de `SelectorModal`.
 */

const numero = new Intl.NumberFormat("es-PY");

/** Cuántos valores se dibujan a la vez: una columna de observaciones puede tener miles. */
const MAX_VALORES = 300;

/**
 * El contenido de un `<th>`: el título, la flecha del orden y el embudo si la
 * columna está filtrada. Tocarlo abre el menú de la columna.
 */
export function EncabezadoReporte<T>({
  columna,
  tabla,
  centro,
  etiqueta,
}: {
  columna: ColumnaReporte<T>;
  tabla: TablaReporte<T>;
  centro?: boolean;
  /** Un texto más corto para el encabezado ("SER"); el menú usa el título entero. */
  etiqueta?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const ordenada = tabla.orden?.clave === columna.clave ? tabla.orden : null;
  const filtrada = (tabla.filtros[columna.clave]?.length ?? 0) > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title={`${columna.titulo}: ordenar o filtrar`}
        className={`flex w-full min-w-0 items-center gap-1 hover:text-primary ${
          centro ? "justify-center" : ""
        } ${ordenada || filtrada ? "text-primary" : ""}`}
      >
        <span className="truncate">{etiqueta ?? columna.titulo}</span>
        {ordenada &&
          (ordenada.asc ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          ))}
        {filtrada && <Filter className="size-3 shrink-0" />}
      </button>
      {abierto && (
        <MenuColumna columna={columna} tabla={tabla} onCerrar={() => setAbierto(false)} />
      )}
    </>
  );
}

function MenuColumna<T>({
  columna,
  tabla,
  onCerrar,
}: {
  columna: ColumnaReporte<T>;
  tabla: TablaReporte<T>;
  onCerrar: () => void;
}) {
  const filtrable = columna.filtrable !== false;
  const [texto, setTexto] = useState("");
  const [borrador, setBorrador] = useState(() => new Set(tabla.filtros[columna.clave] ?? []));
  const valores = filtrable ? tabla.valoresDe(columna.clave) : [];
  const q = normalizar(texto.trim());
  const encontrados = q ? valores.filter((v) => normalizar(v.valor).includes(q)) : valores;
  const ordenada = tabla.orden?.clave === columna.clave ? tabla.orden : null;

  const ordenar = (asc: boolean) => {
    // Tocar el orden que ya está lo saca: vuelve al orden del reporte.
    tabla.ordenar(ordenada?.asc === asc ? null : { clave: columna.clave, asc });
    onCerrar();
  };
  const alternar = (v: string) =>
    setBorrador((prev) => {
      const sig = new Set(prev);
      if (sig.has(v)) sig.delete(v);
      else sig.add(v);
      return sig;
    });
  const aplicar = () => {
    tabla.filtrar(
      columna.clave,
      valores.filter((v) => borrador.has(v.valor)).map((v) => v.valor),
    );
    onCerrar();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_auto_1fr_auto] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-5 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-xl">{columna.titulo}</DialogTitle>
          <DialogDescription className="text-xs">
            {filtrable
              ? "Ordenar la columna, o quedarse con algunos de sus valores"
              : "Ordenar la columna"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 pb-3">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { asc: true, texto: "Ascendente", Icono: ArrowUp },
                { asc: false, texto: "Descendente", Icono: ArrowDown },
              ] as const
            ).map(({ asc, texto: t, Icono }) => (
              <button
                key={t}
                type="button"
                onClick={() => ordenar(asc)}
                aria-pressed={ordenada?.asc === asc}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold ${
                  ordenada?.asc === asc
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-input hover:border-primary/40"
                }`}
              >
                <Icono className="size-4" />
                {t}
              </button>
            ))}
          </div>
          {filtrable && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Buscar un valor…"
                  aria-label={`Buscar en ${columna.titulo}`}
                  className="h-11 w-full rounded-xl border border-input bg-muted/60 pr-10 pl-10 text-base outline-none focus:border-primary/40 focus:bg-card"
                />
                {texto && (
                  <button
                    type="button"
                    onClick={() => setTexto("")}
                    aria-label="Limpiar"
                    className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setBorrador(new Set())}
                  className="rounded-lg px-2 py-1 font-semibold text-muted-foreground hover:bg-muted"
                >
                  Ninguno
                </button>
                <span className="ml-auto text-muted-foreground">
                  {borrador.size} de {numero.format(valores.length)}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3">
          {filtrable &&
            (encontrados.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {valores.length ? `Nada coincide con “${texto.trim()}”` : "No hay valores"}
              </p>
            ) : (
              <ul className="space-y-1">
                {encontrados.slice(0, MAX_VALORES).map((v) => {
                  const marcado = borrador.has(v.valor);
                  return (
                    <li key={v.valor}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={marcado}
                        onClick={() => alternar(v.valor)}
                        className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${
                          marcado
                            ? "border-primary bg-primary-soft"
                            : "border-border/60 bg-card hover:border-primary/40"
                        }`}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-md border-2 ${
                            marcado
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {marcado && <Check className="size-3.5" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 text-sm leading-snug break-words">
                          {v.valor || <span className="text-muted-foreground">(vacío)</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {numero.format(v.n)}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {encontrados.length > MAX_VALORES && (
                  <li className="px-3 py-2 text-center text-xs text-muted-foreground">
                    Y {numero.format(encontrados.length - MAX_VALORES)} más: buscá para
                    encontrarlos.
                  </li>
                )}
              </ul>
            ))}
        </div>

        {filtrable && (
          <div className="flex gap-2 border-t border-border/60 px-5 py-3">
            <button
              type="button"
              onClick={() => {
                tabla.filtrar(columna.clave, []);
                onCerrar();
              }}
              className="h-11 flex-1 rounded-xl border border-input text-sm font-medium"
            >
              Quitar filtro
            </button>
            <button
              type="button"
              onClick={aplicar}
              className="h-11 flex-[2] rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft"
            >
              Aplicar ({borrador.size})
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Lo puesto en las columnas, como chips sobre la tabla: el orden y cada
 * filtro, que se quitan de a uno, y "Quitar todo".
 */
export function FiltrosColumnas<T>({ tabla }: { tabla: TablaReporte<T> }) {
  if (!tabla.activo) return null;
  const titulo = (clave: string) => tabla.columnas.find((c) => c.clave === clave)?.titulo ?? clave;
  const chip = (clave: string, texto: string, quitar: () => void) => (
    <span
      key={clave}
      className="flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-medium"
    >
      <span className="truncate">{texto}</span>
      <button
        type="button"
        onClick={quitar}
        aria-label={`Quitar ${texto}`}
        className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card"
      >
        <X className="size-3" />
      </button>
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
      {tabla.orden &&
        chip("orden", `Orden: ${titulo(tabla.orden.clave)} ${tabla.orden.asc ? "↑" : "↓"}`, () =>
          tabla.ordenar(null),
        )}
      {Object.entries(tabla.filtros).map(([clave, valores]) =>
        chip(
          `f-${clave}`,
          `${titulo(clave)}: ${valores[0] || "(vacío)"}${valores.length > 1 ? ` +${valores.length - 1}` : ""}`,
          () => tabla.filtrar(clave, []),
        ),
      )}
      <button
        type="button"
        onClick={tabla.limpiar}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
      >
        <RotateCcw className="size-3" />
        Quitar todo
      </button>
    </div>
  );
}
