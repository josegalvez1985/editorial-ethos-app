import { useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Database,
  RotateCcw,
  SquarePen,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import {
  abrirAsistente,
  cargarManual,
  nuevaConversacion,
  preguntar,
  reintentar,
  useAsistente,
  useAsistenteDisponible,
  type ConsultaIA,
  type MensajeIA,
} from "@/lib/asistente";
import { usePermisos } from "@/lib/permisos";
import { cn } from "@/lib/utils";

/**
 * El asistente con IA (15/10/2026): botón flotante y chat, en todas las
 * pantallas con sesión (lo monta `AppShell`). Lógica y contrato en
 * `lib/asistente.ts`; el backend, `backend/ia_asistente.sql`.
 *
 * | | Botón | Chat |
 * | --- | --- | --- |
 * | Celular y APK (`< lg`) | abajo a la derecha, encima de la barra | hoja casi a pantalla completa |
 * | Escritorio (`≥ lg`) | abajo a la derecha | panel fijo a la derecha, **sin tapar** la pantalla: `AppShell` le hace lugar, y sigue abierto al navegar |
 *
 * Solo aparece con la página de `/asistente` habilitada (`PUEDE_CONSULTAR`):
 * ver {@link useAsistenteDisponible}.
 */
export function Asistente() {
  const disponible = useAsistenteDisponible();
  const { abierto, pendiente } = useAsistente();
  const escritorio = useEscritorio();

  if (!disponible) return null;

  return (
    <>
      {!(escritorio && abierto) && (
        <button
          type="button"
          onClick={() => {
            void cargarManual(); // que esté listo para la primera pregunta
            abrirAsistente(true);
          }}
          aria-label="Abrir el asistente"
          title="Asistente"
          className="tap bg-hero-gradient fixed right-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full text-on-brand shadow-elegant lg:right-6 lg:bottom-6"
        >
          <Sparkles className="size-6" />
          {pendiente && (
            <span className="absolute top-0.5 right-0.5 flex size-3.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-on-brand/70" />
              <span className="relative inline-flex size-3.5 rounded-full border-2 border-on-brand bg-brand-red" />
            </span>
          )}
        </button>
      )}

      {escritorio ? (
        abierto && (
          <aside
            aria-label="Asistente"
            className="animate-in slide-in-from-right fade-in fixed inset-y-0 right-0 z-40 flex w-[420px] flex-col border-l border-border/70 bg-background shadow-elegant duration-200"
          >
            <PanelChat escritorio />
          </aside>
        )
      ) : (
        <Drawer open={abierto} onOpenChange={abrirAsistente} shouldScaleBackground={false}>
          <DrawerContent className="h-[94dvh] rounded-t-3xl border-border/60 lg:hidden">
            <DrawerTitle className="sr-only">Asistente</DrawerTitle>
            <DrawerDescription className="sr-only">
              Preguntale sobre el sistema o sobre los datos
            </DrawerDescription>
            <PanelChat escritorio={false} />
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

/** `≥ lg`, el mismo corte que la sidebar. */
function useEscritorio() {
  return useSyncExternalStore(
    (f) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", f);
      return () => mq.removeEventListener("change", f);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  );
}

/* -------------------------------------------------------------------------- */
/* El chat                                                                     */
/* -------------------------------------------------------------------------- */

function PanelChat({ escritorio }: { escritorio: boolean }) {
  const { mensajes, pendiente, usadasHoy, limite } = useAsistente();
  const pantalla = usePantallaActual();
  const [texto, setTexto] = useState("");
  const lista = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);

  // Siempre a la vista lo último: la pregunta recién mandada y la respuesta.
  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: "smooth" });
  }, [mensajes.length, pendiente]);

  // En la computadora se escribe enseguida; en el celular no se abre el
  // teclado solo, que tapa la mitad de la hoja.
  useEffect(() => {
    if (escritorio) entrada.current?.focus();
  }, [escritorio]);

  // Escape cierra el panel de la computadora (la hoja del celular ya lo hace).
  useEffect(() => {
    if (!escritorio) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") abrirAsistente(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escritorio]);

  const enviar = (t = texto) => {
    if (!t.trim() || pendiente) return;
    void preguntar(t, pantalla.texto);
    setTexto("");
    entrada.current?.style.removeProperty("height");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Cabecera */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <span className="bg-hero-gradient grid size-9 shrink-0 place-items-center rounded-full text-on-brand">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] leading-tight font-bold">Asistente</h2>
          <p className="truncate text-[11.5px] leading-tight text-muted-foreground">
            Sobre el sistema o sobre los datos
          </p>
        </div>
        {mensajes.length > 0 && (
          <button
            type="button"
            onClick={nuevaConversacion}
            disabled={pendiente}
            title="Nueva conversación"
            aria-label="Nueva conversación"
            className="tap grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <SquarePen className="size-[18px]" />
          </button>
        )}
        <button
          type="button"
          onClick={() => abrirAsistente(false)}
          title="Cerrar"
          aria-label="Cerrar el asistente"
          className="tap grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Conversación */}
      <div ref={lista} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 ? (
          <Bienvenida pantalla={pantalla.nombre} onElegir={enviar} />
        ) : (
          mensajes.map((m, i) => (
            <Mensaje
              key={m.id}
              m={m}
              ultimo={i === mensajes.length - 1}
              onReintentar={() => reintentar(pantalla.texto)}
            />
          ))
        )}
        {pendiente && <Pensando />}
      </div>

      {/* Entrada */}
      <div className="border-t border-border/60 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            ref={entrada}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              // Crece con el texto hasta unas 6 líneas.
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
            }}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            enterKeyHint="send"
            placeholder="Escribí tu pregunta…"
            aria-label="Tu pregunta"
            className="max-h-[150px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14.5px] leading-snug outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => enviar()}
            disabled={!texto.trim() || pendiente}
            aria-label="Enviar"
            className="tap grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            <ArrowUp className="size-[18px]" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[10.5px] leading-tight text-muted-foreground">
          Lo responde una IA con los datos del sistema: revisá lo importante.
          {usadasHoy != null && limite != null && (
            <>
              {" "}
              Hoy: {usadasHoy} de {limite} preguntas.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * La pantalla abierta, para la IA ("¿cómo uso esta pantalla?") y para la
 * primera sugerencia. El nombre sale del menú; Inicio y Mi cuenta no son
 * páginas.
 */
function usePantallaActual(): { nombre: string | null; texto: string } {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { paginaDeRuta } = usePermisos();
  const nombre =
    paginaDeRuta(pathname)?.nombre ??
    (pathname.startsWith("/home")
      ? "Inicio"
      : pathname.startsWith("/account")
        ? "Mi cuenta"
        : null);
  return { nombre, texto: nombre ? `${nombre} (${pathname})` : pathname };
}

function Bienvenida({
  pantalla,
  onElegir,
}: {
  pantalla: string | null;
  onElegir: (t: string) => void;
}) {
  const sugerencias = [
    pantalla && pantalla !== "Inicio" ? `¿Cómo se usa ${pantalla}?` : null,
    "¿Cuántas intervenciones se hicieron este mes?",
    "¿Qué instituciones no tienen facilitador este año?",
    "¿Quiénes cumplen años este mes?",
    "¿Cómo le doy permisos a un usuario?",
  ].filter((s): s is string => !!s);

  return (
    <div className="flex flex-col items-center pt-6 text-center">
      <span className="bg-hero-gradient grid size-14 place-items-center rounded-2xl text-on-brand shadow-soft">
        <Sparkles className="size-7" />
      </span>
      <p className="font-display mt-3 text-lg font-bold">¿En qué te ayudo?</p>
      <p className="mt-1 max-w-[19rem] text-[13px] text-muted-foreground">
        Preguntame cómo se usa una pantalla o cualquier cosa sobre los datos: intervenciones,
        facilitadores, instituciones, manuales…
      </p>
      <div className="mt-5 flex w-full flex-col gap-2">
        {sugerencias.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onElegir(s)}
            className="tap rounded-xl border border-border/70 bg-card px-3.5 py-2.5 text-left text-[13.5px] hover:border-primary/40 hover:bg-primary-soft"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Mensaje({
  m,
  ultimo,
  onReintentar,
}: {
  m: MensajeIA;
  ultimo: boolean;
  onReintentar: () => void;
}) {
  if (m.rol === "usuario") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[14px] leading-snug whitespace-pre-wrap text-primary-foreground">
          {m.texto}
        </p>
      </div>
    );
  }

  if (m.error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
        <p className="flex items-start gap-2 text-[13.5px] text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{m.texto}</span>
        </p>
        {ultimo && (
          <button
            type="button"
            onClick={onReintentar}
            className="tap mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3.5 text-[13px] font-semibold"
          >
            <RotateCcw className="size-3.5" />
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Markdown texto={m.texto} />
      <div className="flex flex-wrap items-center gap-1.5">
        <BotonCopiar texto={m.texto} />
        {!!m.consultas?.length && <Consultas consultas={m.consultas} />}
      </div>
    </div>
  );
}

function BotonCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          })
          .catch(() => toast.error("No se pudo copiar"));
      }}
      className="tap inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-muted-foreground hover:bg-muted"
    >
      {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}

/** Qué consultó para responder: el motivo, cuántas filas y el SQL. */
function Consultas({ consultas }: { consultas: ConsultaIA[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="tap inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-muted-foreground hover:bg-muted"
      >
        <Database className="size-3.5" />
        Ver consultas ({consultas.length})
        <ChevronDown className={cn("size-3.5 transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <ol className="mt-1.5 space-y-2">
          {consultas.map((c, i) => (
            <li key={i} className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-medium">{c.motivo || `Consulta ${i + 1}`}</p>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                    c.error ? "bg-destructive/10 text-destructive" : "bg-primary-soft text-primary",
                  )}
                >
                  {c.error ? "Error" : `${c.filas} ${c.filas === 1 ? "fila" : "filas"}`}
                </span>
              </div>
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-background px-2.5 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-muted-foreground">
                {c.sql}
              </pre>
              {c.error && <p className="mt-1.5 text-[11.5px] text-destructive">{c.error}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Mientras espera. No hay avance real que mostrar (la respuesta llega
 * entera), así que el texto cambia con el tiempo: una pregunta sobre datos
 * suele llevar varias consultas.
 */
function Pensando() {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const texto =
    segundos < 4
      ? "Pensando…"
      : segundos < 15
        ? "Buscando en los datos…"
        : `Sigue trabajando… (${segundos} s)`;

  return (
    <div className="flex items-center gap-2.5 text-[13px] text-muted-foreground" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-primary/70"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      {texto}
    </div>
  );
}
