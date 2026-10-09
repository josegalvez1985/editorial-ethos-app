import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ChevronRight,
  FileSpreadsheet,
  RotateCcw,
  School,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { EditorPostulacion } from "@/components/editor-postulacion";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import {
  DIAS,
  franjas,
  GRADOS,
  keysPostulaciones,
  listarTodasPostulaciones,
  MANUALES,
  sumaGrados,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-postulaciones/")({
  head: () => ({
    meta: [
      { title: "Consulta de postulaciones — Juventud con Valores" },
      {
        name: "description",
        content: "Las postulaciones del año por ciudad, institución y facilitador.",
      },
    ],
  }),
  component: ConsultaPostulacionesPage,
});

const numero = new Intl.NumberFormat("es-PY");
const plural = (n: number, uno: string, varios: string) =>
  `${numero.format(n)} ${n === 1 ? uno : varios}`;

/** Cuántas instituciones se dibujan de entrada; "Mostrar más" suma de a tanto. */
const PASO = 15;

/** "¿Tiene facilitador?" de APEX: vacío = todas. */
type Tiene = "" | "S" | "N";

/** Una postulación con lo que la consulta necesita a mano. */
type Fila = PostulacionFila & { ciudad: string; busqueda: string };

/** Los filtros que se pueden combinar (las facetas de APEX). */
type Filtros = {
  ciudades: string[];
  instituciones: string[];
  facilitadores: string[];
  tiene: Tiene;
  texto: string;
};
type Faceta = "ciudades" | "instituciones" | "facilitadores" | "tiene";

const SIN_FILTROS: Filtros = {
  ciudades: [],
  instituciones: [],
  facilitadores: [],
  tiene: "",
  texto: "",
};

/** Si la fila pasa los filtros; `salvo` ignora uno, para contar sus opciones. */
function pasa(p: Fila, f: Filtros, salvo?: Faceta) {
  if (salvo !== "ciudades" && f.ciudades.length && !f.ciudades.includes(p.ciudad)) return false;
  if (
    salvo !== "instituciones" &&
    f.instituciones.length &&
    !f.instituciones.includes(String(p.idInstitucion))
  )
    return false;
  if (
    salvo !== "facilitadores" &&
    f.facilitadores.length &&
    !f.facilitadores.includes(String(p.idFacilitador ?? ""))
  )
    return false;
  if (salvo !== "tiene" && f.tiene && (f.tiene === "S") !== (p.idFacilitador != null)) return false;
  const q = normalizar(f.texto.trim());
  return !q || p.busqueda.includes(q);
}

/** Cuántas filas tiene cada valor de una faceta, con el resto de los filtros puestos. */
function contar(filas: Fila[], f: Filtros, faceta: Faceta, clave: (p: Fila) => string) {
  const m = new Map<string, number>();
  for (const p of filas) if (pasa(p, f, faceta)) m.set(clave(p), (m.get(clave(p)) ?? 0) + 1);
  return m;
}

/**
 * Consulta de Postulaciones: la página 24 de APEX (una búsqueda con facetas
 * sobre `V_POSTULACIONES`). Backend: `postulaciones/todas` de
 * `backend/postulaciones.sql`, el mismo de la página 20; no necesita SQL
 * propio. El ícono es el que ya tenía en el menú (`FileSearch`).
 *
 * Como en APEX: las postulaciones activas (no 'Inactivo') de un año, que se
 * combinan por ciudad, institución, facilitador y "¿tiene facilitador?", con
 * un buscador sobre todos los textos, "Restablecer" y la descarga para Excel.
 * Tocar una postulación abre el modal 22 (el link de la institución en APEX).
 *
 * Distinto de APEX, a propósito:
 *
 * - **Un año a la vez** (el lectivo actual de entrada): APEX dejaba marcar
 *   varios y mezclaba postulaciones de años distintos.
 * - **Cada opción dice cuántas hay con el resto de los filtros puestos**,
 *   como las facetas de APEX, pero en una lista con buscador.
 * - **Un resumen arriba** (postulaciones, instituciones y cuántas tienen y no
 *   tienen facilitador) y la lista **agrupada por institución**, en tarjetas:
 *   la tabla de 40 columnas de APEX no se leía en el celular.
 */
function ConsultaPostulacionesPage() {
  const qc = useQueryClient();
  const [anio, setAnio] = useState("");
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [mostrar, setMostrar] = useState(PASO);
  const [editando, setEditando] = useState<PostulacionFila | null>(null);

  const filtrosApi: FiltrosPostulaciones = {
    anio,
    idDepartamento: null,
    idCiudad: null,
    idBarrio: null,
    idInstitucion: null,
    turno: null,
  };
  const lista = useQuery({
    queryKey: keysPostulaciones.todas(filtrosApi),
    queryFn: () => listarTodasPostulaciones(filtrosApi),
  });
  const insts = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });
  const opciones = useQuery({
    queryKey: keysPreHorarios.opciones,
    queryFn: opcionesPreHorario,
    staleTime: 10 * 60 * 1000,
  });

  const anioElegido = lista.data?.anio ?? anio;
  const anios = [
    ...new Set([lista.data?.anioActual ?? "", ...(lista.data?.anios ?? [])].filter(Boolean)),
  ].sort((a, b) => b.localeCompare(a));
  const turnos = opciones.data?.turno ?? [];
  const nombreTurno = (t: number | null) =>
    t == null ? "" : (turnos.find((o) => o.valor === String(t))?.mostrar ?? String(t));

  // Las activas del año, con su ciudad (la de la institución) y el texto del buscador.
  const filas = useMemo<Fila[]>(() => {
    const ciudadDe = new Map((insts.data?.items ?? []).map((i) => [i.id, i.ciudad]));
    return (lista.data?.items ?? [])
      .filter((p) => p.activa)
      .map((p) => {
        const ciudad = ciudadDe.get(p.idInstitucion) || "Sin ciudad";
        const dias = franjas(p)
          .map((x) => `${x.dia.nombre} ${x.desde} ${x.hasta}`)
          .join(" ");
        return {
          ...p,
          ciudad,
          busqueda: normalizar(
            [
              p.institucion,
              p.enfasis,
              dias,
              p.materia,
              p.docente,
              p.telefono,
              p.facilitador,
              ciudad,
            ].join(" "),
          ),
        };
      });
  }, [lista.data, insts.data]);

  const visibles = filas.filter((p) => pasa(p, f));

  // Las opciones de cada filtro: las del año, con cuántas quedan con el resto
  // de los filtros. Las que quedan en cero se esconden, salvo si están elegidas.
  const facetas = useMemo(() => {
    const opcionesDe = (
      faceta: Exclude<Faceta, "tiene">,
      clave: (p: Fila) => string,
      texto: (p: Fila) => string,
      extra?: (p: Fila) => string,
    ) => {
      const cuenta = contar(filas, f, faceta, clave);
      const vistas = new Map<string, Fila>();
      for (const p of filas) if (!vistas.has(clave(p))) vistas.set(clave(p), p);
      return [...vistas]
        .filter(([v]) => cuenta.get(v) || f[faceta].includes(v))
        .map(([v, p]) => ({
          valor: v,
          texto: texto(p),
          extra: [extra?.(p), plural(cuenta.get(v) ?? 0, "postulación", "postulaciones")]
            .filter(Boolean)
            .join(" · "),
        }))
        .sort((a, b) => a.texto.localeCompare(b.texto, "es"));
    };
    return {
      ciudades: opcionesDe(
        "ciudades",
        (p) => p.ciudad,
        (p) => p.ciudad,
      ),
      instituciones: opcionesDe(
        "instituciones",
        (p) => String(p.idInstitucion),
        (p) => p.institucion,
        (p) => p.ciudad,
      ),
      facilitadores: opcionesDe(
        "facilitadores",
        (p) => String(p.idFacilitador ?? ""),
        (p) => p.facilitador,
      ).filter((o) => o.valor !== ""),
      tiene: contar(filas, f, "tiene", (p) => (p.idFacilitador != null ? "S" : "N")),
    };
  }, [filas, f]);

  const con = facetas.tiene.get("S") ?? 0;
  const sin = facetas.tiene.get("N") ?? 0;
  const cobertura = con + sin ? Math.round((con / (con + sin)) * 100) : 0;

  // Agrupadas por institución; adentro, por turno y por el primer día con horario.
  const grupos = useMemo(() => {
    const m = new Map<number, Fila[]>();
    for (const p of visibles) {
      const g = m.get(p.idInstitucion);
      if (g) g.push(p);
      else m.set(p.idInstitucion, [p]);
    }
    const orden = (p: Fila) => {
      const i = DIAS.findIndex((d) => p.dias[d.clave].desde);
      return `${p.turno ?? 9}-${i < 0 ? 9 : i}-${i < 0 ? "" : p.dias[DIAS[i].clave].desde}`;
    };
    return [...m.values()]
      .map((xs) => ({
        id: xs[0].idInstitucion,
        nombre: xs[0].institucion,
        ciudad: xs[0].ciudad,
        sinFacilitador: xs.filter((p) => p.idFacilitador == null).length,
        filas: [...xs].sort((a, b) => orden(a).localeCompare(orden(b))),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [visibles]);

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setMostrar(PASO);
  };

  // Los filtros puestos, como chips que se quitan de a uno.
  const nombreDe = (lista: { valor: string; texto: string }[], v: string) =>
    lista.find((o) => o.valor === v)?.texto ?? v;
  const chips = [
    ...f.ciudades.map((v) => ({
      clave: `c${v}`,
      texto: v,
      quitar: () => cambiar({ ciudades: f.ciudades.filter((x) => x !== v) }),
    })),
    ...f.instituciones.map((v) => ({
      clave: `i${v}`,
      texto: nombreDe(facetas.instituciones, v),
      quitar: () => cambiar({ instituciones: f.instituciones.filter((x) => x !== v) }),
    })),
    ...f.facilitadores.map((v) => ({
      clave: `f${v}`,
      texto: nombreDe(facetas.facilitadores, v),
      quitar: () => cambiar({ facilitadores: f.facilitadores.filter((x) => x !== v) }),
    })),
    ...(f.tiene
      ? [
          {
            clave: "t",
            texto: f.tiene === "S" ? "Con facilitador" : "Sin facilitador",
            quitar: () => cambiar({ tiene: "" }),
          },
        ]
      : []),
  ];
  const hayFiltros = chips.length > 0 || f.texto.trim() !== "";

  const descargar = () => descargarCsv(visibles, nombreTurno, anioElegido);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Consulta de postulaciones</h1>
            <p className="text-xs text-muted-foreground">
              Quién cubre cada postulación del año, por ciudad, institución y facilitador
            </p>
          </div>
          <button
            type="button"
            onClick={descargar}
            disabled={!visibles.length}
            title={
              visibles.length
                ? "Descarga lo que se ve, para abrir en Excel"
                : "No hay postulaciones para descargar"
            }
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </button>
        </div>

        {/* ── Filtros ──────────────────────────────────────────────────── */}
        <div className="mb-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <SelectorModal
            label="Año"
            descripcion="Las postulaciones de ese año lectivo"
            value={anioElegido}
            onChange={(a) => {
              setAnio(a);
              setF(SIN_FILTROS);
              setMostrar(PASO);
            }}
            opciones={anios.map((a) => ({
              valor: a,
              texto: a,
              extra: a === lista.data?.anioActual ? "Año lectivo actual" : undefined,
            }))}
            placeholder="Año"
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Ciudad"
            placeholder="Todas"
            descripcion="Debajo de cada una, cuántas postulaciones quedan con los otros filtros"
            value={f.ciudades}
            onChange={(v) => cambiar({ ciudades: v })}
            opciones={facetas.ciudades}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Institución"
            placeholder="Todas"
            descripcion="Con la ciudad y cuántas postulaciones quedan con los otros filtros"
            value={f.instituciones}
            onChange={(v) => cambiar({ instituciones: v })}
            opciones={facetas.instituciones}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
          <MultiSelectorModal
            label="Facilitador"
            placeholder="Todos"
            descripcion="Cuántas postulaciones tiene cada uno con los otros filtros"
            value={f.facilitadores}
            onChange={(v) => cambiar({ facilitadores: v })}
            opciones={facetas.facilitadores}
            className="min-h-11 px-3.5 py-2 text-sm"
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* ¿Tiene facilitador? (la faceta de APEX), con sus cuentas. */}
          <div
            role="radiogroup"
            aria-label="¿Tiene facilitador?"
            className="flex h-11 w-full rounded-xl border border-input bg-card p-0.5 text-sm sm:w-auto"
          >
            {(
              [
                { valor: "", texto: "Todas", n: con + sin },
                { valor: "S", texto: "Con facilitador", n: con },
                { valor: "N", texto: "Sin facilitador", n: sin },
              ] as const
            ).map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={f.tiene === o.valor}
                onClick={() => cambiar({ tiene: o.valor })}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2.5 font-medium whitespace-nowrap transition-colors ${
                  f.tiene === o.valor
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.texto}
                <span className="text-[11px] tabular-nums opacity-80">{numero.format(o.n)}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 [&>div]:mb-0">
            <Buscador
              valor={f.texto}
              onCambio={(v) => cambiar({ texto: v })}
              placeholder="Buscar institución, materia, profesor…"
            />
          </div>
        </div>

        {hayFiltros && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c.clave}
                className="flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-1 pr-1 pl-2.5 text-xs font-medium"
              >
                <span className="truncate">{c.texto}</span>
                <button
                  type="button"
                  onClick={c.quitar}
                  aria-label={`Quitar ${c.texto}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => cambiar(SIN_FILTROS)}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3" />
              Restablecer
            </button>
          </div>
        )}

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {lista.isLoading || insts.isLoading ? (
          <Cargando />
        ) : lista.isError ? (
          <Fallo error={lista.error} texto="No se pudieron cargar las postulaciones" />
        ) : !filas.length ? (
          <Vacio texto={`No hay postulaciones activas en ${anioElegido || "este año"}.`} />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Postulaciones" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Instituciones" valor={numero.format(grupos.length)} />
              <Resumen
                etiqueta="Con facilitador"
                valor={numero.format(con)}
                detalle={`${cobertura} % cubiertas`}
                barra={cobertura}
              />
              <Resumen
                etiqueta="Sin facilitador"
                valor={numero.format(sin)}
                alerta={sin > 0}
                detalle={sin ? "Falta asignarles uno" : "Todas cubiertas"}
              />
            </div>

            {!visibles.length ? (
              <Vacio texto="Nada coincide con estos filtros." />
            ) : (
              <>
                <div className="space-y-5">
                  {grupos.slice(0, mostrar).map((g) => (
                    <section key={g.id}>
                      <header className="mb-2 flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="font-display truncate text-base font-bold">{g.nombre}</h2>
                          <p className="text-xs text-muted-foreground">
                            {g.ciudad} · {plural(g.filas.length, "postulación", "postulaciones")}
                            {g.sinFacilitador ? (
                              <span className="font-medium text-amber-700 dark:text-amber-400">
                                {" "}
                                · {numero.format(g.sinFacilitador)} sin facilitador
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <Link
                          to="/instituciones/$id"
                          params={{ id: String(g.id) }}
                          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                        >
                          <School className="size-3.5" />
                          Ficha
                          <ChevronRight className="size-3.5" />
                        </Link>
                      </header>
                      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                        {g.filas.map((p) => (
                          <li key={p.id}>
                            <TarjetaPostulacion
                              p={p}
                              turno={nombreTurno(p.turno)}
                              onAbrir={() => setEditando(p)}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {grupos.length > mostrar && (
                  <button
                    type="button"
                    onClick={() => setMostrar((n) => n + PASO)}
                    className="mt-5 h-11 w-full rounded-xl border border-border/80 bg-card text-sm font-semibold text-primary hover:border-primary/40"
                  >
                    Mostrar más instituciones ({numero.format(grupos.length - mostrar)})
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {editando && (
        <EditorPostulacion
          key={editando.id}
          p={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            qc.invalidateQueries({ queryKey: keysPostulaciones.todo });
            qc.invalidateQueries({ queryKey: keysInstituciones.lista });
          }}
        />
      )}
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Vacio({ texto }: { texto: string }) {
  return <p className="py-12 text-center text-sm text-muted-foreground">{texto}</p>;
}

function Resumen({
  etiqueta,
  valor,
  detalle,
  barra,
  alerta,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  /** Un porcentaje, como barra debajo del número. */
  barra?: number;
  alerta?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p
        className={`mt-0.5 text-xl font-bold tabular-nums ${
          alerta ? "text-amber-700 dark:text-amber-400" : ""
        }`}
      >
        {valor}
      </p>
      {barra != null && (
        <div className="mt-1.5 h-1.5 rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${barra}%` }} />
        </div>
      )}
      {detalle && <p className="mt-1 text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}

/**
 * Una postulación: qué clase es, cuándo, qué manuales lleva y quién la cubre.
 * Tocarla abre el modal 22.
 */
function TarjetaPostulacion({
  p,
  turno,
  onAbrir,
}: {
  p: PostulacionFila;
  turno: string;
  onAbrir: () => void;
}) {
  const alumnos = sumaGrados(p);
  const grados = GRADOS.filter((g) => p.grados[g.clave])
    .map((g) => `${g.corto.replace("°", "º")}: ${p.grados[g.clave]}`)
    .join(" · ");
  const manuales = MANUALES.filter((m) => p.manuales[m.clave]);
  const dias = franjas(p);

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap flex h-full w-full flex-col gap-2 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft hover:border-primary/40"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {turno && <span className="rounded-full bg-muted px-2 py-0.5">{turno}</span>}
        {p.seccion && <span className="rounded-full bg-muted px-2 py-0.5">Secc. {p.seccion}</span>}
        {p.enfasis && <span className="truncate">{p.enfasis}</span>}
      </div>

      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold">{p.materia || "Sin materia"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {p.docente || "Sin profesor"}
          {p.telefono ? ` · ${p.telefono}` : ""}
        </p>
      </div>

      {dias.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {dias.map((x) => (
            <span
              key={x.dia.clave}
              className="rounded-md bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
            >
              {x.dia.corto} {x.desde}–{x.hasta}
            </span>
          ))}
        </div>
      )}

      {(manuales.length > 0 || alumnos > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {manuales.map((m) => (
            <span
              key={m.clave}
              title={m.nombre}
              className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{ backgroundColor: m.color, color: m.tinta }}
            >
              {m.corto} {p.manuales[m.clave]}
            </span>
          ))}
          {alumnos > 0 && (
            <span title={grados} className="ml-1 text-[11px] text-muted-foreground">
              {plural(alumnos, "alumno", "alumnos")}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2 text-xs">
        {p.idFacilitador != null ? (
          <>
            <UserCheck className="size-3.5 shrink-0 text-primary" />
            <span className="truncate font-medium">{p.facilitador}</span>
          </>
        ) : (
          <>
            <UserX className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="font-medium text-amber-700 dark:text-amber-400">Sin facilitador</span>
          </>
        )}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La descarga "Excel" de APEX: lo que se ve, con las columnas del reporte. Es
 * un CSV con `;` y BOM, que es lo que Excel en español abre directo en
 * columnas y con tildes.
 */
function descargarCsv(filas: Fila[], turno: (t: number | null) => string, anio: string) {
  const cols: [string, (p: Fila) => string | number][] = [
    ["Turno", (p) => turno(p.turno)],
    ["Facilitador", (p) => p.facilitador],
    ["Institución", (p) => p.institucion],
    ["Sección", (p) => p.seccion],
    ...GRADOS.map((g): [string, (p: Fila) => number | string] => [
      g.corto.replace("°", "º"),
      (p) => p.grados[g.clave] || "",
    ]),
    ["Énfasis", (p) => p.enfasis],
    ...MANUALES.map((m): [string, (p: Fila) => number | string] => [
      m.nombre,
      (p) => p.manuales[m.clave] || "",
    ]),
    ...DIAS.map((d): [string, (p: Fila) => string] => [
      d.nombre,
      (p) => {
        const x = p.dias[d.clave];
        return x.desde || x.hasta ? `${x.desde}-${x.hasta}` : "";
      },
    ]),
    ["Materia", (p) => p.materia],
    ["Profesor", (p) => p.docente],
    ["Teléfono", (p) => p.telefono],
    ["Ciudad", (p) => p.ciudad],
    ["Año", (p) => p.anio],
  ];
  const celda = (v: string | number) => {
    const t = String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texto = [
    cols.map(([c]) => celda(c)).join(";"),
    ...filas.map((p) => cols.map(([, v]) => celda(v(p))).join(";")),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `postulaciones-${anio || "anio"}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
