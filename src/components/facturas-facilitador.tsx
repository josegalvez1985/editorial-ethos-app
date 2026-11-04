import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { EtiquetaCampo, Texto } from "@/components/ficha-ui";
import { SelectorModal } from "@/components/selector-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  descargarArchivoFactura,
  eliminarFactura,
  esPdf,
  formatearNroFactura,
  guardarFactura,
  keysFacturas,
  listarFacturas,
  miniatura,
  nombreArchivoFactura,
  porRevisar,
  sePisan,
  subirFotoFactura,
  TIPOS_FOTO,
  TOPE_FOTO_KB,
  TOPE_PDF_MB,
  type Factura,
} from "@/lib/facturas-facilitadores";
import { fechaCorta, hoyISO } from "@/lib/fechas";
import { keysIntervenciones, listarResumenPeriodo } from "@/lib/intervenciones";
import { rangoValido } from "@/lib/periodos";
import { campo, normalizar } from "@/lib/utils";

/**
 * Las facturas de los facilitadores: el diálogo de Totales por Facilitador
 * (04/11/2026). No es una página ni tiene permisos propios: quien llega a
 * Totales por Facilitador ve, carga, modifica y borra facturas (el backend pide
 * solo sesión). Antes usaba las banderas insertar/actualizar/borrar de la
 * página; se sacaron a pedido el mismo día.
 *
 * Un solo diálogo con tres vistas, para no poner un diálogo encima de otro:
 *
 * - **La lista**: de un facilitador o de todos, con su foto, lo facturado y si
 *   coincide con lo que da el reporte hoy. Abre con **todas las cargadas**
 *   (04/11/2026: una factura de un período sin intervenciones no tenía dónde
 *   verse) y se puede achicar a las que tocan el período del reporte. Con
 *   todos los facilitadores va agrupada por facilitador, y arriba los del
 *   reporte que todavía no facturaron el período.
 * - **El formulario**: alta y edición. Propone el período del reporte, la
 *   cantidad del facilitador en el reporte y el sueldo de la pantalla; la foto
 *   o el PDF se sube a Cloudinary al elegirlo.
 * - **La foto** en grande, con el enlace al original (en el APK la WebView no
 *   abre pestañas: por eso se ve acá).
 *
 * **Por revisar** (04/11/2026): las que sube el facilitador desde su app llegan
 * con cantidad y sueldo en 0 (`porRevisar`). Se marcan en ámbar y, al abrirlas,
 * el formulario propone la cantidad del reporte (si la factura es del período
 * que se está viendo) y el sueldo de la pantalla; guardarla la deja revisada.
 */

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Un facilitador del reporte, con sus intervenciones en el período. */
export type FacilitadorPeriodo = { id: number; nombre: string; cantidad: number };

type Vista =
  | { modo: "lista" }
  | { modo: "editar"; factura: Factura | null; idFacilitador: number | null }
  | { modo: "foto"; url: string; titulo: string; archivo: string };

/** `YYYY-MM-DDTHH:MI` → "4 nov 2026 15:30". */
const fechaHora = (v: string) => (v ? `${fechaCorta(v.slice(0, 10))} ${v.slice(11, 16)}` : "");

export function DialogoFacturas({
  desde,
  hasta,
  sueldo,
  facilitadores,
  cantidadesValidas,
  idFacilitador,
  nueva,
  onCerrar,
}: {
  /** El período del reporte. */
  desde: string;
  hasta: string;
  /** El sueldo por intervención de la pantalla: el que se propone. */
  sueldo: number;
  /** Los facilitadores con intervenciones en el período. */
  facilitadores: FacilitadorPeriodo[];
  /** Con el reporte en "Desarrollo: No" la cantidad no es la que se paga. */
  cantidadesValidas: boolean;
  /** `null`: las de todos los facilitadores. */
  idFacilitador: number | null;
  /** Abrir directo en el alta. */
  nueva?: boolean;
  onCerrar: () => void;
}) {
  // `todas`: las cargadas, de cualquier período. `periodo`: las que tocan el del reporte.
  const [alcance, setAlcance] = useState<"todas" | "periodo">("todas");
  const datos = useQuery({
    queryKey: alcance === "todas" ? keysFacturas.todas : keysFacturas.periodo(desde, hasta),
    queryFn: () => listarFacturas(alcance === "todas" ? {} : { desde, hasta }),
  });
  const [vista, setVista] = useState<Vista>(
    nueva ? { modo: "editar", factura: null, idFacilitador } : { modo: "lista" },
  );
  const [buscar, setBuscar] = useState("");
  // Mientras se guarda o se sube una foto, el diálogo no se cierra.
  const [ocupado, setOcupado] = useState(false);

  const fac = idFacilitador != null ? facilitadores.find((f) => f.id === idFacilitador) : undefined;
  const todas = datos.data?.facturas ?? [];
  const delFiltro =
    idFacilitador != null ? todas.filter((f) => f.idFacilitador === idFacilitador) : todas;
  const q = normalizar(buscar.trim());
  const visibles = q
    ? delFiltro.filter((f) =>
        normalizar(`${f.nroFactura} ${f.facilitador} ${f.timbrado} ${f.observacion}`).includes(q),
      )
    : delFiltro;
  const grupos = idFacilitador == null ? agruparPorFacilitador(visibles) : null;

  // Los del reporte que no tienen ninguna factura que toque el período (con
  // "Todas" la lista trae también las de otros períodos: no cuentan).
  const conFactura = new Set(
    todas
      .filter((f) => sePisan({ desde, hasta }, { desde: f.fechaDesde, hasta: f.fechaHasta }))
      .map((f) => f.idFacilitador),
  );
  const sinFactura = facilitadores.filter((f) => !conFactura.has(f.id));
  const cantidadDe = (id: number) => facilitadores.find((f) => f.id === id)?.cantidad;

  const nombre =
    fac?.nombre ??
    (idFacilitador != null
      ? todas.find((f) => f.idFacilitador === idFacilitador)?.facilitador
      : undefined);
  const periodo = `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      {/* En el formulario y la foto, columna sin scroll propio: scrollea el
          contenido del Editor y su pie queda fijo. En la lista, scroll normal. */}
      <DialogContent
        className={
          vista.modo === "editar"
            ? "flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-2xl"
            : "max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl"
        }
      >
        {vista.modo === "foto" ? (
          <VerFoto
            url={vista.url}
            titulo={vista.titulo}
            archivo={vista.archivo}
            onVolver={() => setVista({ modo: "lista" })}
          />
        ) : vista.modo === "editar" ? (
          <Editor
            factura={vista.factura}
            idFacilitadorInicial={vista.idFacilitador}
            facilitadores={facilitadores}
            otras={todas}
            desde={desde}
            hasta={hasta}
            sueldo={sueldo}
            fotosHabilitadas={datos.data?.fotosHabilitadas ?? false}
            largoObservacion={datos.data?.largoObservacion ?? 2000}
            onOcupado={setOcupado}
            onVolver={() => setVista({ modo: "lista" })}
          />
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="font-display text-xl">Facturas</DialogTitle>
              <DialogDescription className="text-xs">
                {nombre ?? "Todos los facilitadores"} ·{" "}
                {alcance === "todas" ? "todas las cargadas" : `las que tocan del ${periodo}`}
              </DialogDescription>
            </DialogHeader>

            <div
              role="radiogroup"
              aria-label="Qué facturas mostrar"
              className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
            >
              {(
                [
                  ["todas", "Todas las cargadas"],
                  ["periodo", `Del período (${periodo})`],
                ] as const
              ).map(([valor, texto]) => (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={alcance === valor}
                  onClick={() => setAlcance(valor)}
                  className={`min-h-9 rounded-lg px-2 py-1 text-xs font-semibold ${
                    alcance === valor
                      ? "bg-card text-foreground shadow-soft"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {texto}
                </button>
              ))}
            </div>

            {datos.isLoading ? (
              <Cargando />
            ) : datos.isError ? (
              <Fallo error={datos.error} texto="No se pudieron cargar las facturas" />
            ) : (
              <div className="space-y-3">
                <Resumen facturas={delFiltro} />

                {idFacilitador == null && sinFactura.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="mb-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Sin factura en el período:{" "}
                      {plural(sinFactura.length, "facilitador", "facilitadores")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sinFactura.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() =>
                            setVista({ modo: "editar", factura: null, idFacilitador: f.id })
                          }
                          title="Cargar su factura"
                          className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-card px-2.5 py-1 text-xs font-medium hover:border-primary/50"
                        >
                          <Plus className="size-3" />
                          {f.nombre}
                          <span className="text-muted-foreground tabular-nums">
                            · {numero.format(f.cantidad)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-start gap-2">
                  {delFiltro.length > 3 && (
                    <div className="min-w-56 flex-1">
                      <Buscador
                        valor={buscar}
                        onCambio={setBuscar}
                        placeholder="Buscar por número, facilitador o timbrado"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setVista({ modo: "editar", factura: null, idFacilitador })}
                    className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft"
                  >
                    <Plus className="size-4" />
                    Nueva factura
                  </button>
                </div>

                {!visibles.length ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    {q
                      ? "Ninguna factura coincide con la búsqueda."
                      : alcance === "todas"
                        ? nombre
                          ? `${nombre} no tiene facturas cargadas.`
                          : "No hay facturas cargadas."
                        : nombre
                          ? `${nombre} no tiene facturas que toquen este período.`
                          : "No hay facturas que toquen este período."}
                  </p>
                ) : (
                  (grupos ?? [{ id: idFacilitador ?? 0, nombre: "", facturas: visibles }]).map(
                    (g) => (
                      <section key={g.id} className="space-y-2">
                        {grupos && (
                          <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-border/60 pt-1 pb-1">
                            <span className="text-sm font-bold">{g.nombre}</span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {plural(g.facturas.length, "factura", "facturas")} ·{" "}
                              {numero.format(g.facturas.reduce((s, f) => s + f.monto, 0))}
                            </span>
                          </h3>
                        )}
                        <ul className="space-y-2">
                          {g.facturas.map((f) => (
                            <TarjetaFactura
                              key={f.id}
                              factura={f}
                              conFacilitador={false}
                              desde={desde}
                              hasta={hasta}
                              cantidadReporte={
                                cantidadesValidas ? cantidadDe(f.idFacilitador) : undefined
                              }
                              onAbrir={() =>
                                setVista({
                                  modo: "editar",
                                  factura: f,
                                  idFacilitador: f.idFacilitador,
                                })
                              }
                              onVerFoto={() =>
                                setVista({
                                  modo: "foto",
                                  url: f.fotoUrl,
                                  titulo: `Factura ${f.nroFactura}`,
                                  archivo: nombreArchivoFactura(
                                    f.fechaFactura,
                                    f.nroFactura,
                                    f.fotoUrl,
                                  ),
                                })
                              }
                              onOcupado={setOcupado}
                            />
                          ))}
                        </ul>
                      </section>
                    ),
                  )
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* La lista                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Las facturas agrupadas por facilitador, por nombre; dentro de cada uno, en el
 * orden en que llegan (el backend las manda de la más nueva a la más vieja).
 */
function agruparPorFacilitador(facturas: Factura[]) {
  const m = new Map<number, { id: number; nombre: string; facturas: Factura[] }>();
  for (const f of facturas) {
    const g = m.get(f.idFacilitador);
    if (g) g.facturas.push(f);
    else m.set(f.idFacilitador, { id: f.idFacilitador, nombre: f.facilitador, facturas: [f] });
  }
  return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

function Resumen({ facturas }: { facturas: Factura[] }) {
  if (!facturas.length) return null;
  const monto = facturas.reduce((s, f) => s + f.monto, 0);
  const cantidad = facturas.reduce((s, f) => s + f.cantidad, 0);
  const sinFoto = facturas.filter((f) => !f.fotoUrl).length;
  const pendientes = facturas.filter(porRevisar).length;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Dato titulo="Facturas" valor={numero.format(facturas.length)} />
      <Dato titulo="Por revisar" valor={numero.format(pendientes)} alerta={pendientes > 0} />
      <Dato titulo="Intervenciones" valor={numero.format(cantidad)} />
      <Dato titulo="Total facturado" valor={numero.format(monto)} />
      <Dato titulo="Sin foto" valor={numero.format(sinFoto)} alerta={sinFoto > 0} />
    </div>
  );
}

function Dato({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{titulo}</p>
      <p
        className={`text-base font-bold tabular-nums ${alerta ? "text-amber-700 dark:text-amber-300" : ""}`}
      >
        {valor}
      </p>
    </div>
  );
}

function TarjetaFactura({
  factura: f,
  conFacilitador,
  desde,
  hasta,
  cantidadReporte,
  onAbrir,
  onVerFoto,
  onOcupado,
}: {
  factura: Factura;
  conFacilitador: boolean;
  desde: string;
  hasta: string;
  /** Lo que da hoy el reporte para el facilitador, si se puede comparar. */
  cantidadReporte?: number;
  onAbrir: () => void;
  onVerFoto: () => void;
  /** Mientras se borra, el diálogo no se cierra. */
  onOcupado: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  // Eliminar desde la lista, sin entrar al formulario: primer toque pide
  // confirmación, el segundo borra. Mismo efecto que el botón del formulario.
  const [confirmar, setConfirmar] = useState(false);
  const borrar = useMutation({
    mutationFn: () => eliminarFactura(f.id),
    onMutate: () => onOcupado(true),
    onSettled: () => onOcupado(false),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keysFacturas.todo });
      toast.success(`Factura ${f.nroFactura} eliminada`, {
        description: f.fotoUrl && !r.aviso ? "Y su foto, de Cloudinary." : undefined,
      });
      if (r.aviso) toast.warning(r.aviso);
    },
    onError: (e) => {
      setConfirmar(false);
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    },
  });

  const pendiente = porRevisar(f);
  const mismoPeriodo = f.fechaDesde === desde && f.fechaHasta === hasta;
  const cubreTodo = f.fechaDesde <= desde && f.fechaHasta >= hasta;
  const tocaPeriodo = sePisan({ desde, hasta }, { desde: f.fechaDesde, hasta: f.fechaHasta });
  const diferencia =
    cantidadReporte != null && mismoPeriodo && !pendiente ? cantidadReporte - f.cantidad : null;

  return (
    <li
      className={`flex gap-3 rounded-xl border bg-card p-3 ${
        pendiente ? "border-amber-500/50" : "border-border/60"
      }`}
    >
      {f.fotoUrl ? (
        <button
          type="button"
          onClick={onVerFoto}
          aria-label="Ver la foto de la factura"
          className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
        >
          <img
            src={miniatura(f.fotoUrl, 160)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
          {esPdf(f.fotoUrl) && (
            <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
              PDF
            </span>
          )}
        </button>
      ) : (
        <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-border text-center text-[10px] leading-tight text-muted-foreground">
          Sin
          <br />
          foto
        </div>
      )}

      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-sm font-bold">{f.nroFactura}</span>
          {f.timbrado && (
            <span className="text-[11px] text-muted-foreground">Timbrado {f.timbrado}</span>
          )}
          {pendiente && (
            <span className="rounded-full bg-amber-500/15 px-2 py-px text-[10.5px] font-semibold text-amber-800 dark:text-amber-300">
              Por revisar
            </span>
          )}
        </div>
        {conFacilitador && <p className="truncate text-sm font-medium">{f.facilitador}</p>}
        <p className="text-xs text-muted-foreground">
          Del {fechaCorta(f.fechaFactura)} · cubre del {fechaCorta(f.fechaDesde)} al{" "}
          {fechaCorta(f.fechaHasta)}
        </p>
        {pendiente ? (
          <p className="mt-0.5 text-[11.5px] text-amber-800 dark:text-amber-300">
            La subió el facilitador{f.cargadoEl ? ` el ${fechaHora(f.cargadoEl)}` : ""}: falta
            controlarla y completar intervenciones y sueldo.
          </p>
        ) : (
          <p className="mt-0.5 text-sm tabular-nums">
            {numero.format(f.cantidad)} × {numero.format(f.sueldo)} ={" "}
            <span className="font-bold">{numero.format(f.monto)}</span>
          </p>
        )}
        {diferencia === 0 ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5" />
            Coincide con el reporte
          </p>
        ) : diferencia != null ? (
          <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" />
            El reporte hoy da {numero.format(cantidadReporte!)} ({diferencia > 0 ? "+" : ""}
            {numero.format(diferencia)})
          </p>
        ) : !tocaPeriodo ? (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Fuera del período del reporte.
          </p>
        ) : (
          !cubreTodo && (
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Cubre solo parte del período del reporte.
            </p>
          )
        )}
        {f.observacion && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{f.observacion}</p>
        )}
      </button>

      <div className="flex shrink-0 flex-col gap-1.5 self-start">
        <button
          type="button"
          onClick={onAbrir}
          disabled={borrar.isPending}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-primary/30 px-2.5 text-xs font-semibold text-primary hover:bg-primary-soft disabled:opacity-50"
        >
          <Pencil className="size-3.5" />
          Modificar
        </button>
        {f.fotoUrl && (
          <BotonDescargar
            url={f.fotoUrl}
            archivo={nombreArchivoFactura(f.fechaFactura, f.nroFactura, f.fotoUrl)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-input px-2.5 text-xs font-semibold hover:border-primary/40 disabled:opacity-50"
            icono="size-3.5"
          />
        )}
        <button
          type="button"
          onClick={() => (confirmar ? borrar.mutate() : setConfirmar(true))}
          onBlur={() => !borrar.isPending && setConfirmar(false)}
          disabled={borrar.isPending}
          className={`flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
            confirmar
              ? "border-destructive bg-destructive text-white"
              : "border-destructive/40 text-destructive hover:bg-destructive/10"
          }`}
        >
          {borrar.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
          {confirmar ? "¿Seguro?" : "Eliminar"}
        </button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* La foto en grande                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Descarga la foto o el PDF con el nombre `<fecha>-<nro_factura>` (ver
 * `nombreArchivoFactura`). Es un `button` y no un `a download`: el enlace es de
 * otro dominio (Cloudinary) y el navegador ignoraría el nombre.
 */
function BotonDescargar({
  url,
  archivo,
  className,
  icono,
}: {
  url: string;
  archivo: string;
  className: string;
  icono: string;
}) {
  const [bajando, setBajando] = useState(false);
  return (
    <button
      type="button"
      disabled={bajando}
      title={`Descargar como ${archivo}`}
      onClick={async () => {
        setBajando(true);
        try {
          await descargarArchivoFactura(url, archivo);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "No se pudo descargar la factura");
        } finally {
          setBajando(false);
        }
      }}
      className={className}
    >
      {bajando ? <Loader2 className={`${icono} animate-spin`} /> : <Download className={icono} />}
      Descargar
    </button>
  );
}

function VerFoto({
  url,
  titulo,
  archivo,
  onVolver,
  volverTexto = "Facturas",
}: {
  url: string;
  titulo: string;
  /** El nombre con que se descarga. */
  archivo: string;
  onVolver: () => void;
  volverTexto?: string;
}) {
  return (
    <>
      <DialogHeader className="text-left">
        <Volver onClick={onVolver} texto={volverTexto} />
        <DialogTitle className="font-display text-xl">{titulo}</DialogTitle>
        <DialogDescription className="text-xs">
          {esPdf(url) ? "La primera página del PDF." : "La foto cargada."}
        </DialogDescription>
      </DialogHeader>
      <img
        src={miniatura(url, 1400)}
        alt={titulo}
        className="max-h-[65vh] w-full rounded-lg border border-border bg-muted object-contain"
      />
      <div className="grid grid-cols-2 gap-2">
        <BotonDescargar
          url={url}
          archivo={archivo}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-60"
          icono="size-4"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-input bg-card text-sm font-semibold hover:border-primary/40"
        >
          <ExternalLink className="size-4" />
          {esPdf(url) ? "Abrir el PDF" : "Abrir el original"}
        </a>
      </div>
    </>
  );
}

function Volver({ onClick, texto = "Facturas" }: { onClick: () => void; texto?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 mb-1 flex w-fit items-center gap-1 rounded-lg px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      {texto}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición                                                             */
/* -------------------------------------------------------------------------- */

function Editor({
  factura,
  idFacilitadorInicial,
  facilitadores,
  otras,
  desde,
  hasta,
  sueldo,
  fotosHabilitadas,
  largoObservacion,
  onOcupado,
  onVolver,
}: {
  factura: Factura | null;
  idFacilitadorInicial: number | null;
  facilitadores: FacilitadorPeriodo[];
  /** Las facturas cargadas en la lista: para avisar de una que se pisa. */
  otras: Factura[];
  desde: string;
  hasta: string;
  sueldo: number;
  fotosHabilitadas: boolean;
  largoObservacion: number;
  onOcupado: (o: boolean) => void;
  onVolver: () => void;
}) {
  const qc = useQueryClient();
  const nueva = factura == null;

  // La subió el facilitador y falta completar cantidad y sueldo.
  const pendiente = factura != null && porRevisar(factura);

  const [idFac, setIdFac] = useState<number | null>(factura?.idFacilitador ?? idFacilitadorInicial);
  const [nro, setNro] = useState(factura?.nroFactura ?? "");
  const [timbrado, setTimbrado] = useState(factura?.timbrado ?? "");
  const [fecha, setFecha] = useState(factura?.fechaFactura ?? hoyISO());
  const [fDesde, setFDesde] = useState(factura?.fechaDesde ?? desde);
  const [fHasta, setFHasta] = useState(factura?.fechaHasta ?? hasta);
  // Una nueva o una por revisar (viene en 0) se completa sola con las
  // intervenciones del período de la factura; una ya revisada conserva la suya.
  const [cantidad, setCantidad] = useState(factura && !pendiente ? String(factura.cantidad) : "");
  const [cantidadTocada, setCantidadTocada] = useState(false);
  const [sueldoTxt, setSueldoTxt] = useState(
    factura && !pendiente ? String(factura.sueldo) : String(sueldo || ""),
  );
  const [obs, setObs] = useState(factura?.observacion ?? "");
  const [foto, setFoto] = useState(factura?.fotoUrl ?? "");
  const [progreso, setProgreso] = useState<number | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  // La foto en grande, sin salir del formulario: lo escrito no se pierde.
  const [viendoFoto, setViendoFoto] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const nombreFac = facilitadores.find((f) => f.id === idFac)?.nombre ?? factura?.facilitador ?? "";
  const nroFormateado = nro.trim() ? formatearNroFactura(nro) : null;
  const cant = Number(cantidad) || 0;
  const sue = Number(sueldoTxt) || 0;
  const periodoOk = !!fDesde && !!fHasta && fHasta >= fDesde;

  // Las intervenciones del facilitador en el período DE LA FACTURA (no el de
  // la pantalla), con Desarrollo: Sí, que son las que se pagan. Es el mismo
  // endpoint del reporte: con el mismo período comparte la caché.
  const contar = idFac != null && rangoValido({ desde: fDesde, hasta: fHasta });
  const delPeriodo = useQuery({
    queryKey: keysIntervenciones.resumenPeriodo(fDesde, fHasta, "Si"),
    queryFn: () => listarResumenPeriodo(fDesde, fHasta, "Si"),
    enabled: contar,
  });
  // `truncado`: el backend cortó la lista, el conteo no sería el real.
  const reporte =
    contar && delPeriodo.data && !delPeriodo.data.truncado
      ? delPeriodo.data.data.filter((x) => x.id_facilitador === idFac).length
      : undefined;
  // Si el período de la factura da 0, cuántas tiene en el de la pantalla: para
  // ofrecer pasarla ahí (la típica: el facilitador puso el mes siguiente).
  const otroPeriodo = fDesde !== desde || fHasta !== hasta;
  const delReporte = useQuery({
    queryKey: keysIntervenciones.resumenPeriodo(desde, hasta, "Si"),
    queryFn: () => listarResumenPeriodo(desde, hasta, "Si"),
    enabled: idFac != null && otroPeriodo && reporte === 0 && rangoValido({ desde, hasta }),
  });
  const enReporte =
    idFac != null && otroPeriodo && delReporte.data && !delReporte.data.truncado
      ? delReporte.data.data.filter((x) => x.id_facilitador === idFac).length
      : undefined;

  const autoCantidad = (nueva || pendiente) && !cantidadTocada;
  useEffect(() => {
    if (autoCantidad && reporte != null) setCantidad(String(reporte));
  }, [autoCantidad, reporte]);

  const pisada =
    idFac != null && periodoOk
      ? otras.find(
          (o) =>
            o.idFacilitador === idFac &&
            o.id !== factura?.id &&
            sePisan({ desde: fDesde, hasta: fHasta }, { desde: o.fechaDesde, hasta: o.fechaHasta }),
        )
      : undefined;
  const repetida =
    idFac != null && nroFormateado
      ? otras.find(
          (o) =>
            o.idFacilitador === idFac &&
            o.id !== factura?.id &&
            o.nroFactura === nroFormateado &&
            (o.timbrado || "") === timbrado.trim(),
        )
      : undefined;

  const falta = [
    idFac == null && "el facilitador",
    !nroFormateado && "el número",
    !fecha && "la fecha",
    !periodoOk && "el período",
    cant < 1 && "la cantidad",
    sue < 1 && "el sueldo",
  ].filter(Boolean) as string[];
  const listo = !falta.length && !pisada && !repetida && progreso == null;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysFacturas.todo });

  const guardar = useMutation({
    mutationFn: () => {
      const original = factura?.fotoUrl ?? "";
      return guardarFactura(factura?.id ?? null, {
        id_facilitador: idFac!,
        nro_factura: nroFormateado!,
        timbrado: timbrado.trim(),
        fecha_factura: fecha,
        fecha_desde: fDesde,
        fecha_hasta: fHasta,
        cantidad: cant,
        sueldo: sue,
        observacion: obs.trim(),
        // Vacío no la toca en el backend: solo se manda si cambió.
        foto_url: foto !== original ? foto : "",
        ...(original && !foto ? { quitar_foto: "S" as const } : {}),
      });
    },
    onMutate: () => onOcupado(true),
    onSettled: () => onOcupado(false),
    onSuccess: (r) => {
      invalidar();
      toast.success(nueva ? `Factura ${nroFormateado} registrada` : "Factura actualizada");
      // La factura quedó guardada; solo la foto anterior quedó en Cloudinary.
      if (r.aviso) toast.warning(r.aviso);
      onVolver();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarFactura(factura!.id),
    onMutate: () => onOcupado(true),
    onSettled: () => onOcupado(false),
    onSuccess: (r) => {
      invalidar();
      toast.success(`Factura ${factura!.nroFactura} eliminada`, {
        description: factura!.fotoUrl && !r.aviso ? "Y su foto, de Cloudinary." : undefined,
      });
      if (r.aviso) toast.warning(r.aviso);
      onVolver();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const subir = async (f: File) => {
    setProgreso(0);
    onOcupado(true);
    try {
      setFoto(await subirFotoFactura(f, setProgreso));
      toast.success(esPdf(f.name) || f.type === "application/pdf" ? "PDF subido" : "Foto subida", {
        description: "Se guarda con la factura.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setProgreso(null);
      onOcupado(false);
      if (archivo.current) archivo.current.value = "";
    }
  };

  const ocupado = guardar.isPending || borrar.isPending || progreso != null;
  const titulo = nueva ? "Nueva factura" : `Factura ${factura.nroFactura}`;

  // El diálogo, en el formulario, es una columna: el contenido scrollea y el
  // pie con Guardar / Eliminar queda SIEMPRE a la vista (ver DialogoFacturas).
  return viendoFoto && foto ? (
    <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6">
      <VerFoto
        url={foto}
        titulo={titulo}
        archivo={nombreArchivoFactura(fecha, nroFormateado ?? nro.trim(), foto)}
        volverTexto={titulo}
        onVolver={() => setViendoFoto(false)}
      />
    </div>
  ) : (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (listo) guardar.mutate();
      }}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div className="-mx-6 min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-1">
        <DialogHeader className="text-left">
          <Volver onClick={onVolver} />
          <DialogTitle className="font-display text-xl">{titulo}</DialogTitle>
          <DialogDescription className="text-xs">
            {nombreFac || "Elegí el facilitador."}
            {factura?.cargadoEl &&
              ` · cargada el ${fechaHora(factura.cargadoEl)}${factura.cargadoPor ? ` por ${factura.cargadoPor}` : ""}`}
            {factura?.modificadoEl &&
              ` · modificada el ${fechaHora(factura.modificadoEl)}${factura.modificadoPor ? ` por ${factura.modificadoPor}` : ""}`}
          </DialogDescription>
        </DialogHeader>

        {pendiente && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              <b>Por revisar.</b> La subió el facilitador desde su app: controlá con la foto el
              número, la fecha y el mes, y completá las intervenciones y el sueldo. Al guardar queda
              revisada y el facilitador ya no la puede cambiar.
            </span>
          </p>
        )}

        <fieldset disabled={ocupado} className="space-y-4">
          {nueva && idFacilitadorInicial == null && (
            <SelectorModal
              label="Facilitador"
              descripcion="Los que tienen intervenciones en el período"
              requerido
              buscador
              value={idFac == null ? "" : String(idFac)}
              onChange={(v) => setIdFac(Number(v) || null)}
              opciones={facilitadores.map((f) => ({
                valor: String(f.id),
                texto: f.nombre,
                extra: plural(f.cantidad, "intervención", "intervenciones"),
              }))}
              placeholder="Elegí el facilitador"
            />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto
              etiqueta="Número de factura"
              req
              largo={20}
              valor={nro}
              onCambio={setNro}
              inputMode="numeric"
              placeholder="001-001-0000123"
              ayuda={
                !nro.trim() ? undefined : !nroFormateado ? (
                  <span className="text-destructive">Va con el formato 001-001-0000123.</span>
                ) : repetida ? (
                  <span className="text-destructive">Esa factura ya está cargada.</span>
                ) : nroFormateado !== nro.trim() ? (
                  `Se guarda como ${nroFormateado}.`
                ) : undefined
              }
            />
            <Texto
              etiqueta="Timbrado"
              largo={20}
              valor={timbrado}
              onCambio={(v) => setTimbrado(v.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Opcional"
            />
            <Texto
              etiqueta="Fecha de la factura"
              req
              tipo="date"
              valor={fecha}
              onCambio={setFecha}
            />
          </div>

          <div>
            <div className="grid grid-cols-2 gap-3">
              <Texto etiqueta="Cubre desde" req tipo="date" valor={fDesde} onCambio={setFDesde} />
              <Texto etiqueta="Hasta" req tipo="date" valor={fHasta} onCambio={setFHasta} />
            </div>
            {fDesde && fHasta && fHasta < fDesde ? (
              <p className="mt-1 text-xs text-destructive">
                La fecha hasta no puede ser anterior a la desde.
              </p>
            ) : pisada ? (
              <p className="mt-1 text-xs text-destructive">
                Se pisa con la factura {pisada.nroFactura}, que cubre del{" "}
                {fechaCorta(pisada.fechaDesde)} al {fechaCorta(pisada.fechaHasta)}.
              </p>
            ) : (
              (fDesde !== desde || fHasta !== hasta) && (
                <button
                  type="button"
                  onClick={() => {
                    setFDesde(desde);
                    setFHasta(hasta);
                  }}
                  className="mt-1 text-[11.5px] font-medium text-primary hover:underline"
                >
                  Usar el período del reporte ({fechaCorta(desde)} al {fechaCorta(hasta)})
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Texto
              etiqueta="Intervenciones"
              req
              largo={5}
              valor={cantidad}
              onCambio={(v) => {
                setCantidadTocada(true);
                setCantidad(v.replace(/\D/g, ""));
              }}
              inputMode="numeric"
              ayuda={
                !contar ? undefined : delPeriodo.isFetching && reporte == null ? (
                  "Contando las intervenciones del período…"
                ) : delPeriodo.isError ? (
                  <span className="text-destructive">
                    No se pudieron contar las intervenciones.
                  </span>
                ) : delPeriodo.data?.truncado ? (
                  "El período es muy largo para contarlas: cargala a mano."
                ) : reporte == null ? undefined : reporte === cant ? (
                  `Las ${numero.format(reporte)} del período (Desarrollo: Sí).`
                ) : (
                  <button
                    type="button"
                    onClick={() => setCantidad(String(reporte))}
                    className="font-medium text-primary hover:underline"
                  >
                    El período da {numero.format(reporte)}: usar
                  </button>
                )
              }
            />
            <label className="block">
              <EtiquetaCampo texto="Sueldo por intervención" req />
              <input
                inputMode="numeric"
                value={sue ? numero.format(sue) : sueldoTxt}
                onChange={(e) => setSueldoTxt(e.target.value.replace(/\D/g, ""))}
                className={campo}
              />
            </label>
            <div>
              <EtiquetaCampo texto="Monto" />
              <p className="flex h-12 items-center rounded-xl bg-muted/50 px-3.5 text-base font-bold tabular-nums">
                {numero.format(cant * sue)}
              </p>
            </div>
          </div>

          {reporte === 0 && (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-px size-4 shrink-0" />
                <span>
                  {nombreFac || "El facilitador"} no tiene intervenciones del {fechaCorta(fDesde)}{" "}
                  al {fechaCorta(fHasta)}: por eso Intervenciones y Monto dan 0 y no se puede
                  guardar. Revisá con la foto qué período cubre la factura.
                </span>
              </p>
              {enReporte != null && enReporte > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFDesde(desde);
                    setFHasta(hasta);
                    setCantidadTocada(false);
                  }}
                  className="flex min-h-9 w-full items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Pasar la factura al {fechaCorta(desde)} al {fechaCorta(hasta)} (
                  {plural(enReporte, "intervención", "intervenciones")})
                </button>
              )}
            </div>
          )}

          <Texto
            etiqueta="Observación"
            multilinea
            largo={largoObservacion}
            valor={obs}
            onCambio={setObs}
          />
        </fieldset>

        <CampoFoto
          foto={foto}
          progreso={progreso}
          habilitada={fotosHabilitadas}
          sinConfigurar={!fotosHabilitadas}
          deshabilitado={ocupado}
          onElegir={() => archivo.current?.click()}
          onQuitar={() => setFoto("")}
          onVer={() => setViendoFoto(true)}
          archivo={nombreArchivoFactura(fecha, nroFormateado ?? nro.trim(), foto)}
        />
        <input
          ref={archivo}
          type="file"
          accept={TIPOS_FOTO}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
      </div>

      {/* El pie, fuera del scroll: Guardar y Eliminar siempre a la vista. */}
      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <div className="flex gap-2">
          {!nueva && (
            <BotonBorrar
              confirmar={confirmarBorrado}
              pendiente={borrar.isPending}
              deshabilitado={ocupado}
              onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
            />
          )}
          <button
            type="submit"
            disabled={!listo || ocupado}
            title={falta.length ? `Falta ${falta.join(", ")}` : undefined}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            {nueva ? "Registrar factura" : pendiente ? "Guardar como revisada" : "Guardar cambios"}
          </button>
        </div>
        {falta.length > 0 && (
          <p className="text-center text-[11.5px] text-muted-foreground">
            Falta {falta.join(", ")}.
          </p>
        )}
      </div>
    </form>
  );
}

function CampoFoto({
  foto,
  progreso,
  habilitada,
  sinConfigurar,
  deshabilitado,
  onElegir,
  onQuitar,
  onVer,
  archivo,
}: {
  foto: string;
  progreso: number | null;
  /** Si se puede subir o cambiar (Cloudinary configurado). */
  habilitada: boolean;
  sinConfigurar: boolean;
  deshabilitado: boolean;
  onElegir: () => void;
  onQuitar: () => void;
  onVer: () => void;
  /** El nombre con que se descarga. */
  archivo: string;
}) {
  let contenido: ReactNode;
  if (progreso != null) {
    contenido = (
      <div className="flex items-center gap-3 rounded-xl border border-border p-3">
        <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Subiendo… {progreso}%</p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${progreso}%` }} />
          </div>
        </div>
      </div>
    );
  } else if (foto) {
    contenido = (
      <div className="flex items-center gap-3 rounded-xl border border-border p-2">
        <button
          type="button"
          onClick={onVer}
          aria-label="Ver la foto"
          className="relative size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
        >
          <img src={miniatura(foto, 200)} alt="" className="size-full object-cover" />
          {esPdf(foto) && (
            <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
              PDF
            </span>
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <button
            type="button"
            onClick={onVer}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-input px-3 text-sm font-medium hover:border-primary/40"
          >
            <FileText className="size-4" />
            Ver
          </button>
          <BotonDescargar
            url={foto}
            archivo={archivo}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-input px-3 text-sm font-medium hover:border-primary/40 disabled:opacity-50"
            icono="size-4"
          />
          {habilitada && (
            <>
              <button
                type="button"
                onClick={onElegir}
                disabled={deshabilitado}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-input px-3 text-sm font-medium hover:border-primary/40 disabled:opacity-50"
              >
                <ImagePlus className="size-4" />
                Cambiar
              </button>
              <button
                type="button"
                onClick={onQuitar}
                disabled={deshabilitado}
                className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <X className="size-4" />
                Quitar
              </button>
            </>
          )}
        </div>
      </div>
    );
  } else if (habilitada) {
    contenido = (
      <button
        type="button"
        onClick={onElegir}
        disabled={deshabilitado}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-5 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
      >
        <ImagePlus className="size-5" />
        Subir la foto o el PDF (la foto se achica sola a menos de {TOPE_FOTO_KB} KB; PDF hasta{" "}
        {TOPE_PDF_MB} MB)
      </button>
    );
  } else {
    contenido = (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <ReceiptText className="size-4 shrink-0" />
        {sinConfigurar
          ? "Subir fotos todavía no está habilitado: falta configurar Cloudinary en el backend."
          : "Sin foto."}
      </p>
    );
  }

  return (
    <div>
      <EtiquetaCampo texto="Foto de la factura" />
      {contenido}
    </div>
  );
}
