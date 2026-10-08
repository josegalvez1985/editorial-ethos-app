import { FileText, Loader2, Plus, Search, Trash2, X } from "lucide-react";

/**
 * Piezas de las dos pantallas de administración: Permisos (`/permisos`) y
 * Páginas del menú (`/paginas`). Separadas en dos rutas el 08/10/2026 porque
 * las administran personas distintas, pero se ven igual.
 */

export function Buscador({
  valor,
  onCambio,
  placeholder,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-input bg-card pr-9 pl-9 text-base outline-none focus:border-primary/40 lg:text-sm"
      />
      {valor && (
        <button
          onClick={() => onCambio("")}
          aria-label="Limpiar búsqueda"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Cargando…
    </div>
  );
}

export function Fallo({ error, texto }: { error: unknown; texto: string }) {
  return (
    <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
      {error instanceof Error ? error.message : texto}
    </p>
  );
}

export function NumeroPagina({ pagina }: { pagina: number }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-xs font-bold tabular-nums">
      {pagina}
    </span>
  );
}

export function Etiqueta({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-semibold text-primary">
      {children}
    </span>
  );
}

export function BotonPrimario({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
    >
      <Plus className="size-4" />
      {children}
    </button>
  );
}

/** Borrar pide un segundo toque en el mismo botón, sin un diálogo encima de otro. */
export function BotonBorrar({
  confirmar,
  pendiente,
  deshabilitado,
  onClick,
}: {
  confirmar: boolean;
  pendiente: boolean;
  deshabilitado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      aria-label="Eliminar"
      className={`flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold transition-colors disabled:opacity-60 ${
        confirmar
          ? "border-destructive bg-destructive text-white"
          : "border-destructive/40 text-destructive"
      }`}
    >
      {pendiente ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      {confirmar ? "¿Seguro?" : null}
    </button>
  );
}

export function SoloLectura({ texto }: { texto: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
      <FileText className="mt-px size-3.5 shrink-0" />
      {texto}
    </p>
  );
}
