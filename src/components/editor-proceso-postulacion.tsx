import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  Copy,
  Eye,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  PenLine,
  Quote,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { SoloLectura } from "@/components/admin-ui";
import { Markdown } from "@/components/markdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  guardarProcesoPostulacion,
  keysAniosLectivos,
  seccionesProceso,
  type AnioLectivo,
} from "@/lib/anios-lectivos";
import { cn } from "@/lib/utils";

/** El punto de partida: las tres partes que nombra el comentario de la columna. */
const PLANTILLA = `## Etapas

1. **Primera etapa**: qué se hace y hasta cuándo.
2. **Segunda etapa**: qué se hace y hasta cuándo.

## Documentos

- Documento que hay que presentar

## Requisitos

- Requisito que tiene que cumplir el postulante
`;

/**
 * Editor del **proceso de postulación** de un año lectivo (24/11/2026):
 * `ANIOS_LECTIVOS.PROCESO_POSTULACION`, el texto que el postulante acepta en el
 * formulario de la **otra app** que comparte la base. Se guarda en
 * **Markdown**, que es como esa app lo muestra.
 *
 * - Barra de formato (título, negrita, cursiva, listas, enlace, cita,
 *   separador) que escribe el Markdown por vos, y Ctrl+B / Ctrl+I / Ctrl+S.
 * - Vista previa al lado en pantallas grandes; en el celular, pestañas
 *   Escribir / Vista previa.
 * - Vacío, ofrece una plantilla (Etapas, Documentos, Requisitos) o copiar el
 *   del año anterior.
 * - Cerrar con cambios sin guardar pregunta antes.
 */
export function EditorProcesoPostulacion({
  anio,
  anterior,
  puedeEditar,
  onCerrar,
}: {
  anio: AnioLectivo;
  /** El año anterior con proceso cargado, para copiarlo. */
  anterior?: AnioLectivo;
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const area = useRef<HTMLTextAreaElement>(null);
  const [texto, setTexto] = useState(anio.proceso);
  const [vista, setVista] = useState<"escribir" | "previa">(puedeEditar ? "escribir" : "previa");
  const [descartar, setDescartar] = useState(false);
  /** Eligió "Escribir desde cero": ya no se ofrecen las opciones de inicio. */
  // Si ya tenía texto, borrarlo todo no vuelve a las opciones.
  const [empezado, setEmpezado] = useState(!!anio.proceso.trim());

  const sucio = texto.trim() !== anio.proceso.trim();
  const vacio = !texto.trim();
  const opcionesInicio = vacio && !empezado;

  const guardar = useMutation({
    mutationFn: () => guardarProcesoPostulacion(anio.id, texto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keysAniosLectivos.todo });
      toast.success(
        vacio ? `Se quitó el proceso de ${anio.anio}` : `Proceso de ${anio.anio} guardado`,
      );
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const cerrar = () => {
    if (guardar.isPending) return;
    if (sucio && puedeEditar) setDescartar(true);
    else onCerrar();
  };

  /* ------------------------------ formato ------------------------------ */

  /** Reemplaza la selección y deja el cursor (o la selección) donde va. */
  const reemplazar = (desde: number, hasta: number, nuevo: string, sel: [number, number]) => {
    const t = texto.slice(0, desde) + nuevo + texto.slice(hasta);
    setTexto(t);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(desde + sel[0], desde + sel[1]);
    });
  };

  /** `**texto**`: rodea la selección, o un texto de ejemplo seleccionado. */
  const rodear = (marca: string, ejemplo: string, cierre = marca) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = texto.slice(a, b) || ejemplo;
    reemplazar(a, b, `${marca}${sel}${cierre}`, [marca.length, marca.length + sel.length]);
  };

  /** Un prefijo al comienzo de cada línea seleccionada (`- `, `1. `, `## `, `> `). */
  const prefijo = (p: (i: number) => string, ejemplo: string) => {
    const el = area.current;
    if (!el) return;
    const a = texto.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const finLinea = texto.indexOf("\n", el.selectionEnd);
    const b = finLinea === -1 ? texto.length : finLinea;
    const lineas = (texto.slice(a, b) || ejemplo).split("\n");
    const nuevo = lineas
      .map((l, i) => p(i) + l.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, ""))
      .join("\n");
    reemplazar(a, b, nuevo, [nuevo.length, nuevo.length]);
  };

  const enlace = () => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = texto.slice(a, b) || "texto del enlace";
    const nuevo = `[${sel}](https://)`;
    // Deja seleccionado el "https://" para pegar la dirección encima.
    reemplazar(a, b, nuevo, [sel.length + 3, nuevo.length - 1]);
  };

  const separador = () => {
    const el = area.current;
    if (!el) return;
    const a = el.selectionStart;
    const antes = a > 0 && texto[a - 1] !== "\n" ? "\n\n" : "";
    const nuevo = `${antes}---\n\n`;
    reemplazar(a, el.selectionEnd, nuevo, [nuevo.length, nuevo.length]);
  };

  const BOTONES: { icono: LucideIcon; titulo: string; accion: () => void }[] = [
    { icono: Heading2, titulo: "Título", accion: () => prefijo(() => "## ", "Título") },
    { icono: Bold, titulo: "Negrita (Ctrl+B)", accion: () => rodear("**", "texto") },
    { icono: Italic, titulo: "Cursiva (Ctrl+I)", accion: () => rodear("_", "texto") },
    { icono: List, titulo: "Lista", accion: () => prefijo(() => "- ", "Elemento") },
    {
      icono: ListOrdered,
      titulo: "Lista numerada",
      accion: () => prefijo((i) => `${i + 1}. `, "Paso"),
    },
    { icono: Link2, titulo: "Enlace", accion: enlace },
    { icono: Quote, titulo: "Nota destacada", accion: () => prefijo(() => "> ", "Nota") },
    { icono: Minus, titulo: "Separador", accion: separador },
  ];

  const atajos = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      rodear("**", "texto");
    } else if (k === "i") {
      e.preventDefault();
      rodear("_", "texto");
    } else if (k === "s") {
      e.preventDefault();
      if (sucio) guardar.mutate();
    }
  };

  /* -------------------------------- vista -------------------------------- */

  const secciones = seccionesProceso(texto);

  return (
    <Dialog open onOpenChange={(o) => !o && cerrar()}>
      <DialogContent className="flex h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl flex-col gap-3 overflow-hidden rounded-2xl p-4 sm:p-5">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            Proceso de postulación {anio.anio}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Etapas, documentos y requisitos que el postulante lee y acepta al completar el
            formulario.
          </DialogDescription>
        </DialogHeader>

        {/* Pestañas: solo en el celular. En pantallas grandes van las dos. */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 lg:hidden">
          {(
            [
              ["escribir", "Escribir", PenLine],
              ["previa", "Vista previa", Eye],
            ] as const
          ).map(([clave, rotulo, Icono]) =>
            clave === "escribir" && !puedeEditar ? null : (
              <button
                key={clave}
                type="button"
                onClick={() => setVista(clave)}
                className={cn(
                  "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold",
                  vista === clave ? "bg-card shadow-soft" : "text-muted-foreground",
                  !puedeEditar && "col-span-2",
                )}
              >
                <Icono className="size-4" />
                {rotulo}
              </button>
            ),
          )}
        </div>

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3",
            puedeEditar ? "lg:grid-cols-2" : "lg:grid-cols-1",
          )}
        >
          {/* Escribir */}
          {puedeEditar && (
            <div
              className={cn(
                "flex min-h-0 flex-col overflow-hidden rounded-xl border border-input bg-background focus-within:border-primary/40",
                vista === "previa" && "hidden lg:flex",
              )}
            >
              <div
                className={cn(
                  "flex flex-wrap items-center gap-0.5 border-b border-border/60 px-1.5 py-1",
                  opcionesInicio && "hidden",
                )}
              >
                {BOTONES.map(({ icono: Icono, titulo, accion }) => (
                  <button
                    key={titulo}
                    type="button"
                    title={titulo}
                    aria-label={titulo}
                    onMouseDown={(e) => e.preventDefault()} // no perder la selección
                    onClick={accion}
                    disabled={guardar.isPending}
                    className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Icono className="size-4" />
                  </button>
                ))}
              </div>

              {opcionesInicio ? (
                <Vacio
                  anterior={anterior}
                  onPlantilla={() => {
                    setTexto(PLANTILLA);
                    setEmpezado(true);
                  }}
                  onCopiar={() => {
                    if (!anterior) return;
                    setTexto(anterior.proceso);
                    setEmpezado(true);
                  }}
                  onEscribir={() => {
                    setEmpezado(true);
                    requestAnimationFrame(() => area.current?.focus());
                  }}
                />
              ) : (
                <textarea
                  ref={area}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={atajos}
                  disabled={guardar.isPending}
                  spellCheck
                  aria-label="Proceso de postulación en Markdown"
                  className="min-h-0 flex-1 resize-none bg-transparent px-3.5 py-3 font-mono text-[13px] leading-relaxed outline-none"
                />
              )}
            </div>
          )}

          {/* Vista previa: como lo va a leer el postulante. */}
          <div
            className={cn(
              "min-h-0 overflow-y-auto rounded-xl border border-border/60 bg-card px-4 py-3.5",
              puedeEditar && vista === "escribir" && "hidden lg:block",
            )}
          >
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Eye className="size-3.5" />
              Así lo ve el postulante
            </p>
            {vacio ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Todavía no hay nada escrito.
              </p>
            ) : (
              <Markdown texto={texto} />
            )}
          </div>
        </div>

        {!puedeEditar && (
          <SoloLectura texto="Solo lectura: tu usuario no puede modificar años lectivos." />
        )}

        {descartar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 pl-3.5">
            <p className="min-w-0 flex-1 text-[13px] font-medium text-amber-800 dark:text-amber-300">
              Tenés cambios sin guardar. ¿Los descartás?
            </p>
            <button
              type="button"
              onClick={() => setDescartar(false)}
              className="h-10 rounded-xl px-3.5 text-sm font-semibold"
            >
              Seguir editando
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="h-10 rounded-xl bg-destructive px-3.5 text-sm font-semibold text-white"
            >
              Descartar
            </button>
          </div>
        ) : (
          puedeEditar && (
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted-foreground">
                {sucio ? (
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    Sin guardar
                  </span>
                ) : (
                  "Sin cambios"
                )}
                {secciones.length > 0 && ` · ${secciones.join(" · ")}`}
                {!vacio && ` · ${texto.trim().length.toLocaleString("es")} caracteres`}
              </p>
              <button
                type="button"
                onClick={cerrar}
                disabled={guardar.isPending}
                className="hidden h-11 rounded-xl px-4 text-sm font-semibold text-muted-foreground hover:text-foreground sm:block"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => guardar.mutate()}
                disabled={!sucio || guardar.isPending}
                className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
              >
                {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
                Guardar
              </button>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function Vacio({
  anterior,
  onPlantilla,
  onCopiar,
  onEscribir,
}: {
  anterior?: AnioLectivo;
  onPlantilla: () => void;
  onCopiar: () => void;
  onEscribir: () => void;
}) {
  const opcion =
    "tap flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-left hover:border-primary/40";
  return (
    <div className="flex flex-1 flex-col justify-center gap-2 overflow-y-auto p-4">
      <p className="mb-1 text-sm font-semibold">¿Cómo querés empezar?</p>
      {anterior && (
        <button type="button" onClick={onCopiar} className={opcion}>
          <Copy className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold">Copiar el de {anterior.anio}</span>
            <span className="block text-[12px] text-muted-foreground">
              Y ajustás lo que cambie este año.
            </span>
          </span>
        </button>
      )}
      <button type="button" onClick={onPlantilla} className={opcion}>
        <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>
          <span className="block text-sm font-semibold">Usar la plantilla</span>
          <span className="block text-[12px] text-muted-foreground">
            Con las secciones Etapas, Documentos y Requisitos, para completar.
          </span>
        </span>
      </button>
      <button type="button" onClick={onEscribir} className={opcion}>
        <PenLine className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>
          <span className="block text-sm font-semibold">Escribir desde cero</span>
          <span className="block text-[12px] text-muted-foreground">
            Con la barra de arriba das formato sin saber Markdown.
          </span>
        </span>
      </button>
    </div>
  );
}
