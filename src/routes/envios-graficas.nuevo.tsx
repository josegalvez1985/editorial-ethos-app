import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { EnvioGraficaForm } from "@/components/envio-grafica-form";
import { keysEnvios, listarEnvios } from "@/lib/envios-graficas";

export const Route = createFileRoute("/envios-graficas/nuevo")({
  head: () => ({
    meta: [
      { title: "Nuevo envío de gráficas — Juventud con Valores" },
      { name: "description", content: "Lo que una gráfica manda a las sucursales." },
    ],
  }),
  component: NuevoEnvioPage,
});

/**
 * El alta de un envío. Necesita la lista de envíos (misma caché que el
 * listado): de ahí salen los catálogos del formulario, las gráficas ya usadas
 * y lo ya enviado a cada ciudad.
 */
function NuevoEnvioPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: keysEnvios.todo,
    queryFn: listarEnvios,
  });

  return (
    // Sin barra de navegación: el formulario tiene su propio pie fijo.
    <AppShell nav={false}>
      <div className="px-5 pt-5">
        <Link
          to="/envios-graficas"
          className="mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          Envíos de Gráficas
        </Link>

        <h1 className="font-display mb-1 text-2xl font-bold">Nuevo envío</h1>
        <p className="mb-5 text-xs text-muted-foreground">
          Qué gráfica manda, cuándo, y a qué ciudades y sucursales van los manuales.
        </p>

        {isLoading ? (
          <Cargando />
        ) : error || !data ? (
          <Fallo error={error} texto="No se pudieron cargar los datos del formulario" />
        ) : (
          <EnvioGraficaForm lista={data} />
        )}
      </div>
    </AppShell>
  );
}
