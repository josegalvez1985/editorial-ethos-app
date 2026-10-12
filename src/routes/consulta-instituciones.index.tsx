import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { BotonExcel } from "@/components/boton-excel";
import { EncabezadoReporte, FiltrosColumnas } from "@/components/columna-reporte";
import { descargarExcel, type ColumnaExcel } from "@/lib/excel";
import {
  keysInstituciones,
  listarInstituciones,
  opcionesInstitucion,
  type InstitucionFila,
} from "@/lib/instituciones";
import { useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-instituciones/")({
  head: () => ({
    meta: [
      { title: "Consulta de Instituciones — Juventud con Valores" },
      {
        name: "description",
        content: "Las instituciones con su ubicación, su facilitador y su estado.",
      },
    ],
  }),
  component: ConsultaInstitucionesPage,
});

const numero = new Intl.NumberFormat("es-PY");

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

/**
 * Una fila: la institución con su estado como lo cuenta APEX en esta página
 * (`nvl(estado,'I')`: sin estado cargado es Inactiva) y el texto del buscador.
 */
type Fila = InstitucionFila & { estadoApex: string; busqueda: string };

/**
 * Las columnas visibles del reporte de APEX, en su orden. Cada una se ordena y
 * se filtra desde su encabezado (`lib/tabla-reporte.ts`).
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "institucion", titulo: "Institución", valor: (f) => f.nombre },
  { clave: "departamento", titulo: "Departamento", valor: (f) => f.departamento },
  { clave: "ciudad", titulo: "Ciudad", valor: (f) => f.ciudad },
  { clave: "barrio", titulo: "Barrio", valor: (f) => f.barrio },
  { clave: "direccion", titulo: "Dirección", valor: (f) => f.direccion },
  { clave: "zona", titulo: "Zona", valor: (f) => f.zona },
  { clave: "facilitador", titulo: "Facilitador", valor: (f) => f.facilitador },
  { clave: "comentario", titulo: "Comentario", valor: (f) => f.comentario },
];

/**
 * Consulta de Instituciones: la página 61 de APEX (una búsqueda con facetas
 * sobre `INSTITUCIONES`): cada institución con su ubicación, su facilitador y
 * su estado. Es de solo lectura; para editar está Instituciones (`/instituciones`).
 * El ícono es el que ya tenía en el menú (`Library`).
 *
 * Backend: `GET instituciones` de `backend/instituciones.sql`, el mismo listado
 * de la pantalla Instituciones, sin SQL propio. Desde el 12/10/2026 trae
 * también el comentario, que es una columna de este reporte: hasta que se
 * vuelva a correr el script, esa columna sale vacía.
 *
 * Como en APEX:
 *
 * - La faceta Estado (Activo / Inactivo, con cuántas) y el buscador sobre los
 *   textos de la institución (nombre, ubicación, dirección, zona, director,
 *   facilitador, comentario), y Restablecer.
 * - El reporte con sus columnas visibles en el mismo orden (Institución,
 *   Departamento, Ciudad, Barrio, Dirección, Zona, Facilitador, Comentario),
 *   ordenado por nombre, 50 filas por página con la paginación abajo a la
 *   derecha.
 * - **Sin estado cargado cuenta como Inactiva**, como en la consulta de APEX
 *   (`nvl(estado,'I')`). La pantalla Instituciones la cuenta como activa.
 *
 * Distinto de APEX, a propósito:
 *
 * - El nombre de la institución abre su ficha.
 * - Un resumen arriba: instituciones, activas, inactivas y sin facilitador.
 * - Orden y filtro por columna, y Excel (APEX no tenía la descarga en esta).
 * - El buscador no mira los textos viejos de la tabla (DIRECTOR, NRO_CI,
 *   TELEFONO, COORDINADOR, HORARIO, CARGO, NIVEL, TURNO): hoy las autoridades
 *   y el horario viven en sus propias tablas. Mira el director vigente.
 */
function ConsultaInstitucionesPage() {
  const [estado, setEstado] = useState("");
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(0);

  const lista = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });
  const opciones = useQuery({
    queryKey: keysInstituciones.opciones,
    queryFn: opcionesInstitucion,
    staleTime: 10 * 60 * 1000,
  });
  const nombreEstado = (v: string) =>
    opciones.data?.estado.find((o) => o.valor === v)?.mostrar ??
    (v === "A" ? "Activo" : v === "I" ? "Inactivo" : v);

  const filas = useMemo<Fila[]>(
    () =>
      (lista.data?.items ?? []).map((i) => ({
        ...i,
        estadoApex: (i.estado || "I").toUpperCase(),
        busqueda: normalizar(
          [
            i.nombre,
            i.departamento,
            i.ciudad,
            i.barrio,
            i.direccion,
            i.ubicacion,
            i.zona,
            i.director,
            i.directorTelefono,
            i.facilitador,
            i.comentario,
          ].join(" "),
        ),
      })),
    [lista.data],
  );

  const q = normalizar(texto.trim());
  const porTexto = useMemo(() => filas.filter((f) => !q || f.busqueda.includes(q)), [filas, q]);
  // La faceta Estado: cuántas tiene cada valor con el buscador puesto.
  const estados = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of porTexto) m.set(f.estadoApex, (m.get(f.estadoApex) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [porTexto]);

  const filtradas = useMemo(
    () => porTexto.filter((f) => !estado || f.estadoApex === estado),
    [porTexto, estado],
  );
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  const activas = visibles.filter((f) => f.estadoApex === "A").length;
  const sinFacilitador = visibles.filter((f) => f.idFacilitador == null).length;

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

  const restablecer = () => {
    setEstado("");
    setTexto("");
    tabla.limpiar();
    setPagina(0);
  };
  const hayFiltros = !!estado || !!texto.trim() || tabla.activo;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Consulta de Instituciones</h1>
            <p className="text-xs text-muted-foreground">
              Cada institución con su ubicación, su facilitador y su estado
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                "instituciones",
                [
                  ...COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                  ["Estado", (f) => nombreEstado(f.estadoApex)],
                ],
                visibles,
              )
            }
            deshabilitado={!visibles.length}
          />
        </div>

        {/* ── Filtros: la faceta Estado y el buscador ──────────────────── */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Estado"
            className="flex h-11 w-full rounded-xl border border-input bg-card p-0.5 text-sm sm:w-auto"
          >
            {[
              { valor: "", texto: "Todas", n: porTexto.length },
              ...estados.map(([v, n]) => ({ valor: v, texto: nombreEstado(v), n })),
            ].map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={estado === o.valor}
                onClick={() => {
                  setEstado(o.valor);
                  setPagina(0);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 font-medium whitespace-nowrap transition-colors ${
                  estado === o.valor
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.texto}
                <span className="text-[11px] tabular-nums opacity-80">{numero.format(o.n)}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 basis-64 [&>div]:mb-0">
            <Buscador
              valor={texto}
              onCambio={(v) => {
                setTexto(v);
                setPagina(0);
              }}
              placeholder="Buscar institución, ciudad, dirección, director, facilitador…"
            />
          </div>
          {hayFiltros && (
            <button
              type="button"
              onClick={restablecer}
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-3" />
              Restablecer
            </button>
          )}
        </div>

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {lista.isLoading ? (
          <Cargando />
        ) : lista.isError ? (
          <Fallo error={lista.error} texto="No se pudieron cargar las instituciones" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Instituciones" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Activas" valor={numero.format(activas)} />
              <Resumen etiqueta="Inactivas" valor={numero.format(visibles.length - activas)} />
              <Resumen
                etiqueta="Sin facilitador"
                valor={numero.format(sinFacilitador)}
                alerta={sinFacilitador > 0}
              />
            </div>

            {/* "Resultados de la Búsqueda": el reporte de APEX. */}
            <section className="rounded-lg border border-border bg-card shadow-soft">
              <FiltrosColumnas tabla={tabla} />
              {!visibles.length ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No se ha encontrado ningún dato
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-[13px]">
                      <thead>
                        <tr>
                          {COLUMNAS.map((c) => (
                            <th
                              key={c.clave}
                              className="border-r border-b border-border bg-muted px-3 py-2 text-left text-xs font-semibold last:border-r-0"
                            >
                              <EncabezadoReporte columna={c} tabla={tabla} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {enPagina.map((f) => (
                          <tr key={f.id} className="align-top hover:bg-muted/40">
                            <Td>
                              <Link
                                to="/instituciones/$id"
                                params={{ id: String(f.id) }}
                                className="font-medium text-primary hover:underline"
                              >
                                {f.nombre}
                              </Link>
                              {f.estadoApex !== "A" && (
                                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                  {nombreEstado(f.estadoApex)}
                                </span>
                              )}
                            </Td>
                            <Td>{f.departamento}</Td>
                            <Td>{f.ciudad}</Td>
                            <Td>{f.barrio}</Td>
                            <Td>{f.direccion}</Td>
                            <Td>{f.zona}</Td>
                            <Td>{f.facilitador}</Td>
                            <Td>{f.comentario}</Td>
                          </tr>
                        ))}
                      </tbody>
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
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** La celda, con borde vertical: toda tabla de detalle lleva marcos entre columnas. */
function Td({ children }: { children: ReactNode }) {
  return (
    <td className="border-r border-b border-border/60 px-3 py-1.5 last:border-r-0">{children}</td>
  );
}

function Resumen({
  etiqueta,
  valor,
  alerta,
}: {
  etiqueta: string;
  valor: string;
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
    </div>
  );
}
