import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { keys, lista, STALE_LISTAS, type Opcion } from "@/lib/evaluaciones";

type Nombre = "facilitadores" | "instituciones" | "areas" | "evaluaciones" | "ciudades";

type Props = {
  label: string;
  /**
   * Lista del backend. Excluyente con `opciones`: uno de los dos tiene que venir.
   */
  nombre?: Nombre;
  /**
   * Lista fija, ya en memoria (una escala, no una tabla). Cuando viene, no hay
   * request ni buscador: son pocas filas y todas están a la vista.
   */
  opciones?: Opcion[];
  value: number | null;
  /** Texto a mostrar cuando el valor viene de la API y la lista no se abrió aún. */
  valueText?: string | null;
  /** Recibe la opción completa: `instituciones` trae también la ciudad. */
  onChange: (o: Opcion) => void;
  placeholder?: string;
  /** Motivo por el que está deshabilitado; se muestra en lugar del placeholder. */
  disabledReason?: string;
  /** Solo `evaluaciones`: filtra por el área elegida. */
  idArea?: number | null;
  /** Solo `instituciones`: solo las del facilitador (vía POSTULACIONES). */
  idFacilitador?: number | null;
  /** Al editar: trae el valor guardado aunque esté inactivo. */
  incluirId?: number | null;
  requerido?: boolean;
};

/** Desde cuántas filas una lista fija justifica un buscador. */
const UMBRAL_BUSCADOR = 8;

/**
 * Lista de valores en modal, con un botón como campo y un buscador adentro.
 *
 * Sirve a los dos tipos de lista del formulario, y la diferencia es de dónde
 * salen las filas:
 *
 * - **`nombre`** — una lista del backend (`listas/:nombre`). La consulta arranca
 *   recién al abrir (`enabled: abierto`): la pantalla no gasta cinco requests en
 *   listas que el usuario capaz ni toca. El buscador trabaja en dos niveles a la
 *   vez:
 *
 *     1. Contra el servidor (`?buscar=`, con debounce de 300 ms). Necesario
 *        porque el backend corta en 100 filas: lo que se busca puede no estar
 *        cargado.
 *     2. En memoria, sobre TODOS los campos de las filas ya traídas (`busqueda`).
 *        Así se encuentra por CI, por estado o por id, no solo por el nombre, y
 *        el filtrado se siente instantáneo mientras el servidor responde.
 *
 * - **`opciones`** — una escala fija del front (calificaciones). Sin request, sin
 *   estados de carga y sin buscador si son menos de {@link UMBRAL_BUSCADOR}:
 *   buscar entre cinco palabras que ya se ven es un campo de más.
 */
export function PickerModal({
  label,
  nombre,
  opciones: estaticas,
  value,
  valueText,
  onChange,
  placeholder = "Seleccionar",
  disabledReason,
  idArea,
  idFacilitador,
  incluirId,
  requerido = false,
}: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [elegidoTexto, setElegidoTexto] = useState<string | null>(null);

  // Debounce solo para el viaje al servidor; el filtro en memoria usa `texto`
  // directo y por eso responde en la misma tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const params = {
    buscar: buscar || undefined,
    id_area: nombre === "evaluaciones" ? idArea : undefined,
    id_facilitador: nombre === "instituciones" ? idFacilitador : undefined,
    incluir_id: incluirId ?? undefined,
  };

  // El hook se llama siempre —las reglas de hooks no permiten saltearlo— pero con
  // lista estática queda apagado y nunca toca la red.
  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: nombre ? keys.lista(nombre, params) : ["lista", "estatica", label],
    queryFn: () => lista(nombre as Nombre, params),
    enabled: abierto && !estaticas,
    staleTime: STALE_LISTAS,
  });

  const q = texto.trim().toLowerCase();
  const todas = estaticas ?? data ?? [];
  const opciones = q ? todas.filter((o) => o.busqueda.includes(q)) : todas;

  const conBuscador = !estaticas || estaticas.length > UMBRAL_BUSCADOR;
  // Con lista estática no hay nada que cargar ni que falle: las dos banderas
  // quedarían en false igual, pero decirlo explícito ahorra tener que razonar
  // sobre qué devuelve react-query con `enabled: false`.
  const cargando = !estaticas && isLoading;
  const fallo = !estaticas && isError;

  const deshabilitado = Boolean(disabledReason);
  // El texto elegido en esta sesión manda sobre el que vino de la API.
  const mostrado = elegidoTexto ?? valueText ?? null;
  const conValor = value !== null && Boolean(mostrado);

  const elegir = (o: Opcion) => {
    setElegidoTexto(o.texto);
    onChange(o);
    setAbierto(false);
    setTexto("");
  };

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}
        {requerido ? <span className="ml-0.5 text-destructive">*</span> : null}
      </label>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogTrigger asChild disabled={deshabilitado}>
          {/* min-h-12 y no h-12: el campo crece con el texto. Ver la elección
              recortada acá sería el mismo problema que recortarla en la lista. */}
          <button
            type="button"
            className={`tap flex min-h-12 w-full items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-left text-base ${
              deshabilitado
                ? "cursor-not-allowed border-input opacity-60"
                : conValor
                  ? "border-primary/40 font-medium"
                  : "border-input hover:border-primary/40"
            }`}
          >
            <span
              className={`min-w-0 flex-1 leading-snug ${conValor ? "" : "text-muted-foreground"}`}
            >
              {deshabilitado ? disabledReason : conValor ? mostrado : placeholder}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DialogTrigger>

        {/*
          Modal centrado que en móvil ocupa casi todo el ancho y como máximo el
          85% del alto: el teclado sube y la lista sigue teniendo espacio.
          p-0 y grid-rows: el header y el buscador quedan fijos y solo scrollea
          la lista.
        */}
        <DialogContent
          className={`grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md gap-0 overflow-hidden rounded-2xl p-0 ${
            // Una fila por hijo: sin buscador son dos, no tres.
            conBuscador ? "grid-rows-[auto_auto_1fr]" : "grid-rows-[auto_1fr]"
          }`}
        >
          <DialogHeader className="px-5 pt-5 pb-3 text-left">
            <DialogTitle className="font-display text-xl">{label}</DialogTitle>
            <DialogDescription className="text-xs">
              {conBuscador ? "Buscá por cualquier dato de la lista" : "Elegí una opción"}
            </DialogDescription>
          </DialogHeader>

          {conBuscador ? (
            <div className="relative px-5 pb-3">
              <Search className="pointer-events-none absolute top-1/2 left-8 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Buscar…"
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
              ) : (
                // Spinner al costado y no en lugar de la lista: refrescar no debe
                // hacer desaparecer lo que ya se está viendo.
                isFetching &&
                !isLoading && (
                  <Loader2 className="absolute top-1/2 right-8 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )
              )}
            </div>
          ) : null}

          <div className="min-h-[10rem] overflow-y-auto overscroll-contain px-3 pb-4">
            {cargando ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Cargando…
              </div>
            ) : fallo ? (
              <p className="px-4 py-12 text-center text-sm text-destructive">
                {error instanceof Error ? error.message : "No se pudo cargar la lista"}
              </p>
            ) : opciones.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                {q ? `Nada coincide con “${texto.trim()}”` : "No hay opciones disponibles"}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {opciones.map((o) => {
                  const activo = o.id === value;
                  return (
                    <li key={o.id}>
                      {/* Cada opción es un botón con borde, no una fila de texto:
                          se ve que es tocable y el área de toque es de 48px. */}
                      <button
                        type="button"
                        onClick={() => elegir(o)}
                        className={`tap flex min-h-12 w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
                          activo
                            ? "border-primary bg-primary-soft"
                            : "border-border/60 bg-card hover:border-primary/40"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          {/* Sin truncate: los nombres de facilitador, de
                              institución y las descripciones de área se cortarían
                              justo en la parte que distingue una fila de otra. */}
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

                {/* El backend corta en 100 filas: decirlo es mejor que dar a
                    entender que eso es todo lo que hay. Una lista estática no
                    tiene tope ni buscador, así que el aviso no aplica. */}
                {!estaticas && todas.length >= 100 ? (
                  <li className="px-4 py-3 text-center text-xs text-muted-foreground">
                    Se muestran las primeras 100. Escribí para buscar en el resto.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
