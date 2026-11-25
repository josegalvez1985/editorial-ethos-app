import { ExternalLink, Loader2, RefreshCw, Trash2, Undo2, Upload, UserRound } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { miniatura } from "@/lib/cloudinary";
import { subirFotoCarnet } from "@/lib/facilitadores";
import { cn } from "@/lib/utils";

/**
 * La foto carnet del facilitador (`FOTO_CARNET`, 25/11/2026), en su ficha. Es
 * aparte de la foto de perfil.
 *
 * - Sin foto: Subir.
 * - Con foto: tocarla la abre en grande; Reemplazar y Quitar.
 *
 * Subir y Reemplazar suben a Cloudinary enseguida (carpeta `foto_carnet`), pero
 * la ficha cambia recién al Guardar. Reemplazar y Quitar **no borran nada
 * todavía**: el archivo anterior lo borra el backend después de guardar. Hasta
 * entonces la tarjeta lo dice y se puede deshacer.
 *
 * Va dentro del `<fieldset>` de la ficha: sin permiso para guardar, sus
 * botones quedan deshabilitados con el resto; la foto se ve y se abre igual.
 */
export function FotoCarnetFacilitador({
  url,
  original,
  nombre,
  onCambio,
}: {
  /** La de la ficha (lo que se va a guardar). */
  url: string;
  /** La guardada en la base. */
  original: string;
  nombre: string;
  onCambio: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [viendo, setViendo] = useState(false);

  const quitada = !url && !!original;
  const nueva = !!url && url !== original;
  const visible = url || original;
  const subiendo = progreso != null;
  const puedeVer = !!url && !subiendo;

  const subir = async (archivo: File) => {
    setProgreso(0);
    try {
      onCambio(await subirFotoCarnet(archivo, setProgreso));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setProgreso(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-4">
      {/*
        Un <div role="button"> y no un <button>: el <fieldset disabled> de la
        ficha deshabilita sus botones, y quien solo puede ver tiene que poder
        abrir la foto en grande igual.
      */}
      <div
        role={puedeVer ? "button" : undefined}
        tabIndex={puedeVer ? 0 : undefined}
        onClick={() => puedeVer && setViendo(true)}
        onKeyDown={(e) => {
          if (puedeVer && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setViendo(true);
          }
        }}
        aria-label={url ? "Ver la foto carnet" : "Sin foto carnet"}
        className={cn(
          "relative grid aspect-[3/4] w-24 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted/40",
          puedeVer &&
            "cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          nueva ? "border-primary/60" : quitada ? "border-destructive/50" : "border-border/60",
          !visible && "border-dashed",
        )}
      >
        {visible ? (
          <img
            src={miniatura(visible, 240)}
            alt={`Foto carnet de ${nombre || "el facilitador"}`}
            className={cn("h-full w-full object-cover", quitada && "opacity-30 grayscale")}
          />
        ) : (
          <UserRound className="size-9 text-muted-foreground/50" aria-hidden />
        )}
        {(nueva || quitada) && (
          <span
            className={cn(
              "absolute top-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white",
              nueva ? "bg-primary" : "bg-destructive",
            )}
          >
            {nueva ? "Nueva" : "Se quita"}
          </span>
        )}
        {subiendo && (
          <span className="absolute inset-0 grid place-items-center bg-background/85 px-2">
            <span className="w-full">
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progreso}%` }}
                />
              </span>
              <span className="mt-1 block text-center text-[10.5px] font-medium">{progreso}%</span>
            </span>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-[12.5px] font-semibold">Foto carnet</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {quitada
              ? "Se borra al guardar."
              : nueva
                ? original
                  ? "Reemplaza a la anterior, que se borra al guardar."
                  : "Se guarda con la ficha."
                : visible
                  ? "Tocala para verla en grande."
                  : "Todavía no tiene. Una foto tipo carnet, de frente."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quitada ? (
            <Boton icono={Undo2} onClick={() => onCambio(original)}>
              Deshacer
            </Boton>
          ) : (
            <>
              <Boton
                icono={subiendo ? Loader2 : url ? RefreshCw : Upload}
                girando={subiendo}
                principal={!url}
                onClick={() => input.current?.click()}
                deshabilitado={subiendo}
              >
                {subiendo ? "Subiendo…" : url ? "Reemplazar" : "Subir foto"}
              </Boton>
              {url && (
                <Boton
                  icono={nueva && original ? Undo2 : Trash2}
                  peligro={!(nueva && original)}
                  onClick={() => onCambio(nueva && original ? original : "")}
                  deshabilitado={subiendo}
                >
                  {nueva && original ? "Volver a la anterior" : "Quitar"}
                </Boton>
              )}
            </>
          )}
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) void subir(archivo);
        }}
      />

      {viendo && url && (
        <Dialog open onOpenChange={(o) => !o && setViendo(false)}>
          <DialogContent className="flex max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-md flex-col gap-3 rounded-2xl p-4">
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-lg">Foto carnet</DialogTitle>
              <DialogDescription className="text-xs">{nombre || "Facilitador"}</DialogDescription>
            </DialogHeader>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto rounded-xl bg-muted/40">
              <img
                src={miniatura(url, 1200)}
                alt={`Foto carnet de ${nombre || "el facilitador"}`}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border/60 text-sm font-semibold"
            >
              <ExternalLink className="size-4" />
              Abrir original
            </a>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Boton({
  icono: Icono,
  children,
  onClick,
  principal,
  peligro,
  girando,
  deshabilitado,
}: {
  icono: typeof Upload;
  children: ReactNode;
  onClick: () => void;
  principal?: boolean;
  peligro?: boolean;
  girando?: boolean;
  deshabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold disabled:opacity-50",
        principal
          ? "bg-primary-soft text-primary"
          : peligro
            ? "border border-border/60 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            : "border border-border/60 text-foreground hover:bg-muted",
      )}
    >
      <Icono className={cn("size-4", girando && "animate-spin")} aria-hidden />
      {children}
    </button>
  );
}
