/**
 * El formulario de una transferencia de manuales: cabecera y detalle. Alta,
 * edición de una pendiente y vista de una recibida (solo lectura).
 *
 * ============================================================================
 * EL DISEÑO: UNA RUTA Y UN CARRITO POR FACILITADOR
 * ============================================================================
 *
 * Arriba la **ruta**: Origen → Destino, con un botón para invertirlos (el
 * error más común es cargarla al revés). Abajo el **carrito**, repartido por
 * **facilitador e institución** (12/10/2026: cada línea del detalle va a un
 * facilitador y una institución, los dos obligatorios). Cada tarjeta de
 * facilitador tiene sus manuales, uno por fila, con − / + para la cantidad; se
 * agregan varios de una vez con una lista con checks (`MultiSelectorModal`), y
 * la misma lista sirve para sacarlos.
 *
 * La institución se elige entre las que el facilitador tiene en
 * POSTULACIONES (cualquier año), con un interruptor para ver todas. Si se
 * elige un par facilitador + institución que ya tiene tarjeta, las dos se
 * juntan y se suman las cantidades del mismo manual.
 *
 * Las líneas de antes del 12/10/2026 no tienen facilitador ni institución:
 * forman la tarjeta "Sin asignar", y para volver a guardar hay que asignarla.
 *
 * Cada línea muestra cuántos hay DISPONIBLES en el origen, y avisa en ámbar si
 * entre todas las tarjetas se envía más. Avisa pero deja guardar: las
 * existencias pueden estar desactualizadas (decidido el 25/09/2026).
 *
 * ============================================================================
 * RECIBIR ES EL PASO QUE MUEVE LAS EXISTENCIAS
 * ============================================================================
 *
 * Guardar no mueve nada. Lo hace "Confirmar recepción", vía el trigger
 * `TRANSFERENCIAS_ACTUALIZAR_EXISTENCIAS`, y una recibida queda en solo
 * lectura. Para corregirla, **Revertir recepción** devuelve las existencias y
 * la deja pendiente otra vez; **Eliminar** hace eso y además la borra
 * (29/09/2026). Ver `lib/transferencias.ts`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Building2,
  CheckCircle2,
  Loader2,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal, type OpcionFija } from "@/components/selector-modal";
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
import { keys as keysListas, lista, STALE_LISTAS } from "@/lib/evaluaciones";
import { keysInventario, listarSucursales } from "@/lib/inventarios";
import {
  actualizarTransferencia,
  crearTransferencia,
  disponible,
  eliminarTransferencia,
  keysTransferencias,
  manualesDeOrigen,
  recibirTransferencia,
  revertirRecepcion,
  textoDestinatario,
  type ManualOrigen,
  type TransferenciaDetalle,
} from "@/lib/transferencias";

/** Una línea del carrito. La cantidad como texto: es lo que da el input. */
type Linea = { manual: string; cantidad: string };

/** Una tarjeta del carrito: un facilitador en una institución, con sus manuales. */
type Grupo = {
  /** Solo para React: no viaja al backend. */
  clave: string;
  id_facilitador: number | null;
  facilitador: string;
  id_institucion: number | null;
  institucion: string;
  lineas: Linea[];
  /** Mostrando los selectores (recién agregada, o tocando "Cambiar"). */
  editando: boolean;
};

const MAX_CANTIDAD = 9_999_999;

/** El par facilitador + institución, para comparar tarjetas y líneas. */
const par = (g: { id_facilitador: number | null; id_institucion: number | null }) =>
  `${g.id_facilitador ?? ""}|${g.id_institucion ?? ""}`;

const completo = (g: Grupo) => g.id_facilitador != null && g.id_institucion != null;

/** Las tarjetas de una transferencia guardada, en el orden en que llegaron. */
function gruposDe(previa: TransferenciaDetalle | undefined): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const d of previa?.detalle ?? []) {
    const k = par(d);
    let g = m.get(k);
    if (!g) {
      g = {
        clave: `g-${k}`,
        id_facilitador: d.id_facilitador,
        facilitador: d.facilitador ?? "",
        id_institucion: d.id_institucion,
        institucion: d.institucion ?? "",
        lineas: [],
        editando: false,
      };
      m.set(k, g);
    }
    g.lineas.push({ manual: d.manual, cantidad: String(d.cantidad) });
  }
  return [...m.values()];
}

/** Junta dos listas de líneas: el mismo manual suma sus cantidades. */
function juntarLineas(a: Linea[], b: Linea[]): Linea[] {
  const out = a.map((l) => ({ ...l }));
  for (const l of b) {
    const x = out.find((y) => y.manual === l.manual);
    if (x)
      x.cantidad = String(
        Math.min(MAX_CANTIDAD, (Number(x.cantidad) || 0) + (Number(l.cantidad) || 0)),
      );
    else out.push({ ...l });
  }
  return out;
}

export function TransferenciaForm({ previa }: { previa?: TransferenciaDetalle }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editando = previa != null;
  const soloLectura = previa?.recibida === true;

  const [origen, setOrigen] = useState(previa ? String(previa.id_sucursal_origen) : "");
  const [destino, setDestino] = useState(previa ? String(previa.id_sucursal_destino) : "");
  const [grupos, setGrupos] = useState<Grupo[]>(() => gruposDe(previa));
  const [confirmar, setConfirmar] = useState<"recibir" | "revertir" | "borrar" | null>(null);
  const siguiente = useRef(0);

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

  // Todos los facilitadores activos, sin filtrar por año: a principio de año
  // todavía no hay postulaciones y la lista quedaría vacía.
  const paramsFac = { anio: "TODOS", limite: 500 };
  const facilitadores = useQuery({
    queryKey: keysListas.lista("facilitadores", paramsFac),
    queryFn: () => lista("facilitadores", paramsFac),
    staleTime: STALE_LISTAS,
    enabled: !soloLectura,
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

  const cambiarGrupo = (clave: string, f: (g: Grupo) => Grupo) =>
    setGrupos((prev) => prev.map((g) => (g.clave === clave ? f(g) : g)));

  function agregarGrupo() {
    siguiente.current += 1;
    setGrupos((prev) => [
      ...prev,
      {
        clave: `nuevo-${siguiente.current}`,
        id_facilitador: null,
        facilitador: "",
        id_institucion: null,
        institucion: "",
        lineas: [],
        editando: true,
      },
    ]);
  }

  const quitarGrupo = (clave: string) => setGrupos((prev) => prev.filter((g) => g.clave !== clave));

  /**
   * Elegido el par: si ya hay otra tarjeta con el mismo facilitador e
   * institución, esta se suma a esa y desaparece.
   */
  function fijarDestinatario(
    clave: string,
    d: { id_facilitador: number; facilitador: string; id_institucion: number; institucion: string },
  ) {
    const otra = grupos.find((g) => g.clave !== clave && par(g) === par(d));
    if (otra) {
      const esta = grupos.find((g) => g.clave === clave)!;
      setGrupos((prev) =>
        prev
          .filter((g) => g.clave !== clave)
          .map((g) =>
            g.clave === otra.clave ? { ...g, lineas: juntarLineas(g.lineas, esta.lineas) } : g,
          ),
      );
      toast.info(`Se juntó con la tarjeta que ya había para ${d.facilitador} · ${d.institucion}`);
      return;
    }
    cambiarGrupo(clave, (g) => ({ ...g, ...d, editando: false }));
  }

  /** La lista con checks devuelve lo marcado: se conserva lo que ya estaba. */
  const elegirManuales = (clave: string, marcados: string[]) =>
    cambiarGrupo(clave, (g) => ({
      ...g,
      lineas: marcados.map(
        (m) => g.lineas.find((l) => l.manual === m) ?? { manual: m, cantidad: "1" },
      ),
    }));

  const setCantidad = (clave: string, manual: string, texto: string) =>
    cambiarGrupo(clave, (g) => ({
      ...g,
      lineas: g.lineas.map((l) =>
        l.manual === manual ? { ...l, cantidad: texto.replace(/\D/g, "").slice(0, 7) } : l,
      ),
    }));

  const sumar = (clave: string, manual: string, delta: number) =>
    cambiarGrupo(clave, (g) => ({
      ...g,
      lineas: g.lineas.map((l) =>
        l.manual === manual
          ? {
              ...l,
              cantidad: String(
                Math.min(MAX_CANTIDAD, Math.max(1, (Number(l.cantidad) || 0) + delta)),
              ),
            }
          : l,
      ),
    }));

  const quitarLinea = (clave: string, manual: string) =>
    cambiarGrupo(clave, (g) => ({ ...g, lineas: g.lineas.filter((l) => l.manual !== manual) }));

  function invertir() {
    setOrigen(destino);
    setDestino(origen);
  }

  const todasLasLineas = grupos.flatMap((g) => g.lineas.map((l) => ({ ...l, g })));
  const unidades = todasLasLineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
  /** Lo que sale de cada manual sumando todas las tarjetas: es lo que se compara con lo disponible. */
  const totalPorManual = new Map<string, number>();
  for (const l of todasLasLineas)
    totalPorManual.set(l.manual, (totalPorManual.get(l.manual) ?? 0) + (Number(l.cantidad) || 0));

  // Sin cambios respecto de lo guardado: recibir exige que no haya nada
  // pendiente, o se recibiría una versión que no es la que se ve.
  const sinCambios =
    !!previa &&
    origen === String(previa.id_sucursal_origen) &&
    destino === String(previa.id_sucursal_destino) &&
    todasLasLineas.length === previa.detalle.length &&
    todasLasLineas.every((l) =>
      previa.detalle.some(
        (d) => d.manual === l.manual && par(d) === par(l.g) && String(d.cantidad) === l.cantidad,
      ),
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
        lineas: todasLasLineas.map((l) => ({
          manual: l.manual,
          cantidad: Number(l.cantidad),
          id_facilitador: l.g.id_facilitador!,
          id_institucion: l.g.id_institucion!,
        })),
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

  const revertir = useMutation({
    mutationFn: () => revertirRecepcion(previa!.id_transferencia),
    onSuccess: () => {
      // La página rearma el formulario al cambiar `recibida` (ver su `key`):
      // vuelve editable, con el botón de recibir.
      invalidar();
      toast.success(
        "Recepción revertida: las existencias volvieron y la transferencia quedó pendiente.",
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo revertir"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarTransferencia(previa!.id_transferencia),
    onSuccess: () => {
      invalidar();
      toast.success(
        soloLectura ? "Transferencia eliminada y existencias devueltas" : "Transferencia eliminada",
      );
      navigate({ to: "/transferencias" });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || recibir.isPending || revertir.isPending || borrar.isPending;

  /*
   * Lo mismo que valida el backend, para no gastar un viaje de red en decir lo
   * obvio. El backend NO confía en esto: vuelve a validar todo.
   */
  const sinAsignar = grupos.some((g) => !completo(g) && g.lineas.length > 0 && !g.editando);
  const falta: string | null = !origen
    ? "Elegí el origen"
    : !destino
      ? "Elegí el destino"
      : origen === destino
        ? "Origen y destino son la misma"
        : grupos.length === 0
          ? "Agregá un facilitador"
          : sinAsignar
            ? "Asigná las líneas sin asignar"
            : grupos.some((g) => !completo(g))
              ? "Elegí facilitador e institución"
              : grupos.some((g) => g.lineas.length === 0)
                ? "Hay un facilitador sin manuales"
                : todasLasLineas.some((l) => !(Number(l.cantidad) > 0))
                  ? "Hay una cantidad vacía"
                  : null;

  const opcionesSucursal = (sucursales.data ?? []).map((s) => ({
    valor: String(s.id_sucursal),
    texto: s.descripcion,
  }));

  const opcionesManual = (manuales.data ?? []).map((m) => ({
    valor: m.manual,
    texto: m.manual,
    extra: `${disponible(m)} disponible${disponible(m) === 1 ? "" : "s"}`,
  }));

  const opcionesFacilitador: OpcionFija[] = (facilitadores.data ?? []).map((o) => ({
    valor: String(o.id),
    texto: o.texto,
    extra: o.extra,
  }));

  return (
    <div className="space-y-5 pb-32 lg:pb-6">
      {/* ── Estado: recibida / pendiente ─────────────────────────────── */}
      {previa &&
        (soloLectura ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/40 p-4 sm:flex-row sm:items-center">
            <CheckCircle2 className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">Recibida en {previa.destino}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {previa.recibida_el && `El ${previa.recibida_el}`}
                {previa.recibida_por && ` por ${previa.recibida_por}`}
                {previa.recibida_el ? ". " : ""}
                Las existencias ya se movieron. Para corregirla, revertí la recepción.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setConfirmar("borrar")}
                disabled={ocupado}
                aria-label="Eliminar"
                title="Eliminar y devolver las existencias"
                className="grid size-11 shrink-0 place-items-center rounded-xl border border-destructive/40 text-destructive disabled:opacity-60"
              >
                {borrar.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmar("revertir")}
                disabled={ocupado}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-input bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60"
              >
                {revertir.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                Revertir recepción
              </button>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
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

        {/* ── El carrito, por facilitador ──────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Facilitadores y manuales
              </h2>
              <p className="text-xs text-muted-foreground">
                {todasLasLineas.length
                  ? `${grupos.length} destino${grupos.length === 1 ? "" : "s"} · ${unidades} libro${unidades === 1 ? "" : "s"}`
                  : "Cada manual va a un facilitador en una institución"}
              </p>
            </div>
            {!soloLectura && grupos.length > 0 && (
              <button
                type="button"
                onClick={agregarGrupo}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary-soft px-3 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Agregar facilitador</span>
                <span className="sm:hidden">Facilitador</span>
              </button>
            )}
          </div>

          {grupos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-10 text-center">
              <UserRound className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-2 px-4 text-sm text-muted-foreground">
                Agregá el facilitador y la institución que reciben los manuales.
              </p>
              {!soloLectura && (
                <button
                  type="button"
                  onClick={agregarGrupo}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                >
                  <Plus className="size-4" />
                  Agregar facilitador
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {grupos.map((g) => (
                <GrupoCard
                  key={g.clave}
                  grupo={g}
                  soloLectura={soloLectura}
                  origen={origen}
                  nombreOrigen={nombreSucursal(origen)}
                  opcionesFacilitador={opcionesFacilitador}
                  cargandoFacilitadores={facilitadores.isLoading}
                  opcionesManual={opcionesManual}
                  porManual={porManual}
                  totalPorManual={totalPorManual}
                  onEditar={(v) => cambiarGrupo(g.clave, (x) => ({ ...x, editando: v }))}
                  onFijar={(d) => fijarDestinatario(g.clave, d)}
                  onQuitar={() => quitarGrupo(g.clave)}
                  onManuales={(m) => elegirManuales(g.clave, m)}
                  onCantidad={(m, t) => setCantidad(g.clave, m, t)}
                  onSumar={(m, d) => sumar(g.clave, m, d)}
                  onQuitarLinea={(m) => quitarLinea(g.clave, m)}
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
                    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-muted/50 p-2 text-xs">
                      {previa.detalle.map((d) => (
                        <li key={`${d.manual}|${par(d)}`} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate">{d.manual}</span>
                            <span className="block truncate text-[10.5px] opacity-75">
                              {textoDestinatario(d)}
                            </span>
                          </span>
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
          ) : confirmar === "revertir" && previa ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Revertir la recepción?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      Vuelven <span className="font-semibold text-foreground">{unidades}</span>{" "}
                      libro{unidades === 1 ? "" : "s"} a {previa.origen} y se restan de{" "}
                      {previa.destino}. La transferencia queda pendiente otra vez: se puede editar,
                      volver a recibir o eliminar.
                    </p>
                    <p className="text-xs">
                      Si después de recibirla se cerró un inventario en {previa.origen} o en{" "}
                      {previa.destino}, ese conteo ya refleja lo que hay: revertir lo descuadra.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => revertir.mutate()}>
                  Revertir recepción
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta transferencia?</AlertDialogTitle>
                <AlertDialogDescription>
                  {soloLectura
                    ? `No se puede deshacer. Como ya se recibió, antes se devuelven las existencias: vuelven ${unidades} libro${unidades === 1 ? "" : "s"} a ${previa?.origen} y se restan de ${previa?.destino}.`
                    : "No se puede deshacer. Como todavía no se recibió, las existencias no se tocaron."}
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
/* Una tarjeta: facilitador + institución, con sus manuales                    */
/* -------------------------------------------------------------------------- */

function GrupoCard({
  grupo: g,
  soloLectura,
  origen,
  nombreOrigen,
  opcionesFacilitador,
  cargandoFacilitadores,
  opcionesManual,
  porManual,
  totalPorManual,
  onEditar,
  onFijar,
  onQuitar,
  onManuales,
  onCantidad,
  onSumar,
  onQuitarLinea,
}: {
  grupo: Grupo;
  soloLectura: boolean;
  /** El id del origen elegido: sin él no se pueden elegir manuales. */
  origen: string;
  nombreOrigen: string;
  opcionesFacilitador: OpcionFija[];
  cargandoFacilitadores: boolean;
  opcionesManual: OpcionFija[];
  porManual: Map<string, ManualOrigen>;
  totalPorManual: Map<string, number>;
  onEditar: (editando: boolean) => void;
  onFijar: (d: {
    id_facilitador: number;
    facilitador: string;
    id_institucion: number;
    institucion: string;
  }) => void;
  onQuitar: () => void;
  onManuales: (marcados: string[]) => void;
  onCantidad: (manual: string, texto: string) => void;
  onSumar: (manual: string, delta: number) => void;
  onQuitarLinea: (manual: string) => void;
}) {
  const asignado = completo(g);
  const libros = g.lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);

  return (
    <li
      className={`rounded-2xl border bg-card shadow-soft ${
        !asignado && !g.editando ? "border-amber-500/50" : "border-border/60"
      }`}
    >
      {/* Encabezado: a quién va */}
      <div className="border-b border-border/60 p-3.5">
        {g.editando && !soloLectura ? (
          <ElegirDestinatario
            grupo={g}
            opcionesFacilitador={opcionesFacilitador}
            cargandoFacilitadores={cargandoFacilitadores}
            onFijar={onFijar}
            onCancelar={
              // Una tarjeta nueva sin nada se descarta; una que ya tenía par vuelve a él.
              asignado || g.lineas.length ? () => onEditar(false) : onQuitar
            }
          />
        ) : (
          <div className="flex items-start gap-3">
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                asignado ? "bg-primary-soft text-primary" : "bg-amber-500/10 text-amber-600"
              }`}
            >
              <UserRound className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              {asignado ? (
                <>
                  <p className="truncate text-sm font-semibold">{g.facilitador}</p>
                  <p className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
                    <Building2 className="size-3 shrink-0" />
                    <span className="truncate">{g.institucion}</span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-500">
                    Sin asignar
                  </p>
                  <p className="text-[11.5px] leading-snug text-muted-foreground">
                    Líneas cargadas antes de que la transferencia fuera por facilitador.
                    {!soloLectura && " Asignales facilitador e institución para guardar."}
                  </p>
                </>
              )}
            </div>
            <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
              {libros} libro{libros === 1 ? "" : "s"}
            </span>
            {!soloLectura && (
              <div className="-mt-1 -mr-1 flex shrink-0">
                <button
                  type="button"
                  onClick={() => onEditar(true)}
                  aria-label={asignado ? "Cambiar facilitador o institución" : "Asignar"}
                  title={asignado ? "Cambiar facilitador o institución" : "Asignar"}
                  className="tap grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onQuitar}
                  aria-label="Quitar este facilitador y sus manuales"
                  title="Quitar este facilitador y sus manuales"
                  className="tap grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Los manuales */}
      <div className="space-y-2 p-3">
        {g.lineas.length === 0 ? (
          <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
            <BookOpen className="size-4 shrink-0 opacity-50" />
            {origen ? "Todavía sin manuales." : "Elegí el origen para agregar manuales."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {g.lineas.map((l) => (
              <LineaCard
                key={l.manual}
                linea={l}
                info={porManual.get(l.manual)}
                total={totalPorManual.get(l.manual) ?? 0}
                origen={nombreOrigen}
                soloLectura={soloLectura}
                onCantidad={(t) => onCantidad(l.manual, t)}
                onSumar={(d) => onSumar(l.manual, d)}
                onQuitar={() => onQuitarLinea(l.manual)}
              />
            ))}
          </ul>
        )}
        {!soloLectura && (
          <MultiSelectorModal
            label={asignado ? `Manuales para ${g.facilitador}` : "Manuales"}
            descripcion={
              origen
                ? `Lo disponible en ${nombreOrigen} ya descuenta otras transferencias en camino`
                : "Elegí primero el origen para ver cuántos hay"
            }
            confirmar="Listo"
            value={g.lineas.map((l) => l.manual)}
            onChange={onManuales}
            opciones={opcionesManual}
            disparador={
              <button
                type="button"
                disabled={!origen}
                title={!origen ? "Elegí primero el origen" : undefined}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary/40 text-[13px] font-semibold text-primary disabled:opacity-50"
              >
                <Plus className="size-4" />
                {g.lineas.length ? "Agregar o quitar manuales" : "Agregar manuales"}
              </button>
            }
          />
        )}
      </div>
    </li>
  );
}

/**
 * Los dos selectores de una tarjeta. La institución se elige entre las del
 * facilitador (sus postulaciones de cualquier año), o entre todas con el
 * interruptor; si el facilitador no tiene ninguna, se muestran todas.
 */
function ElegirDestinatario({
  grupo: g,
  opcionesFacilitador,
  cargandoFacilitadores,
  onFijar,
  onCancelar,
}: {
  grupo: Grupo;
  opcionesFacilitador: OpcionFija[];
  cargandoFacilitadores: boolean;
  onFijar: (d: {
    id_facilitador: number;
    facilitador: string;
    id_institucion: number;
    institucion: string;
  }) => void;
  onCancelar: () => void;
}) {
  const [fac, setFac] = useState(g.id_facilitador == null ? "" : String(g.id_facilitador));
  const [inst, setInst] = useState(g.id_institucion == null ? "" : String(g.id_institucion));
  const [todas, setTodas] = useState(false);

  const paramsDelFac = { id_facilitador: Number(fac), anio: "TODOS", limite: 500 };
  const delFacilitador = useQuery({
    queryKey: keysListas.lista("instituciones", paramsDelFac),
    queryFn: () => lista("instituciones", paramsDelFac),
    staleTime: STALE_LISTAS,
    enabled: !!fac,
  });
  const sinPropias = delFacilitador.isSuccess && delFacilitador.data.length === 0;
  const verTodas = todas || sinPropias;

  const paramsTodas = { limite: 500 };
  const todasLasInst = useQuery({
    queryKey: keysListas.lista("instituciones", paramsTodas),
    queryFn: () => lista("instituciones", paramsTodas),
    staleTime: STALE_LISTAS,
    enabled: !!fac && verTodas,
  });

  // El elegido entra siempre a la lista, aunque hoy esté inactivo o no salga
  // con el filtro: si no, el selector se vería vacío.
  const conActual = (ops: OpcionFija[], valor: string, texto: string) =>
    valor && texto && !ops.some((o) => o.valor === valor) ? [{ valor, texto }, ...ops] : ops;

  const opcionesFac = conActual(
    opcionesFacilitador,
    g.id_facilitador == null ? "" : String(g.id_facilitador),
    g.facilitador,
  );
  const fuenteInst = verTodas ? todasLasInst : delFacilitador;
  const opcionesInst = conActual(
    (fuenteInst.data ?? []).map((o) => ({ valor: String(o.id), texto: o.texto, extra: o.extra })),
    g.id_institucion == null ? "" : String(g.id_institucion),
    g.institucion,
  );

  const listo = !!fac && !!inst;

  return (
    <div className="space-y-2">
      <SelectorModal
        label="Facilitador"
        requerido
        descripcion="Quien recibe los manuales"
        placeholder={cargandoFacilitadores ? "Cargando…" : "Elegí el facilitador…"}
        value={fac}
        onChange={(v) => {
          setFac(v);
          // Otro facilitador, otras instituciones.
          if (v !== fac) setInst("");
        }}
        opciones={opcionesFac}
        buscador
        className="min-h-11 px-3.5 py-2 text-sm"
      />
      <SelectorModal
        label="Institución"
        requerido
        descripcion={
          verTodas
            ? "Todas las instituciones activas"
            : "Las instituciones donde postuló el facilitador"
        }
        placeholder={
          !fac ? "Elegí primero el facilitador" : fuenteInst.isLoading ? "Cargando…" : "Elegí…"
        }
        value={inst}
        onChange={setInst}
        opciones={fac ? opcionesInst : []}
        buscador
        className="min-h-11 px-3.5 py-2 text-sm"
      />
      {fac && (
        <label className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <input
            type="checkbox"
            checked={verTodas}
            disabled={sinPropias}
            onChange={(e) => setTodas(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          {sinPropias
            ? "El facilitador no tiene postulaciones: se muestran todas las instituciones."
            : "Ver todas las instituciones, no solo las del facilitador"}
        </label>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancelar}
          className="h-9 flex-1 rounded-lg border border-border/60 text-[13px] font-semibold"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={!listo}
          onClick={() =>
            onFijar({
              id_facilitador: Number(fac),
              facilitador: opcionesFac.find((o) => o.valor === fac)?.texto ?? "",
              id_institucion: Number(inst),
              institucion: opcionesInst.find((o) => o.valor === inst)?.texto ?? "",
            })
          }
          className="h-9 flex-1 rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          Listo
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Una línea del carrito                                                      */
/* -------------------------------------------------------------------------- */

function LineaCard({
  linea,
  info,
  total,
  origen,
  soloLectura,
  onCantidad,
  onSumar,
  onQuitar,
}: {
  linea: Linea;
  /** Lo que hay en el origen. `undefined` mientras carga o sin origen. */
  info: ManualOrigen | undefined;
  /** Lo que sale de este manual sumando todas las tarjetas. */
  total: number;
  origen: string;
  soloLectura: boolean;
  onCantidad: (texto: string) => void;
  onSumar: (delta: number) => void;
  onQuitar: () => void;
}) {
  const cantidad = Number(linea.cantidad) || 0;
  const disp = info ? disponible(info) : null;
  const excede = disp != null && total > disp;
  const enOtras = total - cantidad;

  return (
    <li
      className={`rounded-xl border bg-background p-3 ${
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
          {enOtras > 0
            ? `Entre todos los facilitadores salen ${total} y hay ${disp} disponibles.`
            : `Supera lo disponible (${disp}).`}{" "}
          Se puede guardar, pero al recibirla {origen} quedaría en negativo.
        </p>
      )}
    </li>
  );
}
