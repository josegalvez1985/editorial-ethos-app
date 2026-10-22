import { useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  RotateCcw,
  SquarePen,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
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
  type MensajeIA,
} from "@/lib/asistente";
import { usePermisos } from "@/lib/permisos";

/**
 * El asistente con IA (15/10/2026): botón flotante y chat, en todas las
 * pantallas con sesión (lo monta `AppShell`). Lógica y contrato en
 * `lib/asistente.ts`; el backend, `backend/ia_asistente.sql`.
 *
 * | | Botón | Chat |
 * | --- | --- | --- |
 * | Celular y APK (`< lg`) | abajo a la derecha, encima de la barra (se puede arrastrar) | hoja casi a pantalla completa |
 * | Escritorio (`≥ lg`) | abajo a la derecha (se puede arrastrar) | panel fijo a la derecha, **sin tapar** la pantalla: `AppShell` le hace lugar, y sigue abierto al navegar |
 *
 * Lo ven todos los que entran: no depende de Roles de páginas (Jose,
 * 15/10/2026; la primera versión pedía la página `/asistente`).
 */
export function Asistente() {
  const { abierto, pendiente } = useAsistente();
  const escritorio = useEscritorio();
  const movible = useBotonMovible(escritorio);

  return (
    <>
      {!(escritorio && abierto) && (
        <button
          type="button"
          {...movible.eventos}
          onClick={() => {
            if (movible.recienMovido()) return; // fue un arrastre, no un toque
            void cargarManual(); // que esté listo para la primera pregunta
            abrirAsistente(true);
          }}
          aria-label="Abrir el asistente"
          title="Asistente · arrastralo para moverlo"
          style={movible.pos ?? undefined}
          className="tap bg-hero-gradient fixed right-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 grid size-14 touch-none place-items-center rounded-full text-on-brand shadow-elegant select-none lg:right-6 lg:bottom-6"
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

/**
 * El botón se puede ARRASTRAR (22/10/2026, pedido de Jose: a veces quedaba
 * encima de algo de la pantalla). Se mantiene apretado y se suelta donde no
 * moleste; un toque sin mover sigue abriendo el chat. La posición se recuerda
 * en este navegador, una para el celular y otra para la computadora (las
 * pantallas no se parecen), y nunca queda fuera de la pantalla, bajo la
 * cabecera ni tapado por la barra de abajo del celular.
 */
type PosBoton = { right: number; bottom: number };

const TAM_BOTON = 56;
const MARGEN_BOTON = 8;
/** Lo que hay que mover el dedo para que cuente como arrastre y no como toque. */
const UMBRAL_ARRASTRE = 6;
const claveBoton = (escritorio: boolean) =>
  `ethos-asistente-boton-${escritorio ? "web" : "celular"}`;

/** Dentro de la pantalla, entre la cabecera (64 px) y la barra de abajo. */
function limitarBoton({ right, bottom }: PosBoton): PosBoton {
  const barra = document.querySelector("[data-barra-inferior]")?.getBoundingClientRect();
  const piso = (barra && barra.height > 0 ? barra.height : 0) + MARGEN_BOTON;
  const techo = window.innerHeight - TAM_BOTON - 64 - MARGEN_BOTON;
  const derecha = window.innerWidth - TAM_BOTON - MARGEN_BOTON;
  return {
    right: Math.round(Math.min(Math.max(right, MARGEN_BOTON), Math.max(derecha, MARGEN_BOTON))),
    bottom: Math.round(Math.min(Math.max(bottom, piso), Math.max(techo, piso))),
  };
}

function useBotonMovible(escritorio: boolean) {
  // null = el lugar de siempre (las clases del botón).
  const [pos, setPos] = useState<PosBoton | null>(null);
  const arrastre = useRef<{ x: number; y: number; desde: PosBoton; movio: boolean } | null>(null);
  const movido = useRef(false);

  // Se lee en un efecto: en el prerender no hay `localStorage`.
  useEffect(() => {
    let guardada: PosBoton | null = null;
    try {
      const v = JSON.parse(localStorage.getItem(claveBoton(escritorio)) ?? "null");
      if (typeof v?.right === "number" && typeof v?.bottom === "number") guardada = v;
    } catch {
      /* sin storage o dato roto: el lugar de siempre */
    }
    setPos(guardada && limitarBoton(guardada));
  }, [escritorio]);

  // Si la ventana se achica (o se gira el celular), que no quede afuera.
  useEffect(() => {
    const ajustar = () => setPos((p) => p && limitarBoton(p));
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, []);

  const destino = (e: PointerEvent<HTMLButtonElement>) => {
    const a = arrastre.current!;
    return limitarBoton({
      right: a.desde.right - (e.clientX - a.x),
      bottom: a.desde.bottom - (e.clientY - a.y),
    });
  };

  const eventos = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      movido.current = false;
      const r = e.currentTarget.getBoundingClientRect();
      arrastre.current = {
        x: e.clientX,
        y: e.clientY,
        desde: { right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom },
        movio: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const a = arrastre.current;
      if (!a) return;
      if (!a.movio && Math.hypot(e.clientX - a.x, e.clientY - a.y) < UMBRAL_ARRASTRE) return;
      a.movio = true;
      setPos(destino(e));
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const a = arrastre.current;
      if (!a) return;
      if (a.movio) {
        const final = destino(e);
        setPos(final);
        movido.current = true;
        try {
          localStorage.setItem(claveBoton(escritorio), JSON.stringify(final));
        } catch {
          /* se pierde la posición al recargar, no el arrastre */
        }
      }
      arrastre.current = null;
    },
    onPointerCancel: () => {
      arrastre.current = null;
    },
  };

  /** Si el clic que llega es el final de un arrastre (y lo consume). */
  const recienMovido = () => {
    const m = movido.current;
    movido.current = false;
    return m;
  };

  return { pos, eventos, recienMovido };
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
      {/*
        Sin "Ver consultas" (15/10/2026, a pedido): el usuario ve solo la
        respuesta. El SQL que corrió queda en IA_CONSULTAS.CONSULTAS.
      */}
      <BotonCopiar texto={m.texto} />
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
