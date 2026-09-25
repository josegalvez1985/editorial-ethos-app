import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, ChevronRight, Loader2, Plus, Truck } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import { keysInventario, listarSucursales } from "@/lib/inventarios";
import {
  keysTransferencias,
  listarTransferencias,
  type FiltrosTransferencias,
  type Transferencia,
} from "@/lib/transferencias";

export const Route = createFileRoute("/transferencias/")({
  head: () => ({
    meta: [
      { title: "Transferencias de manuales — Juventud con Valores" },
      { name: "description", content: "Envío de manuales entre sucursales." },
    ],
  }),
  component: TransferenciasPage,
});

type Estado = "" | "N" | "S";

/**
 * Las transferencias de manuales entre sucursales.
 *
 * Arranca en **Pendientes**: son las que piden algo (recibirlas), y las
 * recibidas ya no se pueden tocar. Dentro de "Todas", el backend también las
 * ordena pendientes primero.
 */
function TransferenciasPage() {
  const [estado, setEstado] = useState<Estado>("N");
  const [sucursal, setSucursal] = useState("");

  const sucursales = useQuery({
    queryKey: keysInventario.sucursales,
    queryFn: listarSucursales,
  });

  const filtros: FiltrosTransferencias = {
    estado: estado || undefined,
    id_sucursal: sucursal ? Number(sucursal) : undefined,
    limite: 50,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: keysTransferencias.lista(filtros),
    queryFn: () => listarTransferencias(filtros),
  });

  const filas = data?.data ?? [];

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Transferencias</h1>
            <p className="text-xs text-muted-foreground">Envío de manuales entre sucursales</p>
          </div>
          <Link
            to="/transferencias/nueva"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            <Plus className="size-4" />
            Nueva
          </Link>
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          {/* Segmentado y no un combo: son tres opciones y se leen de un vistazo. */}
          <div className="flex h-10 shrink-0 rounded-xl border border-input bg-card p-0.5 text-sm">
            {(
              [
                ["N", "Pendientes"],
                ["S", "Recibidas"],
                ["", "Todas"],
              ] as const
            ).map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setEstado(valor)}
                aria-pressed={estado === valor}
                className={`flex-1 rounded-[10px] px-3 font-medium transition-colors ${
                  estado === valor
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
          <div className="sm:w-72">
            <SelectorModal
              label="Sucursal"
              mostrarLabel={false}
              descripcion="Las que salen o llegan a esta sucursal"
              value={sucursal}
              onChange={setSucursal}
              opciones={[
                { valor: "", texto: "Todas las sucursales" },
                ...(sucursales.data ?? []).map((s) => ({
                  valor: String(s.id_sucursal),
                  texto: s.descripcion,
                })),
              ]}
              className="h-10 px-3 text-sm"
            />
          </div>
        </div>

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudieron cargar las transferencias.
          </p>
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <Truck className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {estado === "N"
                ? "No hay transferencias pendientes de recibir."
                : "No hay transferencias con estos filtros."}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {data!.total} transferencia{data!.total === 1 ? "" : "s"}
              {filas.length < data!.total && ` · mostrando ${filas.length}`}
            </p>
            <ul className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {filas.map((t) => (
                <Fila key={t.id_transferencia} t={t} />
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}

/** Una transferencia en la lista. Toda la tarjeta es el enlace a su detalle. */
function Fila({ t }: { t: Transferencia }) {
  return (
    <li>
      <Link
        to="/transferencias/$id"
        params={{ id: String(t.id_transferencia) }}
        className="flex h-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft"
      >
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${
            t.recibida ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-600"
          }`}
        >
          {t.recibida ? <CheckCircle2 className="size-5" /> : <Truck className="size-5" />}
        </span>

        <div className="min-w-0 flex-1">
          {/* La ruta es lo primero que se busca: de dónde a dónde. */}
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="min-w-0 truncate">{t.origen}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{t.destino}</span>
          </p>
          {t.resumen && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.resumen}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                t.recibida ? "bg-muted" : "bg-amber-500/10 text-amber-700 dark:text-amber-500"
              }`}
            >
              {t.recibida ? "Recibida" : "En camino"}
            </span>
            <span className="font-medium text-foreground">
              {t.unidades} libro{t.unidades === 1 ? "" : "s"}
            </span>
            <span>
              {t.lineas} manual{t.lineas === 1 ? "" : "es"}
            </span>
            {t.fecha && <span>{t.fecha}</span>}
          </p>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
