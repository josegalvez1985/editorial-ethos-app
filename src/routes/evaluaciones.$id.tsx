import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { EvaluacionForm } from "@/components/evaluacion-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  actualizarEvaluacion,
  eliminarEvaluacion,
  keys,
  obtenerEvaluacion,
  type EvaluacionInput,
} from "@/lib/evaluaciones";

export const Route = createFileRoute("/evaluaciones/$id")({
  head: () => ({
    meta: [{ title: "Editar evaluación — Editorial Ethos" }],
  }),
  component: EditarPage,
});

function EditarPage() {
  const { id } = Route.useParams();
  const idNum = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keys.evaluacion(idNum),
    queryFn: () => obtenerEvaluacion(idNum),
    enabled: Number.isFinite(idNum),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["evaluaciones"] });
    qc.invalidateQueries({ queryKey: keys.evaluacion(idNum) });
  };

  const guardar = useMutation({
    mutationFn: (v: EvaluacionInput) => actualizarEvaluacion(idNum, v),
    onSuccess: () => {
      invalidar();
      toast.success("Evaluación actualizada");
      navigate({ to: "/evaluaciones", replace: true });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar la evaluación"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarEvaluacion(idNum),
    onSuccess: () => {
      invalidar();
      toast.success("Evaluación eliminada");
      navigate({ to: "/evaluaciones", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  return (
    <AppShell nav={false}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Evaluación #{id}
          </p>
          <h1 className="font-display mt-1 truncate text-[2rem] leading-none font-bold">
            {data?.facilitador ?? "Editar"}
          </h1>
        </div>

        {data ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                aria-label="Eliminar evaluación"
                className="tap grid size-11 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"
              >
                <Trash2 className="size-5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-[calc(100vw-2.5rem)] rounded-2xl sm:max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">¿Eliminar evaluación?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borra el registro de {data.facilitador ?? "el facilitador"}. Queda copia en la
                  bitácora de auditoría, pero no se puede deshacer desde la app.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2">
                <AlertDialogCancel className="h-11 rounded-xl">Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => borrar.mutate()}
                  className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {borrar.isPending ? "Eliminando…" : "Eliminar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-4 px-5 pt-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <div className="mx-5 mt-5 rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "No se pudo cargar la evaluación"}
        </div>
      ) : data ? (
        // key: si se navega de una evaluación a otra, el formulario tiene que
        // reiniciar su estado en vez de quedarse con los valores anteriores.
        <EvaluacionForm
          key={data.id_evaluacion_facilitador}
          inicial={data}
          guardando={guardar.isPending}
          onSubmit={(v) => guardar.mutate(v)}
          textoBoton="Guardar cambios"
        />
      ) : null}

      {borrar.isPending ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/60">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : null}
    </AppShell>
  );
}
