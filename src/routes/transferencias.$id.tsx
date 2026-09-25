import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { TransferenciaForm } from "@/components/transferencia-form";
import { keysTransferencias, obtenerTransferencia } from "@/lib/transferencias";

export const Route = createFileRoute("/transferencias/$id")({
  head: () => ({
    meta: [
      { title: "Transferencia — Juventud con Valores" },
      { name: "description", content: "Detalle de una transferencia de manuales." },
    ],
  }),
  component: TransferenciaPage,
});

function TransferenciaPage() {
  const { id } = Route.useParams();
  const idNum = Number(id);

  const { data, isLoading, isError } = useQuery({
    queryKey: keysTransferencias.uno(idNum),
    queryFn: () => obtenerTransferencia(idNum),
    // Un id que no es número no se pide: el backend respondería 400 y el error
    // sería más confuso que no llamar.
    enabled: Number.isFinite(idNum),
  });

  return (
    // Sin barra de navegación: el formulario tiene su propio footer fijo.
    <AppShell nav={false}>
      <div className="px-5 pt-5">
        <Link
          to="/transferencias"
          className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          Transferencias
        </Link>

        <h1 className="font-display mb-1 text-2xl font-bold">Transferencia #{id}</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          {data ? `${data.origen} → ${data.destino}` : " "}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError || !data ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudo cargar la transferencia.
          </p>
        ) : (
          /*
            `key` con el id y el estado: al recibirla, el formulario tiene que
            rearmarse en solo lectura; y entre dos transferencias, React
            reusaría el estado de la anterior.
          */
          <TransferenciaForm key={`${data.id_transferencia}-${data.recibida}`} previa={data} />
        )}
      </div>
    </AppShell>
  );
}
