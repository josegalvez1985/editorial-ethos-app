import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  descargarDeCloudinary,
  esPdf,
  extension,
  miniatura,
  TIPOS_ARCHIVO,
} from "@/lib/cloudinary";
import { esEnlace, nombreDescarga, subirArchivoPostulante } from "@/lib/postulantes";
import { campo, cn } from "@/lib/utils";

/**
 * Un documento de Cloudinary de la ficha del postulante (24/11/2026).
 *
 * - Con archivo: la miniatura (la primera página si es PDF) y Ver, Descargar,
 *   Reemplazar y Quitar.
 * - Sin archivo: "Falta" si le corresponde (o "No corresponde") y Subir.
 *
 * Reemplazar y Quitar **no tocan Cloudinary todavía**: cambian la ficha, y el
 * archivo viejo se borra al Guardar (lo hace el backend, después de guardar).
 * Hasta entonces la tarjeta lo dice y se puede deshacer.
 */
export function DocCloudinary({
  nombre,
  url,
  original,
  corresponde,
  cedula,
  archivo,
  editable,
  onCambio,
}: {
  nombre: string;
  /** El de la ficha (lo que se va a guardar). */
  url: string;
  /** El guardado en la base. */
  original: string;
  corresponde: boolean;
  cedula: string;
  /** Para el nombre de la descarga: "cedula-frente". */
  archivo: string;
  editable: boolean;
  onCambio: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [viendo, setViendo] = useState(false);

  const quitado = !url && !!original;
  const nuevo = !!url && url !== original;
  const visible = url || original;

  const subir = async (f: File) => {
    setProgreso(0);
    try {
      onCambio(await subirArchivoPostulante(f, setProgreso));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir el archivo");
    } finally {
      setProgreso(null);
      if (input.current) input.current.value = "";
    }
  };

  const descargar = () =>
    descargarDeCloudinary(
      url,
      nombreDescarga(cedula, archivo, extension(url)),
      `de ${nombre}`,
    ).catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo descargar"));

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border bg-card",
        !visible
          ? corresponde
            ? "border-dashed border-amber-500/50"
            : "border-dashed border-border"
          : nuevo
            ? "border-primary/50"
            : quitado
              ? "border-destructive/40"
              : "border-border/60",
      )}
    >
      <button
        type="button"
        onClick={() => visible && !quitado && setViendo(true)}
        disabled={!visible || quitado}
        className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-muted/40"
        aria-label={visible ? `Ver ${nombre}` : nombre}
      >
        {visible ? (
          <img
            src={miniatura(visible, 360)}
            alt={nombre}
            loading="lazy"
            className={cn("h-full w-full object-cover", quitado && "opacity-30 grayscale")}
          />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px] font-medium text-muted-foreground">
            <FileText className="size-6 opacity-50" />
            {corresponde ? "Falta" : "No corresponde"}
          </span>
        )}
        {visible && esPdf(visible) && (
          <span className="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
            PDF
          </span>
        )}
        {(nuevo || quitado) && (
          <span
            className={cn(
              "absolute top-2 right-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white",
              nuevo ? "bg-primary" : "bg-destructive",
            )}
          >
            {nuevo ? "Nuevo" : "Se quita"}
          </span>
        )}
        {progreso != null && (
          <span className="absolute inset-0 grid place-items-center bg-background/80">
            <span className="w-2/3">
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progreso}%` }}
                />
              </span>
              <span className="mt-1 block text-center text-[11px] font-medium">
                Subiendo… {progreso}%
              </span>
            </span>
          </span>
        )}
      </button>

      <div className="flex items-center gap-1 px-2.5 py-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{nombre}</p>
        {quitado ? (
          editable && <Accion icono={Undo2} titulo="Deshacer" onClick={() => onCambio(original)} />
        ) : url ? (
          <>
            <Accion icono={Eye} titulo="Ver" onClick={() => setViendo(true)} />
            <Accion icono={Download} titulo="Descargar" onClick={() => void descargar()} />
            {editable && (
              <>
                <Accion
                  icono={RefreshCw}
                  titulo="Reemplazar"
                  onClick={() => input.current?.click()}
                  ocupado={progreso != null}
                />
                <Accion
                  icono={nuevo && original ? Undo2 : Trash2}
                  titulo={nuevo && original ? "Volver al anterior" : "Quitar"}
                  peligro={!(nuevo && original)}
                  onClick={() => onCambio(nuevo && original ? original : "")}
                />
              </>
            )}
          </>
        ) : (
          editable && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={progreso != null}
              className="flex h-8 items-center gap-1 rounded-lg bg-primary-soft px-2.5 text-[12px] font-semibold text-primary"
            >
              {progreso != null ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Subir
            </button>
          )
        )}
      </div>
      {(nuevo || quitado) && (
        <p className="px-2.5 pb-2 text-[10.5px] leading-snug text-muted-foreground">
          {quitado
            ? "Se borra de Cloudinary al guardar."
            : original
              ? "Reemplaza al anterior, que se borra al guardar."
              : "Se guarda con la ficha."}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept={TIPOS_ARCHIVO}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void subir(f);
        }}
      />

      {viendo && url && (
        <Visor
          nombre={nombre}
          url={url}
          onDescargar={descargar}
          onCerrar={() => setViendo(false)}
        />
      )}
    </div>
  );
}

function Accion({
  icono: Icono,
  titulo,
  onClick,
  peligro,
  ocupado,
}: {
  icono: typeof Eye;
  titulo: string;
  onClick: () => void;
  peligro?: boolean;
  ocupado?: boolean;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={ocupado}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted",
        peligro ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Icono className="size-4" />}
    </button>
  );
}

/** El archivo grande, sin salir de la ficha. Un PDF muestra su primera página. */
function Visor({
  nombre,
  url,
  onDescargar,
  onCerrar,
}: {
  nombre: string;
  url: string;
  onDescargar: () => void;
  onCerrar: () => void;
}) {
  const pdf = esPdf(url);
  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="flex max-h-[94vh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col gap-3 rounded-2xl p-4">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-lg">{nombre}</DialogTitle>
          <DialogDescription className="text-xs">
            {pdf ? "La primera página del PDF." : "Tocá Abrir para verla en tamaño original."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto rounded-xl bg-muted/40">
          <img
            src={miniatura(url, 1400)}
            alt={nombre}
            className="max-h-[70vh] w-auto max-w-full object-contain"
          />
        </div>
        <div className="flex gap-2">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border/60 text-sm font-semibold"
          >
            <ExternalLink className="size-4" />
            Abrir {pdf ? "el PDF" : "original"}
          </a>
          <button
            type="button"
            onClick={onDescargar}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            <Download className="size-4" />
            Descargar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Un documento de OneDrive: un enlace (o una ruta) de texto. Se edita y, si es
 * un enlace, se abre.
 */
export function DocOneDrive({
  nombre,
  valor,
  editable,
  onCambio,
}: {
  nombre: string;
  valor: string;
  editable: boolean;
  onCambio: (v: string) => void;
}) {
  const v = valor.trim();
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn("size-2 shrink-0 rounded-full", v ? "bg-emerald-500" : "bg-amber-500")}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{nombre}</p>
        {v && esEnlace(v) && (
          <a
            href={v}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-primary hover:bg-primary-soft"
          >
            <ExternalLink className="size-3.5" />
            Abrir
          </a>
        )}
      </div>
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        disabled={!editable}
        maxLength={1000}
        placeholder="Enlace o ruta en OneDrive"
        className={`${campo} h-10 text-[13px]`}
      />
    </div>
  );
}

/** "MB" de "María Benítez". */
const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** La foto carnet en un círculo, o las iniciales. */
export function Avatar({
  foto,
  nombre,
  className = "size-12 text-sm",
}: {
  foto: string;
  nombre: string;
  className?: string;
}) {
  return foto ? (
    <img
      src={miniatura(foto, 160)}
      alt=""
      loading="lazy"
      className={cn("shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-primary-soft font-bold text-primary",
        className,
      )}
    >
      {iniciales(nombre) || "?"}
    </span>
  );
}
