import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
} from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { SelectorModal } from "@/components/selector-modal";
import { SelectorPeriodo } from "@/components/selector-periodo";
import { TotalesPago } from "@/components/totales-pago";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysIntervenciones,
  listarResumenPeriodo,
  SUELDO_INICIAL,
  type IntervencionResumen,
} from "@/lib/intervenciones";
import { otroInicial, rangoDe, rangoValido, type Periodo } from "@/lib/periodos";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";

export const Route = createFileRoute("/totales-facilitador/")({
  head: () => ({
    meta: [
      { title: "Totales por Facilitador — Juventud con Valores" },
      {
        name: "description",
        content: "Cuántas intervenciones hizo cada facilitador en cada institución, y su total.",
      },
    ],
  }),
  component: TotalesFacilitadorPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

/** Una fila del reporte de APEX: un facilitador en una institución, con cuántas hizo. */
type Fila = {
  clave: string;
  idFacilitador: number;
  facilitador: string;
  idInstitucion: number;
  institucion: string;
  cantidad: number;
  /** Las intervenciones que forman la fila: el detalle (la página 78 de APEX). */
  marcaciones: IntervencionResumen[];
};

/** Los colores de las horas, como en Intervenciones Realizadas y el Resumen. */
const COLOR_HORA: CSSProperties = { backgroundColor: "#ffeb3b", color: "#000" };
const COLOR_DESDE: CSSProperties = { backgroundColor: "#4caf50", color: "#fff" };
const COLOR_HASTA: CSSProperties = { backgroundColor: "#ff9800", color: "#fff" };

/**
 * Totales por Facilitador: la página 55 de APEX. Cuántas intervenciones hizo
 * cada facilitador en cada institución en un período, y cuánto da a razón de
 * un sueldo por intervención. El ícono es el que ya tenía en el menú
 * (`Sigma`).
 *
 * Backend: `GET intervenciones/resumen-periodo?desde=&hasta=&si_no=` de
 * `backend/intervenciones.sql`, **el mismo del Resumen de Intervenciones** (la
 * 53): una por clase y día, la cuenta del pago. La cuenta por facilitador e
 * institución se arma en el navegador.
 *
 * Hasta el 27/10/2026 leía `intervenciones/realizadas`, el agrupado con que
 * contaba la 55 de APEX (una fila por marcación), y el mismo período daba otro
 * total que la 53. Ahora salen de las mismas filas y coinciden siempre.
 *
 * Como en APEX:
 *
 * - Los parámetros Fecha desde / hasta, Facilitadores, Desarrollo (Sí / No),
 *   Sueldo por intervención (30.000 de entrada) y Limpiar.
 * - El reporte: Facilitador, Institución, Cantidad Intervenciones, Total
 *   (cantidad × sueldo) y Detalle, con la suma de cantidad y total al pie.
 *
 * Distinto de APEX, a propósito:
 *
 * - **"Todos" los facilitadores funciona:** en APEX la consulta pedía
 *   `id_facilitador = :P55_ID_FACILITADOR`, así que sin elegir uno no salía
 *   nada. Acá entra con todos, para ver lo de cada uno de una vez.
 * - **Sin botón "Consultar"**, con el período en atajos (este mes, mes
 *   anterior, semanas, otro), y entra con este mes y las desarrolladas.
 * - **Los tres totales a la vista** (APEX los calculaba en campos ocultos):
 *   Sueldo en verde, Total Intervenciones en azul y Total Salario en naranja.
 *   Cuentan lo que se ve, también con un filtro de columna puesto.
 * - **Detalle (la página 78) es un diálogo** con las marcaciones de esa fila.
 * - Cada columna se ordena y se filtra desde su encabezado.
 */
function TotalesFacilitadorPage() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [otro, setOtro] = useState(otroInicial);
  const [siNo, setSiNo] = useState<"Si" | "No">("Si");
  const [idFac, setIdFac] = useState("");
  const [sueldo, setSueldo] = useState(String(SUELDO_INICIAL));
  const [pagina, setPagina] = useState(0);
  const [detalleDe, setDetalleDe] = useState<Fila | null>(null);
  // "Ocultar institución" (27/10/2026): una fila por facilitador, con todas
  // sus instituciones sumadas.
  const [porFacilitador, setPorFacilitador] = useState(false);

  const { desde, hasta } = rangoDe(periodo, otro);
  const valido = rangoValido({ desde, hasta });

  const datos = useQuery({
    queryKey: keysIntervenciones.resumenPeriodo(desde, hasta, siNo),
    queryFn: () => listarResumenPeriodo(desde, hasta, siNo),
    enabled: valido,
  });

  // El GROUP BY de APEX: facilitador + institución, contando las intervenciones.
  // Con la institución oculta, solo por facilitador.
  const todas = useMemo<Fila[]>(() => {
    const m = new Map<string, Fila>();
    for (const x of datos.data?.data ?? []) {
      const clave = porFacilitador
        ? String(x.id_facilitador)
        : `${x.id_facilitador}|${x.id_institucion}`;
      const f = m.get(clave);
      if (f) {
        f.cantidad++;
        f.marcaciones.push(x);
      } else {
        m.set(clave, {
          clave,
          idFacilitador: x.id_facilitador,
          facilitador: x.facilitador,
          idInstitucion: x.id_institucion,
          institucion: x.institucion,
          cantidad: 1,
          marcaciones: [x],
        });
      }
    }
    return [...m.values()].sort(
      (a, b) =>
        a.facilitador.localeCompare(b.facilitador, "es") ||
        a.institucion.localeCompare(b.institucion, "es"),
    );
  }, [datos.data, porFacilitador]);

  // Los facilitadores del período, con cuántas intervenciones tiene cada uno.
  const facilitadores = useMemo(() => {
    const m = new Map<number, { valor: string; texto: string; n: number }>();
    for (const f of todas) {
      const o = m.get(f.idFacilitador) ?? {
        valor: String(f.idFacilitador),
        texto: f.facilitador,
        n: 0,
      };
      o.n += f.cantidad;
      m.set(f.idFacilitador, o);
    }
    return [...m.values()]
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"))
      .map((o) => ({ ...o, extra: plural(o.n, "intervención", "intervenciones") }));
  }, [todas]);

  const filtradas = useMemo(
    () => todas.filter((f) => !idFac || String(f.idFacilitador) === idFac),
    [todas, idFac],
  );

  const sueldoNum = Number(sueldo.replace(/\D/g, "")) || 0;
  // Las columnas del reporte de APEX, en su orden. Total depende del sueldo.
  // Sin Institución cuando está oculta: el Excel sale igual que la tabla.
  const columnas = useMemo<ColumnaReporte<Fila>[]>(
    () => [
      { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
      ...(porFacilitador
        ? []
        : [{ clave: "institucion", titulo: "Institución", valor: (f: Fila) => f.institucion }]),
      { clave: "cantidad", titulo: "Cantidad Intervenciones", valor: (f) => f.cantidad },
      { clave: "total", titulo: "Total", valor: (f) => f.cantidad * sueldoNum },
    ],
    [sueldoNum, porFacilitador],
  );
  const tabla = useTablaReporte(filtradas, columnas);

  const alternarInstitucion = () => {
    // Un filtro puesto en Institución no tiene que quedar colgado al ocultarla.
    if (!porFacilitador) tabla.filtrar("institucion", []);
    setPorFacilitador(!porFacilitador);
    setPagina(0);
  };

  const cantidad = tabla.visibles.reduce((s, f) => s + f.cantidad, 0);
  const paginas = Math.max(1, Math.ceil(tabla.visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desdeFila = pag * POR_PAGINA;
  const enPagina = tabla.visibles.slice(desdeFila, desdeFila + POR_PAGINA);

  const limpiar = () => {
    setPeriodo("mes");
    setSiNo("Si");
    setIdFac("");
    setSueldo(String(SUELDO_INICIAL));
    setPorFacilitador(false);
    tabla.limpiar();
    setPagina(0);
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Totales por Facilitador</h1>
            <p className="text-xs text-muted-foreground">
              Cuántas intervenciones hizo cada facilitador en cada institución, y su total
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                `totales-facilitador-${desde}-a-${hasta}`,
                columnas.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                tabla.visibles,
              )
            }
            deshabilitado={!tabla.visibles.length}
          />
        </div>

        {/* ── "Parametros" ─────────────────────────────────────────────── */}
        <section className="mb-4 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <SelectorPeriodo
            periodo={periodo}
            otro={otro}
            onPeriodo={(p) => {
              setPeriodo(p);
              setPagina(0);
            }}
            onOtro={setOtro}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SelectorModal
              label="Facilitadores"
              descripcion="Los que tienen intervenciones en el período"
              value={idFac}
              onChange={(v) => {
                setIdFac(v);
                setPagina(0);
              }}
              opciones={[{ valor: "", texto: "Todos" }, ...facilitadores]}
              placeholder="Todos"
              buscador
              className="min-h-11 px-3.5 py-2 text-sm"
            />
            <div>
              <p className="mb-1.5 text-sm font-medium">Desarrollo (Sí/No)</p>
              <div
                role="radiogroup"
                aria-label="Desarrollo"
                className="flex h-11 rounded-xl border border-input bg-card p-0.5 text-sm"
              >
                {(
                  [
                    { valor: "Si", texto: "Sí" },
                    { valor: "No", texto: "No" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    role="radio"
                    aria-checked={siNo === o.valor}
                    onClick={() => {
                      setSiNo(o.valor);
                      setPagina(0);
                    }}
                    className={`flex-1 rounded-[10px] font-medium transition-colors ${
                      siNo === o.valor
                        ? "bg-primary text-primary-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {o.texto}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={alternarInstitucion}
                aria-pressed={porFacilitador}
                title={
                  porFacilitador
                    ? "Volver a separar cada facilitador por institución"
                    : "Una fila por facilitador, con todas sus instituciones sumadas"
                }
                className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition-colors ${
                  porFacilitador
                    ? "border-primary bg-primary text-primary-foreground shadow-soft"
                    : "border-input bg-card hover:border-primary/40"
                }`}
              >
                {porFacilitador ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                {porFacilitador ? "Mostrar institución" : "Ocultar institución"}
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={limpiar}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-input bg-card text-sm font-semibold hover:border-primary/40"
              >
                <Eraser className="size-4" />
                Limpiar
              </button>
            </div>
          </div>
        </section>

        <div className="mb-4">
          <TotalesPago sueldo={sueldo} onSueldo={setSueldo} intervenciones={cantidad} />
        </div>

        {datos.data?.truncado && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            El período trajo más de {numero.format(datos.data.limite)} intervenciones y se cortó:
            elegí uno más corto para que los totales sean los reales.
          </p>
        )}

        {/* ── El reporte ───────────────────────────────────────────────── */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          {!valido ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí un período válido.
            </p>
          ) : datos.isLoading ? (
            <Cargando />
          ) : datos.isError ? (
            <div className="p-4">
              <Fallo error={datos.error} texto="No se pudieron cargar las intervenciones" />
            </div>
          ) : (
            <>
              <FiltrosColumnas tabla={tabla} />
              {!tabla.visibles.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
                      <thead>
                        <tr>
                          {columnas.map((c) => (
                            <Th
                              key={c.clave}
                              numero={c.clave === "cantidad" || c.clave === "total"}
                            >
                              <EncabezadoReporte columna={c} tabla={tabla} />
                            </Th>
                          ))}
                          <Th centro>Detalle</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((f) => (
                          <tr key={f.clave} className="hover:bg-muted/40">
                            <Td>{f.facilitador}</Td>
                            {!porFacilitador && <Td>{f.institucion}</Td>}
                            <Td numero>{numero.format(f.cantidad)}</Td>
                            <Td numero>{numero.format(f.cantidad * sueldoNum)}</Td>
                            <td className="border-b border-border/60 text-center">
                              <button
                                type="button"
                                onClick={() => setDetalleDe(f)}
                                aria-label="Ver el detalle"
                                title="Ver las intervenciones de esta fila"
                                className="inline-grid size-7 place-items-center rounded text-primary hover:bg-primary-soft"
                              >
                                <BookOpen className="size-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* La suma de cantidad y total (`sum_columns_on_break` de APEX),
                          de todo lo filtrado. */}
                      <tfoot>
                        <tr className="bg-muted/60 font-semibold">
                          <td
                            colSpan={porFacilitador ? 1 : 2}
                            className="border-r border-border/60 px-3 py-2"
                          >
                            Total
                          </td>
                          <td className="border-r border-border/60 px-3 py-2 text-right tabular-nums">
                            {numero.format(cantidad)}
                          </td>
                          <td className="border-r border-border/60 px-3 py-2 text-right tabular-nums">
                            {numero.format(cantidad * sueldoNum)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="flex items-center justify-end gap-1 border-t border-border px-4 py-2 text-[12.5px]">
                    <button
                      type="button"
                      onClick={() => setPagina(pag - 1)}
                      disabled={pag === 0}
                      aria-label="Anterior"
                      className="grid size-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="px-1 text-muted-foreground tabular-nums">
                      {numero.format(desdeFila + 1)} - {numero.format(desdeFila + enPagina.length)}{" "}
                      de {numero.format(tabla.visibles.length)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPagina(pag + 1)}
                      disabled={pag >= paginas - 1}
                      aria-label="Siguiente"
                      className="grid size-8 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {detalleDe && (
        <DialogoDetalle
          fila={detalleDe}
          conInstitucion={porFacilitador}
          onCerrar={() => setDetalleDe(null)}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* El detalle (la página 78 de APEX)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Las intervenciones de un facilitador en una institución en el período (la
 * página 78 de APEX, que recibía institución, facilitador y las dos fechas),
 * de la más nueva a la más vieja.
 *
 * Con la institución oculta la fila es el facilitador entero: el detalle trae
 * las de todas sus instituciones, con una columna que dice de cuál es cada una.
 */
function DialogoDetalle({
  fila,
  conInstitucion,
  onCerrar,
}: {
  fila: Fila;
  conInstitucion: boolean;
  onCerrar: () => void;
}) {
  const instituciones = new Set(fila.marcaciones.map((x) => x.id_institucion)).size;
  const marcaciones = [...fila.marcaciones].sort(
    (a, b) =>
      ordenFecha(b.fecha).localeCompare(ordenFecha(a.fecha)) ||
      (b.hora ?? "").localeCompare(a.hora ?? ""),
  );
  const indice = (x: IntervencionResumen) =>
    x.nro_indice != null ? `${x.nro_indice}${x.indice_titulo ? ` - ${x.indice_titulo}` : ""}` : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Detalle</DialogTitle>
          <DialogDescription className="text-xs">
            {fila.facilitador} en{" "}
            {conInstitucion
              ? plural(instituciones, "institución", "instituciones")
              : fila.institucion}{" "}
            · {plural(fila.cantidad, "intervención", "intervenciones")}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                {[
                  "Fecha",
                  ...(conInstitucion ? ["Institución"] : []),
                  "Hora",
                  "Desde",
                  "Hasta",
                  "Dif. Min.",
                  "Manual",
                  "Índice",
                  "Postulaciones",
                ].map((t) => (
                  <th
                    key={t}
                    className="border-r border-b border-border bg-muted px-2 py-1.5 text-left text-xs font-semibold last:border-r-0"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {marcaciones.map((x) => (
                <tr key={x.id_intervencion}>
                  <Celda>{x.fecha}</Celda>
                  {conInstitucion && <Celda>{x.institucion}</Celda>}
                  <Celda estilo={COLOR_HORA}>{x.hora}</Celda>
                  <Celda estilo={COLOR_DESDE}>{x.hora_desde}</Celda>
                  <Celda estilo={COLOR_HASTA}>{x.hora_hasta}</Celda>
                  <Celda>
                    {x.diferencia != null && (
                      <span
                        className="inline-block min-w-10 rounded-md px-1.5 py-0.5 text-center font-bold tabular-nums"
                        style={
                          x.diferencia < 0
                            ? { backgroundColor: "#e74c3c", color: "#fff" }
                            : x.diferencia > 0
                              ? { backgroundColor: "#3498db", color: "#fff" }
                              : { backgroundColor: "#bdc3c7", color: "#000" }
                        }
                      >
                        {x.diferencia}
                      </span>
                    )}
                  </Celda>
                  <Celda>{x.manual}</Celda>
                  <Celda>{indice(x)}</Celda>
                  <Celda>{x.postulaciones}</Celda>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** Encabezado con borde vertical: toda tabla de detalle lleva marcos entre columnas. */
function Th({
  children,
  numero: num,
  centro,
}: {
  children: ReactNode;
  numero?: boolean;
  centro?: boolean;
}) {
  return (
    <th
      className={`border-r border-b border-border bg-muted px-3 py-2 text-xs font-semibold last:border-r-0 ${
        num ? "text-right" : centro ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, numero: num }: { children: ReactNode; numero?: boolean }) {
  return (
    <td
      className={`border-r border-b border-border/60 px-3 py-1.5 ${
        num ? "text-right tabular-nums" : ""
      }`}
    >
      {children}
    </td>
  );
}

function Celda({ children, estilo }: { children: ReactNode; estilo?: CSSProperties }) {
  return (
    <td
      style={estilo}
      className={`border-r border-b border-border/60 px-2 py-1.5 tabular-nums last:border-r-0 ${
        estilo ? "text-center font-bold" : ""
      }`}
    >
      {children}
    </td>
  );
}
