import {
  AlertCircle,
  Copy,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { LupaPlanilla } from "@/components/lupa-planilla";
import { escribirHora, normalizarHora, usePlanilla } from "@/lib/lupa";
import { normalizar } from "@/lib/utils";

/**
 * Una grilla editable en línea, como el Interactive Grid de APEX en modo
 * edición. La usan solo Pre-horarios (página 43) y Postulaciones (página 38),
 * que Jose pidió el 09/10/2026 que se vieran y funcionaran igual que en APEX.
 *
 * Funciona como el IG:
 *
 * - Cada celda se edita ahí mismo (texto, número, hora o lista). Las celdas
 *   cambiadas llevan la marca en la esquina; nada se guarda hasta tocar
 *   **Guardar**, que manda las filas una por una (borradas, modificadas y
 *   nuevas). Si una falla, queda con su error y el resto sigue.
 * - **Agregar fila** la suma arriba; **Eliminar** la tacha hasta guardar (otro
 *   toque la recupera); **Duplicar** copia la fila como nueva.
 * - Flechas arriba/abajo y Enter pasan de fila en la misma columna.
 * - **Buscar** filtra lo que se ve; abajo, el total de filas.
 *
 * Las filas trabajan con texto (`Record<string, string>`): cada pantalla
 * convierte de y hacia lo que pide su backend.
 */

export type OpcionGrilla = { valor: string; mostrar: string; inactiva?: boolean };

export type ColumnaGrilla = {
  clave: string;
  titulo: string;
  tipo?: "texto" | "numero" | "hora" | "lista";
  /** Para `lista`. Las `inactiva` se ofrecen solo si ya estaban elegidas. */
  opciones?: OpcionGrilla[];
  /** En px. */
  ancho?: number;
  alinear?: "izq" | "der" | "centro";
  /** Color de la columna (los manuales de la 38). */
  fondo?: string;
  tinta?: string;
  /**
   * Color de la CELDA según su valor (el manual elegido en Pre-horarios,
   * 09/10/2026): fondo sólido y letra en su tinta. Manda sobre `fondo`.
   */
  colorValor?: (valor: string) => { fondo: string; tinta: string } | undefined;
  mayusculas?: boolean;
  max?: number;
  /** Se muestra pero no se edita. */
  soloLectura?: boolean;
  /**
   * Encabezado en dos niveles (09/10/2026): las columnas SEGUIDAS con el mismo
   * `grupo` comparten un título arriba ("Lunes") y debajo va su `subtitulo`
   * ("Desde" / "Hasta"). Solo cambia el encabezado: cada columna sigue siendo
   * su propio dato. `titulo` se sigue usando para los errores y la
   * accesibilidad, así que conviene que diga todo ("Lun Des").
   */
  grupo?: string;
  subtitulo?: string;
};

export type FilaGrilla = {
  id: number;
  datos: Record<string, string>;
  /** Motivo por el que no se puede modificar ni eliminar. */
  bloqueada?: string;
  /** Motivo por el que no se puede eliminar (sí modificar). */
  sinBorrar?: string;
};

type Nueva = { tmp: number; datos: Record<string, string> };

export function GrillaEditable({
  columnas,
  filas,
  editable,
  nueva,
  alCambiar,
  validar,
  guardarFila,
  eliminarFila,
  onGuardado,
  extra,
  vacio = "Sin datos",
}: {
  columnas: ColumnaGrilla[];
  filas: FilaGrilla[];
  editable: boolean;
  /** Los valores por defecto de una fila nueva. */
  nueva: () => Record<string, string>;
  /** Para cambios encadenados (el docente pisa el teléfono, como en APEX). */
  alCambiar?: (
    clave: string,
    valor: string,
    datos: Record<string, string>,
  ) => Record<string, string>;
  /** El error de la fila, o null si está bien. */
  validar?: (datos: Record<string, string>) => string | null;
  guardarFila: (id: number | null, datos: Record<string, string>) => Promise<unknown>;
  eliminarFila: (id: number) => Promise<unknown>;
  /** Después de guardar: refrescar las listas. Se espera antes de limpiar. */
  onGuardado: () => Promise<unknown> | void;
  /** Lo que va entre la barra y la grilla; `agregar` suma una fila nueva. */
  extra?: (agregar: (datos: Record<string, string>) => void) => ReactNode;
  vacio?: string;
}) {
  const [cambios, setCambios] = useState<Map<number, Record<string, string>>>(new Map());
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  const [borrar, setBorrar] = useState<Set<number>>(new Set());
  const [errores, setErrores] = useState<Map<number, string>>(new Map());
  const [buscar, setBuscar] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tmp = useRef(-1);
  const tabla = useRef<HTMLTableElement>(null);

  const porId = useMemo(() => new Map(filas.map((f) => [f.id, f])), [filas]);
  const pendientes = cambios.size + nuevas.length + borrar.size;

  const agregar = (datos: Record<string, string>) => {
    const t = tmp.current--;
    setNuevas((x) => [{ tmp: t, datos: { ...nueva(), ...datos } }, ...x]);
  };

  /** `id` < 0: una fila nueva. */
  const cambiar = (id: number, clave: string, valor: string) => {
    setErrores((e) => {
      if (!e.has(id)) return e;
      const n = new Map(e);
      n.delete(id);
      return n;
    });
    if (id < 0) {
      setNuevas((x) =>
        x.map((f) => {
          if (f.tmp !== id) return f;
          const datos = { ...f.datos, [clave]: valor };
          return { ...f, datos: alCambiar ? alCambiar(clave, valor, datos) : datos };
        }),
      );
      return;
    }
    const original = porId.get(id)?.datos ?? {};
    setCambios((m) => {
      const actual = { ...original, ...m.get(id), [clave]: valor };
      const datos = alCambiar ? alCambiar(clave, valor, actual) : actual;
      // Se guarda solo lo que difiere del original.
      const dif = Object.fromEntries(
        Object.entries(datos).filter(([k, v]) => (original[k] ?? "") !== v),
      );
      const n = new Map(m);
      if (Object.keys(dif).length) n.set(id, dif);
      else n.delete(id);
      return n;
    });
  };

  const alternarBorrado = (id: number) => {
    if (id < 0) {
      setNuevas((x) => x.filter((f) => f.tmp !== id));
      return;
    }
    setBorrar((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const deshacer = () => {
    setCambios(new Map());
    setNuevas([]);
    setBorrar(new Set());
    setErrores(new Map());
  };

  const datosDe = (f: FilaGrilla) => ({ ...f.datos, ...cambios.get(f.id) });

  const guardar = async () => {
    // Primero se validan todas, como el IG antes de mandar.
    const malas = new Map<number, string>();
    if (validar) {
      for (const n of nuevas) {
        const e = validar(n.datos);
        if (e) malas.set(n.tmp, e);
      }
      for (const id of cambios.keys()) {
        const f = porId.get(id);
        if (!f || borrar.has(id)) continue;
        const e = validar(datosDe(f));
        if (e) malas.set(id, e);
      }
    }
    if (malas.size) {
      setErrores(malas);
      toast.error(
        malas.size === 1 ? "Una fila tiene errores" : `${malas.size} filas tienen errores`,
      );
      return;
    }

    setGuardando(true);
    const fallos = new Map<number, string>();
    const msg = (e: unknown) => (e instanceof Error ? e.message : "No se pudo guardar");
    let hechas = 0;
    for (const id of borrar) {
      try {
        await eliminarFila(id);
        hechas++;
      } catch (e) {
        fallos.set(id, msg(e));
      }
    }
    for (const id of cambios.keys()) {
      const f = porId.get(id);
      if (!f || borrar.has(id)) continue;
      try {
        await guardarFila(id, datosDe(f));
        hechas++;
      } catch (e) {
        fallos.set(id, msg(e));
      }
    }
    // Las nuevas, de abajo hacia arriba: en el orden en que se agregaron.
    for (const n of [...nuevas].reverse()) {
      try {
        await guardarFila(null, n.datos);
        hechas++;
      } catch (e) {
        fallos.set(n.tmp, msg(e));
      }
    }

    if (hechas) await onGuardado();
    setBorrar((s) => new Set([...s].filter((id) => fallos.has(id))));
    setCambios((m) => new Map([...m].filter(([id]) => fallos.has(id))));
    setNuevas((x) => x.filter((n) => fallos.has(n.tmp)));
    setErrores(fallos);
    setGuardando(false);
    if (fallos.size)
      toast.error(
        `${hechas ? `Se guardaron ${hechas}; ` : ""}${fallos.size === 1 ? "una fila no se pudo guardar" : `${fallos.size} filas no se pudieron guardar`}`,
      );
    else toast.success("Cambios guardados");
  };

  const texto = (c: ColumnaGrilla, v: string) =>
    c.tipo === "lista" ? (c.opciones?.find((o) => o.valor === v)?.mostrar ?? v) : v;

  const q = normalizar(buscar.trim());
  const visibles = q
    ? filas.filter((f) => {
        const d = datosDe(f);
        return columnas.some((c) => normalizar(texto(c, d[c.clave] ?? "")).includes(q));
      })
    : filas;
  const vista: { id: number; datos: Record<string, string>; fila?: FilaGrilla }[] = [
    ...nuevas.map((n) => ({ id: n.tmp, datos: n.datos })),
    ...visibles.map((f) => ({ id: f.id, datos: datosDe(f), fila: f })),
  ];

  /** Flechas y Enter: la misma columna, una fila arriba o abajo. */
  const mover = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    const paso = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!paso) return;
    const sig = tabla.current?.querySelector<HTMLElement>(`[data-celda="${r + paso}:${c}"]`);
    if (sig) {
      e.preventDefault();
      sig.focus();
    }
  };

  const ancho = (c: ColumnaGrilla) => c.ancho ?? (c.tipo === "hora" ? 44 : 96);
  const alinear = (c: ColumnaGrilla) =>
    c.alinear === "der" ? "text-right" : c.alinear === "centro" ? "text-center" : "text-left";

  // La lupa y el encabezado fijo (`lib/lupa.ts`), con el ancho natural de
  // la planilla: la suma de sus columnas.
  const natural = (editable ? ANCHO_ACCIONES : 0) + columnas.reduce((n, c) => n + ancho(c), 0);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(natural);
  const conGrupos = columnas.some((c) => c.grupo);

  return (
    <div className="space-y-2">
      {/* La barra del IG: buscar, agregar, deshacer y guardar. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar en la grilla"
            className="h-9 w-full rounded-lg border border-input bg-card pr-8 pl-8 text-base outline-none focus:border-primary/40 lg:text-sm"
          />
          {buscar && (
            <button
              type="button"
              onClick={() => setBuscar("")}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {editable && (
          <>
            <button
              type="button"
              disabled={guardando}
              onClick={() => agregar({})}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-50"
            >
              <Plus className="size-4" />
              Agregar fila
            </button>
            {pendientes > 0 && (
              <button
                type="button"
                disabled={guardando}
                onClick={deshacer}
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <Undo2 className="size-4" />
                Deshacer
              </button>
            )}
            <button
              type="button"
              disabled={guardando || !pendientes}
              onClick={guardar}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {guardando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Guardar{pendientes ? ` (${pendientes})` : ""}
            </button>
          </>
        )}
      </div>

      {extra?.(agregar)}

      {/*
        LA LUPA (09/10/2026, a pedido): achica o agranda SOLO la planilla, no
        la página. "Ajustar" la deja del tamaño justo para ver todas las
        columnas de un pantallazo. Se recuerda en este navegador.
      */}
      <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />

      {/*
        TODAS LAS FILAS A LA VISTA, sin barra propia (09/10/2026, a pedido):
        antes el recuadro cortaba en el 70 % de la pantalla y tenía su scroll.
        Ahora se baja con el de la página. Si la planilla entra a lo ancho, el
        recuadro no recorta nada y el encabezado queda pegado bajo la cabecera
        de la app; si no entra, queda solo el desplazamiento de costado
        ("Ajustar" lo saca).
      */}
      <div
        ref={marco}
        className={`rounded-xl border border-border/70 bg-card ${cabe ? "" : "overflow-x-auto"}`}
      >
        <table
          ref={tabla}
          // `zoom` y no `transform: scale`: con zoom la tabla ocupa de verdad
          // su tamaño nuevo, así el scroll y los encabezados fijos siguen bien.
          // El ANCHO EXACTO de las columnas (`table-fixed` + el ancho natural),
          // así la lupa achica columnas y letras juntas. Antes la tabla se
          // estiraba a todo el recuadro (`min-w-full`) y al achicarla las
          // columnas volvían a ensancharse: solo se achicaba la letra. Al 100 %
          // o más se sigue estirando para llenar el recuadro, como antes.
          style={{ zoom, width: natural }}
          className={`table-fixed border-separate border-spacing-0 text-[12px] ${zoom >= 1 ? "min-w-full" : ""}`}
        >
          <colgroup>
            {editable && <col style={{ width: ANCHO_ACCIONES }} />}
            {columnas.map((c) => (
              <col key={c.clave} style={{ width: ancho(c) }} />
            ))}
          </colgroup>
          <thead
            className={cabe ? "sticky z-20" : ""}
            style={cabe ? { top: topEncabezado } : undefined}
          >
            {conGrupos ? (
              <>
                {/* Fila 1: los grupos (un título sobre varias columnas) y las
                    columnas sueltas, que ocupan las dos filas. */}
                <tr>
                  {editable && (
                    <th
                      rowSpan={2}
                      className="sticky left-0 z-10 border-r border-b border-border/70 bg-muted"
                    />
                  )}
                  {columnas.map((c, i) => {
                    if (!c.grupo) {
                      return (
                        <th
                          key={c.clave}
                          scope="col"
                          rowSpan={2}
                          className={`border-r border-b border-border/70 truncate px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap last:border-r-0 ${alinear(c)}`}
                          title={c.titulo}
                          style={{ backgroundColor: c.fondo ?? "var(--muted)", color: c.tinta }}
                        >
                          {c.titulo}
                        </th>
                      );
                    }
                    // Solo la primera del grupo dibuja el título, con el ancho de todas.
                    if (columnas[i - 1]?.grupo === c.grupo) return null;
                    let n = 1;
                    while (columnas[i + n]?.grupo === c.grupo) n++;
                    return (
                      <th
                        key={`g-${c.clave}`}
                        scope="colgroup"
                        colSpan={n}
                        className="border-r border-b border-border/70 bg-muted px-1 py-1 text-center text-[11px] font-semibold whitespace-nowrap last:border-r-0"
                      >
                        {c.grupo}
                      </th>
                    );
                  })}
                </tr>
                {/* Fila 2: las columnas de cada grupo ("Desde" / "Hasta"). */}
                <tr>
                  {columnas
                    .filter((c) => c.grupo)
                    .map((c) => (
                      <th
                        key={c.clave}
                        scope="col"
                        className={`border-r border-b border-border/70 px-1 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-muted-foreground ${alinear(c)}`}
                        style={{ backgroundColor: c.fondo ?? "var(--muted)", color: c.tinta }}
                      >
                        {c.subtitulo ?? c.titulo}
                      </th>
                    ))}
                </tr>
              </>
            ) : (
              <tr>
                {editable && (
                  <th className="sticky left-0 z-10 border-r border-b border-border/70 bg-muted" />
                )}
                {columnas.map((c) => (
                  <th
                    key={c.clave}
                    scope="col"
                    className={`border-r border-b border-border/70 truncate px-1 py-1.5 text-[11px] font-semibold whitespace-nowrap last:border-r-0 ${alinear(c)}`}
                    title={c.titulo}
                    style={{
                      backgroundColor: c.fondo ?? "var(--muted)",
                      color: c.tinta,
                    }}
                  >
                    {c.titulo}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {!vista.length && (
              <tr>
                <td
                  colSpan={columnas.length + (editable ? 1 : 0)}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  {q ? "Ninguna fila coincide con la búsqueda." : vacio}
                </td>
              </tr>
            )}
            {vista.map(({ id, datos, fila }, r) => {
              const esNueva = id < 0;
              const tachada = borrar.has(id);
              const bloqueo = fila?.bloqueada;
              const editarFila = editable && !bloqueo && !tachada && !guardando;
              const error = errores.get(id);
              const original = fila?.datos;
              const fondoFila = error
                ? "bg-destructive/5"
                : esNueva
                  ? "bg-primary/5"
                  : tachada
                    ? "bg-muted/60"
                    : "";
              return [
                <tr key={id} className={`${fondoFila} ${tachada ? "text-muted-foreground" : ""}`}>
                  {editable && (
                    <td
                      // Fija: fondo opaco, y el estado de la fila en el borde izquierdo.
                      className={`sticky left-0 z-10 border-r border-b border-l-[3px] border-border/60 bg-card px-1 ${
                        error
                          ? "border-l-destructive"
                          : esNueva
                            ? "border-l-primary"
                            : tachada
                              ? "border-l-muted-foreground/50"
                              : "border-l-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        {bloqueo ? (
                          <span title={bloqueo} className="p-0.5 text-muted-foreground">
                            <Lock className="size-3.5" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={guardando || (!!fila?.sinBorrar && !tachada)}
                            title={
                              fila?.sinBorrar && !tachada
                                ? fila.sinBorrar
                                : tachada
                                  ? "Recuperar"
                                  : "Eliminar"
                            }
                            aria-label={tachada ? "Recuperar fila" : "Eliminar fila"}
                            onClick={() => alternarBorrado(id)}
                            className={`rounded p-0.5 hover:bg-muted disabled:opacity-30 ${tachada ? "text-primary" : "text-destructive"}`}
                          >
                            {tachada ? (
                              <RotateCcw className="size-3.5" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={guardando}
                          title="Duplicar"
                          aria-label="Duplicar fila"
                          onClick={() => agregar(datos)}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        >
                          <Copy className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                  {columnas.map((c, ci) => {
                    const v = datos[c.clave] ?? "";
                    const cambiada =
                      !esNueva && original != null && (original[c.clave] ?? "") !== v;
                    const editarCelda = editarFila && !c.soloLectura;
                    return (
                      <td
                        key={c.clave}
                        className={`relative border-r border-b border-border/60 p-0 last:border-r-0 ${alinear(c)} ${tachada ? "line-through" : ""}`}
                        style={estiloCelda(c, v)}
                      >
                        {cambiada && (
                          <span
                            aria-hidden
                            className="absolute top-0 left-0 size-0 border-t-[7px] border-r-[7px] border-t-primary border-r-transparent"
                          />
                        )}
                        {editarCelda ? (
                          <Celda
                            c={c}
                            valor={v}
                            celda={`${r}:${ci}`}
                            onCambio={(x) => cambiar(id, c.clave, x)}
                            onTecla={(e) => mover(e, r, ci)}
                          />
                        ) : (
                          <span className="block truncate px-1 py-1" title={texto(c, v)}>
                            {texto(c, v)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>,
                error ? (
                  <tr key={`${id}-error`}>
                    <td
                      colSpan={columnas.length + (editable ? 1 : 0)}
                      className="border-b border-border/60 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive"
                    >
                      <span className="sticky left-3 inline-flex items-center gap-1.5">
                        <AlertCircle className="size-3.5 shrink-0" />
                        {error}
                      </span>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-right text-[12px] text-muted-foreground">
        Total {filas.length}
        {q && visibles.length !== filas.length ? ` · se ven ${visibles.length}` : ""}
      </p>
    </div>
  );
}

/** El fondo de una celda: el del valor (`colorValor`) o el de la columna. */
function estiloCelda(c: ColumnaGrilla, v: string) {
  const porValor = v ? c.colorValor?.(v) : undefined;
  if (porValor) return { backgroundColor: porValor.fondo, color: porValor.tinta, fontWeight: 600 };
  return c.fondo ? { backgroundColor: `${c.fondo}33` } : undefined;
}

/**
 * Lo más compacto que se puede sin achicar la letra (09/10/2026, a pedido:
 * ver la mayor cantidad de datos de un pantallazo): 12 px, poco relleno y
 * filas de 28 px. La columna de acciones (borrar y copiar) mide esto.
 */
const ANCHO_ACCIONES = 50;

const claseEntrada =
  "block h-7 w-full min-w-0 bg-transparent px-1 text-[12px] outline-none focus:bg-background focus:ring-2 focus:ring-primary/50 focus:ring-inset";

function Celda({
  c,
  valor,
  celda,
  onCambio,
  onTecla,
}: {
  c: ColumnaGrilla;
  valor: string;
  celda: string;
  onCambio: (v: string) => void;
  onTecla: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const alin = c.alinear === "der" ? "text-right" : c.alinear === "centro" ? "text-center" : "";
  if (c.tipo === "lista") {
    return <CeldaLista c={c} valor={valor} celda={celda} alin={alin} onCambio={onCambio} />;
  }
  if (c.tipo === "hora") {
    return <CeldaHora c={c} valor={valor} celda={celda} onCambio={onCambio} onTecla={onTecla} />;
  }
  return (
    <input
      data-celda={celda}
      type="text"
      inputMode={c.tipo === "numero" ? "numeric" : undefined}
      value={valor}
      maxLength={c.max}
      aria-label={c.titulo}
      onChange={(e) => {
        let v = e.target.value;
        if (c.tipo === "numero") v = v.replace(/\D/g, "");
        if (c.mayusculas) v = v.toUpperCase();
        onCambio(v);
      }}
      // Un clic y ya se escribe encima: el texto queda seleccionado.
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onTecla}
      className={`${claseEntrada} ${alin} tabular-nums`}
    />
  );
}

/**
 * Una celda de lista que arma su <select> RECIÉN AL TOCARLA (09/10/2026).
 *
 * Con un <select> completo en cada celda, la planilla de Postulaciones tenía
 * ~25.000 <option> (400 docentes, 150 facilitadores… por fila) y cada tecla las
 * volvía a armar: medido con la CPU x4, ~3 s para abrirla y ~140 ms por tecla.
 * Sin tocar, la celda es un botón con el texto elegido; al enfocarla (clic,
 * Tab o las flechas, que buscan `data-celda`) se cambia por el <select> y, si
 * fue con el mouse o el dedo, se despliega solo (`showPicker`).
 */
function CeldaLista({
  c,
  valor,
  celda,
  alin,
  onCambio,
}: {
  c: ColumnaGrilla;
  valor: string;
  celda: string;
  alin: string;
  onCambio: (v: string) => void;
}) {
  const [activa, setActiva] = useState(false);
  const conPuntero = useRef(false);
  const sel = useRef<HTMLSelectElement>(null);
  const color = valor ? c.colorValor?.(valor) : undefined;

  // Recién montado el <select>: el foco, y desplegarlo si se tocó con el mouse.
  useEffect(() => {
    if (!activa || !sel.current) return;
    sel.current.focus();
    if (conPuntero.current) {
      conPuntero.current = false;
      try {
        sel.current.showPicker();
      } catch {
        /* navegador sin showPicker: queda enfocado, se abre con otro toque */
      }
    }
  }, [activa]);

  if (!activa) {
    const mostrar = valor ? (c.opciones?.find((o) => o.valor === valor)?.mostrar ?? valor) : "";
    return (
      <button
        type="button"
        data-celda={celda}
        aria-label={`${c.titulo}: ${mostrar || "vacío"}`}
        title={mostrar || undefined}
        onPointerDown={() => {
          conPuntero.current = true;
        }}
        onFocus={() => setActiva(true)}
        className={`${claseEntrada} ${alin} cursor-pointer truncate text-left ${color ? "focus:bg-transparent" : ""}`}
        style={color ? { color: color.tinta, fontWeight: 600 } : undefined}
      >
        {mostrar}
      </button>
    );
  }

  const ops = (c.opciones ?? []).filter((o) => !o.inactiva || o.valor === valor);
  const conocida = !valor || ops.some((o) => o.valor === valor);
  return (
    <select
      ref={sel}
      data-celda={celda}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      onBlur={() => setActiva(false)}
      aria-label={c.titulo}
      // Con color por valor, la celda no se blanquea al enfocarla: se vería
      // letra blanca sobre blanco. Queda el anillo del foco.
      className={`${claseEntrada} ${alin} cursor-pointer appearance-none ${color ? "focus:bg-transparent" : ""}`}
      style={color ? { color: color.tinta, fontWeight: 600 } : undefined}
    >
      <option value=""></option>
      {!conocida && <option value={valor}>{valor}</option>}
      {ops.map((o) => {
        const co = c.colorValor?.(o.valor);
        return (
          <option
            key={o.valor}
            value={o.valor}
            style={co ? { backgroundColor: co.fondo, color: co.tinta } : undefined}
          >
            {o.mostrar}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Una hora "HH:MM" como TEXTO, sin el reloj del navegador (09/10/2026, a
 * pedido): con un clic queda todo seleccionado y se escribe encima. Se tipean
 * los números y los dos puntos se ponen solos ("0730" → "07:30"); al salir
 * se completa ("7" → "07:00", "730" → "07:30"). Lo que no es una hora válida
 * queda como se escribió y la validación de la fila lo marca. Además pesa
 * mucho menos que un <input type="time">, que son diez por fila.
 */
function CeldaHora({
  c,
  valor,
  celda,
  onCambio,
  onTecla,
}: {
  c: ColumnaGrilla;
  valor: string;
  celda: string;
  onCambio: (v: string) => void;
  onTecla: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <input
      data-celda={celda}
      type="text"
      inputMode="numeric"
      placeholder="--:--"
      maxLength={5}
      value={valor}
      aria-label={c.titulo}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onCambio(escribirHora(e.target.value))}
      onBlur={(e) => {
        const n = normalizarHora(e.target.value);
        if (n !== e.target.value) onCambio(n);
      }}
      onKeyDown={onTecla}
      className={`${claseEntrada} text-center tabular-nums placeholder:text-muted-foreground/50`}
    />
  );
}
