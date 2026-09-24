import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  Info,
  KeyRound,
  Loader2,
  RotateCcw,
  Search,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  alertasTabla,
  claveRegistro,
  coberturaColumnas,
  ESTADO_COLUMNA,
  esOperacion,
  estadoColumna,
  estadoRegistro,
  formatearFechaHora,
  formatearValor,
  keysAuditoria,
  labelOperacion,
  listarMovimientos,
  listarTablas,
  META_AUDITORIA,
  OPERACIONES,
  obtenerHistorial,
  reconstruir,
  textoConvencion,
  type Cambio,
  type ColumnaHistorial,
  type EstadoColumna,
  type FiltrosMovimientos,
  type Movimiento,
  type Operacion,
  type Paso,
  type TablaAuditada,
  type Valores,
} from "@/lib/auditoria";

export const Route = createFileRoute("/auditoria/")({
  head: () => ({
    meta: [
      { title: "Auditoría — Juventud con Valores" },
      { name: "description", content: "Tablas auditadas y movimientos de la bitácora." },
    ],
  }),
  component: AuditoriaPage,
});

/** La medida de un campo de filtro. Misma que en Agendas: ver `ALTO_CAMPO` ahí. */
const ALTO_CAMPO = "h-11 px-3.5 text-sm";

/** Filas por página de movimientos. */
const POR_PAGINA = 50;

type Vista = "tablas" | "movimientos";

/**
 * Los filtros de Movimientos **tal como se tipean**. Viven en la página y no
 * en la vista para que pasar a "Tablas" y volver no los borre.
 */
type FiltrosUI = {
  /** Texto a buscar en cualquier campo de datos. */
  buscar: string;
  tabla: string;
  operacion: string;
  usuario: string;
  desde: string;
  hasta: string;
  idAuditoria: string;
};

const SIN_FILTROS: FiltrosUI = {
  buscar: "",
  tabla: "",
  operacion: "",
  usuario: "",
  desde: "",
  hasta: "",
  idAuditoria: "",
};

/** El registro cuyo historial se está mirando, y qué movimiento resaltar. */
type Seleccion = { tabla: string; id: number; rid?: string };

/**
 * Consulta de auditoría: qué tablas tienen bitácora y qué pasó en ellas.
 *
 * ## DOS VISTAS
 *
 * - **Tablas**: cada tabla auditada con su trigger y sus columnas cruzadas
 *   contra la bitácora. Sirve para saber si la auditoría FUNCIONA — un trigger
 *   inválido o una columna agregada después de auditar no dan ningún error en
 *   el resto de la app.
 * - **Movimientos**: la bitácora de todas las tablas en una lista. Sirve para
 *   saber QUIÉN cambió QUÉ.
 *
 * Tocar un movimiento abre la historia completa de ese registro, con el antes
 * y el después de cada cambio. El diff lo arma `reconstruir` en
 * `lib/auditoria.ts`, que es donde está explicada la trampa de las dos
 * convenciones de trigger.
 */
function AuditoriaPage() {
  const [vista, setVista] = useState<Vista>("tablas");
  const [filtros, setFiltros] = useState<FiltrosUI>(SIN_FILTROS);
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<TablaAuditada | null>(null);
  const [historial, setHistorial] = useState<Seleccion | null>(null);

  // Las dos vistas la usan: Tablas la lista, Movimientos arma el combo de tabla.
  const tablas = useQuery({
    queryKey: keysAuditoria.tablas(),
    queryFn: listarTablas,
    meta: META_AUDITORIA,
  });

  /** Cambiar un filtro vuelve a la página 1: la 4 de otro filtro no existe. */
  const cambiar = (clave: keyof FiltrosUI, valor: string) => {
    setFiltros((f) => ({ ...f, [clave]: valor }));
    setPagina(1);
  };

  const limpiar = () => {
    setFiltros(SIN_FILTROS);
    setPagina(1);
  };

  const verMovimientosDe = (tabla: string) => {
    setFiltros({ ...SIN_FILTROS, tabla });
    setPagina(1);
    setDetalle(null);
    setVista("movimientos");
  };

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-bold">Auditoría</h1>
          <p className="text-xs text-muted-foreground">
            Tablas auditadas y movimientos de la bitácora
          </p>
        </div>

        <SelectorVista vista={vista} onChange={setVista} />

        {vista === "tablas" ? (
          <VistaTablas
            tablas={tablas.data}
            cargando={tablas.isLoading}
            error={tablas.isError ? tablas.error : null}
            onVer={setDetalle}
          />
        ) : (
          <VistaMovimientos
            tablas={tablas.data ?? []}
            filtros={filtros}
            pagina={pagina}
            onCambiar={cambiar}
            onLimpiar={limpiar}
            onPagina={setPagina}
            onVer={setHistorial}
          />
        )}
      </div>

      <DetalleTabla
        t={detalle}
        onClose={() => setDetalle(null)}
        onVerMovimientos={verMovimientosDe}
      />
      <DialogHistorial sel={historial} onClose={() => setHistorial(null)} />
    </AppShell>
  );
}

function SelectorVista({ vista, onChange }: { vista: Vista; onChange: (v: Vista) => void }) {
  const opciones: { valor: Vista; texto: string }[] = [
    { valor: "tablas", texto: "Tablas" },
    { valor: "movimientos", texto: "Movimientos" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Vista"
      className="mb-4 inline-flex rounded-xl border border-border/60 bg-card p-1 shadow-soft"
    >
      {opciones.map((o) => {
        const activa = vista === o.valor;
        return (
          <button
            key={o.valor}
            role="tab"
            aria-selected={activa}
            onClick={() => onChange(o.valor)}
            className={`tap h-9 rounded-lg px-4 text-sm font-medium transition-colors ${
              activa
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vista: Tablas                                                              */
/* -------------------------------------------------------------------------- */

function VistaTablas({
  tablas,
  cargando,
  error,
  onVer,
}: {
  tablas: TablaAuditada[] | undefined;
  cargando: boolean;
  error: Error | null;
  onVer: (t: TablaAuditada) => void;
}) {
  const [texto, setTexto] = useState("");

  const visibles = useMemo(() => {
    const q = texto.trim().toUpperCase();
    return (tablas ?? []).filter((t) => !q || t.tabla.includes(q));
  }, [tablas, texto]);

  if (cargando) return <Cargando />;
  if (error) return <ErrorCarga error={error} />;
  if (!tablas?.length) {
    return (
      <Vacio
        icono={Database}
        texto="No hay tablas auditadas. Una tabla se audita con pr_crear_trigger_auditoria."
      />
    );
  }

  const total = tablas.reduce((s, t) => s + (t.movimientos ?? 0), 0);
  const conProblemas = tablas.filter((t) => alertasTabla(t).length > 0).length;

  return (
    <>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar tabla…"
          aria-label="Buscar tabla"
          className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-sm outline-none focus:border-primary/40"
        />
        {texto && (
          <button
            onClick={() => setTexto("")}
            aria-label="Limpiar búsqueda"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        {tablas.length} tabla{tablas.length === 1 ? "" : "s"} auditada
        {tablas.length === 1 ? "" : "s"} · {fmt(total)} movimientos
        {conProblemas > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {" "}
            · {conProblemas} para revisar
          </span>
        )}
      </p>

      {!visibles.length ? (
        <Vacio icono={Database} texto="Ninguna tabla coincide con la búsqueda." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 min-[1700px]:grid-cols-4">
          {visibles.map((t) => (
            <TarjetaTabla key={t.tabla} t={t} onVer={() => onVer(t)} />
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Una tabla auditada. Arriba lo que dice si la auditoría anda —el estado—, y
 * abajo cuánto se usa. Los problemas se listan en la tarjeta misma: son la
 * razón de ser de esta vista y no pueden quedar escondidos detrás de un toque.
 */
function TarjetaTabla({ t, onVer }: { t: TablaAuditada; onVer: () => void }) {
  const alertas = alertasTabla(t);
  const { auditadas, total } = coberturaColumnas(t);

  return (
    <li>
      <button
        onClick={onVer}
        className="tap h-full w-full rounded-2xl border border-border/60 bg-card p-4 text-left shadow-soft hover:border-primary/40"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold">{t.tabla}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t.clave ? `Clave: ${t.clave}` : "Sin clave primaria"}
            </p>
          </div>
          <EstadoTabla t={t} />
        </div>

        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-bold">{fmt(t.movimientos)}</span>
          <span className="text-xs text-muted-foreground">movimientos</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Conteo op="INS" n={t.inserciones} />
          <Conteo op="UPD" n={t.actualizaciones} />
          <Conteo op="DEL" n={t.eliminaciones} />
        </div>

        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Último movimiento</dt>
            <dd className="font-medium">{formatearFechaHora(t.ultimo_movimiento)}</dd>
          </div>
          {t.existe_tabla && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Columnas auditadas</dt>
              <dd
                className={`font-medium ${
                  auditadas < total ? "text-amber-700 dark:text-amber-400" : ""
                }`}
              >
                {auditadas} de {total}
              </dd>
            </div>
          )}
        </dl>

        {alertas.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border/50 pt-2.5">
            {alertas.map((a) => (
              <li
                key={a.texto}
                className={`flex items-start gap-1.5 text-[11px] font-medium ${
                  a.nivel === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"
                }`}
              >
                <AlertTriangle className="mt-px size-3 shrink-0" />
                {a.texto}
              </li>
            ))}
          </ul>
        )}
      </button>
    </li>
  );
}

function EstadoTabla({ t }: { t: TablaAuditada }) {
  const alertas = alertasTabla(t);
  const [texto, tono] = !t.existe_tabla
    ? ["Sin tabla", TONO.neutro]
    : alertas.some((a) => a.nivel === "error")
      ? ["Con errores", TONO.error]
      : alertas.length
        ? ["Revisar", TONO.aviso]
        : ["Al día", TONO.ok];
  return <Chip tono={tono}>{texto}</Chip>;
}

function Conteo({ op, n }: { op: Operacion; n: number | null }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${TONO_OPERACION[op]}`}>
      {OPERACIONES[op].label} {fmt(n)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalle de una tabla                                                       */
/* -------------------------------------------------------------------------- */

const TONO_ESTADO_COLUMNA: Record<EstadoColumna, string> = {
  auditada: "bg-primary-soft text-primary",
  control: "bg-muted text-muted-foreground",
  historica: "bg-muted text-muted-foreground",
  sin_trigger: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  sin_jn: "bg-destructive/10 text-destructive",
};

/**
 * Todo lo que se sabe de la auditoría de una tabla: sus triggers, sus números
 * y cada columna cruzada contra la bitácora y el trigger.
 *
 * Cuando hay columnas sin auditar dice CÓMO arreglarlo, porque la pantalla es
 * de consulta y el arreglo es un comando en APEX: sin el comando a la vista,
 * el aviso no sirve de mucho.
 */
function DetalleTabla({
  t,
  onClose,
  onVerMovimientos,
}: {
  t: TablaAuditada | null;
  onClose: () => void;
  onVerMovimientos: (tabla: string) => void;
}) {
  if (!t) return null;

  const alertas = alertasTabla(t);
  const { auditadas, total } = coberturaColumnas(t);
  const estados = new Set(t.columnas.map(estadoColumna));
  const hayQueArreglar = estados.has("sin_jn") || estados.has("sin_trigger");
  // Solo las tablas con el trigger del procedimiento se arreglan con él. La de
  // evaluaciones tiene el suyo escrito a mano: correr el procedimiento ahí le
  // crearía un segundo trigger.
  const generada = t.triggers.some((tr) => tr.nombre === `AUDITORIA_${t.tabla}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-mono text-lg break-all">{t.tabla}</DialogTitle>
          <DialogDescription>
            Bitácora {t.tabla_jn}
            {t.clave && ` · clave ${t.clave}`}
          </DialogDescription>
        </DialogHeader>

        {alertas.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
            {alertas.map((a) => (
              <li
                key={a.texto}
                className={`flex items-start gap-2 text-xs font-medium ${
                  a.nivel === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-400"
                }`}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {a.texto}
              </li>
            ))}
          </ul>
        )}

        {/* ── Números ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Numero label="Movimientos" valor={t.movimientos} />
          <Numero label={OPERACIONES.INS.label + "s"} valor={t.inserciones} />
          <Numero label={OPERACIONES.UPD.label + "es"} valor={t.actualizaciones} />
          <Numero label={OPERACIONES.DEL.label + "s"} valor={t.eliminaciones} />
        </div>
        <p className="text-xs text-muted-foreground">
          Desde {formatearFechaHora(t.primer_movimiento)} hasta{" "}
          {formatearFechaHora(t.ultimo_movimiento)}
        </p>

        {/* ── Triggers ────────────────────────────────────────────────── */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Trigger{t.triggers.length === 1 ? "" : "s"}
          </h3>
          {!t.triggers.length ? (
            <p className="text-xs text-muted-foreground">
              {t.existe_tabla
                ? "Ningún trigger escribe esta bitácora: los cambios no se anotan."
                : "La tabla ya no existe."}
            </p>
          ) : (
            <ul className="space-y-2">
              {t.triggers.map((tr) => (
                <li key={tr.nombre} className="rounded-xl border border-border/60 p-3">
                  <p className="font-mono text-[12px] font-semibold break-all">{tr.nombre}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Chip tono={tr.habilitado ? TONO.ok : TONO.error}>
                      {tr.habilitado ? "Habilitado" : "Deshabilitado"}
                    </Chip>
                    <Chip tono={tr.valido ? TONO.ok : TONO.error}>
                      {tr.valido ? "Válido" : "Inválido"}
                    </Chip>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {textoConvencion(tr.guarda_en_update)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Columnas ────────────────────────────────────────────────── */}
        <section>
          <h3 className="mb-2 text-sm font-semibold">
            Columnas
            {t.existe_tabla && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {auditadas} de {total} auditadas
              </span>
            )}
          </h3>
          <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
            {t.columnas.map((c) => {
              const e = estadoColumna(c);
              return (
                <li key={c.columna} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-mono text-[12px] font-medium break-all">
                      {c.es_pk && (
                        <KeyRound
                          className="size-3 shrink-0 text-primary"
                          aria-label="Clave primaria"
                        />
                      )}
                      {c.columna}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.tipo}
                      {!c.nulable && " · obligatoria"}
                    </p>
                  </div>
                  <span
                    title={ESTADO_COLUMNA[e].ayuda}
                    className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${TONO_ESTADO_COLUMNA[e]}`}
                  >
                    {ESTADO_COLUMNA[e].label}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* La leyenda, solo de los estados que aparecen: en una tabla sana
              no hay nada que explicar. */}
          <ul className="mt-2 space-y-0.5">
            {(["sin_jn", "sin_trigger", "historica"] as const)
              .filter((e) => estados.has(e))
              .map((e) => (
                <li key={e} className="text-[11px] text-muted-foreground">
                  <span className="font-semibold">{ESTADO_COLUMNA[e].label}:</span>{" "}
                  {ESTADO_COLUMNA[e].ayuda}.
                </li>
              ))}
          </ul>

          {hayQueArreglar && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 text-xs">
                {generada ? (
                  <>
                    <p>Para sumarlas, correr en APEX (SQL Commands):</p>
                    <p className="mt-1 font-mono text-[11px] break-all">
                      BEGIN pr_crear_trigger_auditoria('{t.tabla}'); END;
                    </p>
                  </>
                ) : (
                  <p>
                    El trigger de esta tabla está escrito a mano: las columnas se suman en su propio
                    script de <span className="font-mono">backend/</span>, no con
                    pr_crear_trigger_auditoria.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <button
          onClick={() => onVerMovimientos(t.tabla)}
          className="tap flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
        >
          <History className="size-4" />
          Ver movimientos de esta tabla
        </button>
      </DialogContent>
    </Dialog>
  );
}

function Numero({ label, valor }: { label: string; valor: number | null }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold">{fmt(valor)}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vista: Movimientos                                                         */
/* -------------------------------------------------------------------------- */

/**
 * La bitácora de todas las tablas, de lo más nuevo a lo más viejo.
 *
 * Paginada con "Anterior / Siguiente", a diferencia de Agendas: una agenda se
 * acota con los filtros, pero la bitácora crece sin techo y es normal querer
 * recorrerla hacia atrás.
 */
function VistaMovimientos({
  tablas,
  filtros,
  pagina,
  onCambiar,
  onLimpiar,
  onPagina,
  onVer,
}: {
  tablas: TablaAuditada[];
  filtros: FiltrosUI;
  pagina: number;
  onCambiar: (clave: keyof FiltrosUI, valor: string) => void;
  onLimpiar: () => void;
  onPagina: (p: number) => void;
  onVer: (s: Seleccion) => void;
}) {
  // Los campos que se tipean esperan a que se termine de escribir: sin esto
  // cada tecla dispara un UNION ALL sobre todas las bitácoras.
  const buscar = useDemorado(filtros.buscar.trim(), 350);
  const usuario = useDemorado(filtros.usuario.trim(), 350);
  const idTexto = useDemorado(filtros.idAuditoria.trim(), 350);

  const f: FiltrosMovimientos = {
    buscar: buscar || undefined,
    tabla: filtros.tabla || undefined,
    operacion: esOperacion(filtros.operacion) ? filtros.operacion : undefined,
    usuario: usuario || undefined,
    desde: filtros.desde || undefined,
    hasta: filtros.hasta || undefined,
    id_auditoria: /^\d+$/.test(idTexto) ? Number(idTexto) : undefined,
    limite: POR_PAGINA,
    pagina,
  };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: keysAuditoria.movimientos(f),
    queryFn: () => listarMovimientos(f),
    meta: META_AUDITORIA,
    // Sin esto la lista se vacía y vuelve a aparecer en cada cambio de página.
    placeholderData: (previa) => previa,
  });

  const filas = data?.data ?? [];
  const paginas = data ? Math.max(1, Math.ceil(data.total / data.limite)) : 1;
  const activos = Object.values(filtros).filter(Boolean).length;

  return (
    <>
      {/* Busca en los DATOS de cada bitácora; las columnas de control (quién,
          cuándo, qué operación) tienen sus propios filtros abajo. */}
      <div className="mb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filtros.buscar}
            onChange={(e) => onCambiar("buscar", e.target.value)}
            placeholder="Buscar en cualquier campo…"
            aria-label="Buscar en cualquier campo de la bitácora"
            className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-sm outline-none focus:border-primary/40"
          />
          {filtros.buscar && (
            <button
              onClick={() => onCambiar("buscar", "")}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {/* Solo mientras se busca, que es cuando importa: buscar el nombre de
            un facilitador no encuentra nada, porque la bitácora guarda su ID. */}
        {filtros.buscar && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Busca en todos los campos de cada tabla. Lo que apunta a otra tabla (un facilitador, una
            institución) está guardado por su ID: se encuentra por el número, no por el nombre.
          </p>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Filtros</p>
        {activos > 0 && (
          <button
            onClick={onLimpiar}
            aria-label={`Limpiar ${activos} filtro${activos === 1 ? "" : "s"}`}
            className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
          >
            <RotateCcw className="size-3.5" />
            Limpiar ({activos})
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-x-3 gap-y-3.5 min-[380px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
        <SelectorModal
          label="Tabla"
          value={filtros.tabla}
          onChange={(v) => onCambiar("tabla", v)}
          placeholder="Todas"
          descripcion="Las tablas con bitácora"
          buscador
          opciones={[
            { valor: "", texto: "Todas" },
            ...tablas.map((t) => ({
              valor: t.tabla,
              texto: t.tabla,
              extra: t.movimientos != null ? `${fmt(t.movimientos)} movimientos` : undefined,
            })),
          ]}
          className={ALTO_CAMPO}
        />
        <SelectorModal
          label="Operación"
          value={filtros.operacion}
          onChange={(v) => onCambiar("operacion", v)}
          placeholder="Todas"
          opciones={[
            { valor: "", texto: "Todas" },
            ...(Object.keys(OPERACIONES) as Operacion[]).map((op) => ({
              valor: op,
              texto: OPERACIONES[op].label,
              extra: op,
            })),
          ]}
          className={ALTO_CAMPO}
        />
        <CampoTexto
          id="aud-usuario"
          label="Usuario"
          value={filtros.usuario}
          onChange={(v) => onCambiar("usuario", v)}
          placeholder="Contiene…"
        />
        <CampoFecha
          id="aud-desde"
          label="Desde"
          value={filtros.desde}
          onChange={(v) => onCambiar("desde", v)}
        />
        <CampoFecha
          id="aud-hasta"
          label="Hasta"
          value={filtros.hasta}
          onChange={(v) => onCambiar("hasta", v)}
        />
        <CampoTexto
          id="aud-id"
          label="ID de auditoría"
          value={filtros.idAuditoria}
          onChange={(v) => onCambiar("idAuditoria", v.replace(/\D/g, ""))}
          placeholder="Un registro"
          inputMode="numeric"
        />
      </div>

      {isLoading ? (
        <Cargando />
      ) : isError ? (
        <ErrorCarga error={error} />
      ) : !filas.length ? (
        <Vacio
          icono={History}
          texto={
            activos ? "Ningún movimiento coincide con los filtros." : "La bitácora está vacía."
          }
        />
      ) : (
        <>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {fmt(data!.total)} movimiento{data!.total === 1 ? "" : "s"}
            {paginas > 1 && ` · página ${data!.pagina} de ${paginas}`}
            {isFetching && <Loader2 className="size-3 animate-spin" />}
          </p>

          <ul className="space-y-2 lg:hidden">
            {filas.map((m) => (
              <TarjetaMovimiento key={m.tabla + m.rid} m={m} onVer={onVer} />
            ))}
          </ul>
          <TablaMovimientos filas={filas} onVer={onVer} />

          {paginas > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                onClick={() => onPagina(pagina - 1)}
                disabled={pagina <= 1}
                className="tap flex h-10 items-center gap-1 rounded-lg border border-border/60 bg-card px-3 text-sm font-medium disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
                Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                {pagina} / {paginas}
              </span>
              <button
                onClick={() => onPagina(pagina + 1)}
                disabled={pagina >= paginas}
                className="tap flex h-10 items-center gap-1 rounded-lg border border-border/60 bg-card px-3 text-sm font-medium disabled:opacity-40"
              >
                Siguiente
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Qué abrir al tocar un movimiento. `null` si esa bitácora no permite seguirlo. */
function seleccion(m: Movimiento): Seleccion | null {
  return m.id_auditoria != null ? { tabla: m.tabla, id: m.id_auditoria, rid: m.rid } : null;
}

function TarjetaMovimiento({ m, onVer }: { m: Movimiento; onVer: (s: Seleccion) => void }) {
  const sel = seleccion(m);
  return (
    <li>
      <button
        onClick={() => sel && onVer(sel)}
        disabled={!sel}
        className="tap w-full rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft disabled:cursor-default"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <BadgeOperacion op={m.operacion} />
            <span className="truncate font-mono text-[12px] font-semibold">{m.tabla}</span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatearFechaHora(m.fecha)}
          </span>
        </div>
        <p className="mt-1.5 truncate text-[13px] font-medium">
          {m.clave ?? (m.id_auditoria != null ? `ID de auditoría ${m.id_auditoria}` : "—")}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <User className="size-3 shrink-0" />
          {m.usuario ?? "—"}
          {m.aplicacion && <span className="truncate"> · {m.aplicacion}</span>}
        </p>
      </button>
    </li>
  );
}

function TablaMovimientos({
  filas,
  onVer,
}: {
  filas: Movimiento[];
  onVer: (s: Seleccion) => void;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-soft lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="sticky top-0 border-b border-border/60 bg-muted/50 text-left text-xs">
            <Th>Fecha</Th>
            <Th>Tabla</Th>
            <Th>Operación</Th>
            <Th>Registro</Th>
            <Th>Usuario</Th>
            <Th>Aplicación</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => {
            const sel = seleccion(m);
            return (
              <tr
                key={m.tabla + m.rid}
                onClick={() => sel && onVer(sel)}
                className={`border-b border-border/40 last:border-0 ${
                  sel ? "cursor-pointer hover:bg-muted/40" : ""
                }`}
              >
                <Td className="whitespace-nowrap">{formatearFechaHora(m.fecha, true)}</Td>
                <Td className="font-mono text-[12px]">{m.tabla}</Td>
                <Td>
                  <BadgeOperacion op={m.operacion} />
                </Td>
                <Td>
                  {m.clave ?? (
                    <span className="text-muted-foreground">
                      {m.id_auditoria != null ? `ID auditoría ${m.id_auditoria}` : "—"}
                    </span>
                  )}
                </Td>
                <Td>{m.usuario ?? "—"}</Td>
                <Td className="text-muted-foreground">{m.aplicacion ?? "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Historial de un registro                                                   */
/* -------------------------------------------------------------------------- */

const ESTADO_REGISTRO = {
  vigente: { texto: "Vigente", tono: "ok" },
  eliminado: { texto: "Eliminado", tono: "error" },
  sin_tabla: { texto: "Tabla eliminada", tono: "neutro" },
  ausente: { texto: "Ya no está en la tabla", tono: "aviso" },
} as const;

/**
 * La vida completa de un registro, del cambio más nuevo al más viejo.
 *
 * El movimiento desde el que se abrió va resaltado: se llega acá buscando UN
 * cambio y el resto es contexto.
 */
function DialogHistorial({ sel, onClose }: { sel: Seleccion | null; onClose: () => void }) {
  const {
    data: h,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: keysAuditoria.historial(sel?.tabla ?? "", sel?.id ?? 0),
    queryFn: () => obtenerHistorial(sel!.tabla, sel!.id),
    enabled: !!sel,
    meta: META_AUDITORIA,
  });

  // Del más nuevo al más viejo, igual que la lista de movimientos.
  const pasos = useMemo(() => (h ? reconstruir(h).reverse() : []), [h]);

  if (!sel) return null;

  const estado = h ? ESTADO_REGISTRO[estadoRegistro(h)] : null;
  const clave = h ? claveRegistro(h) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-mono text-lg break-all">{sel.tabla}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{clave ?? `ID de auditoría ${sel.id}`}</span>
            {clave && <span className="text-muted-foreground">· ID de auditoría {sel.id}</span>}
            {estado && <Chip tono={TONO[estado.tono]}>{estado.texto}</Chip>}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <ErrorCarga error={error} />
        ) : h && !h.eventos.length ? (
          <Vacio icono={History} texto="Este registro no tiene movimientos en la bitácora." />
        ) : h ? (
          <>
            {h.guarda_en_update === null && (
              <Nota>
                No se pudo deducir qué guarda el trigger en las modificaciones. Los cambios se
                muestran suponiendo que guarda el valor nuevo.
              </Nota>
            )}
            {h.eventos.length >= h.max_eventos && (
              <Nota>
                Se muestran los primeros {h.max_eventos} movimientos del registro: hay más.
              </Nota>
            )}

            <ol className="space-y-2.5">
              {pasos.map((p) => (
                <PasoHistorial
                  key={p.evento.rid}
                  paso={p}
                  columnas={h.columnas}
                  destacado={p.evento.rid === sel.rid}
                />
              ))}
            </ol>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Un movimiento del historial, con TODOS los campos de la fila.
 *
 * Los que cambiaron van resaltados, con el valor de antes y el de después; el
 * resto muestra el suyo. Hasta el 24/09/2026 un cambio mostraba solo las
 * columnas modificadas y la fila completa quedaba detrás de un "Ver": se pidió
 * verla siempre, porque un cambio suelto no dice de qué registro se trata.
 */
function PasoHistorial({
  paso,
  columnas,
  destacado,
}: {
  paso: Paso;
  columnas: ColumnaHistorial[];
  destacado: boolean;
}) {
  const e = paso.evento;

  // Qué valores mostrar: los que quedaron, salvo en una baja (no quedó nada) o
  // en un cambio del que no se sabe cómo quedó.
  const fila = e.operacion === "DEL" ? paso.antes : (paso.despues ?? paso.antes);
  const cambios = new Map((paso.cambios ?? []).map((c) => [c.columna, c]));

  return (
    <li
      className={`rounded-2xl border bg-card p-3.5 ${
        destacado ? "border-primary/50 ring-2 ring-primary/15" : "border-border/60"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BadgeOperacion op={e.operacion} />
        <span className="text-sm font-semibold">{formatearFechaHora(e.fecha, true)}</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <User className="size-3" />
          {e.usuario ?? "—"}
        </span>
      </div>
      {(e.aplicacion || e.sesion || e.notas) && (
        <p className="mt-1 text-[11px] break-all text-muted-foreground">
          {[e.aplicacion, e.sesion && `sesión ${e.sesion}`, e.notas].filter(Boolean).join(" · ")}
        </p>
      )}

      <p className="mt-2.5 text-xs text-muted-foreground">{resumenPaso(paso)}</p>
      {fila && <ListaCampos columnas={columnas} valores={fila} cambios={cambios} />}
    </li>
  );
}

/**
 * La línea que dice qué pasó en el movimiento y qué valores se ven debajo.
 *
 * En un cambio que no se puede reconstruir dice cuál de los dos lados es el que
 * se muestra: sin eso, la lista se leería como el antes y el después a la vez.
 */
function resumenPaso(paso: Paso): string {
  const op = paso.evento.operacion;
  if (op === "INS") return "Creó el registro con estos valores.";
  if (op === "DEL") return "Eliminó el registro. Así estaba:";
  if (op !== "UPD") return `${op}.`;

  if (paso.cambios === null) {
    return paso.antes === undefined
      ? "No hay registro de cómo estaba antes de este cambio: la fila probablemente ya existía cuando se empezó a auditar la tabla. Abajo, cómo quedó."
      : "No se puede saber cómo quedó: la fila ya no está en la tabla y no hay un movimiento posterior. Abajo, cómo estaba antes.";
  }
  const n = paso.cambios.length;
  if (!n) return "Se guardó sin cambiar ningún dato.";
  return `${n} campo${n === 1 ? "" : "s"} modificado${n === 1 ? "" : "s"}.`;
}

function CajaValor({
  etiqueta,
  valor,
  className,
}: {
  etiqueta: string;
  valor: string | null;
  className: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg px-2.5 py-1.5 ${className}`}>
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {etiqueta}
      </p>
      <Valor v={formatearValor(valor)} />
    </div>
  );
}

/**
 * Los campos de la fila, en el orden de la tabla. Los modificados van
 * resaltados y con el antes y el después en lugar de un solo valor.
 *
 * Las columnas que la bitácora no guarda ("Sin auditar") y las que ya no están
 * en la tabla ("Histórica") llevan su marca: sin ella, su "vacío" se leería
 * como un dato.
 */
function ListaCampos({
  columnas,
  valores,
  cambios,
}: {
  columnas: ColumnaHistorial[];
  valores: Valores;
  cambios: Map<string, Cambio>;
}) {
  return (
    <dl className="mt-2 divide-y divide-border/40 overflow-hidden rounded-xl border border-border/60">
      {columnas.map((c) => {
        const cambio = cambios.get(c.columna);
        const marca = cambio
          ? null
          : !c.en_jn
            ? ESTADO_COLUMNA.sin_jn
            : !c.en_tabla
              ? ESTADO_COLUMNA.historica
              : null;
        return (
          <div
            key={c.columna}
            className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 ${
              cambio ? "bg-amber-500/10" : ""
            }`}
          >
            <dt className="min-w-0">
              <span
                className={`flex items-start gap-1 font-mono text-[11px] break-all ${
                  cambio ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {c.es_pk && <KeyRound className="mt-px size-3 shrink-0 text-primary" />}
                {c.columna}
              </span>
              {cambio ? (
                <span className="mt-1 inline-block">
                  <Chip tono={TONO.aviso}>Modificado</Chip>
                </span>
              ) : marca ? (
                <span className="mt-1 inline-block" title={marca.ayuda}>
                  <Chip tono={TONO.neutro}>{marca.label}</Chip>
                </span>
              ) : null}
            </dt>
            <dd className="min-w-0">
              {cambio ? (
                <div className="grid gap-1">
                  <CajaValor etiqueta="Antes" valor={cambio.antes} className="bg-muted/60" />
                  <CajaValor
                    etiqueta="Después"
                    valor={cambio.despues}
                    className="bg-primary-soft"
                  />
                </div>
              ) : (
                <Valor v={formatearValor(valores[c.columna] ?? null)} />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Un valor de columna. El vacío se dibuja distinto de un texto: en un historial
 * "estaba vacío" es un dato, y un guion lo confundiría con un valor cargado.
 *
 * Con techo de alto y scroll propio: un CLOB de aspectos a mejorar puede ocupar
 * la pantalla entera y esconder el resto de los cambios.
 */
function Valor({ v }: { v: string | null }) {
  if (v == null) return <p className="text-xs text-muted-foreground italic">vacío</p>;
  return <p className="max-h-40 overflow-y-auto text-xs break-words whitespace-pre-wrap">{v}</p>;
}

/* -------------------------------------------------------------------------- */
/* Piezas chicas                                                              */
/* -------------------------------------------------------------------------- */

const TONO = {
  ok: "bg-primary-soft text-primary",
  aviso: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  error: "bg-destructive/10 text-destructive",
  neutro: "bg-muted text-muted-foreground",
} as const;

/**
 * El color de cada operación. Alta en el primario, modificación en ámbar y baja
 * en el rojo de error: la baja es la única que no se puede deshacer mirando la
 * tabla, y es la que más se busca en una bitácora.
 */
const TONO_OPERACION: Record<Operacion, string> = {
  INS: TONO.ok,
  UPD: TONO.aviso,
  DEL: TONO.error,
};

function Chip({ tono, children }: { tono: string; children: React.ReactNode }) {
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tono}`}>
      {children}
    </span>
  );
}

function BadgeOperacion({ op }: { op: string }) {
  return (
    <Chip tono={esOperacion(op) ? TONO_OPERACION[op] : TONO.neutro}>{labelOperacion(op)}</Chip>
  );
}

function Nota({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      <p className="text-xs">{children}</p>
    </div>
  );
}

function CampoTexto({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`${ALTO_CAMPO} w-full rounded-xl border border-input bg-card outline-none focus:border-primary/40`}
      />
    </div>
  );
}

function CampoFecha({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${ALTO_CAMPO} w-full rounded-xl border border-input bg-card outline-none focus:border-primary/40`}
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-muted-foreground">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

function Cargando() {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Cargando…
    </div>
  );
}

/**
 * El error con su mensaje. Si el backend no está publicado, ORDS responde un 404
 * en HTML y el mensaje genérico no dice nada: por eso la pista del script.
 */
function ErrorCarga({ error }: { error: Error | null }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-muted-foreground">No se pudo cargar la auditoría.</p>
      {error?.message && <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>}
      <p className="mt-3 text-xs text-muted-foreground">
        Si es la primera vez, falta correr <span className="font-mono">backend/auditoria.sql</span>{" "}
        en APEX.
      </p>
    </div>
  );
}

function Vacio({ icono: Icono, texto }: { icono: typeof Database; texto: string }) {
  return (
    <div className="py-12 text-center">
      <Icono className="mx-auto size-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

/** `1234` → `"1.234"`. `null` → `"—"`: no se pudo contar, que no es lo mismo que cero. */
function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("es-PY");
}

/** El valor, pero recién cuando dejó de cambiar durante `ms`. */
function useDemorado<T>(valor: T, ms: number): T {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}
