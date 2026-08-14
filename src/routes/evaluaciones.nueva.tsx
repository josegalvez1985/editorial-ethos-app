import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EvaluacionForm } from "@/components/evaluacion-form";
import { borrarBorrador, hace, leerBorrador, type ContenidoBorrador } from "@/lib/borrador";
import { guardarEvaluacion, type Cabecera, type Detalle } from "@/lib/evaluaciones";

export const Route = createFileRoute("/evaluaciones/nueva")({
  head: () => ({
    meta: [{ title: "Nueva evaluación — Juventud con Valores" }],
  }),
  component: NuevaPage,
});

/**
 * Alta de una evaluación, con recuperación de lo tipeado.
 *
 * ## POR QUÉ HAY UN BORRADOR
 *
 * Esta carga se hace en la escuela y lleva varios minutos: quedarse sin señal,
 * que el teléfono mate la WebView o que venza el token de 6 h perdía todo. El
 * formulario ahora se guarda solo en el teléfono mientras se escribe. Ver
 * `lib/borrador.ts`.
 *
 * **El borrador NO es una evaluación creada.** Hasta que se toque "Crear
 * evaluación" con red, no existe en Oracle ni la ve nadie más. Es una red de
 * seguridad contra perder el tipeo, no un modo offline.
 */
function NuevaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  /*
   * El borrador se lee UNA vez, al montar, y queda congelado en el estado.
   *
   * Con `useState(() => …)` y no en el render: leer en cada render devolvería un
   * objeto nuevo cada vez y el formulario se reiniciaría solo. Además el
   * formulario lo va a ir reescribiendo mientras se tipea, así que releerlo daría
   * justamente lo que se acaba de escribir.
   */
  const [guardado] = useState(() => leerBorrador());
  /** `null` = todavía no decidió; el formulario espera detrás del cartel. */
  const [restaurado, setRestaurado] = useState<ContenidoBorrador | null>(null);
  const [decidio, setDecidio] = useState(false);

  const mutacion = useMutation({
    // Una llamada por detalle: la tabla no tiene cabecera, así que "crear una
    // evaluación" es insertar N filas que repiten los datos del encabezado.
    mutationFn: ({ cab, detalles }: { cab: Cabecera; detalles: Detalle[] }) =>
      guardarEvaluacion(cab, detalles),
    onSuccess: (r) => {
      // Ya está en Oracle: el borrador cumplió su función y se va. Si quedara,
      // la próxima alta ofrecería restaurar una evaluación ya creada y se
      // cargaría dos veces.
      borrarBorrador();
      // El listado y el resumen del inicio quedaron viejos.
      qc.invalidateQueries({ queryKey: ["evaluaciones"] });
      toast.success(`Evaluación creada con ${r.creados} ítems`);
      navigate({ to: "/evaluaciones", replace: true });
    },
    onError: (e) => {
      // El backend valida lo mismo que el formulario y algo más (que la
      // evaluación pertenezca al área, que la ciudad exista): su mensaje es más
      // preciso que cualquier texto genérico de acá.
      //
      // El borrador NO se borra acá, a propósito: si el guardado falló —sin red,
      // o rechazo del backend— es justo cuando más hace falta conservarlo.
      toast.error(e instanceof Error ? e.message : "No se pudo crear la evaluación");
    },
  });

  // Hay algo que ofrecer y el usuario todavía no dijo qué hacer con eso.
  const ofrecer = guardado !== null && !decidio;

  return (
    <AppShell nav={false}>
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Evaluaciones
        </p>
        <h1 className="font-display mt-1 text-[2rem] leading-none font-bold">Nueva</h1>
      </div>

      {/*
        EL CARTEL VA ANTES DEL FORMULARIO, Y EL FORMULARIO ESPERA.

        Si se montara el formulario debajo del cartel, su autoguardado
        arrancaría con el estado en blanco y pisaría el borrador que el cartel
        está ofreciendo restaurar — se perdería justo al ofrecerlo.
      */}
      {ofrecer ? (
        <div className="mx-5 mt-5 rounded-2xl border border-primary/40 bg-primary-soft p-4">
          <div className="flex items-start gap-3">
            <FileClock className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">Tenés una evaluación a medio cargar</p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                Se guardó en este teléfono {hace(guardado.guardadoEn)}
                {guardado.textos.facilitador ? ` · ${guardado.textos.facilitador}` : ""}. Nunca
                llegó a Oracle: si la descartás, se pierde.
              </p>
            </div>
          </div>

          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => {
                borrarBorrador();
                setDecidio(true);
              }}
              className="tap h-11 flex-1 rounded-xl border border-border/60 bg-card text-sm font-semibold"
            >
              Empezar de cero
            </button>
            <button
              type="button"
              onClick={() => {
                setRestaurado(guardado);
                setDecidio(true);
              }}
              className="tap h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              Seguir cargando
            </button>
          </div>
        </div>
      ) : (
        <EvaluacionForm
          // Sin `key` el formulario ya montado no tomaría el borrador: los
          // `useState(() => …)` solo corren en el primer render. Como el cartel
          // lo mantiene desmontado hasta que se decide, esto es cinturón y
          // tiradores — pero es lo que hace que restaurar sea inmediato.
          key={restaurado ? "restaurado" : "limpio"}
          restaurado={restaurado ?? undefined}
          autoguardar
          guardando={mutacion.isPending}
          onSubmit={(cab, detalles) => mutacion.mutate({ cab, detalles })}
          textoBoton="Crear evaluación"
        />
      )}
    </AppShell>
  );
}
