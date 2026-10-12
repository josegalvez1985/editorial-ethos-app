import { FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * El botón "Excel" de los reportes (ver `lib/excel.ts`): todo reporte con
 * detalle lo lleva, desde el 12/10/2026.
 *
 * Va en la cabecera de la pantalla, al lado del PDF si lo hay, también en los
 * reportes con el formato de APEX (a pedido, 12/10/2026: APEX lo ponía como
 * link al pie). Con borde y no relleno, para que el PDF siga siendo el
 * principal y los dos se distingan.
 *
 * `onDescargar` puede ser asíncrono (un reporte paginado junta sus páginas
 * antes): mientras tanto el botón gira y no se puede volver a tocar.
 */
export function BotonExcel({
  onDescargar,
  deshabilitado,
}: {
  onDescargar: () => void | Promise<void>;
  deshabilitado?: boolean;
}) {
  const [bajando, setBajando] = useState(false);

  const descargar = async () => {
    setBajando(true);
    try {
      await onDescargar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo armar el Excel");
    } finally {
      setBajando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void descargar()}
      disabled={deshabilitado || bajando}
      title={
        deshabilitado
          ? "No hay nada para descargar"
          : "Descarga todo lo filtrado, para abrir en Excel"
      }
      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-card px-3.5 py-2.5 text-sm font-semibold text-primary shadow-soft hover:bg-primary-soft disabled:opacity-50"
    >
      {bajando ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FileSpreadsheet className="size-4" />
      )}
      Excel
    </button>
  );
}
