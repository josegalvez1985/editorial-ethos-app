import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { IntervencionForm } from "@/components/intervencion-form";
import { keysCrud, obtenerCrud } from "@/lib/intervenciones-crud";

export const Route = createFileRoute("/intervenciones/$id")({
  head: () => ({
    meta: [
      { title: "Intervención — Juventud con Valores" },
      { name: "description", content: "Editar una intervención." },
    ],
  }),
  component: EditarIntervencionPage,
});

function EditarIntervencionPage() {
  const { id } = Route.useParams();
  const idNum = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: keysCrud.uno(idNum),
    queryFn: () => obtenerCrud(idNum),
    // Un id que no es número no se pide: el backend respondería 400 y el error
    // sería más confuso que no llamar.
    enabled: Number.isFinite(idNum),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-5 pt-5">
        <Link
          to="/intervenciones"
          className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          Intervenciones
        </Link>

        <h1 className="font-display mb-1 text-2xl font-bold">Editar intervención</h1>
        <p className="mb-5 text-xs text-muted-foreground">#{id}</p>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError || !data ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudo cargar la intervención.
          </p>
        ) : (
          /*
            `key` con el id: si se navega de una intervención a otra sin
            desmontar, React reusaría el estado del formulario anterior y
            quedarían mezclados los datos de las dos.
          */
          <IntervencionForm key={data.id_intervencion} previa={data} />
        )}
      </div>
    </AppShell>
  );
}
