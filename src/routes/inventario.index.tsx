import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Loader2, Lock, PackageSearch, Save } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { ChipsSeleccion, MultiSelectorModal } from "@/components/multi-selector-modal";
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
import {
  cerrarInventario,
  guardarConteo,
  keysInventario,
  listarSucursales,
  obtenerPlanilla,
  sistemaDe,
  type FilaInventario,
} from "@/lib/inventarios";

export const Route = createFileRoute("/inventario/")({
  head: () => ({
    meta: [
      { title: "Inventario de manuales — Juventud con Valores" },
      { name: "description", content: "Conteo de manuales por sucursal." },
    ],
  }),
  component: InventarioPage,
});

/** Qué filas se ven. Para revisar antes de cerrar, sobre todo "con diferencia". */
type Filtro = "todos" | "sin" | "abiertos" | "cerrados" | "diferencia";

const FILTROS: { valor: Filtro; texto: string; extra?: string }[] = [
  { valor: "todos", texto: "Todos los manuales" },
  { valor: "sin", texto: "Nunca contados", extra: "Sin ningún inventario en esta sucursal" },
  { valor: "abiertos", texto: "Contando", extra: "Con un conteo abierto, sin cerrar" },
  { valor: "cerrados", texto: "Sin conteo en curso", extra: "Ya inventariados alguna vez" },
  {
    valor: "diferencia",
    texto: "Con diferencia",
    extra: "La cantidad física no coincide con la del sistema",
  },
];

/**
 * El valor del input cuando no hay nada escrito encima: el conteo abierto.
 *
 * Sin conteo abierto el input arranca vacío aunque haya un inventario cerrado:
 * escribir ahí abre un conteo NUEVO, y precargar el viejo invitaría a "guardar
 * lo mismo" y abrir uno sin querer.
 */
function valorGuardado(f: FilaInventario): string {
  return f.estado === "ABIERTO" && f.cantidad_fisica != null ? String(f.cantidad_fisica) : "";
}

/**
 * Inventario de manuales: la planilla de conteo de una sucursal.
 *
 * ## EL FLUJO
 *
 * 1. Se elige la sucursal. La planilla trae TODOS los manuales del catálogo
 *    (`INDICES_MANUALES`), se hayan contado o no.
 * 2. Se carga la cantidad física de cada manual, de corrido: Enter pasa al
 *    siguiente. Nada viaja hasta tocar **Guardar**, que manda todo junto.
 * 3. Con todo contado, **Cerrar inventario** pasa las cantidades físicas a
 *    `EXISTENCIAS` y los conteos quedan como historia.
 *
 * Se cuenta por MANUAL, no por índice (25/09/2026). Ver `lib/inventarios.ts`.
 *
 * ## LOS CAMBIOS SIN GUARDAR SE PROTEGEN
 *
 * El borrador está indexado por manual, y el manual es el mismo en todas las
 * sucursales: cambiar de sucursal con cambios pendientes los guardaría en la
 * equivocada. Por eso cambiar de sucursal con cambios pide confirmación y
 * descarta el borrador.
 */
function InventarioPage() {
  const qc = useQueryClient();

  const [sucursal, setSucursal] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  /** Los manuales marcados en la lista con checks. Vacío = todos. */
  const [manualesSel, setManualesSel] = useState<string[]>([]);
  /** Lo tipeado y no guardado, por manual. Solo guarda lo que difiere. */
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  /** Sucursal elegida esperando que se confirme el descarte del borrador. */
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  const idSucursal = sucursal ? Number(sucursal) : null;

  const sucursales = useQuery({
    queryKey: keysInventario.sucursales,
    queryFn: listarSucursales,
  });

  // Con una sola sucursal no hay nada que elegir.
  useEffect(() => {
    if (!sucursal && sucursales.data?.length === 1) {
      setSucursal(String(sucursales.data[0].id_sucursal));
    }
  }, [sucursal, sucursales.data]);

  const planilla = useQuery({
    queryKey: keysInventario.planilla(idSucursal ?? 0),
    queryFn: () => obtenerPlanilla(idSucursal!),
    enabled: idSucursal != null,
  });

  const filas = useMemo(() => planilla.data?.data ?? [], [planilla.data]);
  const resumen = planilla.data?.resumen;

  const cambios = filas.filter(
    (f) => f.manual in borrador && borrador[f.manual] !== valorGuardado(f),
  );
  const hayCambios = cambios.length > 0;

  function escribir(f: FilaInventario, texto: string) {
    // Solo dígitos: son libros en un estante. El backend valida lo mismo.
    const limpio = texto.replace(/\D/g, "").slice(0, 7);
    setBorrador((prev) => {
      const sig = { ...prev };
      // Volver al valor guardado no es un cambio: se saca del borrador para que
      // el contador de "sin guardar" no mienta.
      if (limpio === valorGuardado(f)) delete sig[f.manual];
      else sig[f.manual] = limpio;
      return sig;
    });
  }

  /** Cambiar de sucursal. Con cambios sin guardar, primero pregunta. */
  function cambiarSucursal(v: string) {
    if (v === sucursal) return;
    if (hayCambios) {
      setPendiente(v);
      return;
    }
    setBorrador({});
    setSucursal(v);
  }

  /* ---------------------------------------------------------------------- */
  /* Guardar y cerrar                                                       */
  /* ---------------------------------------------------------------------- */

  const guardar = useMutation({
    mutationFn: () =>
      guardarConteo(
        idSucursal!,
        cambios.map((f) => {
          const t = borrador[f.manual];
          return { manual: f.manual, cantidad: t === "" ? null : Number(t) };
        }),
      ),
    onSuccess: async (r) => {
      // Primero la planilla nueva y DESPUÉS vaciar el borrador: al revés, los
      // inputs parpadean con los valores viejos mientras llega la respuesta.
      await qc.invalidateQueries({ queryKey: keysInventario.todo });
      setBorrador({});
      const partes = [
        r.guardados && `${r.guardados} guardado${r.guardados === 1 ? "" : "s"}`,
        r.borrados && `${r.borrados} borrado${r.borrados === 1 ? "" : "s"}`,
      ].filter(Boolean);
      toast.success(partes.length ? `Conteo guardado: ${partes.join(", ")}` : "Conteo guardado");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const cerrar = useMutation({
    mutationFn: () => cerrarInventario(idSucursal!),
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: keysInventario.todo });
      toast.success(
        `Inventario cerrado: ${n} manual${n === 1 ? "" : "es"}. Las existencias quedaron con lo contado.`,
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo cerrar"),
  });

  const ocupado = guardar.isPending || cerrar.isPending;

  /* ---------------------------------------------------------------------- */
  /* Qué se muestra                                                         */
  /* ---------------------------------------------------------------------- */

  /** La física que se ve: lo tipeado, o si no el conteo abierto. */
  const fisicaDe = (f: FilaInventario): number | null => {
    const t = f.manual in borrador ? borrador[f.manual] : valorGuardado(f);
    return t === "" ? null : Number(t);
  };

  const elegidos = new Set(manualesSel);
  const visibles = filas.filter((f) => {
    if (elegidos.size && !elegidos.has(f.manual)) return false;
    switch (filtro) {
      case "sin":
        return f.estado === "SIN";
      case "abiertos":
        return f.estado === "ABIERTO";
      case "cerrados":
        return f.estado === "CERRADO";
      case "diferencia": {
        const fisica = fisicaDe(f);
        return fisica != null && fisica !== sistemaDe(f);
      }
      default:
        return true;
    }
  });

  /** Enter pasa al siguiente manual: se cuenta de corrido, sin tocar la pantalla. */
  function siguiente(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-conteo]"));
    inputs[inputs.indexOf(ev.currentTarget) + 1]?.focus();
  }

  const opcionesSucursal = (sucursales.data ?? []).map((s) => ({
    valor: String(s.id_sucursal),
    texto: s.descripcion,
    extra: s.abiertos
      ? `${s.abiertos} manual${s.abiertos === 1 ? "" : "es"} contándose`
      : undefined,
  }));

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Inventario de manuales</h1>
          <p className="text-xs text-muted-foreground">
            Conteo físico por sucursal. Al cerrar, las existencias quedan con lo contado.
          </p>
        </div>

        {/* ── Qué se cuenta ────────────────────────────────────────────── */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <SelectorModal
            label="Sucursal"
            requerido
            descripcion="Dónde se está contando"
            placeholder={sucursales.isLoading ? "Cargando…" : "Elegí la sucursal…"}
            value={sucursal}
            onChange={cambiarSucursal}
            opciones={opcionesSucursal}
            buscador={opcionesSucursal.length > 8}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          {/*
            Lista con checks y no un buscador de texto (pedido el 25/09/2026):
            se cuenta por tandas —"hoy los de primaria"— y marcar varios deja
            la planilla con exactamente esos, sin tener que tipear nada.
          */}
          <MultiSelectorModal
            label="Manuales"
            placeholder="Todos los manuales"
            descripcion="Marcá los que vas a contar. Sin ninguno marcado se ven todos."
            value={manualesSel}
            onChange={setManualesSel}
            opciones={filas.map((f) => ({
              valor: f.manual,
              texto: f.manual,
              extra: `${ESTADOS[f.estado].texto} · ${f.indices} índice${f.indices === 1 ? "" : "s"}`,
            }))}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <SelectorModal
            label="Mostrar"
            descripcion="Qué manuales se ven en la planilla"
            value={filtro}
            onChange={(v) => setFiltro(v as Filtro)}
            opciones={FILTROS}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
        </div>

        {/* Lo elegido a la vista: "3 seleccionados" en el botón no dice CUÁLES. */}
        <div className="mb-4">
          <ChipsSeleccion
            valores={manualesSel}
            onQuitar={(m) => setManualesSel((prev) => prev.filter((x) => x !== m))}
            onLimpiar={() => setManualesSel([])}
          />
        </div>

        {/*
          ── Acciones, sticky bajo el header ─────────────────────────────
          Arriba y no abajo: en el celular abajo está la barra de navegación,
          y dos barras apiladas no se entienden. Sticky para que Guardar esté
          a mano después de scrollear la lista entera.
        */}
        {resumen && (hayCambios || resumen.abiertos > 0) && (
          <div className="glass sticky top-[calc(4rem+env(safe-area-inset-top))] z-30 -mx-5 mb-4 flex items-center gap-2 border-y border-border/60 px-5 py-2.5">
            {hayCambios ? (
              <>
                <p className="min-w-0 flex-1 text-xs">
                  <span className="font-semibold">{cambios.length}</span> cambio
                  {cambios.length === 1 ? "" : "s"} sin guardar
                </p>
                <button
                  type="button"
                  onClick={() => setBorrador({})}
                  disabled={ocupado}
                  className="h-10 shrink-0 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={() => guardar.mutate()}
                  disabled={ocupado}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
                >
                  {guardar.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Guardar
                </button>
              </>
            ) : (
              <>
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{resumen.abiertos}</span> manual
                  {resumen.abiertos === 1 ? "" : "es"} contándose en {resumen.descripcion}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmarCierre(true)}
                  disabled={ocupado}
                  className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
                >
                  {cerrar.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Lock className="size-4" />
                  )}
                  Cerrar inventario
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Planilla ─────────────────────────────────────────────────── */}
        {idSucursal == null ? (
          <div className="py-12 text-center">
            <PackageSearch className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              Elegí la sucursal para ver su planilla.
            </p>
          </div>
        ) : planilla.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : planilla.isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudo cargar la planilla.
          </p>
        ) : !visibles.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {filas.length
              ? "Ningún manual coincide con la selección o el filtro."
              : "No hay manuales cargados en INDICES_MANUALES."}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {filas.length} manual{filas.length === 1 ? "" : "es"}
              {visibles.length < filas.length && ` · mostrando ${visibles.length}`}
            </p>
            {/* Grilla y no pila: sin tope de ancho (ver AppShell) una sola
                columna quedaba del ancho del monitor. */}
            <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {visibles.map((f) => (
                <Fila
                  key={f.manual}
                  f={f}
                  texto={f.manual in borrador ? borrador[f.manual] : valorGuardado(f)}
                  cambiado={cambios.includes(f)}
                  onChange={(t) => escribir(f, t)}
                  onKeyDown={siguiente}
                  disabled={ocupado}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── Descartar cambios al cambiar de sucursal ─────────────────── */}
      <AlertDialog open={pendiente != null} onOpenChange={(o) => !o && setPendiente(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Hay {cambios.length} conteo{cambios.length === 1 ? "" : "s"} sin guardar en esta
              planilla. Si cambiás de sucursal se pierden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir contando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBorrador({});
                setSucursal(pendiente!);
                setPendiente(null);
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Confirmar cierre ─────────────────────────────────────────── */}
      <AlertDialog open={confirmarCierre} onOpenChange={setConfirmarCierre}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar el inventario de {resumen?.descripcion}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {resumen && resumen.sin_cantidad > 0 ? (
                  <p className="text-destructive">
                    {resumen.sin_cantidad} conteo{resumen.sin_cantidad === 1 ? "" : "s"} abierto
                    {resumen.sin_cantidad === 1 ? "" : "s"} no tiene
                    {resumen.sin_cantidad === 1 ? "" : "n"} cantidad física o manual (cargados desde
                    APEX). Completalos antes de cerrar.
                  </p>
                ) : (
                  <>
                    <p>
                      Se cierran{" "}
                      <span className="font-semibold text-foreground">
                        {resumen?.abiertos} manual{resumen?.abiertos === 1 ? "" : "es"}
                      </span>
                      : todos los conteos abiertos de la sucursal, también los que no se ven por la
                      selección de manuales o el filtro.
                    </p>
                    <p>
                      Las existencias de cada uno quedan con la cantidad física contada. No se puede
                      deshacer desde la app.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cerrar.mutate()}
              disabled={!resumen || resumen.sin_cantidad > 0}
            >
              Cerrar inventario
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Una fila de la planilla                                                    */
/* -------------------------------------------------------------------------- */

const ESTADOS = {
  SIN: { texto: "Nunca contado", clase: "bg-muted text-muted-foreground" },
  ABIERTO: { texto: "Contando", clase: "bg-primary/10 text-primary" },
  CERRADO: { texto: "Inventariado", clase: "bg-muted text-muted-foreground" },
} as const;

function Fila({
  f,
  texto,
  cambiado,
  onChange,
  onKeyDown,
  disabled,
}: {
  f: FilaInventario;
  /** Lo que muestra el input: el borrador, o el conteo abierto. */
  texto: string;
  cambiado: boolean;
  onChange: (texto: string) => void;
  onKeyDown: (ev: KeyboardEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  const sistema = sistemaDe(f);
  const fisica = texto === "" ? null : Number(texto);
  const diferencia = fisica == null ? null : fisica - sistema;
  const estado = ESTADOS[f.estado];
  const id = `conteo-${encodeURIComponent(f.manual)}`;

  return (
    <li
      className={`rounded-2xl border bg-card p-3.5 shadow-soft ${
        cambiado ? "border-primary/60" : "border-border/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <BookOpen className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-snug font-semibold">{f.manual}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${estado.clase}`}>
              {estado.texto}
            </span>
            <span>
              {f.indices} índice{f.indices === 1 ? "" : "s"}
            </span>
            {f.estado === "ABIERTO" && f.fecha && <span>· contado {f.fecha}</span>}
            {/* El inventario anterior, como referencia: el input queda vacío
                para no abrir un conteo sin querer (ver `valorGuardado`). */}
            {f.cierre_fecha && (
              <span>
                · último cierre {f.cierre_fecha}
                {f.cierre_cantidad != null && `: ${f.cierre_cantidad}`}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 items-end gap-2">
        <Dato
          etiqueta="Sistema"
          valor={String(sistema)}
          ayuda={
            f.estado === "ABIERTO"
              ? "Lo que decían las existencias al contar"
              : "Lo que dicen las existencias hoy"
          }
        />
        <div>
          <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Física
          </label>
          <input
            id={id}
            data-conteo
            value={texto}
            onChange={(ev) => onChange(ev.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            inputMode="numeric"
            enterKeyHint="next"
            autoComplete="off"
            placeholder="—"
            // text-base = 16px: con menos, iOS hace zoom al enfocar.
            className="h-10 w-full rounded-xl border border-input bg-background px-3 text-center text-base font-semibold tabular-nums outline-none focus:border-primary/60 disabled:opacity-60"
          />
        </div>
        <Dato
          etiqueta="Diferencia"
          valor={
            diferencia == null
              ? "—"
              : diferencia > 0
                ? `+${diferencia}`
                : diferencia < 0
                  ? `−${-diferencia}`
                  : "0"
          }
          // Faltan en rojo, sobran en ámbar: los dos piden revisar antes de
          // cerrar, pero faltar libros es lo que más importa.
          clase={
            diferencia == null || diferencia === 0
              ? "text-muted-foreground"
              : diferencia < 0
                ? "text-destructive"
                : "text-amber-600"
          }
        />
      </div>

      {cambiado && f.estado !== "ABIERTO" && (
        <p className="mt-2 text-[11px] text-primary">Al guardar se abre un conteo nuevo.</p>
      )}
      {cambiado && f.estado === "ABIERTO" && texto === "" && (
        <p className="mt-2 text-[11px] text-primary">Al guardar, se borra este conteo.</p>
      )}
    </li>
  );
}

function Dato({
  etiqueta,
  valor,
  ayuda,
  clase = "",
}: {
  etiqueta: string;
  valor: string;
  ayuda?: string;
  clase?: string;
}) {
  return (
    <div title={ayuda}>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p
        className={`flex h-10 items-center justify-center rounded-xl bg-muted/50 text-base font-semibold tabular-nums ${clase}`}
      >
        {valor}
      </p>
    </div>
  );
}
