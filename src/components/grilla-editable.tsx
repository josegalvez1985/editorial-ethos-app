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
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

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
  mayusculas?: boolean;
  max?: number;
  /** Se muestra pero no se edita. */
  soloLectura?: boolean;
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

  const ancho = (c: ColumnaGrilla) => c.ancho ?? (c.tipo === "hora" ? 92 : 120);
  const alinear = (c: ColumnaGrilla) =>
    c.alinear === "der" ? "text-right" : c.alinear === "centro" ? "text-center" : "text-left";

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

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-border/70 bg-card">
        <table
          ref={tabla}
          className="w-max min-w-full border-separate border-spacing-0 text-[12.5px]"
        >
          <colgroup>
            {editable && <col style={{ width: 64 }} />}
            {columnas.map((c) => (
              <col key={c.clave} style={{ width: ancho(c) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              {editable && (
                <th className="sticky left-0 z-10 border-r border-b border-border/70 bg-muted" />
              )}
              {columnas.map((c) => (
                <th
                  key={c.clave}
                  scope="col"
                  className={`border-r border-b border-border/70 px-2 py-2 text-[11.5px] font-semibold whitespace-nowrap last:border-r-0 ${alinear(c)}`}
                  style={{
                    backgroundColor: c.fondo ?? "var(--muted)",
                    color: c.tinta,
                  }}
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
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
                          <span title={bloqueo} className="p-1 text-muted-foreground">
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
                            className={`rounded p-1 hover:bg-muted disabled:opacity-30 ${tachada ? "text-primary" : "text-destructive"}`}
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
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
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
                        style={c.fondo ? { backgroundColor: `${c.fondo}33` } : undefined}
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
                          <span className="block truncate px-2 py-1.5" title={texto(c, v)}>
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

const claseEntrada =
  "block h-8 w-full min-w-0 bg-transparent px-2 text-[12.5px] outline-none focus:bg-background focus:ring-2 focus:ring-primary/50 focus:ring-inset";

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
    const ops = (c.opciones ?? []).filter((o) => !o.inactiva || o.valor === valor);
    const conocida = !valor || ops.some((o) => o.valor === valor);
    return (
      <select
        data-celda={celda}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        aria-label={c.titulo}
        className={`${claseEntrada} ${alin} cursor-pointer appearance-none`}
      >
        <option value=""></option>
        {!conocida && <option value={valor}>{valor}</option>}
        {ops.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.mostrar}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      data-celda={celda}
      type={c.tipo === "hora" ? "time" : "text"}
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
      onKeyDown={onTecla}
      className={`${claseEntrada} ${alin} tabular-nums`}
    />
  );
}
