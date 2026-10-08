import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, MapPin, Phone, Plus, UserCheck } from "lucide-react";
import { useState } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { keysFacilitadores, listarFacilitadores } from "@/lib/facilitadores";
import { iniciales } from "@/lib/navegacion";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/facilitadores/")({
  head: () => ({
    meta: [
      { title: "Facilitadores — Juventud con Valores" },
      { name: "description", content: "Los facilitadores y su ficha." },
    ],
  }),
  component: FacilitadoresPage,
});

type Filtro = "todos" | "activos" | "inactivos";

/**
 * Facilitadores: la página 14 de APEX (un IG de 18 columnas). Acá, tarjetas
 * con lo que se busca de un vistazo —nombre, CI, teléfono, ciudad, si está
 * activo— y la ficha completa al tocar una (`/facilitadores/$id`).
 *
 * El ícono es el que ya tenía en el menú (`UserCheck`): no se cambia.
 */
function FacilitadoresPage() {
  const { puedeRuta } = usePermisos();
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("activos");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysFacilitadores.lista,
    queryFn: listarFacilitadores,
  });

  const todos = data ?? [];
  const cuenta = {
    todos: todos.length,
    activos: todos.filter((f) => f.activo).length,
    inactivos: todos.filter((f) => !f.activo).length,
  };
  const q = normalizar(buscar.trim());
  const filas = todos.filter(
    (f) =>
      (filtro === "todos" || f.activo === (filtro === "activos")) &&
      (!q || normalizar(`${f.nombre} ${f.ci} ${f.usuario} ${f.ciudad} ${f.barrio}`).includes(q)),
  );

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Facilitadores</h1>
            <p className="text-xs text-muted-foreground">
              Su ficha: datos personales, iglesia, banco, estudios y referencias.
            </p>
          </div>
          {puedeRuta("/facilitadores", "insertar") && (
            <Link
              to="/facilitadores/$id"
              params={{ id: "nuevo" }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              Nuevo
            </Link>
          )}
        </div>

        <div role="tablist" aria-label="Filtrar por estado" className="mb-3 flex flex-wrap gap-2">
          {(
            [
              ["activos", "Activos"],
              ["inactivos", "Inactivos"],
              ["todos", "Todos"],
            ] as const
          ).map(([clave, label]) => (
            <button
              key={clave}
              type="button"
              role="tab"
              aria-selected={filtro === clave}
              onClick={() => setFiltro(clave)}
              className={`tap flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                filtro === clave
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                  filtro === clave ? "bg-white/20" : "bg-muted"
                }`}
              >
                {isLoading ? "…" : cuenta[clave]}
              </span>
            </button>
          ))}
        </div>

        <Buscador
          valor={buscar}
          onCambio={setBuscar}
          placeholder="Buscar por nombre, CI, usuario o ciudad…"
        />

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudieron cargar los facilitadores" />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <UserCheck className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q || filtro !== "todos"
                ? "Ningún facilitador coincide."
                : "Todavía no hay facilitadores."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((f) => (
              <li key={f.id}>
                <Link
                  to="/facilitadores/$id"
                  params={{ id: String(f.id) }}
                  className="tap flex h-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 shadow-soft hover:border-primary/40"
                >
                  <span
                    aria-hidden
                    className={`grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
                      f.activo ? "bg-hero-gradient text-on-brand" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {iniciales(f.nombre)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{f.nombre}</span>
                      {!f.activo && (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                          Inactivo
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      CI {f.ci}
                      {f.usuario ? ` · ${f.usuario}` : ""}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted-foreground">
                      {f.telefono && (
                        <span className="flex min-w-0 items-center gap-1">
                          <Phone className="size-3 shrink-0" />
                          <span className="truncate">{f.telefono}</span>
                        </span>
                      )}
                      {f.ciudad && (
                        <span className="flex min-w-0 items-center gap-1">
                          <MapPin className="size-3 shrink-0" />
                          <span className="truncate">{f.ciudad}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
