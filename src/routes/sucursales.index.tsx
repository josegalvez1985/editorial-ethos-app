import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Lock, Pencil, Plus, Search, Store, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keysInventario } from "@/lib/inventarios";
import {
  eliminarSucursal,
  enUso,
  guardarSucursal,
  keysSucursales,
  listarSucursalesAbm,
  type Sucursal,
} from "@/lib/sucursales";

export const Route = createFileRoute("/sucursales/")({
  head: () => ({
    meta: [
      { title: "Sucursales — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de sucursales." },
    ],
  }),
  component: SucursalesPage,
});

const numero = new Intl.NumberFormat("es-PY");

/** Sin mayúsculas ni tildes: "asuncion" encuentra "Asunción". */
function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Sucursales: el primer catálogo del Núcleo de datos.
 *
 * Un solo campo (el nombre), así que no hay pantalla de formulario: alta y
 * edición se hacen en un modal sobre la misma lista, sin perder el lugar.
 *
 * Cada tarjeta muestra el USO de la sucursal. Es lo que decide si se puede
 * borrar —inventarios, existencias y transferencias tienen FK a ella— y la
 * pantalla lo dice antes de ofrecer el botón, en vez de dejar que el backend
 * responda que no.
 */
function SucursalesPage() {
  const qc = useQueryClient();
  const [buscar, setBuscar] = useState("");
  /** `null` cerrado, `"nueva"` alta, o la sucursal que se edita. */
  const [editando, setEditando] = useState<Sucursal | "nueva" | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: keysSucursales.todo,
    queryFn: listarSucursalesAbm,
  });

  const q = normalizar(buscar.trim());
  const filas = (data ?? []).filter((s) => !q || normalizar(s.descripcion).includes(q));

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysSucursales.todo });
    // El combo de Inventario y Transferencias sale de otro endpoint.
    qc.invalidateQueries({ queryKey: keysInventario.sucursales });
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Sucursales</h1>
            <p className="text-xs text-muted-foreground">
              Dónde se guardan los manuales: inventarios, existencias y transferencias
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditando("nueva")}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            <Plus className="size-4" />
            Nueva
          </button>
        </div>

        {/* El buscador aparece recién cuando hay algo que buscar. */}
        {(data?.length ?? 0) > 6 && (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar sucursal…"
              aria-label="Buscar sucursal"
              className="h-11 w-full rounded-xl border border-input bg-card pr-9 pl-9 text-sm outline-none focus:border-primary/40"
            />
            {buscar && (
              <button
                onClick={() => setBuscar("")}
                aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudieron cargar las sucursales.
          </p>
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <Store className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q ? "Ninguna sucursal coincide con la búsqueda." : "Todavía no hay sucursales."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((s) => (
              <li key={s.id_sucursal}>
                <button
                  type="button"
                  onClick={() => setEditando(s)}
                  className="flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft hover:border-primary/40"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                    <Store className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.descripcion}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {numero.format(s.libros)} libro{s.libros === 1 ? "" : "s"}
                      </span>
                      <span>
                        {s.manuales} manual{s.manuales === 1 ? "" : "es"}
                      </span>
                      <span>
                        {s.inventarios} conteo{s.inventarios === 1 ? "" : "s"}
                      </span>
                      <span>
                        {s.transferencias} transferencia{s.transferencias === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                  <Pencil className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editando != null && (
        <EditorSucursal
          // `key`: al pasar de una sucursal a otra el campo arranca de nuevo.
          key={editando === "nueva" ? "nueva" : editando.id_sucursal}
          sucursal={editando === "nueva" ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={invalidar}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición en un modal                                                 */
/* -------------------------------------------------------------------------- */

function EditorSucursal({
  sucursal,
  onCerrar,
  onGuardado,
}: {
  sucursal: Sucursal | null;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(sucursal?.descripcion ?? "");
  // Borrar pide un segundo toque en el mismo botón, sin un diálogo encima de
  // otro diálogo.
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const limpio = nombre.trim().replace(/\s+/g, " ");
  const sinCambios = sucursal != null && limpio === sucursal.descripcion;

  const guardar = useMutation({
    mutationFn: () => guardarSucursal(sucursal?.id_sucursal ?? null, limpio),
    onSuccess: () => {
      onGuardado();
      toast.success(sucursal ? "Sucursal actualizada" : "Sucursal creada");
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarSucursal(sucursal!.id_sucursal),
    onSuccess: () => {
      onGuardado();
      toast.success("Sucursal eliminada");
      onCerrar();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const usada = sucursal != null && enUso(sucursal);

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {sucursal ? "Editar sucursal" : "Nueva sucursal"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {sucursal
              ? "El nombre cambia en todos los inventarios y transferencias que la usan."
              : "El nombre tiene que ser único."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (limpio && !sinCambios) guardar.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="nombre-sucursal" className="mb-1.5 block text-sm font-medium">
              Nombre <span className="text-destructive">*</span>
            </label>
            <input
              id="nombre-sucursal"
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={255}
              placeholder="Ej.: Casa central"
              // text-base = 16px: con menos, iOS hace zoom al enfocar.
              className="h-12 w-full rounded-xl border border-input bg-background px-3.5 text-base outline-none focus:border-primary/60"
            />
          </div>

          {/* Por qué no se puede borrar, antes de que alguien lo intente. */}
          {usada && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar: tiene {sucursal.manuales} manual
              {sucursal.manuales === 1 ? "" : "es"} en existencia, {sucursal.inventarios} conteo
              {sucursal.inventarios === 1 ? "" : "s"} y {sucursal.transferencias} transferencia
              {sucursal.transferencias === 1 ? "" : "s"}. Se puede renombrar.
            </p>
          )}

          <div className="flex gap-2">
            {sucursal && !usada && (
              <button
                type="button"
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
                disabled={ocupado}
                className={`flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
                  confirmarBorrado
                    ? "border-destructive bg-destructive text-white"
                    : "border-destructive/40 text-destructive"
                }`}
              >
                {borrar.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                {confirmarBorrado ? "¿Seguro?" : null}
              </button>
            )}
            <button
              type="submit"
              disabled={ocupado || !limpio || sinCambios}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
              {!limpio
                ? "Escribí el nombre"
                : sinCambios
                  ? "Sin cambios"
                  : sucursal
                    ? "Guardar cambios"
                    : "Crear sucursal"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
