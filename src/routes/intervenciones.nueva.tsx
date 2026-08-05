import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { IntervencionForm } from "@/components/intervencion-form";

export const Route = createFileRoute("/intervenciones/nueva")({
  head: () => ({
    meta: [
      { title: "Nueva intervención — Juventud con Valores" },
      { name: "description", content: "Carga manual de una intervención." },
    ],
  }),
  component: NuevaIntervencionPage,
});

function NuevaIntervencionPage() {
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

        <h1 className="font-display mb-1 text-2xl font-bold">Nueva intervención</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          Para registrar una clase que quedó sin cargar
        </p>

        <IntervencionForm />
      </div>
    </AppShell>
  );
}
