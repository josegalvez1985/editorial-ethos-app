import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FileDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { TransferenciaForm } from "@/components/transferencia-form";
import { descargarExcelTransferencia } from "@/lib/excel-transferencia";
import { abrirPdfEnPestana, generarPdfTransferencia } from "@/lib/pdf-transferencias";
import { useSession } from "@/lib/session";
import {
  keysTransferencias,
  obtenerTransferencia,
  type TransferenciaDetalle,
} from "@/lib/transferencias";

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

        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display mb-1 text-2xl font-bold">Transferencia #{id}</h1>
            <p className="text-xs text-muted-foreground">
              {data ? `${data.origen} → ${data.destino}` : " "}
            </p>
          </div>
          {data && <Reportes x={data} />}
        </div>

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

/**
 * El reporte de UNA transferencia (13/10/2026): el PDF con el logo, que se abre
 * en una pestaña nueva, y el Excel con el mismo formato. Los dos salen de
 * lo GUARDADO: si hay cambios sin guardar en el formulario, no están.
 */
function Reportes({ x }: { x: TransferenciaDetalle }) {
  const { sesion } = useSession();
  const [generando, setGenerando] = useState(false);
  const vacia = x.detalle.length === 0;

  function generarPdf() {
    setGenerando(true);
    // SIN await antes de esta llamada: la pestaña se abre dentro del clic o el
    // navegador la bloquea como popup. Ver `abrirPdfEnPestana`.
    abrirPdfEnPestana(
      () => generarPdfTransferencia(x, sesion?.nombre ?? ""),
      `transferencia-${x.id_transferencia}.pdf`,
    )
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo generar el PDF"))
      .finally(() => setGenerando(false));
  }

  // Un .xlsx con el mismo formato que el PDF (pedido el 13/10/2026), no el CSV
  // de los reportes: ver lib/excel-transferencia.ts.
  const descargar = () => descargarExcelTransferencia(x, sesion?.nombre ?? "");

  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-2">
      <BotonExcel onDescargar={descargar} deshabilitado={vacia} />
      <button
        type="button"
        onClick={generarPdf}
        disabled={generando || vacia}
        title={vacia ? "La transferencia no tiene manuales" : "Abre el PDF en una pestaña nueva"}
        className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
      >
        {generando ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
        PDF
      </button>
    </div>
  );
}
