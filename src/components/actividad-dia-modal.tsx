import { useQuery } from "@tanstack/react-query";
import { Building2, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detalleDia,
  MESES,
  SERIES_ACTIVIDAD,
  type DetalleDia,
  type SerieActividad,
} from "@/lib/intervenciones";
import { normalizar } from "@/lib/utils";

/**
 * Lo que se abre al tocar una barra del gráfico de Actividad (09/10/2026):
 * los facilitadores de ese día y, debajo de cada uno, sus instituciones, con
 * cuántas intervenciones hizo en cada una.
 *
 * - Arranca en la serie de la barra tocada (Total, Desarrollados o No
 *   desarrollados) y se puede cambiar arriba sin otro pedido: el backend trae
 *   las tres cuentas juntas.
 * - Los facilitadores van del que más hizo al que menos.
 * - Cuenta igual que la barra (`por-dia/detalle` en `intervenciones.sql`), así
 *   que la suma del detalle da la barra.
 */
export function ActividadDiaModal({
  seleccion,
  anio,
  mes,
  series,
  onClose,
}: {
  /** El día y la serie de la barra tocada. `null` = cerrado. */
  seleccion: { dia: number; serie: SerieActividad } | null;
  anio: string;
  /** 1–12. */
  mes: number;
  /** Las series que se ven en el gráfico (con el filtro de desarrollo, una). */
  series: SerieActividad[];
  onClose: () => void;
}) {
  const abierto = seleccion !== null;
  const [serie, setSerie] = useState<SerieActividad>("total");
  const [buscar, setBuscar] = useState("");
  // Cada vez que se abre, en la serie de la barra tocada y sin búsqueda.
  useEffect(() => {
    if (seleccion) {
      setSerie(seleccion.serie);
      setBuscar("");
    }
  }, [seleccion]);

  // Mismo criterio que el gráfico: la clase del `<html>` dice el tema.
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    setOscuro(document.documentElement.classList.contains("dark"));
  }, [abierto]);
  const color = (k: SerieActividad) =>
    oscuro ? SERIES_ACTIVIDAD[k].oscuro : SERIES_ACTIVIDAD[k].claro;

  const dia = seleccion?.dia ?? 0;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["intervenciones-por-dia-detalle", anio, mes, dia],
    queryFn: () => detalleDia(anio, mes, dia),
    enabled: abierto,
  });

  const grupos = agrupar(data ?? [], serie);
  const q = normalizar(buscar.trim());
  const visibles = q
    ? grupos.filter(
        (g) =>
          normalizar(g.facilitador).includes(q) ||
          g.instituciones.some((i) => normalizar(i.nombre).includes(q)),
      )
    : grupos;
  const total = grupos.reduce((n, g) => n + g.cantidad, 0);
  const instituciones = new Set(grupos.flatMap((g) => g.instituciones.map((i) => i.clave))).size;

  const fecha = new Date(Date.UTC(Number(anio), mes - 1, dia || 1));
  const diaSemana = fecha.toLocaleDateString("es", { weekday: "long", timeZone: "UTC" });

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg grid-rows-[auto_auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-5 pt-5 pb-3 text-left">
          <DialogTitle className="font-display text-xl capitalize">
            {diaSemana} {dia} de {MESES[mes - 1]}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isLoading
              ? "Cargando…"
              : `${total.toLocaleString("es-PY")} ${total === 1 ? "intervención" : "intervenciones"} · ${grupos.length} ${
                  grupos.length === 1 ? "facilitador" : "facilitadores"
                } · ${instituciones} ${instituciones === 1 ? "institución" : "instituciones"}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-5 pb-3">
          {series.length > 1 && (
            <div role="tablist" aria-label="Serie" className="flex flex-wrap gap-1.5">
              {series.map((k) => {
                const activa = serie === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={activa}
                    onClick={() => setSerie(k)}
                    className={`tap flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold ${
                      activa
                        ? "border-foreground/30 bg-muted text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-sm"
                      style={{ background: color(k) }}
                    />
                    {SERIES_ACTIVIDAD[k].nombre}
                  </button>
                );
              })}
            </div>
          )}
          {grupos.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Buscar facilitador o institución…"
                aria-label="Buscar facilitador o institución"
                className="h-10 w-full rounded-xl border border-input bg-background pr-3 pl-9 text-base outline-none focus:border-primary/40 lg:text-sm"
              />
            </div>
          )}
        </div>

        <div className="min-h-[8rem] overflow-y-auto overscroll-contain border-t border-border/60 px-5 py-3">
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {error instanceof Error ? error.message : "No se pudo cargar el detalle del día."}
            </p>
          ) : !visibles.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {q ? "Nada coincide con la búsqueda." : "Sin intervenciones en esta serie."}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibles.map((g) => (
                <li key={g.clave} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-center gap-2">
                    <UserRound className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {g.facilitador || "Sin facilitador"}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold text-white tabular-nums"
                      style={{ background: color(serie) }}
                    >
                      {g.cantidad}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 pl-6">
                    {g.instituciones.map((i) => (
                      <li
                        key={i.clave}
                        className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
                      >
                        <Building2 className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {i.nombre || "Sin institución"}
                        </span>
                        <span className="shrink-0 font-semibold text-foreground tabular-nums">
                          {i.cantidad}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Grupo = {
  clave: string;
  facilitador: string;
  cantidad: number;
  instituciones: { clave: string; nombre: string; cantidad: number }[];
};

/** Por facilitador, con sus instituciones; solo lo que tiene algo en la serie. */
function agrupar(filas: DetalleDia[], serie: SerieActividad): Grupo[] {
  const m = new Map<string, Grupo>();
  for (const f of filas) {
    const n = f[serie];
    if (!n) continue;
    const clave = String(f.idFacilitador ?? f.facilitador);
    const g = m.get(clave) ?? { clave, facilitador: f.facilitador, cantidad: 0, instituciones: [] };
    g.cantidad += n;
    g.instituciones.push({
      clave: String(f.idInstitucion ?? f.institucion),
      nombre: f.institucion,
      cantidad: n,
    });
    m.set(clave, g);
  }
  for (const g of m.values()) g.instituciones.sort((a, b) => b.cantidad - a.cantidad);
  return [...m.values()].sort(
    (a, b) => b.cantidad - a.cantidad || a.facilitador.localeCompare(b.facilitador, "es"),
  );
}
