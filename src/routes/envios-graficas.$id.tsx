import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { BotonPdf, EnvioGraficaForm } from "@/components/envio-grafica-form";
import { keysEnvios, listarEnvios } from "@/lib/envios-graficas";
import { diaSemana, fechaCorta } from "@/lib/fechas";
import { descargarExcelEnvio } from "@/lib/excel-envio-grafica";
import { generarPdfEnvio } from "@/lib/pdf-envios-graficas";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/envios-graficas/$id")({
  head: () => ({
    meta: [
      { title: "Envío de gráficas — Juventud con Valores" },
      { name: "description", content: "Un envío de gráficas con sus destinos." },
    ],
  }),
  component: EnvioPage,
});

/** "12 oct 2026, 18:40" a partir de `YYYY-MM-DDTHH:MI`. */
const cuando = (f: string) => (f ? `${fechaCorta(f.slice(0, 10))}, ${f.slice(11, 16)}` : "");

/**
 * Un envío: su comprobante en PDF arriba y el formulario. No hay GET de un
 * envío: se busca en la lista (misma caché que el listado), que trae además
 * los catálogos del formulario.
 */
function EnvioPage() {
  const { id } = Route.useParams();
  const idNum = Number(id);
  const { sesion } = useSession();

  const { data, isLoading, error } = useQuery({
    queryKey: keysEnvios.todo,
    queryFn: listarEnvios,
  });
  const envio = data?.envios.find((e) => e.id === idNum);

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

        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display mb-1 text-2xl font-bold">Envío Nº {id}</h1>
            <p className="text-xs text-muted-foreground">
              {envio ? (
                <>
                  <span className="capitalize">{diaSemana(envio.fecha)}</span>{" "}
                  {fechaCorta(envio.fecha)}
                  {envio.cargadoEl &&
                    ` · cargado el ${cuando(envio.cargadoEl)}${envio.cargadoPor ? ` por ${envio.cargadoPor}` : ""}`}
                  {envio.modificadoEl &&
                    ` · modificado el ${cuando(envio.modificadoEl)}${envio.modificadoPor ? ` por ${envio.modificadoPor}` : ""}`}
                </>
              ) : (
                " "
              )}
            </p>
          </div>
          {envio && (
            // El PDF y el Excel (con el mismo formato) salen solo por envío y de
            // lo GUARDADO, no de lo que se está editando (13/10/2026).
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <BotonExcel onDescargar={() => descargarExcelEnvio(envio, sesion?.nombre ?? "")} />
              <BotonPdf
                titulo="El comprobante de lo guardado, en una pestaña nueva"
                archivo={`envio-de-graficas-${envio.id}.pdf`}
                generar={(usuario) => generarPdfEnvio(envio, usuario)}
              />
            </div>
          )}
        </div>

        {isLoading ? (
          <Cargando />
        ) : error || !data ? (
          <Fallo error={error} texto="No se pudo cargar el envío" />
        ) : !envio ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            El envío Nº {id} no existe o se eliminó.
          </p>
        ) : (
          /*
            `key` con los ids de las líneas y el último cambio: al guardar, la
            lista vuelve con los ids de los destinos nuevos y el formulario se
            rearma con ellos (si no, el próximo Guardar los mandaría como nuevos).
          */
          <EnvioGraficaForm
            key={`${envio.id}-${envio.lineas.map((l) => l.id).join(",")}-${envio.modificadoEl}`}
            previa={envio}
            lista={data}
          />
        )}
      </div>
    </AppShell>
  );
}
