import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, FileDown, FileSpreadsheet, ImageDown, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import {
  armarAgenda,
  clasesDePostulaciones,
  nombreArchivo3,
  type Agenda,
} from "@/lib/agenda-semanal-facilitador";
import { keysBloqueos, listarBloqueos } from "@/lib/facilitadores-bloqueos";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import {
  descargarForm3Excel,
  generarForm3Imagen,
  generarForm3Pdf,
} from "@/lib/planilla-agenda-semanal";
import { keysPostulaciones, listarTodasPostulaciones } from "@/lib/postulaciones";

export const Route = createFileRoute("/agenda-semanal-facilitador/")({
  head: () => ({
    meta: [
      { title: "Agenda semanal del facilitador — Juventud con Valores" },
      {
        name: "description",
        content: "La semana de un facilitador por turno, en PDF, imagen y Excel.",
      },
    ],
  }),
  component: AgendaSemanalPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** `postulaciones/todas` de un año, sin los otros filtros de la página 20. */
const soloAnio = (anio: string) => ({
  anio,
  idDepartamento: null,
  idCiudad: null,
  idBarrio: null,
  idInstitucion: null,
  turno: null,
});

/**
 * Agenda semanal del facilitador (`/agenda-semanal-facilitador`), el Form. 3 —
 * "Formulario N° 3 - Mi agenda semanal del facilitador" (26/10/2026, pantalla
 * nueva, no viene de APEX). Para un facilitador y un año lectivo: su semana
 * por turno (mañana y tarde), cada clase en su día y su hora, lo bloqueado en
 * rojo. Sale en PDF, imagen y Excel con el mismo formato: la planilla que
 * mandó Jose.
 *
 * Los datos y sus reglas están en `lib/agenda-semanal-facilitador.ts`; el
 * dibujo, en `lib/planilla-agenda-semanal.ts`. No tiene backend propio.
 *
 * - **Año lectivo** en pastillas: entra con el actual.
 * - **Facilitador:** los que tienen postulaciones activas ese año.
 * - **La vista previa** es la misma imagen que se descarga.
 */
function AgendaSemanalPage() {
  const [anioElegido, setAnio] = useState<string | null>(null);
  const [idFac, setIdFac] = useState("");

  // La primera consulta trae el año lectivo actual y la lista de años.
  const base = useQuery({
    queryKey: keysPostulaciones.todas(soloAnio("")),
    queryFn: () => listarTodasPostulaciones(soloAnio("")),
  });
  const anio = anioElegido ?? base.data?.anio ?? "";
  const anios = useMemo(
    () =>
      [...new Set([base.data?.anio ?? "", ...(base.data?.anios ?? [])].filter(Boolean))].sort(
        (a, b) => b.localeCompare(a),
      ),
    [base.data],
  );
  const delAnio = useQuery({
    queryKey: keysPostulaciones.todas(soloAnio(anio)),
    queryFn: () => listarTodasPostulaciones(soloAnio(anio)),
    enabled: !!anio && anio !== base.data?.anio,
  });
  const postulaciones = anio === base.data?.anio ? base : delAnio;

  const bloqueos = useQuery({ queryKey: keysBloqueos.todo, queryFn: listarBloqueos });

  const opcionesFac = useMemo(() => {
    const m = new Map<number, { texto: string; n: number }>();
    for (const p of postulaciones.data?.items ?? []) {
      if (!p.activa || p.idFacilitador == null) continue;
      const x = m.get(p.idFacilitador) ?? { texto: p.facilitador, n: 0 };
      x.n += 1;
      m.set(p.idFacilitador, x);
    }
    return [...m]
      .map(([id, x]) => ({
        valor: String(id),
        texto: x.texto,
        extra: plural(x.n, "postulación", "postulaciones"),
      }))
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
  }, [postulaciones.data]);
  const facilitador = opcionesFac.find((o) => o.valor === idFac)?.texto ?? "";

  /* ---- La agenda: se arma en el navegador con lo ya cargado ---------------- */

  const agenda: Agenda | null = useMemo(() => {
    if (!idFac || !facilitador || !postulaciones.data || !bloqueos.data) return null;
    const bloqueo =
      bloqueos.data.bloqueos.find(
        (b) => String(b.idFacilitador) === idFac && String(b.anio) === anio,
      ) ?? null;
    return armarAgenda({
      anio,
      facilitador,
      clases: clasesDePostulaciones(postulaciones.data.items, Number(idFac)),
      bloqueo,
    });
  }, [idFac, facilitador, postulaciones.data, bloqueos.data, anio]);

  /* ---- Vista previa: la misma imagen que se descarga ---------------------- */

  const [vista, setVista] = useState<string | null>(null);
  /** Si no se pudo dibujar: se muestra, en vez de quedar "cargando" para siempre. */
  const [errorVista, setErrorVista] = useState<unknown>(null);
  useEffect(() => {
    setErrorVista(null);
    if (!agenda) {
      setVista(null);
      return;
    }
    let url: string | null = null;
    let vigente = true;
    generarForm3Imagen(agenda)
      .then((b) => {
        if (!vigente) return;
        url = URL.createObjectURL(b);
        setVista(url);
      })
      .catch((e) => {
        if (!vigente) return;
        console.error("Form. 3: no se pudo dibujar la vista previa", e);
        setVista(null);
        setErrorVista(e);
      });
    return () => {
      vigente = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [agenda]);

  /* ---- Salidas ------------------------------------------------------------ */

  const [generando, setGenerando] = useState<"pdf" | "png" | "xlsx" | null>(null);
  const salir = (tipo: "pdf" | "png" | "xlsx") => {
    if (!agenda) return;
    setGenerando(tipo);
    const trabajo =
      tipo === "xlsx"
        ? descargarForm3Excel(agenda)
        : abrirPdfEnPestana(
            () => (tipo === "pdf" ? generarForm3Pdf(agenda) : generarForm3Imagen(agenda)),
            `${nombreArchivo3(agenda)}.${tipo}`,
            tipo === "pdf" ? "el PDF" : "la imagen",
          );
    trabajo
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar"))
      .finally(() => setGenerando(null));
  };

  const boton = (
    tipo: "pdf" | "png" | "xlsx",
    Icono: typeof FileDown,
    titulo: string,
    clase: string,
  ) => (
    <button
      type="button"
      disabled={!agenda || generando != null}
      onClick={() => salir(tipo)}
      title={titulo}
      className={`flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold disabled:opacity-60 ${clase}`}
    >
      {generando === tipo ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Icono className="size-4" />
      )}
      Form. 3
    </button>
  );

  const error = postulaciones.error ?? bloqueos.error;
  const cargando = base.isLoading || postulaciones.isLoading || bloqueos.isLoading;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Agenda semanal del facilitador</h1>
            <p className="text-xs text-muted-foreground">
              Form. 3: la semana del facilitador por turno, con lo bloqueado en rojo
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {boton(
              "pdf",
              FileDown,
              "El Form. 3 en PDF",
              "bg-primary text-primary-foreground shadow-soft",
            )}
            {boton("png", ImageDown, "El Form. 3 en imagen", "bg-primary-soft text-primary")}
            {boton(
              "xlsx",
              FileSpreadsheet,
              "El Form. 3 en Excel, con el mismo formato",
              "border border-primary/40 bg-card text-primary shadow-soft hover:bg-primary-soft",
            )}
          </div>
        </div>

        {/* ── Parámetros ───────────────────────────────────────────────── */}
        <section className="mb-4 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <div>
            <p className="mb-1.5 text-sm font-medium">Año lectivo</p>
            <div role="tablist" aria-label="Año lectivo" className="flex flex-wrap gap-2">
              {anios.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={anio === a}
                  onClick={() => {
                    setAnio(a);
                    setIdFac("");
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
                    anio === a
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/80 bg-card hover:border-primary/40"
                  }`}
                >
                  {a}
                  {a === base.data?.anioActual && <span className="ml-1 opacity-70">· actual</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectorModal
              label="Facilitador"
              descripcion={`Los que tienen postulaciones activas en ${anio}`}
              value={idFac}
              onChange={setIdFac}
              opciones={opcionesFac}
              placeholder={cargando ? "Cargando…" : "Elegí un facilitador"}
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
          </div>
        </section>

        {/* ── Resumen y avisos ─────────────────────────────────────────── */}
        {agenda && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-2 text-[13px]">
              {[
                plural(agenda.total, "clase por semana", "clases por semana"),
                ...agenda.turnos.map(
                  (t) =>
                    `${t.titulo.charAt(0)}${t.titulo.slice(1).toLowerCase()}: ${numero.format(
                      Object.values(t.totales).reduce((a, b) => a + b, 0),
                    )}`,
                ),
              ].map((s) => (
                <span key={s} className="rounded-full bg-muted px-3 py-1 font-medium">
                  {s}
                </span>
              ))}
            </div>
            {[
              agenda.noche > 0 &&
                `${plural(agenda.noche, "clase es", "clases son")} de la noche y no ${
                  agenda.noche === 1 ? "sale" : "salen"
                } en la agenda (solo mañana y tarde).`,
              agenda.sinHorario > 0 &&
                `${plural(agenda.sinHorario, "postulación no tiene", "postulaciones no tienen")} día ni hora cargados y no ${
                  agenda.sinHorario === 1 ? "sale" : "salen"
                } en la agenda.`,
              agenda.bloqueoIlegible.length > 0 &&
                `No se entendió parte de sus horarios bloqueados (${agenda.bloqueoIlegible.join(
                  "; ",
                )}): revisalos en Facilitadores.`,
            ]
              .filter(Boolean)
              .map((s) => (
                <p
                  key={String(s)}
                  className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {s}
                </p>
              ))}
          </div>
        )}

        {/* ── Vista previa ─────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {error ? (
            <div className="p-4">
              <Fallo error={error} texto="No se pudieron cargar los datos de la agenda" />
            </div>
          ) : cargando ? (
            <Cargando />
          ) : !opcionesFac.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No hay postulaciones activas con facilitador en {anio}.
            </p>
          ) : !idFac ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí el facilitador.
            </p>
          ) : vista ? (
            <div className="overflow-x-auto p-2">
              <img
                src={vista}
                alt={`Form. 3 de ${facilitador}`}
                className="w-full min-w-[900px] rounded border border-border/60"
              />
            </div>
          ) : errorVista ? (
            <div className="p-4">
              <Fallo error={errorVista} texto="No se pudo dibujar la agenda" />
            </div>
          ) : (
            <Cargando />
          )}
        </section>
      </div>
    </AppShell>
  );
}
