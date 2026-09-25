import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { TransferenciaForm } from "@/components/transferencia-form";

export const Route = createFileRoute("/transferencias/nueva")({
  head: () => ({
    meta: [
      { title: "Nueva transferencia — Juventud con Valores" },
      { name: "description", content: "Enviar manuales de una sucursal a otra." },
    ],
  }),
  component: NuevaTransferenciaPage,
});

function NuevaTransferenciaPage() {
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

        <h1 className="font-display mb-1 text-2xl font-bold">Nueva transferencia</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          Elegí la ruta y los manuales que viajan. Las existencias se mueven al recibirla.
        </p>

        <TransferenciaForm />
      </div>
    </AppShell>
  );
}
