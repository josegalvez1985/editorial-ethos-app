import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  FileDown,
  Loader2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { SelectorModal } from "@/components/selector-modal";
import { SelectorPeriodo } from "@/components/selector-periodo";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysFacturas,
  listarPagos,
  META_PAGOS,
  type PagoFactura,
} from "@/lib/facturas-facilitadores";
import { abrirPdfEnPestana, generarPdfPagos } from "@/lib/pdf-pagos-facilitadores";
import { otroInicial, rangoDe, rangoValido, type Periodo } from "@/lib/periodos";
import { useSession } from "@/lib/session";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";

export const Route = createFileRoute("/pagos-facilitadores/")({
  head: () => ({
    meta: [
      { title: "Pagos a Facilitadores — Juventud con Valores" },
      {
        name: "description",
        content: "Las facturas de los facilitadores con sus datos bancarios, para Tesorería.",
      },
    ],
  }),
  component: PagosFacilitadoresPage,
});

const numero = new Intl.NumberFormat("es-PY");

/** Las filas por página del reporte. */
const POR_PAGINA = 50;

/** `YYYY-MM-DD` → `DD/MM/YYYY`, como las fechas de los demás reportes y su Excel. */
const dmy = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";

/** Si al facilitador le falta lo mínimo para transferirle: banco y número de cuenta. */
const sinCuenta = (p: PagoFactura) => !p.banco.trim() || !p.nroCuenta.trim();

/**
 * Pagos a Facilitadores (04/11/2026, no viene de APEX): el reporte de
 * Tesorería. Las facturas **emitidas** en un rango de fechas (la fecha de la
 * factura, no el período que cubre), una por fila, con los datos bancarios del
 * facilitador para pagarle: banco, sucursal, titular y su CI, tipo y número
 * de cuenta, además de su CI, RUC y el nombre del emisor.
 *
 * Decisiones con Jose:
 *
 * - El rango filtra por **fecha de la factura**. Entra con el mes anterior:
 *   lo que se paga a principio de mes es lo facturado el mes pasado.
 * - Las facturas **por revisar** (las que subió el facilitador, todavía con
 *   intervenciones y monto en 0) salen **junto con las demás**, sin distinción.
 * - **Con permiso de página en el backend**: el `GET` pide `PUEDE_CONSULTAR` de
 *   esta página porque trae cuentas bancarias (ver `facturas_facilitadores.sql`).
 *   Por lo mismo la consulta no se guarda en el navegador (`META_PAGOS`).
 *
 * Como todo reporte: Excel y PDF con lo filtrado (el PDF, por facilitador:
 * `lib/pdf-pagos-facilitadores.ts`), orden y filtro por columna, marcos
 * verticales y la suma al pie. Un facilitador sin banco o sin número de
 * cuenta se marca en ámbar, para verlo antes de ir a pagar.
 */
function PagosFacilitadoresPage() {
  const [periodo, setPeriodo] = useState<Periodo>("mes-anterior");
  const [otro, setOtro] = useState(otroInicial);
  const [idFac, setIdFac] = useState("");
  const [pagina, setPagina] = useState(0);
  const [generando, setGenerando] = useState(false);
  const { sesion } = useSession();

  const { desde, hasta } = rangoDe(periodo, otro);
  const valido = rangoValido({ desde, hasta });

  const datos = useQuery({
    queryKey: keysFacturas.pagos(desde, hasta),
    queryFn: () => listarPagos(desde, hasta),
    enabled: valido,
    meta: META_PAGOS,
  });

  // Los facilitadores con facturas en el rango, con cuántas tiene cada uno.
  const facilitadores = useMemo(() => {
    const m = new Map<number, { valor: string; texto: string; n: number }>();
    for (const p of datos.data ?? []) {
      const o = m.get(p.idFacilitador) ?? {
        valor: String(p.idFacilitador),
        texto: p.facilitador,
        n: 0,
      };
      o.n++;
      m.set(p.idFacilitador, o);
    }
    return [...m.values()]
      .sort((a, b) => a.texto.localeCompare(b.texto, "es"))
      .map((o) => ({ ...o, extra: `${numero.format(o.n)} ${o.n === 1 ? "factura" : "facturas"}` }));
  }, [datos.data]);

  const filtradas = useMemo(
    () => (datos.data ?? []).filter((p) => !idFac || String(p.idFacilitador) === idFac),
    [datos.data, idFac],
  );

  // Las columnas, en el orden de la tabla y del Excel.
  const columnas = useMemo<ColumnaReporte<PagoFactura>[]>(
    () => [
      { clave: "facilitador", titulo: "Facilitador", valor: (p) => p.facilitador },
      { clave: "ci", titulo: "CI", valor: (p) => p.nroCi },
      { clave: "ruc", titulo: "RUC", valor: (p) => p.ruc },
      { clave: "emisor", titulo: "Emisor", valor: (p) => p.nombreEmisor },
      { clave: "nro", titulo: "Nro. Factura", valor: (p) => p.nroFactura },
      { clave: "timbrado", titulo: "Timbrado", valor: (p) => p.timbrado },
      {
        clave: "fecha",
        titulo: "Fecha Factura",
        valor: (p) => dmy(p.fechaFactura),
        orden: (p) => p.fechaFactura,
      },
      {
        clave: "periodo",
        titulo: "Período",
        valor: (p) => `${dmy(p.fechaDesde)} al ${dmy(p.fechaHasta)}`,
        orden: (p) => p.fechaDesde,
      },
      { clave: "cantidad", titulo: "Intervenciones", valor: (p) => p.cantidad },
      { clave: "sueldo", titulo: "Sueldo", valor: (p) => p.sueldo },
      { clave: "monto", titulo: "Monto", valor: (p) => p.monto },
      { clave: "banco", titulo: "Banco", valor: (p) => p.banco },
      { clave: "sucursal", titulo: "Sucursal", valor: (p) => p.sucursalBanco },
      { clave: "titular", titulo: "Titular", valor: (p) => p.titular },
      { clave: "ciTitular", titulo: "CI Titular", valor: (p) => p.ciTitular },
      { clave: "tipoCuenta", titulo: "Tipo de Cuenta", valor: (p) => p.tipoCuenta },
      { clave: "nroCuenta", titulo: "Nro. de Cuenta", valor: (p) => p.nroCuenta },
      { clave: "observacion", titulo: "Observación", valor: (p) => p.observacion },
      { clave: "foto", titulo: "Factura", valor: (p) => p.fotoUrl, filtrable: false },
    ],
    [],
  );
  const tabla = useTablaReporte(filtradas, columnas);
  const numericas = new Set(["cantidad", "sueldo", "monto"]);

  const vis = tabla.visibles;
  const total = vis.reduce((s, p) => s + p.monto, 0);
  const intervenciones = vis.reduce((s, p) => s + p.cantidad, 0);
  const cuantosFac = new Set(vis.map((p) => p.idFacilitador)).size;
  const facSinCuenta = new Set(vis.filter(sinCuenta).map((p) => p.idFacilitador)).size;

  const paginas = Math.max(1, Math.ceil(vis.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desdeFila = pag * POR_PAGINA;
  const enPagina = vis.slice(desdeFila, desdeFila + POR_PAGINA);

  const limpiar = () => {
    setPeriodo("mes-anterior");
    setIdFac("");
    tabla.limpiar();
    setPagina(0);
  };

  /**
   * El PDF: lo mismo que el Excel (lo filtrado, en el orden de la tabla),
   * armado para Tesorería. Ver `lib/pdf-pagos-facilitadores.ts`.
   */
  function generarPdf() {
    setGenerando(true);
    // SIN await antes de esta llamada: la pestaña se abre dentro del clic o el
    // navegador la bloquea como popup. Ver `abrirPdfEnPestana`.
    abrirPdfEnPestana(
      () =>
        generarPdfPagos(vis, {
          periodo: `${dmy(desde)} al ${dmy(hasta)}`,
          facilitador: facilitadores.find((f) => f.valor === idFac)?.texto ?? "Todos",
          conFiltrosColumna: Object.keys(tabla.filtros).length > 0,
          usuario: sesion?.nombre ?? "",
        }),
      `pagos-facilitadores-${desde}-a-${hasta}.pdf`,
    )
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo generar el PDF"))
      .finally(() => setGenerando(false));
  }

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Pagos a Facilitadores</h1>
            <p className="text-xs text-muted-foreground">
              Las facturas emitidas en el período, con los datos bancarios para pagarlas
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <BotonExcel
              onDescargar={() =>
                descargarExcel(
                  `pagos-facilitadores-${desde}-a-${hasta}`,
                  columnas.map((c): ColumnaExcel<PagoFactura> => [c.titulo, c.valor]),
                  vis,
                )
              }
              deshabilitado={!vis.length}
            />
            <button
              type="button"
              onClick={generarPdf}
              disabled={generando || !vis.length}
              title={
                !vis.length ? "No hay facturas para imprimir" : "Abre el PDF en una pestaña nueva"
              }
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
            >
              {generando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileDown className="size-4" />
              )}
              PDF
            </button>
          </div>
        </div>

        {/* ── Parámetros ───────────────────────────────────────────────── */}
        <section className="mb-4 space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <p className="text-xs text-muted-foreground">Por la fecha de la factura.</p>
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
              descripcion="Los que tienen facturas en el período"
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

        {/* ── Totales (de lo que se ve, con los filtros de columna) ─────── */}
        {valido && datos.isSuccess && (
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Total titulo="Facturas" valor={numero.format(vis.length)} />
            <Total titulo="Facilitadores" valor={numero.format(cuantosFac)} />
            <Total titulo="Intervenciones" valor={numero.format(intervenciones)} />
            <Total titulo="Total a pagar" valor={numero.format(total)} destacado />
          </div>
        )}

        {valido && datos.isSuccess && facSinCuenta > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {facSinCuenta === 1
              ? "1 facilitador no tiene"
              : `${numero.format(facSinCuenta)} facilitadores no tienen`}{" "}
            banco o número de cuenta cargado: se marcan en la tabla. Se completan en su ficha de
            Facilitadores.
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
              <Fallo error={datos.error} texto="No se pudieron cargar las facturas" />
            </div>
          ) : (
            <>
              <FiltrosColumnas tabla={tabla} />
              {!vis.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No hay facturas emitidas en este período.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1900px] border-separate border-spacing-0 text-[13px]">
                      <thead>
                        <tr>
                          {columnas.map((c) => (
                            <Th key={c.clave} numero={numericas.has(c.clave)}>
                              <EncabezadoReporte columna={c} tabla={tabla} />
                            </Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((p) => {
                          const falta = sinCuenta(p);
                          return (
                            <tr key={p.id} className="hover:bg-muted/40">
                              <Td>
                                <span className="font-medium">{p.facilitador}</span>
                              </Td>
                              <Td>{p.nroCi}</Td>
                              <Td>{p.ruc}</Td>
                              <Td>{p.nombreEmisor}</Td>
                              <Td>
                                <span className="font-mono">{p.nroFactura}</span>
                              </Td>
                              <Td>{p.timbrado}</Td>
                              <Td>{dmy(p.fechaFactura)}</Td>
                              <Td>
                                {dmy(p.fechaDesde)} al {dmy(p.fechaHasta)}
                              </Td>
                              <Td numero>{numero.format(p.cantidad)}</Td>
                              <Td numero>{numero.format(p.sueldo)}</Td>
                              <Td numero>
                                <span className="font-semibold">{numero.format(p.monto)}</span>
                              </Td>
                              <Td alerta={falta && !p.banco.trim()}>{p.banco || "Sin banco"}</Td>
                              <Td>{p.sucursalBanco}</Td>
                              <Td>{p.titular}</Td>
                              <Td>{p.ciTitular}</Td>
                              <Td>{p.tipoCuenta}</Td>
                              <Td alerta={falta && !p.nroCuenta.trim()}>
                                <span className="font-mono">{p.nroCuenta || "Sin cuenta"}</span>
                              </Td>
                              <Td>
                                <span className="line-clamp-2 max-w-64">{p.observacion}</span>
                              </Td>
                              <Td>
                                {p.fotoUrl ? (
                                  <a
                                    href={p.fotoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                                  >
                                    <ExternalLink className="size-3.5" />
                                    Ver
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">Sin foto</span>
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* La suma de lo filtrado, no solo de la página. */}
                      <tfoot>
                        <tr className="bg-muted/60 font-semibold">
                          <td colSpan={8} className="border-r border-border/60 px-3 py-2">
                            Total
                          </td>
                          <td className="border-r border-border/60 px-3 py-2 text-right tabular-nums">
                            {numero.format(intervenciones)}
                          </td>
                          <td className="border-r border-border/60" />
                          <td className="border-r border-border/60 px-3 py-2 text-right tabular-nums">
                            {numero.format(total)}
                          </td>
                          <td colSpan={8} />
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
                      de {numero.format(vis.length)}
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
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Total({
  titulo,
  valor,
  destacado,
}: {
  titulo: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2 shadow-soft ${
        destacado ? "border-primary/40 bg-primary-soft" : "border-border/60 bg-card"
      }`}
    >
      <p className="text-[11px] text-muted-foreground">{titulo}</p>
      <p className={`font-bold tabular-nums ${destacado ? "text-lg text-primary" : "text-base"}`}>
        {valor}
      </p>
    </div>
  );
}

/** Encabezado con borde vertical: toda tabla de detalle lleva marcos entre columnas. */
function Th({ children, numero: num }: { children: ReactNode; numero?: boolean }) {
  return (
    <th
      className={`border-r border-b border-border bg-muted px-3 py-2 text-xs font-semibold whitespace-nowrap last:border-r-0 ${
        num ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  numero: num,
  alerta,
}: {
  children: ReactNode;
  numero?: boolean;
  /** Falta un dato para pagar: la celda en ámbar. */
  alerta?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-border/60 px-3 py-1.5 whitespace-nowrap last:border-r-0 ${
        num ? "text-right tabular-nums" : ""
      } ${alerta ? "bg-amber-500/15 font-semibold text-amber-800 dark:text-amber-300" : ""}`}
    >
      {children}
    </td>
  );
}
