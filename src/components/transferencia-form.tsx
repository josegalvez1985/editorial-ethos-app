/**
 * El formulario de una transferencia de manuales: cabecera y detalle. Alta,
 * edición de una pendiente y vista de una recibida (solo lectura).
 *
 * ============================================================================
 * EL DISEÑO: UNA RUTA Y UN CARRITO
 * ============================================================================
 *
 * Arriba la **ruta**: Origen → Destino, con un botón para invertirlos (el
 * error más común es cargarla al revés). Abajo el **carrito**: los manuales que
 * viajan, uno por tarjeta, con − / + para la cantidad. Se agregan varios de una
 * vez con una lista con checks (`MultiSelectorModal`), y la misma lista sirve
 * para sacarlos.
 *
 * Cada línea muestra cuántos hay DISPONIBLES en el origen, y avisa en ámbar si
 * se envía más. Avisa pero deja guardar: las existencias pueden estar
 * desactualizadas (decidido el 25/09/2026).
 *
 * ============================================================================
 * RECIBIR ES EL PASO QUE MUEVE LAS EXISTENCIAS
 * ============================================================================
 *
 * Guardar no mueve nada. Lo hace "Confirmar recepción", vía el trigger
 * `TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS`, y no tiene vuelta atrás: una
 * recibida queda en solo lectura. Ver `lib/transferencias.ts`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  Save,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { keysInventario, listarSucursales } from "@/lib/inventarios";
import {
  actualizarTransferencia,
  crearTransferencia,
  disponible,
  eliminarTransferencia,
  keysTransferencias,
  manualesDeOrigen,
  recibirTransferencia,
  type ManualOrigen,
  type TransferenciaDetalle,
} from "@/lib/transferencias";

/** Una línea del carrito. La cantidad como texto: es lo que da el input. */
type Linea = { manual: string; cantidad: string };

const MAX_CANTIDAD = 9_999_999;

export function TransferenciaForm({ previa }: { previa?: TransferenciaDetalle }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editando = previa != null;
  const soloLectura = previa?.recibida === true;

  const [origen, setOrigen] = useState(previa ? String(previa.id_sucursal_origen) : "");
  const [destino, setDestino] = useState(previa ? String(previa.id_sucursal_destino) : "");
  const [lineas, setLineas] = useState<Linea[]>(
    () => previa?.detalle.map((l) => ({ manual: l.manual, cantidad: String(l.cantidad) })) ?? [],
  );
  const [confirmar, setConfirmar] = useState<"recibir" | "borrar" | null>(null);

  const sucursales = useQuery({
    queryKey: keysInventario.sucursales,
    queryFn: listarSucursales,
  });

  // Lo que hay en el ORIGEN elegido. Cambia con el origen: la disponibilidad
  // de la misma línea es otra si sale de otra sucursal.
  const manuales = useQuery({
    queryKey: keysTransferencias.manuales(Number(origen), previa?.id_transferencia),
    queryFn: () => manualesDeOrigen(Number(origen), previa?.id_transferencia),
    enabled: !!origen && !soloLectura,
  });

  const porManual = new Map<string, ManualOrigen>((manuales.data ?? []).map((m) => [m.manual, m]));
  const nombreSucursal = (id: string) =>
    sucursales.data?.find((s) => String(s.id_sucursal) === id)?.descripcion ??
    (previa && id === String(previa.id_sucursal_origen) ? previa.origen : null) ??
    (previa && id === String(previa.id_sucursal_destino) ? previa.destino : null) ??
    "";

  /* ---------------------------------------------------------------------- */
  /* Carrito                                                                */
  /* ---------------------------------------------------------------------- */

  /** La lista con checks devuelve lo marcado: se conserva lo que ya estaba. */
  function elegirManuales(marcados: string[]) {
    setLineas((prev) =>
      marcados.map((m) => prev.find((l) => l.manual === m) ?? { manual: m, cantidad: "1" }),
    );
  }

  function setCantidad(manual: string, texto: string) {
    const limpio = texto.replace(/\D/g, "").slice(0, 7);
    setLineas((prev) => prev.map((l) => (l.manual === manual ? { ...l, cantidad: limpio } : l)));
  }

  function sumar(manual: string, delta: number) {
    setLineas((prev) =>
      prev.map((l) =>
        l.manual === manual
          ? {
              ...l,
              cantidad: String(
                Math.min(MAX_CANTIDAD, Math.max(1, (Number(l.cantidad) || 0) + delta)),
              ),
            }
          : l,
      ),
    );
  }

  const quitar = (manual: string) => setLineas((prev) => prev.filter((l) => l.manual !== manual));

  function invertir() {
    setOrigen(destino);
    setDestino(origen);
  }

  const unidades = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);

  // Sin cambios respecto de lo guardado: recibir exige que no haya nada
  // pendiente, o se recibiría una versión que no es la que se ve.
  const sinCambios =
    !!previa &&
    origen === String(previa.id_sucursal_origen) &&
    destino === String(previa.id_sucursal_destino) &&
    lineas.length === previa.detalle.length &&
    lineas.every((l) =>
      previa.detalle.some((d) => d.manual === l.manual && String(d.cantidad) === l.cantidad),
    );

  /* ---------------------------------------------------------------------- */
  /* Guardar, recibir, borrar                                               */
  /* ---------------------------------------------------------------------- */

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysTransferencias.todo });
    // Recibir mueve EXISTENCIAS, que es lo que muestra Inventario.
    qc.invalidateQueries({ queryKey: keysInventario.todo });
  };

  const guardar = useMutation({
    mutationFn: async () => {
      const input = {
        id_sucursal_origen: Number(origen),
        id_sucursal_destino: Number(destino),
        lineas: lineas.map((l) => ({ manual: l.manual, cantidad: Number(l.cantidad) })),
      };
      if (editando) {
        await actualizarTransferencia(previa!.id_transferencia, input);
        return previa!.id_transferencia;
      }
      return crearTransferencia(input);
    },
    onSuccess: (id) => {
      invalidar();
      toast.success(editando ? "Transferencia actualizada" : "Transferencia registrada");
      // Al detalle y no a la lista: el paso siguiente natural es recibirla.
      navigate({ to: "/transferencias/$id", params: { id: String(id) } });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const recibir = useMutation({
    mutationFn: () => recibirTransferencia(previa!.id_transferencia),
    onSuccess: () => {
      invalidar();
      toast.success(`Recibida en ${previa!.destino}. Las existencias quedaron actualizadas.`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo recibir"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarTransferencia(previa!.id_transferencia),
    onSuccess: () => {
      invalidar();
      toast.success("Transferencia eliminada");
      navigate({ to: "/transferencias" });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || recibir.isPending || borrar.isPending;

  /*
   * Lo mismo que valida el backend, para no gastar un viaje de red en decir lo
   * obvio. El backend NO confía en esto: vuelve a validar todo.
   */
  const falta: string | null = !origen
    ? "Elegí el origen"
    : !destino
      ? "Elegí el destino"
      : origen === destino
        ? "Origen y destino son la misma"
        : lineas.length === 0
          ? "Agregá al menos un manual"
          : lineas.some((l) => !(Number(l.cantidad) > 0))
            ? "Hay una cantidad vacía"
            : null;

  const opcionesSucursal = (sucursales.data ?? []).map((s) => ({
    valor: String(s.id_sucursal),
    texto: s.descripcion,
  }));

  return (
    <div className="space-y-5 pb-32 lg:pb-6">
      {/* ── Estado: recibida / pendiente ─────────────────────────────── */}
      {previa &&
        (soloLectura ? (
          <div className="flex items-start gap-3 rounded-2xl border border-border/60 bg-muted/40 p-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="text-sm">
              <p className="font-semibold">Recibida en {previa.destino}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {previa.recibida_el && `El ${previa.recibida_el}`}
                {previa.recibida_por && ` por ${previa.recibida_por}`}
                {previa.recibida_el ? ". " : ""}
                Las existencias ya se movieron, así que no se puede editar ni eliminar.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center">
            <Truck className="size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">En camino a {previa.destino}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Las existencias se mueven recién al confirmar la recepción.
                {!sinCambios && " Guardá los cambios antes de recibirla."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmar("recibir")}
              disabled={ocupado || !sinCambios}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {recibir.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageCheck className="size-4" />
              )}
              Confirmar recepción
            </button>
          </div>
        ))}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        {/* ── La ruta ──────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <h2 className="mb-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Ruta
          </h2>
          {soloLectura ? (
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="min-w-0 truncate">{previa!.origen}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{previa!.destino}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <SelectorModal
                label="Sale de"
                requerido
                descripcion="La sucursal que envía los manuales"
                placeholder="Elegí el origen…"
                value={origen}
                onChange={setOrigen}
                opciones={opcionesSucursal.filter((o) => o.valor !== destino)}
                buscador={opcionesSucursal.length > 8}
                className="min-h-12 px-4 py-2.5 text-base"
              />
              {/* Invertir: el error más común es cargar la ruta al revés. */}
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-border/60" />
                <button
                  type="button"
                  onClick={invertir}
                  disabled={!origen && !destino}
                  aria-label="Invertir origen y destino"
                  title="Invertir origen y destino"
                  className="tap grid size-9 place-items-center rounded-full border border-input bg-background text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-40"
                >
                  <ArrowUpDown className="size-4" />
                </button>
                <ArrowDown className="size-4 text-muted-foreground/50" />
                <div className="h-px flex-1 bg-border/60" />
              </div>
              <SelectorModal
                label="Llega a"
                requerido
                descripcion="La sucursal que recibe los manuales"
                placeholder="Elegí el destino…"
                value={destino}
                onChange={setDestino}
                opciones={opcionesSucursal.filter((o) => o.valor !== origen)}
                buscador={opcionesSucursal.length > 8}
                className="min-h-12 px-4 py-2.5 text-base"
              />
            </div>
          )}
          {previa?.fecha && (
            <p className="mt-3 text-[11px] text-muted-foreground">Creada el {previa.fecha}</p>
          )}
        </section>

        {/* ── El carrito ───────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Manuales
              </h2>
              <p className="text-xs text-muted-foreground">
                {lineas.length
                  ? `${lineas.length} manual${lineas.length === 1 ? "" : "es"} · ${unidades} libro${unidades === 1 ? "" : "s"}`
                  : "Todavía no agregaste ninguno"}
              </p>
            </div>
            {!soloLectura && (
              <MultiSelectorModal
                label="Manuales a enviar"
                descripcion={
                  origen
                    ? `Lo disponible en ${nombreSucursal(origen)} ya descuenta otras transferencias en camino`
                    : "Elegí primero el origen para ver cuántos hay"
                }
                confirmar="Listo"
                value={lineas.map((l) => l.manual)}
                onChange={elegirManuales}
                opciones={(manuales.data ?? []).map((m) => ({
                  valor: m.manual,
                  texto: m.manual,
                  extra: `${disponible(m)} disponible${disponible(m) === 1 ? "" : "s"}`,
                }))}
                disparador={
                  <button
                    type="button"
                    disabled={!origen}
                    title={!origen ? "Elegí primero el origen" : undefined}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary-soft px-3 text-sm font-semibold text-primary disabled:opacity-50"
                  >
                    <Plus className="size-4" />
                    {lineas.length ? "Agregar o quitar" : "Agregar manuales"}
                  </button>
                }
              />
            )}
          </div>

          {lineas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-10 text-center">
              <BookOpen className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                {origen
                  ? "Tocá «Agregar manuales» y marcá los que viajan."
                  : "Elegí el origen y después los manuales que viajan."}
              </p>
            </div>
          ) : (
            <ul className="grid gap-2 xl:grid-cols-2">
              {lineas.map((l) => (
                <LineaCard
                  key={l.manual}
                  linea={l}
                  info={porManual.get(l.manual)}
                  origen={nombreSucursal(origen)}
                  soloLectura={soloLectura}
                  onCantidad={(t) => setCantidad(l.manual, t)}
                  onSumar={(d) => sumar(l.manual, d)}
                  onQuitar={() => quitar(l.manual)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Acciones ─────────────────────────────────────────────────── */}
      {!soloLectura && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border/60 pb-safe lg:sticky lg:-mx-5">
          <div className="mx-auto flex max-w-[480px] gap-2 px-5 py-3 lg:mr-0">
            {editando && (
              <button
                type="button"
                onClick={() => setConfirmar("borrar")}
                disabled={ocupado}
                aria-label="Eliminar"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-destructive/40 text-destructive disabled:opacity-60"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => guardar.mutate()}
              disabled={ocupado || falta != null || (editando && sinCambios)}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {guardar.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {/* El botón dice QUÉ FALTA en vez de solo estar gris. */}
              {falta ??
                (editando
                  ? sinCambios
                    ? "Sin cambios"
                    : "Guardar cambios"
                  : "Registrar transferencia")}
            </button>
          </div>
        </div>
      )}

      {/* ── Confirmaciones ───────────────────────────────────────────── */}
      <AlertDialog open={confirmar != null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          {confirmar === "recibir" && previa ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Confirmar la recepción en {previa.destino}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      Se restan <span className="font-semibold text-foreground">{unidades}</span>{" "}
                      libro{unidades === 1 ? "" : "s"} de {previa.origen} y se suman a{" "}
                      {previa.destino}. No se puede deshacer.
                    </p>
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl bg-muted/50 p-2 text-xs">
                      {previa.detalle.map((d) => (
                        <li key={d.manual} className="flex justify-between gap-3">
                          <span className="truncate">{d.manual}</span>
                          <span className="shrink-0 font-semibold tabular-nums">{d.cantidad}</span>
                        </li>
                      ))}
                    </ul>
                    {/* La regla que evita el doble descuento. Ver lib/transferencias. */}
                    <p className="text-xs">
                      Si en {previa.origen} se cerró un inventario después de que salieron estos
                      manuales, recibirla los descuenta dos veces.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => recibir.mutate()}>
                  Confirmar recepción
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta transferencia?</AlertDialogTitle>
                <AlertDialogDescription>
                  No se puede deshacer. Como todavía no se recibió, las existencias no se tocaron.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => borrar.mutate()}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Una línea del carrito                                                      */
/* -------------------------------------------------------------------------- */

function LineaCard({
  linea,
  info,
  origen,
  soloLectura,
  onCantidad,
  onSumar,
  onQuitar,
}: {
  linea: Linea;
  /** Lo que hay en el origen. `undefined` mientras carga o sin origen. */
  info: ManualOrigen | undefined;
  origen: string;
  soloLectura: boolean;
  onCantidad: (texto: string) => void;
  onSumar: (delta: number) => void;
  onQuitar: () => void;
}) {
  const cantidad = Number(linea.cantidad) || 0;
  const disp = info ? disponible(info) : null;
  const excede = disp != null && cantidad > disp;

  return (
    <li
      className={`rounded-2xl border bg-card p-3.5 shadow-soft ${
        excede ? "border-amber-500/50" : "border-border/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug font-semibold">{linea.manual}</p>
          {!soloLectura && info && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {disp} disponible{disp === 1 ? "" : "s"} en {origen}
              {info.comprometido > 0 && ` · ${info.comprometido} ya en camino en otras`}
            </p>
          )}
        </div>
        {!soloLectura && (
          <button
            type="button"
            onClick={onQuitar}
            aria-label={`Quitar ${linea.manual}`}
            className="tap -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {soloLectura ? (
        <p className="mt-2 text-right text-lg font-bold tabular-nums">
          {cantidad} <span className="text-xs font-medium text-muted-foreground">libros</span>
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onSumar(-1)}
            disabled={cantidad <= 1}
            aria-label="Uno menos"
            className="tap grid size-10 place-items-center rounded-xl border border-input disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <input
            value={linea.cantidad}
            onChange={(e) => onCantidad(e.target.value)}
            inputMode="numeric"
            aria-label={`Cantidad de ${linea.manual}`}
            // text-base = 16px: con menos, iOS hace zoom al enfocar.
            className="h-10 w-20 rounded-xl border border-input bg-background text-center text-base font-semibold tabular-nums outline-none focus:border-primary/60"
          />
          <button
            type="button"
            onClick={() => onSumar(1)}
            aria-label="Uno más"
            className="tap grid size-10 place-items-center rounded-xl border border-input"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}

      {/* Avisa pero no bloquea: las existencias pueden estar desactualizadas. */}
      {!soloLectura && excede && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-500">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          Supera lo disponible ({disp}). Se puede guardar, pero al recibirla {origen} quedaría en
          negativo.
        </p>
      )}
    </li>
  );
}
