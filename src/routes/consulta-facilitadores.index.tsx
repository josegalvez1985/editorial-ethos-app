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
  keysFacilitadores,
  listarFacilitadores,
  opcionesFacilitador,
  type FacilitadorFila,
} from "@/lib/facilitadores";
import { ordenFecha, useTablaReporte, type ColumnaReporte } from "@/lib/tabla-reporte";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/consulta-facilitadores/")({
  head: () => ({
    meta: [
      { title: "Consulta de Facilitadores — Juventud con Valores" },
      {
        name: "description",
        content: "Los facilitadores con sus datos personales y si están activos.",
      },
    ],
  }),
  component: ConsultaFacilitadoresPage,
});

const numero = new Intl.NumberFormat("es-PY");

/** Las filas por página del reporte, como el "Number of Rows" de APEX. */
const POR_PAGINA = 50;

/** Un facilitador con los textos de las listas ya puestos y el del buscador. */
type Fila = FacilitadorFila & {
  estadoCivilTexto: string;
  conQuienViveTexto: string;
  busqueda: string;
};

/**
 * Las columnas visibles del reporte de APEX, en su orden. Cada una se ordena y
 * se filtra desde su encabezado (`lib/tabla-reporte.ts`).
 */
const COLUMNAS: ColumnaReporte<Fila>[] = [
  { clave: "nombre", titulo: "Nombre Completo", valor: (f) => f.nombre },
  { clave: "ci", titulo: "Nro CI", valor: (f) => f.ci },
  { clave: "nacionalidad", titulo: "Nacionalidad", valor: (f) => f.nacionalidad },
  {
    clave: "fecha_nacimiento",
    titulo: "Fecha Nacimiento",
    valor: (f) => f.fechaNacimiento,
    orden: (f) => ordenFecha(f.fechaNacimiento),
  },
  { clave: "edad", titulo: "Edad", valor: (f) => f.edad },
  { clave: "estado_civil", titulo: "Estado Civil", valor: (f) => f.estadoCivilTexto },
  { clave: "con_quien_vive", titulo: "Con Quién Vive", valor: (f) => f.conQuienViveTexto },
  { clave: "hijos", titulo: "Hijos", valor: (f) => f.hijos },
  { clave: "telefono", titulo: "Teléfono", valor: (f) => f.telefono },
  { clave: "observacion", titulo: "Observación", valor: (f) => f.observacion },
];

/**
 * Consulta de Facilitadores: la página 62 de APEX (una búsqueda con facetas
 * sobre `FACILITADORES`): cada facilitador con sus datos personales y si está
 * activo. Es de solo lectura; para editar está Facilitadores
 * (`/facilitadores`). El ícono es el que ya tenía en el menú (`IdCard`).
 *
 * Backend: `GET facilitadores` de `backend/facilitadores.sql`, el mismo listado
 * de la pantalla Facilitadores, sin SQL propio. Desde el 12/10/2026 trae
 * también la fecha de nacimiento, la edad, el estado civil, con quién vive,
 * los hijos, la observación, la dirección y la ubicación: hasta que se vuelva
 * a correr el script, esas columnas salen vacías.
 *
 * Como en APEX:
 *
 * - La faceta Activo (Sí / No, con cuántos; sin dato cuenta como No, el
 *   `nvl(activo,'NO')` de APEX) y el buscador sobre los datos del facilitador,
 *   y Restablecer.
 * - El reporte con sus columnas visibles en el mismo orden, ordenado por
 *   nombre, 50 filas por página con la paginación abajo a la derecha.
 *
 * Distinto de APEX, a propósito:
 *
 * - El nombre abre la ficha del facilitador.
 * - Estado civil y con quién vive con el texto de su lista (APEX mostraba el
 *   valor guardado).
 * - Un resumen arriba: facilitadores, activos, inactivos y edad promedio.
 * - Orden y filtro por columna, y Excel (APEX no tenía la descarga en esta).
 */
function ConsultaFacilitadoresPage() {
  const [activo, setActivo] = useState<"" | "S" | "N">("");
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(0);

  const lista = useQuery({ queryKey: keysFacilitadores.lista, queryFn: listarFacilitadores });
  const opciones = useQuery({
    queryKey: keysFacilitadores.opciones,
    queryFn: opcionesFacilitador,
    staleTime: 10 * 60 * 1000,
  });

  const filas = useMemo<Fila[]>(() => {
    const mostrar = (lista: { valor: string; mostrar: string }[] | undefined, v: string) =>
      lista?.find((o) => o.valor === v)?.mostrar ?? v;
    return (lista.data ?? []).map((f) => {
      const estadoCivilTexto = mostrar(opciones.data?.estado_civil, f.estadoCivil);
      const conQuienViveTexto = mostrar(opciones.data?.con_quien_vive, f.conQuienVive);
      return {
        ...f,
        estadoCivilTexto,
        conQuienViveTexto,
        // Las columnas de P62_SEARCH.
        busqueda: normalizar(
          [
            f.nombre,
            f.ci,
            f.nacionalidad,
            estadoCivilTexto,
            conQuienViveTexto,
            f.hijos,
            f.telefono,
            f.departamento,
            f.ciudad,
            f.barrio,
            f.direccion,
            f.ubicacion,
            f.usuario,
            f.email,
            f.observacion,
          ].join(" "),
        ),
      };
    });
  }, [lista.data, opciones.data]);

  const q = normalizar(texto.trim());
  const porTexto = useMemo(() => filas.filter((f) => !q || f.busqueda.includes(q)), [filas, q]);
  const nActivos = porTexto.filter((f) => f.activo).length;

  const filtradas = useMemo(
    () => porTexto.filter((f) => !activo || (activo === "S") === f.activo),
    [porTexto, activo],
  );
  const tabla = useTablaReporte(filtradas, COLUMNAS);
  const visibles = tabla.visibles;

  const activos = visibles.filter((f) => f.activo).length;
  const conEdad = visibles.filter((f) => f.edad != null);
  const edadPromedio = conEdad.length
    ? Math.round(conEdad.reduce((s, f) => s + (f.edad ?? 0), 0) / conEdad.length)
    : null;

  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const desde = pag * POR_PAGINA;
  const enPagina = visibles.slice(desde, desde + POR_PAGINA);

  const restablecer = () => {
    setActivo("");
    setTexto("");
    tabla.limpiar();
    setPagina(0);
  };
  const hayFiltros = !!activo || !!texto.trim() || tabla.activo;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Consulta de Facilitadores</h1>
            <p className="text-xs text-muted-foreground">
              Cada facilitador con sus datos personales y si está activo
            </p>
          </div>
          <BotonExcel
            onDescargar={() =>
              descargarExcel(
                "facilitadores",
                [
                  ...COLUMNAS.map((c): ColumnaExcel<Fila> => [c.titulo, c.valor]),
                  ["Activo", (f) => (f.activo ? "Sí" : "No")],
                ],
                visibles,
              )
            }
            deshabilitado={!visibles.length}
          />
        </div>

        {/* ── Filtros: la faceta Activo y el buscador ──────────────────── */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Activo"
            className="flex h-11 w-full rounded-xl border border-input bg-card p-0.5 text-sm sm:w-auto"
          >
            {(
              [
                { valor: "", texto: "Todos", n: porTexto.length },
                { valor: "S", texto: "Activos", n: nActivos },
                { valor: "N", texto: "Inactivos", n: porTexto.length - nActivos },
              ] as const
            ).map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={activo === o.valor}
                onClick={() => {
                  setActivo(o.valor);
                  setPagina(0);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 font-medium whitespace-nowrap transition-colors ${
                  activo === o.valor
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
              placeholder="Buscar nombre, CI, teléfono, ciudad, usuario…"
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
          <Fallo error={lista.error} texto="No se pudieron cargar los facilitadores" />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Resumen etiqueta="Facilitadores" valor={numero.format(visibles.length)} />
              <Resumen etiqueta="Activos" valor={numero.format(activos)} />
              <Resumen etiqueta="Inactivos" valor={numero.format(visibles.length - activos)} />
              <Resumen
                etiqueta="Edad promedio"
                valor={edadPromedio == null ? "—" : `${edadPromedio} años`}
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
                              className={`border-r border-b border-border bg-muted px-3 py-2 text-xs font-semibold last:border-r-0 ${
                                c.clave === "edad" ? "text-right" : "text-left"
                              }`}
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
                                to="/facilitadores/$id"
                                params={{ id: String(f.id) }}
                                className="font-medium text-primary hover:underline"
                              >
                                {f.nombre}
                              </Link>
                              {!f.activo && (
                                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                  Inactivo
                                </span>
                              )}
                            </Td>
                            <Td numero>{f.ci}</Td>
                            <Td>{f.nacionalidad}</Td>
                            <Td numero>{f.fechaNacimiento}</Td>
                            <Td numero derecha>
                              {f.edad ?? ""}
                            </Td>
                            <Td>{f.estadoCivilTexto}</Td>
                            <Td>{f.conQuienViveTexto}</Td>
                            <Td>{f.hijos}</Td>
                            <Td numero>{f.telefono}</Td>
                            <Td>{f.observacion}</Td>
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
function Td({
  children,
  numero: num,
  derecha,
}: {
  children: ReactNode;
  numero?: boolean;
  derecha?: boolean;
}) {
  return (
    <td
      className={`border-r border-b border-border/60 px-3 py-1.5 last:border-r-0 ${
        num ? "tabular-nums whitespace-nowrap" : ""
      } ${derecha ? "text-right" : ""}`}
    >
      {children}
    </td>
  );
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-soft">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{valor}</p>
    </div>
  );
}
