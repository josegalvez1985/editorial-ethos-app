import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EvaluacionForm } from "@/components/evaluacion-form";
import { esSinConexion } from "@/lib/api";
import { guardarEvaluacion, type Cabecera, type Detalle } from "@/lib/evaluaciones";
import { encolar } from "@/lib/offline";

export const Route = createFileRoute("/evaluaciones/nueva")({
  head: () => ({
    meta: [{ title: "Nueva evaluación — Juventud con Valores" }],
  }),
  component: NuevaPage,
});

function NuevaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const mutacion = useMutation({
    // Una llamada por detalle: la tabla no tiene cabecera, así que "crear una
    // evaluación" es insertar N filas que repiten los datos del encabezado.
    mutationFn: async ({ cab, detalles }: { cab: Cabecera; detalles: Detalle[] }) => {
      /*
       * SIN CONEXIÓN: a la cola, y se sube sola en el próximo login con red.
       *
       * Se intenta el guardado normal PRIMERO y se encola solo si falla por
       * red. Preguntar por `navigator.onLine` antes sería peor: miente seguido
       * —da `true` con wifi sin salida a internet— y encolaría evaluaciones que
       * se podían guardar de una.
       *
       * Solo se encolan evaluaciones NUEVAS. Es esta pantalla; la de edición no
       * encola, por lo que explica el encabezado de `lib/offline.ts`.
       */
      try {
        return await guardarEvaluacion(cab, detalles);
      } catch (e) {
        if (!esSinConexion(e)) throw e;
        encolar(cab, detalles);
        return "encolada" as const;
      }
    },
    onSuccess: (r) => {
      // El listado y el resumen del inicio quedaron viejos.
      qc.invalidateQueries({ queryKey: ["evaluaciones"] });
      if (r === "encolada") {
        toast.success("Evaluación guardada en el teléfono", {
          description: "Se va a subir sola cuando vuelvas a entrar con internet.",
        });
      } else {
        toast.success(`Evaluación creada con ${r.creados} ítems`);
      }
      navigate({ to: "/evaluaciones", replace: true });
    },
    onError: (e) => {
      // El backend valida lo mismo que el formulario y algo más (que la
      // evaluación pertenezca al área, que la ciudad exista): su mensaje es más
      // preciso que cualquier texto genérico de acá.
      toast.error(e instanceof Error ? e.message : "No se pudo crear la evaluación");
    },
  });

  return (
    <AppShell nav={false}>
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Evaluaciones
        </p>
        <h1 className="font-display mt-1 text-[2rem] leading-none font-bold">Nueva</h1>
      </div>

      <EvaluacionForm
        guardando={mutacion.isPending}
        onSubmit={(cab, detalles) => mutacion.mutate({ cab, detalles })}
        textoBoton="Crear evaluación"
      />
    </AppShell>
  );
}
