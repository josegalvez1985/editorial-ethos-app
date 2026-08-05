import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EvaluacionForm } from "@/components/evaluacion-form";
import { guardarEvaluacion, type Cabecera, type Detalle } from "@/lib/evaluaciones";

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
    mutationFn: ({ cab, detalles }: { cab: Cabecera; detalles: Detalle[] }) =>
      guardarEvaluacion(cab, detalles),
    onSuccess: (r) => {
      // El listado y el resumen del inicio quedaron viejos.
      qc.invalidateQueries({ queryKey: ["evaluaciones"] });
      toast.success(`Evaluación creada con ${r.creados} ítems`);
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
