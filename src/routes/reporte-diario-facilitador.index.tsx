import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  FileDown,
  FileSpreadsheet,
  ImageDown,
  Loader2,
  Milestone,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import { keysEtapas, listarEtapas, nombreEtapa, numerarEtapas } from "@/lib/etapas";
import { hoyISO } from "@/lib/fechas";
import {
  cargarFormulario2,
  hechas,
  nombreArchivo2,
  textoEtapa,
  type Formulario2,
} from "@/lib/reporte-diario-facilitador";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import {
  descargarForm2Excel,
  generarForm2Imagen,
  generarForm2Pdf,
} from "@/lib/planilla-reporte-diario";
import { DIAS, keysPostulaciones, listarTodasPostulaciones } from "@/lib/postulaciones";
import { rangoValido } from "@/lib/periodos";

export const Route = createFileRoute("/reporte-diario-facilitador/")({
  head: () => ({
    meta: [
      { title: "Reporte diario del facilitador — Juventud con Valores" },
      {
        name: "description",
        content: "El reporte diario del facilitador en una institución, en PDF, imagen y Excel.",
      },
    ],
  }),
  component: ReporteDiarioPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;
const ddmmyyyy = (f: string) => f.split("-").reverse().join("/");

/**
 * Reporte diario del facilitador (`/reporte-diario-facilitador`), el Form. 2 —
 * "Formulario N° 2 - Reporte diario del facilitador" (26/10/2026,
 * pantalla nueva, no viene de APEX). Para un facilitador en una institución y
 * un rango de fechas: sus clases, con las intervenciones del rango en las
 * columnas de la 1° a la 4°. Sale en PDF, imagen y Excel con el mismo formato:
 * la planilla que mandó Jose.
 *
 * Los datos y sus reglas están en `lib/reporte-diario-facilitador.ts`; el dibujo, en
 * `lib/planilla-reporte-diario.ts`. No tiene backend propio.
 *
 * - **Fechas:** entra con la etapa en curso (si la hay); "Buscar etapa" llena
 *   las fechas con una de la tabla `ETAPAS`.
 * - **La línea de la etapa** se arma con las fechas ("ETAPA: 20 ABRIL - 13
 *   MAYO", "3ª ETAPA: …" si se eligió una) y se puede escribir a mano.
 * - **Facilitador e institución** se filtran entre sí: cada lista muestra los
 *   que tienen postulaciones activas en el año con lo elegido en la otra.
 * - **La vista previa** es la misma imagen que se descarga.
 */
function ReporteDiarioPage() {
  const hoy = hoyISO();
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  /** El número de la etapa elegida en "Buscar etapa"; se pierde al tocar las fechas. */
  const [nroEtapa, setNroEtapa] = useState<number | null>(null);
  /** La línea escrita a mano; `null` = la armada con las fechas. */
  const [etapaManual, setEtapaManual] = useState<string | null>(null);
  const [idFac, setIdFac] = useState("");
  const [idInst, setIdInst] = useState("");
  const [tocoFechas, setTocoFechas] = useState(false);

  const valido = rangoValido({ desde, hasta });
  const anio = desde.slice(0, 4);

  /* ---- Etapas: la en curso de entrada, y "Buscar etapa" ------------------- */

  const etapas = useQuery({ queryKey: keysEtapas.todo, queryFn: listarEtapas });
  const numeradas = useMemo(() => numerarEtapas(etapas.data ?? []), [etapas.data]);

  const elegirEtapa = (id: string) => {
    const e = numeradas.find((x) => String(x.id) === id);
    if (!e) return;
    setDesde(e.inicio);
    setHasta(e.fin);
    setNroEtapa(e.n);
    setEtapaManual(null);
    setTocoFechas(true);
  };

  // De entrada, la etapa en curso (si la hay y no se tocaron las fechas).
  useEffect(() => {
    if (tocoFechas) return;
    const enCurso = numeradas.find((e) => e.inicio <= hoy && hoy <= e.fin);
    if (enCurso) {
      setDesde(enCurso.inicio);
      setHasta(enCurso.fin);
      setNroEtapa(enCurso.n);
    }
  }, [numeradas, tocoFechas, hoy]);

  const cambiarFecha = (cual: "desde" | "hasta", v: string) => {
    (cual === "desde" ? setDesde : setHasta)(v);
    setNroEtapa(null);
    setTocoFechas(true);
  };

  const etapaAuto = textoEtapa(desde, hasta, nroEtapa);
  const etapa = etapaManual ?? etapaAuto;

  /* ---- Facilitador e institución ------------------------------------------ */

  const filtros = {
    anio,
    idDepartamento: null,
    idCiudad: null,
    idBarrio: null,
    idInstitucion: null,
    turno: null,
  };
  const postulaciones = useQuery({
    queryKey: keysPostulaciones.todas(filtros),
    queryFn: () => listarTodasPostulaciones(filtros),
    enabled: /^\d{4}$/.test(anio),
  });
  const activas = useMemo(
    () => (postulaciones.data?.items ?? []).filter((p) => p.activa && p.idFacilitador != null),
    [postulaciones.data],
  );

  const opcionesFac = useMemo(() => {
    const m = new Map<number, { texto: string; inst: Set<number> }>();
    for (const p of activas) {
      if (idInst && String(p.idInstitucion) !== idInst) continue;
      const x = m.get(p.idFacilitador!) ?? { texto: p.facilitador, inst: new Set<number>() };
      x.inst.add(p.idInstitucion);
      m.set(p.idFacilitador!, x);
    }
    return [...m]
      .map(([id, x]) => ({
        valor: String(id),
        texto: x.texto,
        extra: plural(x.inst.size, "institución", "instituciones"),
      }))
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
  }, [activas, idInst]);

  const opcionesInst = useMemo(() => {
    const m = new Map<number, { texto: string; n: number }>();
    for (const p of activas) {
      if (idFac && String(p.idFacilitador) !== idFac) continue;
      const x = m.get(p.idInstitucion) ?? { texto: p.institucion, n: 0 };
      x.n += 1;
      m.set(p.idInstitucion, x);
    }
    return [...m]
      .map(([id, x]) => ({
        valor: String(id),
        texto: x.texto,
        extra: plural(x.n, "postulación", "postulaciones"),
      }))
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
  }, [activas, idFac]);

  const facilitador = opcionesFac.find((o) => o.valor === idFac)?.texto ?? "";

  /* ---- El formulario ------------------------------------------------------ */

  const listo = valido && !!idFac && !!idInst && !!postulaciones.data;
  const datos = useQuery({
    queryKey: ["reporte-diario-facilitador", idInst, idFac, desde, hasta, anio],
    queryFn: () =>
      cargarFormulario2({
        idInstitucion: Number(idInst),
        idFacilitador: Number(idFac),
        facilitador,
        desde,
        hasta,
        etapa: "",
        postulaciones: postulaciones.data?.items ?? [],
      }),
    enabled: listo,
  });
  // La etapa se aplica acá: escribirla no vuelve a consultar.
  const form: Formulario2 | null = datos.data ? { ...datos.data, etapa } : null;

  // Las activas de los dos que no tienen ningún día con horario: no salen.
  const sinHorario = activas.filter(
    (p) =>
      String(p.idFacilitador) === idFac &&
      String(p.idInstitucion) === idInst &&
      !DIAS.some((d) => p.dias[d.clave].desde),
  ).length;

  /* ---- Vista previa: la misma imagen que se descarga ---------------------- */

  const [vista, setVista] = useState<string | null>(null);
  /** Si no se pudo dibujar: se muestra, en vez de quedar "cargando" para siempre. */
  const [errorVista, setErrorVista] = useState<unknown>(null);
  useEffect(() => {
    setErrorVista(null);
    if (!form) {
      setVista(null);
      return;
    }
    let url: string | null = null;
    let vigente = true;
    // Un respiro para no redibujar con cada letra de la etapa.
    const t = setTimeout(() => {
      generarForm2Imagen(form)
        .then((b) => {
          if (!vigente) return;
          url = URL.createObjectURL(b);
          setVista(url);
        })
        .catch((e) => {
          if (!vigente) return;
          console.error("Form. 2: no se pudo dibujar la vista previa", e);
          setVista(null);
          setErrorVista(e);
        });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
    // `form` se rearma en cada render: se redibuja cuando cambian sus partes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.data, etapa]);

  /* ---- Salidas ------------------------------------------------------------ */

  const [generando, setGenerando] = useState<"pdf" | "png" | "xlsx" | null>(null);
  const salir = (tipo: "pdf" | "png" | "xlsx") => {
    if (!form) return;
    setGenerando(tipo);
    const archivo = nombreArchivo2(form);
    const trabajo =
      tipo === "xlsx"
        ? descargarForm2Excel(form)
        : abrirPdfEnPestana(
            () => (tipo === "pdf" ? generarForm2Pdf(form) : generarForm2Imagen(form)),
            `${archivo}.${tipo}`,
            tipo === "pdf" ? "el PDF" : "la imagen",
          );
    trabajo
      .catch((e) => toast.error(e instanceof Error ? e.message : "No se pudo generar"))
      .finally(() => setGenerando(null));
  };

  const clases = form?.clases ?? [];
  const intervenciones = clases.reduce((a, c) => a + c.intervenciones.length, 0);
  const desarrolladas = clases.reduce((a, c) => a + hechas(c), 0);
  const conDeMas = clases.filter((c) => c.sobran > 0);
  const vacio = !clases.length;

  const boton = (
    tipo: "pdf" | "png" | "xlsx",
    Icono: typeof FileDown,
    titulo: string,
    clase: string,
  ) => (
    <button
      type="button"
      disabled={!form || vacio || generando != null}
      onClick={() => salir(tipo)}
      title={titulo}
      className={`flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold disabled:opacity-60 ${clase}`}
    >
      {generando === tipo ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Icono className="size-4" />
      )}
      Form. 2
    </button>
  );

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Reporte diario del facilitador</h1>
            <p className="text-xs text-muted-foreground">
              Form. 2: las clases del facilitador en una institución y las intervenciones de un
              período
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {boton(
              "pdf",
              FileDown,
              "El Form. 2 en PDF",
              "bg-primary text-primary-foreground shadow-soft",
            )}
            {boton("png", ImageDown, "El Form. 2 en imagen", "bg-primary-soft text-primary")}
            {boton(
              "xlsx",
              FileSpreadsheet,
              "El Form. 2 en Excel, con el mismo formato",
              "border border-primary/40 bg-card text-primary shadow-soft hover:bg-primary-soft",
            )}
          </div>
        </div>

        {/* ── Parámetros ───────────────────────────────────────────────── */}
        <section className="mb-4 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Fecha desde</span>
              <input
                type="date"
                value={desde}
                onChange={(e) => cambiarFecha("desde", e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Fecha hasta</span>
              <input
                type="date"
                value={hasta}
                onChange={(e) => cambiarFecha("hasta", e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3"
              />
            </label>
            <SelectorModal
              label="Facilitador"
              descripcion={`Los que tienen postulaciones activas en ${anio}`}
              value={idFac}
              onChange={setIdFac}
              opciones={opcionesFac}
              placeholder={postulaciones.isLoading ? "Cargando…" : "Elegí un facilitador"}
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <SelectorModal
              label="Institución"
              descripcion={
                idFac ? "Las de ese facilitador" : `Las que tienen postulaciones activas en ${anio}`
              }
              value={idInst}
              onChange={setIdInst}
              opciones={opcionesInst}
              placeholder={postulaciones.isLoading ? "Cargando…" : "Elegí una institución"}
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
          </div>
          {!valido && (
            <p className="text-xs text-destructive">Elegí un período válido, de hasta un año.</p>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <SelectorModal
              label="Buscar etapa"
              descripcion="Llena las fechas con las de la etapa"
              value=""
              onChange={elegirEtapa}
              opciones={[...numeradas].reverse().map((e) => ({
                valor: String(e.id),
                texto: nombreEtapa(e),
                extra: `${ddmmyyyy(e.inicio)} al ${ddmmyyyy(e.fin)}`,
              }))}
              placeholder={etapas.isLoading ? "Cargando…" : "Elegir de la tabla"}
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <label className="block min-w-0 text-sm">
              <span className="mb-1 flex items-center gap-1.5 font-medium">
                <Milestone className="size-4 text-muted-foreground" />
                Línea de la etapa (sale en rojo en el formulario)
              </span>
              <div className="flex gap-2">
                <input
                  value={etapa}
                  onChange={(e) => setEtapaManual(e.target.value)}
                  placeholder="ETAPA: 20 ABRIL - 13 MAYO"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 font-semibold text-red-600 uppercase"
                />
                {etapaManual != null && (
                  <button
                    type="button"
                    onClick={() => setEtapaManual(null)}
                    title={`Volver a la armada con las fechas: ${etapaAuto}`}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-input bg-card px-3 text-sm font-semibold hover:border-primary/40"
                  >
                    <RotateCcw className="size-4" />
                    Con las fechas
                  </button>
                )}
              </div>
            </label>
          </div>
        </section>

        {/* ── Resumen y avisos ─────────────────────────────────────────── */}
        {form && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-2 text-[13px]">
              {[
                plural(clases.length, "clase", "clases"),
                // Sin las intervenciones (CON_INTERVENCIONES), solo las clases.
                ...(form.conIntervenciones
                  ? [
                      plural(
                        intervenciones,
                        "intervención en el período",
                        "intervenciones en el período",
                      ),
                      plural(desarrolladas, "desarrollada", "desarrolladas"),
                    ]
                  : []),
              ].map((s) => (
                <span key={s} className="rounded-full bg-muted px-3 py-1 font-medium">
                  {s}
                </span>
              ))}
            </div>
            {conDeMas.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  El formulario tiene lugar para 4 intervenciones por clase y{" "}
                  {conDeMas
                    .map(
                      (c) =>
                        `${DIAS.find((d) => d.clave === c.dia)?.nombre ?? ""} ${c.hora} tiene ${c.intervenciones.length + c.sobran}`,
                    )
                    .join(", ")}
                  : salen las primeras 4. Achicá el período para ver las demás.
                </span>
              </p>
            )}
            {sinHorario > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {plural(sinHorario, "postulación no tiene", "postulaciones no tienen")} día ni hora
                cargados y no sale en el formulario.
              </p>
            )}
          </div>
        )}

        {/* ── Vista previa ─────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {postulaciones.isError ? (
            <div className="p-4">
              <Fallo
                error={postulaciones.error}
                texto={`No se pudieron cargar las postulaciones de ${anio}`}
              />
            </div>
          ) : postulaciones.data && !activas.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No hay postulaciones activas con facilitador en {anio}. Revisá las fechas: el año sale
              de la fecha desde.
            </p>
          ) : !idFac || !idInst ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí el facilitador y la institución.
            </p>
          ) : !valido ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí un período válido.
            </p>
          ) : datos.isLoading || postulaciones.isLoading ? (
            <Cargando />
          ) : datos.isError ? (
            <div className="p-4">
              <Fallo error={datos.error} texto="No se pudo armar el formulario" />
            </div>
          ) : vacio ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Este facilitador no tiene postulaciones activas con horario en esta institución en{" "}
              {anio}.
            </p>
          ) : vista ? (
            <div className="overflow-x-auto p-2">
              <img
                src={vista}
                alt={`Form. 2 de ${facilitador}`}
                className="w-full min-w-[960px] rounded border border-border/60"
              />
            </div>
          ) : errorVista ? (
            <div className="p-4">
              <Fallo error={errorVista} texto="No se pudo dibujar el formulario" />
            </div>
          ) : (
            <Cargando />
          )}
        </section>
      </div>
    </AppShell>
  );
}
