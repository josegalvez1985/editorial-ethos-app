import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { ArrowRight, ClipboardList, Plus, Star } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { StarsDisplay } from "@/components/star-rating";
import { keys, listarEvaluaciones } from "@/lib/evaluaciones";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Inicio — Editorial Ethos" },
      { name: "description", content: "Resumen de evaluaciones de facilitadores." },
      { property: "og:title", content: "Inicio — Editorial Ethos" },
    ],
  }),
  component: HomePage,
});

const fecha = (iso: string) => {
  try {
    return format(parseISO(iso), "d MMM", { locale: es });
  } catch {
    return iso;
  }
};

function HomePage() {
  // Una sola consulta alimenta todo el resumen: `total` es exacto y las filas
  // sirven para las últimas y para el promedio.
  const filtros = { limite: 20 };
  const { data, isLoading, isError } = useQuery({
    queryKey: keys.evaluaciones(filtros),
    queryFn: () => listarEvaluaciones(filtros),
  });

  const filas = data?.data ?? [];
  const conEstrellas = filas.filter((e) => e.calificacion_estrellas != null);
  const promedio =
    conEstrellas.length > 0
      ? conEstrellas.reduce((s, e) => s + (e.calificacion_estrellas ?? 0), 0) / conEstrellas.length
      : null;

  return (
    <AppShell>
      <div className="px-5 pt-5">
        {/* Acción principal: es lo que el usuario viene a hacer */}
        <Link
          to="/evaluaciones/nueva"
          className="tap relative flex items-center gap-4 overflow-hidden rounded-3xl bg-hero-gradient p-5 text-primary-foreground shadow-elegant"
        >
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:20px_20px]" />
          <div className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-white/20">
            <Plus className="size-6" />
          </div>
          <div className="relative min-w-0 flex-1">
            <p className="font-display text-lg leading-tight font-bold">Nueva evaluación</p>
            <p className="text-[13px] text-primary-foreground/80">Cargar la de un facilitador</p>
          </div>
          <ArrowRight className="relative size-5 shrink-0" />
        </Link>

        {/* Métricas */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Tile
            icon={<ClipboardList className="size-4" />}
            label="Evaluaciones"
            valor={isLoading ? null : isError ? "—" : String(data?.total ?? 0)}
            hint="en total"
          />
          <Tile
            icon={<Star className="size-4" />}
            label="Promedio"
            valor={
              isLoading ? null : promedio === null ? "—" : promedio.toFixed(1).replace(".", ",")
            }
            hint={conEstrellas.length > 0 ? `de las últimas ${conEstrellas.length}` : "sin datos"}
          />
        </div>

        {/* Últimas */}
        <div className="mt-7 mb-3 flex items-end justify-between gap-3">
          <h2 className="font-display text-xl font-bold">Últimas</h2>
          <Link to="/evaluaciones" className="text-sm font-semibold text-primary">
            Ver todas
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            No se pudo cargar el resumen. Revisá tu conexión.
          </p>
        ) : filas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no hay evaluaciones cargadas. Empezá por la primera.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filas.slice(0, 4).map((e) => (
              <Link
                key={e.id_evaluacion_facilitador}
                to="/evaluaciones/$id"
                params={{ id: String(e.id_evaluacion_facilitador) }}
                className="tap flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">
                    {e.facilitador ?? `Facilitador #${e.id_facilitador}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.institucion ?? "—"} · {fecha(e.fecha_desde)}
                  </p>
                </div>
                <StarsDisplay value={e.calificacion_estrellas} className="shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function Tile({
  icon,
  label,
  valor,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  /** null mientras carga: la baldosa mantiene su alto y no salta el layout. */
  valor: string | null;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      {valor === null ? (
        <div className="mt-2 h-8 w-14 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p className="font-display mt-1 text-3xl leading-none font-bold">{valor}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
