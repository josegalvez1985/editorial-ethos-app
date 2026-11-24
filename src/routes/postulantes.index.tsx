import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, FileCheck2, Paperclip, UserRoundSearch } from "lucide-react";
import { useState } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { Avatar } from "@/components/postulante-documentos";
import { descargarExcel } from "@/lib/excel";
import { cuandoEs, fechaCorta } from "@/lib/fechas";
import {
  documentos,
  estadoDe,
  ESTADOS,
  keysPostulantes,
  listarPostulantes,
  META_POSTULANTES,
  mostrar,
  TURNOS,
  type Estado,
  type ResumenPostulante,
} from "@/lib/postulantes";
import { cn, normalizar } from "@/lib/utils";

export const Route = createFileRoute("/postulantes/")({
  head: () => ({
    meta: [
      { title: "Postulantes — Juventud con Valores" },
      { name: "description", content: "Las postulaciones de facilitadores de cada año lectivo." },
    ],
  }),
  component: PostulantesPage,
});

/**
 * Postulantes (24/11/2026, pantalla nueva, no de APEX): la bandeja de revisión
 * de `POSTULANTES_FACILITADORES`, que llena otra app. Backend:
 * `backend/postulantes_facilitadores.sql`.
 *
 * Por año lectivo y por estado (arranca en Pendientes si hay), con buscador y
 * Excel. Cada tarjeta dice si es nuevo o ya fue facilitador y cuántos
 * documentos tiene de los que le corresponden; tocarla abre la ficha.
 */
function PostulantesPage() {
  const [idAnio, setIdAnio] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado | "TODAS" | null>(null);
  const [buscar, setBuscar] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: keysPostulantes.lista(idAnio),
    queryFn: () => listarPostulantes(idAnio),
    meta: META_POSTULANTES,
  });

  const todos = data?.postulantes ?? [];
  const cuenta = (e: Estado) => todos.filter((p) => p.estado === e).length;
  // Arranca en Pendientes si hay; si no, todas.
  const filtro = estado ?? (cuenta("PENDIENTE") ? "PENDIENTE" : "TODAS");
  const q = normalizar(buscar.trim());
  const filas = todos.filter(
    (p) =>
      (filtro === "TODAS" || p.estado === filtro) &&
      (!q ||
        normalizar(
          `${p.nombre_completo} ${p.cedula} ${p.correo_electronico} ${p.telefono} ${p.ciudad}`,
        ).includes(q)),
  );
  const anios = (data?.anios ?? []).filter(
    (a) => a.cantidad > 0 || a.vigente || a.idAnio === data?.idAnio,
  );

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Postulantes
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {todos.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Las postulaciones de facilitadores: revisá, aprobá o rechazá.
            </p>
          </div>
          {filas.length > 0 && (
            <BotonExcel
              onDescargar={() => excel(filas, anios.find((a) => a.idAnio === data?.idAnio)?.anio)}
            />
          )}
        </div>

        {anios.length > 1 && (
          <div role="tablist" aria-label="Año lectivo" className="mb-3 flex flex-wrap gap-2">
            {anios.map((a) => (
              <Pastilla
                key={a.idAnio}
                activa={a.idAnio === data?.idAnio}
                onClick={() => {
                  setIdAnio(a.idAnio);
                  setEstado(null);
                }}
                texto={String(a.anio)}
                cantidad={a.cantidad}
              />
            ))}
          </div>
        )}

        {todos.length > 0 && (
          <div role="tablist" aria-label="Estado" className="mb-3 flex flex-wrap gap-2">
            {ESTADOS.map((e) => (
              <Pastilla
                key={e.valor}
                activa={filtro === e.valor}
                onClick={() => setEstado(e.valor)}
                texto={e.plural}
                cantidad={cuenta(e.valor)}
              />
            ))}
            <Pastilla
              activa={filtro === "TODAS"}
              onClick={() => setEstado("TODAS")}
              texto="Todas"
              cantidad={todos.length}
            />
          </div>
        )}

        {todos.length > 6 && (
          <Buscador
            valor={buscar}
            onCambio={setBuscar}
            placeholder="Nombre, CI, correo o teléfono…"
          />
        )}

        {isLoading ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto="No se pudieron cargar las postulaciones" />
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <UserRoundSearch className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q
                ? "Ninguna postulación coincide con la búsqueda."
                : todos.length
                  ? `No hay postulaciones ${filtro === "TODAS" ? "" : estadoDe(filtro).plural.toLowerCase()}.`
                  : "Todavía no llegó ninguna postulación para este año."}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {filas.map((p) => (
              <li key={p.id}>
                <Tarjeta p={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function Pastilla({
  activa,
  onClick,
  texto,
  cantidad,
}: {
  activa: boolean;
  onClick: () => void;
  texto: string;
  cantidad: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={cn(
        "tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold",
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {texto}
      <span
        className={cn(
          "rounded-full px-1.5 text-[11px] tabular-nums",
          activa ? "bg-white/20" : "bg-muted",
        )}
      >
        {cantidad}
      </span>
    </button>
  );
}

function Tarjeta({ p }: { p: ResumenPostulante }) {
  const e = estadoDe(p.estado);
  const d = documentos(p);
  const completos = d.tiene >= d.esperados;
  return (
    <Link
      to="/postulantes/$id"
      params={{ id: String(p.id) }}
      className="tap flex h-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
    >
      <Avatar foto={p.foto_url} nombre={p.nombre_completo} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{p.nombre_completo}</span>
          <span
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", e.color)}
          >
            {e.texto}
          </span>
        </span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          CI {p.cedula}
          {p.ciudad && ` · ${p.ciudad}`}
          {p.fecha_registro && ` · ${cuandoEs(p.fecha_registro.slice(0, 10))}`}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10.5px] font-medium",
              p.id_facilitador != null
                ? "bg-sky-500/10 text-sky-700 dark:text-sky-400"
                : "bg-muted",
            )}
          >
            {p.id_facilitador != null ? "Ya fue facilitador" : "Nuevo"}
          </span>
          <span
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
              completos
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {completos ? <FileCheck2 className="size-3" /> : <Paperclip className="size-3" />}
            Docs {d.tiene}/{d.esperados}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** El Excel de lo filtrado (todo reporte con detalle lo lleva). */
function excel(filas: ResumenPostulante[], anio?: number) {
  descargarExcel(
    `postulantes-${anio ?? "todos"}`,
    [
      ["Registrada", (p) => p.fecha_registro],
      ["Nombre", (p) => p.nombre_completo],
      ["CI", (p) => p.cedula],
      ["Edad", (p) => p.edad],
      ["Teléfono", (p) => p.telefono],
      ["Correo", (p) => p.correo_electronico],
      ["Departamento", (p) => p.departamento],
      ["Ciudad", (p) => p.ciudad],
      ["Ya fue facilitador", (p) => (p.id_facilitador != null ? p.facilitador || "Sí" : "No")],
      ["Turno", (p) => mostrar(TURNOS, p.turno)],
      ["Días", (p) => p.dias_disponibles],
      ["Documentos", (p) => `${documentos(p).tiene}/${documentos(p).esperados}`],
      ["Estado", (p) => estadoDe(p.estado).texto],
      ["Revisada", (p) => (p.fecha_revision ? fechaCorta(p.fecha_revision.slice(0, 10)) : "")],
      ["Observación", (p) => p.observacion_admin],
      ["Cargada por", (p) => p.usuario || "Formulario"],
    ],
    filas,
  );
}
