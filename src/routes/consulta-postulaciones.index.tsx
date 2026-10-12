import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { EditorPostulacion } from "@/components/editor-postulacion";
import { LupaPlanilla } from "@/components/lupa-planilla";
import { MultiSelectorModal } from "@/components/multi-selector-modal";
import { SelectorModal } from "@/components/selector-modal";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { usePlanilla } from "@/lib/lupa";
import {
  DIAS,
  franjas,
  GRADOS,
  keysPostulaciones,
  listarTodasPostulaciones,
  MANUALES,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
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

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

const cant = (n: number) => (n ? String(n) : "");
const franja = (f: { desde: string; hasta: string }) =>
  f.desde || f.hasta ? `${f.desde}-${f.hasta}` : "";

/**
 * El ancho de cada columna del reporte, en el orden de APEX. Lo más compacto
 * que se puede sin achicar la letra (12 px), como las planillas de la 20 y de
 * la ficha; el total es el ancho natural que usa la lupa.
 */
const COLUMNAS = [
  180, // nombre institución
  64, // turno
  140, // facilitador
  50, // sección
  ...GRADOS.map(() => 32),
  100, // énfasis
  ...MANUALES.map(() => 40),
  ...DIAS.map(() => 78), // "07:00-07:40"
  110, // materia
  150, // profesor
  84, // teléfono
  44, // año
];
const ANCHO_TABLA = COLUMNAS.reduce((n, c) => n + c, 0);

/** El encabezado de un grado como en APEX: "2º" … "9º", "1M", "2M", "3M". */
const tituloGrado = (corto: string) => corto.replace("°M", "M").replace("°", "º");

/**
 * El orden del reporte de APEX: `order by turno, lunes, martes, miercoles,
 * jueves, viernes`, con los vacíos al final como hace Oracle en un ASC.
 */
function comparar(a: PostulacionFila, b: PostulacionFila) {
  const t = (a.turno ?? Infinity) - (b.turno ?? Infinity);
  if (t) return t;
  for (const d of DIAS) {
    const x = a.dias[d.clave].desde || "~";
    const y = b.dias[d.clave].desde || "~";
    if (x !== y) return x < y ? -1 : 1;
  }
  return a.id - b.id;
}

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
 *   tienen facilitador).
 *
 * **El detalle es el reporte de APEX** (a pedido, 12/10/2026; los filtros
 * quedan como estaban): las mismas columnas en el mismo orden, los manuales en
 * sus colores, el orden por turno y días, 50 filas por página y el nombre de
 * la institución como link al modal 22. Lleva la lupa de las otras planillas
 * de postulaciones; en el celular se desplaza de costado dentro de su caja.
 */
function ConsultaPostulacionesPage() {
  const qc = useQueryClient();
  const [anio, setAnio] = useState("");
  const [f, setF] = useState<Filtros>(SIN_FILTROS);
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState<PostulacionFila | null>(null);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(ANCHO_TABLA);

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

  const filtradas = useMemo(() => filas.filter((p) => pasa(p, f)).sort(comparar), [filas, f]);

  /**
   * Las columnas del reporte, en el orden de APEX: se ordenan y se filtran desde
   * su encabezado (`lib/tabla-reporte.ts`) y son también las del Excel.
   * Dependen de los nombres de los turnos, que llegan con las opciones.
   */
  const columnas = useMemo<ColumnaReporte<Fila>[]>(() => {
    const turnoDe = (t: number | null) =>
      t == null
        ? ""
        : ((opciones.data?.turno ?? []).find((o) => o.valor === String(t))?.mostrar ?? String(t));
    return [
      { clave: "institucion", titulo: "Nombre Institución", valor: (p) => p.institucion },
      { clave: "turno", titulo: "Turno", valor: (p) => turnoDe(p.turno), orden: (p) => p.turno },
      { clave: "facilitador", titulo: "Facilitador", valor: (p) => p.facilitador },
      { clave: "seccion", titulo: "Sección", valor: (p) => p.seccion },
      ...GRADOS.map((g): ColumnaReporte<Fila> => ({
        clave: g.clave,
        titulo: tituloGrado(g.corto),
        valor: (p) => cant(p.grados[g.clave]),
        orden: (p) => p.grados[g.clave] || null,
      })),
      { clave: "enfasis", titulo: "Énfasis", valor: (p) => p.enfasis },
      ...MANUALES.map((m): ColumnaReporte<Fila> => ({
        clave: m.clave,
        titulo: m.nombre,
        valor: (p) => cant(p.manuales[m.clave]),
        orden: (p) => p.manuales[m.clave] || null,
      })),
      ...DIAS.map((d): ColumnaReporte<Fila> => ({
        clave: d.clave,
        titulo: d.nombre,
        valor: (p) => franja(p.dias[d.clave]),
      })),
      { clave: "materia", titulo: "Materia", valor: (p) => p.materia },
      { clave: "profesor", titulo: "Profesor", valor: (p) => p.docente },
      { clave: "telefono", titulo: "Teléfono", valor: (p) => p.telefono },
      { clave: "anio", titulo: "Año", valor: (p) => p.anio },
    ];
  }, [opciones.data]);
  const tabla = useTablaReporte(filtradas, columnas);
  const visibles = tabla.visibles;
  const nInstituciones = new Set(visibles.map((p) => p.idInstitucion)).size;

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

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

  const cambiar = (cambios: Partial<Filtros>) => {
    setF((x) => ({ ...x, ...cambios }));
    setPagina(0);
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
          <BotonExcel
            onDescargar={() => descargarCsv(visibles, columnas, anioElegido)}
            deshabilitado={!visibles.length}
          />
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
              setPagina(0);
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
              onClick={() => {
                cambiar(SIN_FILTROS);
                tabla.limpiar();
              }}
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
              <Resumen etiqueta="Instituciones" valor={numero.format(nInstituciones)} />
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

            {/* "Resultados de la Búsqueda": el reporte de APEX. */}
            <section className="rounded-lg border border-border bg-card shadow-soft">
              <FiltrosColumnas tabla={tabla} />
              {!visibles.length ? (
                <Vacio texto="No se ha encontrado ningún dato" />
              ) : (
                <>
                  <div className="border-b border-border px-4 py-2">
                    <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />
                  </div>
                  <div ref={marco} className={cabe ? "" : "overflow-x-auto"}>
                    <table
                      style={{ zoom, width: ANCHO_TABLA }}
                      className={`table-fixed border-separate border-spacing-0 text-[12px] ${zoom >= 1 ? "min-w-full" : ""}`}
                    >
                      <colgroup>
                        {COLUMNAS.map((c, i) => (
                          <col key={i} style={{ width: c }} />
                        ))}
                      </colgroup>
                      <thead
                        className={cabe ? "sticky z-10" : ""}
                        style={cabe ? { top: topEncabezado } : undefined}
                      >
                        <tr>
                          {columnas.map((c) => {
                            // Grados, manuales y días van centrados; los
                            // manuales, con su sigla ("SER") por el ancho.
                            const manual = MANUALES.find((m) => m.clave === c.clave);
                            const centro =
                              !!manual ||
                              GRADOS.some((g) => g.clave === c.clave) ||
                              DIAS.some((d) => d.clave === c.clave);
                            return (
                              <Th key={c.clave} centro={centro}>
                                <EncabezadoReporte
                                  columna={c}
                                  tabla={tabla}
                                  centro={centro}
                                  etiqueta={manual?.corto}
                                />
                              </Th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((p) => (
                          <tr key={p.id} className="hover:bg-muted/40">
                            <td className="truncate border-r border-b border-border/40 px-1 py-1">
                              <button
                                type="button"
                                onClick={() => setEditando(p)}
                                title={p.institucion}
                                className="max-w-full truncate text-left font-medium text-primary hover:underline"
                              >
                                {p.institucion}
                              </button>
                            </td>
                            <Td texto={nombreTurno(p.turno)} />
                            <Td texto={p.facilitador} />
                            <Td texto={p.seccion} />
                            {GRADOS.map((g) => (
                              <Td key={g.clave} texto={cant(p.grados[g.clave])} num />
                            ))}
                            <Td texto={p.enfasis} />
                            {MANUALES.map((m) => (
                              <td
                                key={m.clave}
                                className="border-r border-b border-border/40 px-1 py-1 text-center font-semibold tabular-nums"
                                style={{ backgroundColor: m.color, color: m.tinta }}
                              >
                                {cant(p.manuales[m.clave])}
                              </td>
                            ))}
                            {DIAS.map((d) => (
                              <Td key={d.clave} texto={franja(p.dias[d.clave])} num />
                            ))}
                            <Td texto={p.materia} />
                            <Td texto={p.docente} />
                            <Td texto={p.telefono} />
                            <Td texto={p.anio} num />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* La paginación de APEX: "1 - 50" con anterior y siguiente, abajo a la derecha. */}
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
                      {numero.format(desde + 1)} - {numero.format(desde + enPagina.length)} de{" "}
                      {numero.format(visibles.length)}
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
            </section>
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

/** El encabezado compacto; el título completo queda en el `title` si se abrevia. */
function Th({
  children,
  titulo,
  centro,
}: {
  children?: ReactNode;
  titulo?: string;
  centro?: boolean;
}) {
  return (
    <th
      title={titulo ?? (typeof children === "string" ? children : undefined)}
      className={`truncate border-r border-b border-border/60 bg-muted px-1 py-1.5 text-[11px] font-semibold ${
        centro ? "text-center" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

/** La celda compacta: lo que no entra se corta con "…" y se lee entero al pasar el mouse. */
function Td({ texto, num }: { texto: string; num?: boolean }) {
  return (
    <td
      title={texto || undefined}
      className={`truncate border-r border-b border-border/40 px-1 py-1 ${
        num ? "text-center tabular-nums" : ""
      }`}
    >
      {texto}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Excel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * La descarga "Excel" de APEX: todo lo filtrado (no solo la página), en el
 * orden en que se ve y con las columnas del reporte. Ver `lib/excel.ts`.
 */
function descargarCsv(filas: Fila[], columnas: ColumnaReporte<Fila>[], anio: string) {
  descargarExcel(
    `postulaciones-${anio || "anio"}`,
    columnas.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
    filas,
  );
}
