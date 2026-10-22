import {
  AlertCircle,
  Copy,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  ANCHO_ACCIONES,
  Celda,
  claseEntrada,
  type ColumnaGrilla,
  type EdicionGrilla,
  type FilaGrilla,
} from "@/components/grilla-editable";
import { LupaPlanilla } from "@/components/lupa-planilla";
import { minutos } from "@/lib/horario-instituciones";
import { usePlanilla } from "@/lib/lupa";
import { DIAS, GRADOS, MANUALES } from "@/lib/postulaciones";
import type { ValorLista } from "@/lib/utils";

/**
 * Los pre-horarios cargados con el formato del Formulario N° 1 (22/10/2026,
 * pedido de Jose con la imagen del formulario): un bloque por turno, la
 * cantidad en la columna de su grado, los manuales en sus colores, las horas
 * en la columna de su día, la duración, el docente, y el subtotal de cada
 * turno y el total general como en el impreso.
 *
 * NO CAMBIA NADA DE LO QUE SE GUARDA: un pre-horario sigue siendo UNA clase
 * (un grado, un manual y un día, ver `lib/pre-horarios.ts`), que es justo una
 * fila del formulario. Por eso las columnas de grado, de manual y de día se
 * excluyen entre sí dentro de la fila:
 *
 * - escribir la cantidad en "4°" pone grado 4 (y la saca del grado que tenía);
 * - tocar un manual lo elige (otro toque lo saca);
 * - escribir una hora en Martes pasa la clase al martes (y borra la otra hora,
 *   que era del día anterior).
 *
 * Para la misma clase en otro día se usa Duplicar. Las filas y el Guardar son
 * los de la grilla (`useEdicionGrilla`): se puede pasar de una vista a la otra
 * sin perder lo que no se guardó.
 */
export function PlanillaPreHorarios({
  edicion,
  filas,
  columnas,
  turnos,
  editable,
  extra,
  vacio,
}: {
  edicion: EdicionGrilla;
  /** Las guardadas, ya ordenadas. */
  filas: FilaGrilla[];
  /** Las columnas de la grilla: de ahí salen las listas (énfasis, materia…). */
  columnas: ColumnaGrilla[];
  turnos: ValorLista[];
  editable: boolean;
  extra?: ReactNode;
  vacio: string;
}) {
  const {
    nuevas,
    borrar,
    errores,
    guardando,
    pendientes,
    agregar,
    fijar,
    alternarBorrado,
    deshacer,
    datosDe,
    guardar,
  } = edicion;
  const tabla = useRef<HTMLTableElement>(null);

  const col = (clave: string) => columnas.find((c) => c.clave === clave)!;

  /*
   * EL ORDEN, ASCENDENTE POR DÍA Y HORA (22/10/2026, pedido de Jose): a medida
   * que se cargan los horarios, cada fila se ubica en su lugar dentro del
   * turno. Se reacomoda AL SALIR DE LA FILA y no con cada tecla: si no, la
   * fila saltaría mientras se escribe "0820". `claves` guarda la clave de
   * orden que tenía cada fila editada al salir; las demás usan lo guardado, y
   * una nueva que todavía no se dejó queda al final de su turno. Sin cambios
   * pendientes (guardado o Deshacer) se vacía: manda lo guardado.
   */
  const [claves, setClaves] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    if (!pendientes) setClaves((m) => (m.size ? new Map() : m));
  }, [pendientes]);
  const ultimas = useRef<Vista[]>([]);
  const claveDe = (v: Vista) =>
    claves.get(v.id) ?? (v.fila ? claveOrden(v.fila.datos) : SIN_HORARIO);

  // Todas las filas con sus datos de ahora, en orden (`sort` es estable: las
  // nuevas sin dejar quedan en el orden en que se agregaron).
  const todas: Vista[] = [
    ...filas.map((f) => ({ id: f.id, datos: datosDe(f), fila: f })),
    ...[...nuevas].reverse().map((n) => ({ id: n.tmp, datos: n.datos })),
  ].sort((a, b) => claveDe(a).localeCompare(claveDe(b)));
  ultimas.current = todas;

  /**
   * Al dejar una fila: su lugar según lo que tiene ahora. Mover filas puede
   * sacarle el foco a la celda a la que se pasó (el navegador lo pierde al
   * mover el elemento), así que se le devuelve.
   */
  const reordenar = (id: number) => {
    const v = ultimas.current.find((x) => x.id === id);
    if (!v) return;
    const clave = claveOrden(v.datos);
    if (claveDe(v) === clave) return;
    const activo = document.activeElement as HTMLElement | null;
    setClaves((m) => new Map(m).set(id, clave));
    requestAnimationFrame(() => {
      if (activo?.isConnected && document.activeElement !== activo)
        activo.focus({ preventScroll: true });
    });
  };

  // Un bloque por turno, en el orden de la lista; lo que no tiene un turno
  // conocido (filas viejas de APEX), al final.
  const conocido = new Set(turnos.map((t) => t.valor));
  const bloques = [
    ...turnos.map((t) => ({
      turno: t.valor as string | null,
      titulo: t.mostrar,
      filas: todas.filter((v) => v.datos.turno === t.valor),
    })),
    {
      turno: null,
      titulo: "Sin turno",
      filas: todas.filter((v) => !conocido.has(v.datos.turno ?? "")),
    },
  ].filter((b) => b.filas.length);
  const sinFilas = turnos.filter((t) => !bloques.some((b) => b.turno === t.valor));

  /** Flechas y Enter: la misma columna, una fila arriba o abajo. */
  const mover = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    const paso = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!paso) return;
    const sig = tabla.current?.querySelector<HTMLElement>(`[data-celda="${r + paso}:${c}"]`);
    if (sig) {
      e.preventDefault();
      sig.focus();
    }
  };

  const natural = (editable ? ANCHO_ACCIONES : 0) + ANCHOS.reduce((a, b) => a + b, 0);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(natural);
  const totalColumnas = ANCHOS.length + (editable ? 1 : 0);

  const vivas = (vs: Vista[]) => vs.filter((v) => !borrar.has(v.id));
  const todasVivas = vivas(todas);
  // Como el formulario: los alumnos cuentan por grado y los manuales por manual.
  const alumnos = todasVivas.reduce((a, v) => a + (v.datos.grado ? cantidadDe(v.datos) : 0), 0);
  const manuales = todasVivas.reduce((a, v) => a + (v.datos.manual ? cantidadDe(v.datos) : 0), 0);
  const confirmados = todasVivas.filter((v) => v.datos.confirmado === "SI").length;

  // El número de fila en toda la planilla, para moverse con las flechas
  // entre turnos.
  let r = -1;

  return (
    <div className="space-y-2">
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground">
            Cada fila es una clase: la cantidad en la columna de su grado, un toque en su manual y
            las horas en su día. Para otro día, <Copy className="inline size-3" /> Duplicar.
          </p>
          {pendientes > 0 && (
            <button
              type="button"
              disabled={guardando}
              onClick={deshacer}
              className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Undo2 className="size-4" />
              Deshacer
            </button>
          )}
          <button
            type="button"
            disabled={guardando || !pendientes}
            onClick={guardar}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar{pendientes ? ` (${pendientes})` : ""}
          </button>
        </div>
      )}

      {extra}

      <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />

      <div
        ref={marco}
        className={`rounded-xl border border-border/70 bg-card ${cabe ? "" : "overflow-x-auto"}`}
      >
        <table
          ref={tabla}
          style={{ zoom, width: natural }}
          className={`table-fixed border-separate border-spacing-0 text-[12px] ${zoom >= 1 ? "min-w-full" : ""}`}
        >
          <colgroup>
            {editable && <col style={{ width: ANCHO_ACCIONES }} />}
            {ANCHOS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <Encabezado editable={editable} fijo={cabe} top={topEncabezado} />
          <tbody>
            {!bloques.length && (
              <tr>
                <td colSpan={totalColumnas} className="px-3 py-8 text-center text-muted-foreground">
                  {vacio}
                  {editable && turnos.length > 0 && " Elegí el turno abajo para empezar."}
                </td>
              </tr>
            )}
            {bloques.map((b) => (
              <Fragment key={b.turno ?? "sin"}>
                <tr>
                  <td
                    colSpan={totalColumnas}
                    className="border-b border-border/60 px-2 py-1 text-[11.5px] font-bold text-white"
                    style={{ backgroundColor: AZUL_TURNO }}
                  >
                    <span className="sticky left-2 inline-flex items-center gap-3">
                      TURNO: {b.titulo.toUpperCase()}
                      {editable && b.turno != null && (
                        <button
                          type="button"
                          disabled={guardando}
                          onClick={() => agregar({ turno: b.turno! })}
                          className="flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25 disabled:opacity-50"
                        >
                          <Plus className="size-3.5" />
                          Agregar fila
                        </button>
                      )}
                      {b.turno == null && (
                        <span className="font-medium opacity-80">
                          · el turno se elige en la vista Grilla
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {b.filas.map((v, i) => {
                  r++;
                  return (
                    <FilaPlanilla
                      key={v.id}
                      vista={v}
                      n={i + 1}
                      r={r}
                      editable={editable}
                      tachada={borrar.has(v.id)}
                      error={errores.get(v.id)}
                      guardando={guardando}
                      col={col}
                      totalColumnas={totalColumnas}
                      fijar={(p) => fijar(v.id, p)}
                      alternarBorrado={() => alternarBorrado(v.id)}
                      duplicar={() => agregar(v.datos)}
                      alSalir={() => reordenar(v.id)}
                      mover={mover}
                    />
                  );
                })}
                <FilaTotales
                  filas={vivas(b.filas)}
                  editable={editable}
                  clase="bg-amber-100 dark:bg-amber-400/15"
                />
              </Fragment>
            ))}
            {bloques.length > 1 && (
              <FilaTotales
                filas={todasVivas}
                editable={editable}
                clase="bg-sky-100 dark:bg-sky-400/15"
              />
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {editable && sinFilas.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {sinFilas.map((t) => (
              <button
                key={t.valor}
                type="button"
                disabled={guardando}
                onClick={() => agregar({ turno: t.valor })}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border bg-card px-3 text-sm font-semibold hover:border-primary/40 disabled:opacity-50"
              >
                <Plus className="size-4" />
                Turno {t.mostrar}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <p className="text-right text-[12.5px]">
          <b>Total de alumnos:</b>{" "}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{alumnos}</span>
          <span className="text-muted-foreground"> · </span>
          <b>Manuales:</b>{" "}
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{manuales}</span>
          <span className="text-muted-foreground">
            {" "}
            · {confirmados} de {todasVivas.length} confirmados
          </span>
        </p>
      </div>
    </div>
  );
}

type Vista = { id: number; datos: Record<string, string>; fila?: FilaGrilla };

/** El azul de la banda del turno en el formulario impreso. */
const AZUL_TURNO = "#1f3864";
/** El azul de los títulos grandes del formulario. */
const AZUL_TITULO = "#2e75b6";

/*
 * Los anchos, en px, en el orden de las celdas: N, los 11 grados, sección,
 * énfasis, los 7 manuales, desde/hasta de los 5 días, duración, materia,
 * docente, celular, facilitador, observación y confirmado.
 */
const W = { n: 26, grado: 30, sec: 36, enfasis: 84, manual: 34, hora: 44, dur: 36 };
const ANCHOS = [
  W.n,
  ...GRADOS.map(() => W.grado),
  W.sec,
  W.enfasis,
  ...MANUALES.map(() => W.manual),
  ...DIAS.flatMap(() => [W.hora, W.hora]),
  W.dur,
  100,
  140,
  84,
  110,
  100,
  44,
];

/** Los ciclos de los grados, como el encabezado del formulario. */
const CICLOS = [
  { titulo: "2° ciclo", n: 5 },
  { titulo: "3° ciclo", n: 3 },
  { titulo: "N. medio", n: 3 },
];

const cantidadDe = (d: Record<string, string>) => Number(d.cantidad) || 0;

/** Las filas sin día ni hora van al final de su turno. */
const SIN_HORARIO = "9";

/** "1-08:20-09:00": día (lunes = 1) y horas, para ordenar de forma ascendente. */
function claveOrden(d: Record<string, string>): string {
  const dia = DIAS.findIndex((x) => x.valor === d.dia) + 1;
  if (!dia) return SIN_HORARIO;
  return `${dia}-${d.desde || "99:99"}-${d.hasta || "99:99"}`;
}

/** "0:40": de las dos horas de la fila. */
function duracionDe(d: Record<string, string>): string {
  const a = minutos(d.desde ?? "");
  const b = minutos(d.hasta ?? "");
  if (a == null || b == null || b <= a) return "";
  const m = b - a;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

const th =
  "border-r border-b border-border/70 px-0.5 py-1 text-center text-[10.5px] font-semibold whitespace-nowrap";

/** Los tres niveles del encabezado del formulario, una sola vez arriba. */
function Encabezado({ editable, fijo, top }: { editable: boolean; fijo: boolean; top: string }) {
  const titulo: CSSProperties = { backgroundColor: AZUL_TITULO, color: "#ffffff" };
  return (
    <thead className={fijo ? "sticky z-20" : ""} style={fijo ? { top } : undefined}>
      <tr>
        {editable && (
          <th
            rowSpan={3}
            className="sticky left-0 z-10 border-r border-b border-border/70 bg-muted"
          />
        )}
        <th rowSpan={3} className={th} style={titulo}>
          N
        </th>
        <th colSpan={GRADOS.length + 2} className={th} style={titulo}>
          CANTIDAD DE ALUMNOS POR GRADO Y CURSO
        </th>
        <th colSpan={MANUALES.length} className={th} style={titulo}>
          POR MANUAL
        </th>
        <th colSpan={DIAS.length * 2 + 1} className={th} style={titulo}>
          HORARIOS
        </th>
        <th colSpan={3} className={th} style={titulo}>
          DOCENTES RESPONSABLES
        </th>
        <th colSpan={3} className={`${th} border-r-0`} style={titulo}>
          SEGUIMIENTO
        </th>
      </tr>
      <tr>
        {CICLOS.map((c) => (
          <th key={c.titulo} colSpan={c.n} className={`${th} bg-muted`}>
            {c.titulo.toUpperCase()}
          </th>
        ))}
        <th rowSpan={2} className={`${th} bg-muted`}>
          Sec
        </th>
        <th rowSpan={2} className={`${th} bg-muted`}>
          Énfasis
        </th>
        {MANUALES.map((m) => (
          <th
            key={m.clave}
            rowSpan={2}
            title={m.nombre}
            className={th}
            style={{ backgroundColor: m.color, color: m.tinta }}
          >
            {m.corto}
          </th>
        ))}
        {DIAS.map((d) => (
          <th key={d.clave} colSpan={2} className={`${th} bg-muted`}>
            {d.impreso}
          </th>
        ))}
        <th rowSpan={2} className={`${th} bg-muted`} title="Duración">
          Dur.
        </th>
        {["MATERIA", "NOMBRE", "CELULAR", "FACILITADOR", "OBS.", "CONF."].map((x, i, xs) => (
          <th
            key={x}
            rowSpan={2}
            className={`${th} bg-muted ${i === xs.length - 1 ? "border-r-0" : ""}`}
            title={x === "CONF." ? "Confirmado: SI crea su postulación" : undefined}
          >
            {x}
          </th>
        ))}
      </tr>
      <tr>
        {GRADOS.map((g) => (
          <th key={g.clave} className={`${th} bg-muted`}>
            {g.corto}
          </th>
        ))}
        {DIAS.flatMap((d) => [
          <th key={`${d.clave}-de`} className={`${th} bg-muted font-medium`}>
            DE
          </th>,
          <th key={`${d.clave}-ha`} className={`${th} bg-muted font-medium`}>
            HASTA
          </th>,
        ])}
      </tr>
    </thead>
  );
}

/** Una clase: una fila del formulario. */
function FilaPlanilla({
  vista: { id, datos: d, fila },
  n,
  r,
  editable,
  tachada,
  error,
  guardando,
  col,
  totalColumnas,
  fijar,
  alternarBorrado,
  duplicar,
  mover,
  alSalir,
}: {
  vista: Vista;
  n: number;
  r: number;
  editable: boolean;
  tachada: boolean;
  error: string | undefined;
  guardando: boolean;
  col: (clave: string) => ColumnaGrilla;
  totalColumnas: number;
  fijar: (parcial: Record<string, string>) => void;
  alternarBorrado: () => void;
  duplicar: () => void;
  mover: (e: KeyboardEvent<HTMLElement>, r: number, c: number) => void;
  /** Al dejar la fila (el foco pasa afuera): para reordenar. */
  alSalir: () => void;
}) {
  const esNueva = id < 0;
  const bloqueo = fila?.bloqueada;
  const editar = editable && !bloqueo && !tachada && !guardando;
  const o = fila?.datos;
  const fondo = error
    ? "bg-destructive/5"
    : esNueva
      ? "bg-primary/5"
      : tachada
        ? "bg-muted/60"
        : "";

  // Cada celda editable lleva su número de columna, para las flechas.
  let c = -1;
  const td = `relative border-r border-b border-border/60 p-0 ${tachada ? "line-through" : ""}`;
  /** La marca de "cambiada" de la grilla, comparando lo que muestra la celda. */
  const marca = (antes: string | undefined, ahora: string) =>
    !esNueva && antes != null && antes !== ahora ? (
      <span
        aria-hidden
        className="absolute top-0 left-0 size-0 border-t-[7px] border-r-[7px] border-t-primary border-r-transparent"
      />
    ) : null;

  /** Una celda de las de la grilla (texto, lista u hora), con su valor ya traducido. */
  const celda = (
    c0: ColumnaGrilla,
    valor: string,
    antes: string | undefined,
    onCambio: (v: string) => void,
    estilo?: CSSProperties,
  ) => {
    const ci = ++c;
    const mostrar =
      c0.tipo === "lista" ? (c0.opciones?.find((x) => x.valor === valor)?.mostrar ?? valor) : valor;
    return (
      <td key={c0.clave + ci} className={td} style={estilo}>
        {marca(antes, valor)}
        {editar ? (
          <Celda
            c={c0}
            valor={valor}
            celda={`${r}:${ci}`}
            onCambio={onCambio}
            onTecla={(e) => mover(e, r, ci)}
          />
        ) : (
          <span
            className={`block truncate px-1 py-1 ${c0.alinear === "centro" ? "text-center" : ""}`}
            title={mostrar}
          >
            {mostrar}
          </span>
        )}
      </td>
    );
  };

  const deDia = (x: Record<string, string> | undefined, dia: string, k: "desde" | "hasta") =>
    x == null ? undefined : x.dia === dia ? (x[k] ?? "") : "";
  const deGrado = (x: Record<string, string> | undefined, g: string) =>
    x == null ? undefined : x.grado === g ? (x.cantidad ?? "") : "";

  const conf = d.confirmado === "SI";

  return (
    <>
      <tr
        className={`${fondo} ${tachada ? "text-muted-foreground" : ""}`}
        // Se espera un instante: dentro de la fila el foco pasa de celda en celda
        // (y una lista cambia su botón por el <select>) sin haberla dejado.
        onBlur={(e) => {
          const tr = e.currentTarget;
          setTimeout(() => {
            if (!tr.contains(document.activeElement)) alSalir();
          }, 0);
        }}
      >
        {editable && (
          <td
            className={`sticky left-0 z-10 border-r border-b border-l-[3px] border-border/60 bg-card px-1 ${
              error
                ? "border-l-destructive"
                : esNueva
                  ? "border-l-primary"
                  : tachada
                    ? "border-l-muted-foreground/50"
                    : "border-l-transparent"
            }`}
          >
            <div className="flex items-center justify-center gap-0.5">
              {bloqueo ? (
                <span title={bloqueo} className="p-0.5 text-muted-foreground">
                  <Lock className="size-3.5" />
                </span>
              ) : (
                <button
                  type="button"
                  disabled={guardando}
                  title={tachada ? "Recuperar" : "Eliminar"}
                  aria-label={tachada ? "Recuperar fila" : "Eliminar fila"}
                  onClick={alternarBorrado}
                  className={`rounded p-0.5 hover:bg-muted disabled:opacity-30 ${tachada ? "text-primary" : "text-destructive"}`}
                >
                  {tachada ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
                </button>
              )}
              <button
                type="button"
                disabled={guardando}
                title="Duplicar (para la misma clase en otro día)"
                aria-label="Duplicar fila"
                onClick={duplicar}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <Copy className="size-3.5" />
              </button>
            </div>
          </td>
        )}
        <td className={`${td} px-1 text-center text-muted-foreground tabular-nums`}>{n}</td>

        {/* Grados: la cantidad en la columna del suyo. */}
        {GRADOS.map((g) => {
          const v = deGrado(d, g.valor)!;
          const elegido = d.grado === g.valor;
          return celda(
            {
              clave: `g-${g.clave}`,
              titulo: `Alumnos de ${g.corto}`,
              tipo: "numero",
              alinear: "centro",
              max: 4,
            },
            v,
            deGrado(o, g.valor),
            (x) =>
              x
                ? fijar({ grado: g.valor, cantidad: x })
                : elegido
                  ? fijar({ grado: "", cantidad: "" })
                  : undefined,
            elegido
              ? {
                  backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
                  fontWeight: 700,
                }
              : undefined,
          );
        })}
        {celda(col("seccion"), d.seccion ?? "", o?.seccion, (x) => fijar({ seccion: x }))}
        {celda(col("idEnfasis"), d.idEnfasis ?? "", o?.idEnfasis, (x) => fijar({ idEnfasis: x }))}

        {/* Manuales: un toque lo elige; muestra la cantidad, como el formulario. */}
        {MANUALES.map((m) => {
          const ci = ++c;
          const elegido = d.manual === m.valor;
          const texto = elegido ? d.cantidad || "✓" : "";
          const estilo: CSSProperties = elegido
            ? { backgroundColor: m.color, color: m.tinta, fontWeight: 700 }
            : { backgroundColor: `${m.color}2e` };
          return (
            <td key={m.clave} className={`${td} text-center`} style={estilo}>
              {marca(o == null ? undefined : o.manual === m.valor ? "1" : "", elegido ? "1" : "")}
              {editar ? (
                <button
                  type="button"
                  data-celda={`${r}:${ci}`}
                  aria-pressed={elegido}
                  aria-label={`Manual ${m.nombre}`}
                  title={elegido ? `${m.nombre}: tocá para sacarlo` : `Elegir ${m.nombre}`}
                  onClick={() => fijar({ manual: elegido ? "" : m.valor })}
                  onKeyDown={(e) => mover(e, r, ci)}
                  className={`${claseEntrada} cursor-pointer text-center tabular-nums focus:bg-transparent`}
                >
                  {texto}
                </button>
              ) : (
                <span className="block px-1 py-1 tabular-nums">{texto}</span>
              )}
            </td>
          );
        })}

        {/* Días: las horas en la columna del suyo. */}
        {DIAS.flatMap((dia) =>
          (["desde", "hasta"] as const).map((k) => {
            const otro = k === "desde" ? "hasta" : "desde";
            return celda(
              {
                clave: `${dia.clave}-${k}`,
                titulo: `${dia.nombre} ${k}`,
                tipo: "hora",
              },
              deDia(d, dia.valor, k)!,
              deDia(o, dia.valor, k),
              (x) => {
                if (x) {
                  // Pasar la clase a otro día borra la hora que era del anterior.
                  fijar(d.dia === dia.valor ? { [k]: x } : { dia: dia.valor, [k]: x, [otro]: "" });
                } else if (d.dia === dia.valor) {
                  fijar(d[otro] ? { [k]: "" } : { dia: "", [k]: "" });
                }
              },
              d.dia === dia.valor
                ? { backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)" }
                : undefined,
            );
          }),
        )}
        <td className={`${td} px-1 text-center tabular-nums`}>{duracionDe(d)}</td>

        {celda(col("idMateria"), d.idMateria ?? "", o?.idMateria, (x) => fijar({ idMateria: x }))}
        {celda(col("idDocente"), d.idDocente ?? "", o?.idDocente, (x) => fijar({ idDocente: x }))}
        {celda(col("telefono"), d.telefono ?? "", o?.telefono, (x) => fijar({ telefono: x }))}
        {celda(col("idFacilitador"), d.idFacilitador ?? "", o?.idFacilitador, (x) =>
          fijar({ idFacilitador: x }),
        )}
        {celda(col("observacion"), d.observacion ?? "", o?.observacion, (x) =>
          fijar({ observacion: x }),
        )}
        {celda(
          { ...col("confirmado"), alinear: "centro" },
          d.confirmado ?? "",
          o?.confirmado,
          (x) => fijar({ confirmado: x }),
          conf ? { color: "#16a34a", fontWeight: 700 } : undefined,
        )}
      </tr>
      {error && (
        <tr>
          <td
            colSpan={totalColumnas}
            className="border-b border-border/60 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive"
          >
            <span className="sticky left-3 inline-flex items-center gap-1.5">
              <AlertCircle className="size-3.5 shrink-0" />
              {error}
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

/** El subtotal del turno (amarillo) o el total general (celeste), como el formulario. */
function FilaTotales({
  filas,
  editable,
  clase,
}: {
  filas: Vista[];
  editable: boolean;
  clase: string;
}) {
  const porGrado = (g: string) =>
    filas.filter((v) => v.datos.grado === g).reduce((a, v) => a + cantidadDe(v.datos), 0);
  const porManual = (m: string) =>
    filas.filter((v) => v.datos.manual === m).reduce((a, v) => a + cantidadDe(v.datos), 0);
  const celda = "border-r border-b border-border/60 px-1 py-1 text-center font-bold tabular-nums";
  // Horas, duración, docente y seguimiento: sin totales.
  return (
    <tr className={clase}>
      {editable && (
        <td className={`sticky left-0 z-10 border-r border-b border-border/60 ${clase}`} />
      )}
      <td className={celda} />
      {GRADOS.map((g) => (
        <td key={g.clave} className={celda}>
          {porGrado(g.valor) || ""}
        </td>
      ))}
      <td className={celda} />
      <td className={celda} />
      {MANUALES.map((m) => (
        <td key={m.clave} className={celda}>
          {porManual(m.valor) || ""}
        </td>
      ))}
      <td colSpan={DIAS.length * 2 + 1 + 6} className={`${celda} border-r-0`} />
    </tr>
  );
}
