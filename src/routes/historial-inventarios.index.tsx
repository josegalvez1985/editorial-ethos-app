import { createFileRoute, Link } from "@tanstack/react-router";
import { ChartColumn } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ReporteConteos } from "@/components/reporte-conteos";

export const Route = createFileRoute("/historial-inventarios/")({
  head: () => ({
    meta: [
      { title: "Historial de Inventarios de Manuales — Juventud con Valores" },
      {
        name: "description",
        content: "Todos los conteos de manuales de cada sucursal.",
      },
    ],
  }),
  component: HistorialInventariosPage,
});

/**
 * Historial de Inventarios de Manuales: la página 77 de APEX. Todos los
 * conteos de manuales de cada sucursal, con las facetas Sucursal y Manual.
 * Es la misma consulta que la 76 (`ReporteConteos` en modo `todos`; la 76 es
 * el modo `ultimo`, en `/consulta-inventarios`). Ver ese componente para lo
 * que cambia respecto de APEX. El ícono es el que ya tenía en el menú
 * (`Archive`).
 *
 * Para el historial de un período con su gráfico comparativo y su PDF está la
 * vista Historial de Consulta de inventarios: el aviso de arriba lleva ahí.
 */
function HistorialInventariosPage() {
  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <ReporteConteos
          modo="todos"
          titulo="Historial de Inventarios de Manuales"
          subtitulo="Todos los conteos de manuales de cada sucursal"
          vistas={
            <p className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <ChartColumn className="size-3.5" />
              ¿El gráfico comparativo o el PDF de un período?
              <Link
                to="/consulta-inventarios"
                className="font-semibold text-primary hover:underline"
              >
                Consulta de inventarios, en la vista Historial
              </Link>
            </p>
          }
        />
      </div>
    </AppShell>
  );
}
