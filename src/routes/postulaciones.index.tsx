import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Eraser, FileText, FolderPlus, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Campo, EditorPostulacion, Filtro } from "@/components/editor-postulacion";
import { LupaPlanilla } from "@/components/lupa-planilla";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { keysBarrios, listarBarrios } from "@/lib/barrios";
import { keysCiudades, listarCiudades } from "@/lib/ciudades";
import { keysDepartamentos, listarDepartamentos } from "@/lib/departamentos";
import type { Opcion } from "@/lib/evaluaciones";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import { usePlanilla } from "@/lib/lupa";
import { generarPdfPostulaciones, nombrePdfPostulaciones } from "@/lib/pdf-postulaciones";
import { usePermisos } from "@/lib/permisos";
import {
  COLORES_APEX as APEX,
  DIAS,
  eliminarPostulacionesLote,
  generarPostulaciones,
  GRADOS,
  keysPostulaciones,
  listarTodasPostulaciones,
  MANUALES,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/postulaciones/")({
  head: () => ({
    meta: [
      { title: "Postulaciones — Juventud con Valores" },
      { name: "description", content: "Las postulaciones de cada institución, por año." },
    ],
  }),
  component: PostulacionesPage,
});

const RUTA = "/postulaciones";

const SIN_FILTROS: Omit<FiltrosPostulaciones, "anio"> = {
  idDepartamento: null,
  idCiudad: null,
  idBarrio: null,
  idInstitucion: null,
  turno: null,
};

/**
 * El ancho de cada columna de la grilla, en el orden en que se pintan: lo
 * más compacto que se puede sin achicar la letra (12 px), como la grilla de
 * la ficha. El total es el ancho natural de la planilla, el que usa la lupa.
 */
const COLUMNAS = [
  32, // lápiz
  170, // institución
  64, // turno
  46, // sección
  ...GRADOS.map(() => 32),
  96, // énfasis
  ...MANUALES.map(() => 38),
  ...DIAS.map(() => 78), // "07:00-07:40"
  110, // materia
  150, // profesor
  84, // teléfono
  130, // facilitador
];
const ANCHO_TABLA = COLUMNAS.reduce((n, c) => n + c, 0);

const cant = (n: number) => (n ? String(n) : "");
const franja = (f: { desde: string; hasta: string }) =>
  f.desde || f.hasta ? `${f.desde}-${f.hasta}` : "";

/**
 * Postulaciones: la página 20 de APEX (un IG de solo lectura sobre
 * POSTULACIONES de todas las instituciones, con la región "Parámetros" de
 * filtros y los botones Generar, Eliminar, Imprimir y Limpiar Filtros) y su
 * modal 22 (Crear Postulación), que acá es el diálogo de la pantalla con los
 * permisos de la 20. Backend: `backend/postulaciones.sql`, el mismo de la
 * pestaña Postulaciones de la ficha (`listar_todas`, `generar` y
 * `eliminar_lote` son de esta página). El ícono es el que ya tenía en el
 * menú (`FileUser`).
 *
 * **Con el formato de APEX, a pedido (09/10/2026, solo esta página):** los
 * mismos filtros con su fondo celeste, la grilla con las mismas columnas y
 * los manuales en sus colores, el lápiz que abre el modal 22 con los mismos
 * campos y colores por grupo, y el PDF de "Imprimir" (`lib/pdf-postulaciones.ts`).
 * Como en APEX, no hay "Crear": las filas nacen con "Generar" o de los
 * pre-horarios. Los filtros se encadenan (departamento → ciudad → barrio →
 * institución) y elegir uno limpia los de abajo.
 *
 * Distinto de APEX, a propósito:
 *
 * - **La grilla carga recién con una institución elegida** (a pedido): antes
 *   traía las de todas. Hasta entonces solo se piden los años del filtro.
 * - **Eliminar** borra solo las del AÑO elegido (APEX borraba las de todos
 *   los años de la institución) y saltea las que tienen intervenciones o
 *   evaluaciones; pide confirmación diciendo cuántas son.
 * - **Imprimir** sale de lo que muestra la grilla (año y turno elegidos);
 *   APEX mezclaba todos los años de la institución.
 * - En el modal, el valor sugerido de los manuales (el primer grado con
 *   cantidad, como el COPIAR_VALOR de APEX) se pone al entrar al campo solo
 *   si está vacío: APEX lo pisaba siempre.
 */
function PostulacionesPage() {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const ficha = puedeRuta("/instituciones", "actualizar");
  const puedeGenerar = ficha || puedeRuta(RUTA, "insertar");
  const puedeEliminar = ficha || puedeRuta(RUTA, "borrar");

  const [anio, setAnio] = useState("");
  const [f, setF] = useState(SIN_FILTROS);
  const [buscar, setBuscar] = useState("");
  const [editando, setEditando] = useState<PostulacionFila | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const { marco, zoom, setZoom, cabe, ajustar, topEncabezado } = usePlanilla(ANCHO_TABLA);

  // Las postulaciones se cargan recién con una institución elegida (09/10/2026,
  // a pedido): sin ella eran las de todas y la página tardaba en abrir.
  const conInst = f.idInstitucion != null;
  const filtros: FiltrosPostulaciones = { anio, ...f };
  const lista = useQuery({
    queryKey: keysPostulaciones.todas(filtros),
    queryFn: () => listarTodasPostulaciones(filtros),
    enabled: conInst,
  });
  // Mientras tanto, solo los años para el filtro: la institución -1 no
  // existe, así que el backend no trae filas.
  const soloAnios: FiltrosPostulaciones = { anio: "", ...SIN_FILTROS, idInstitucion: -1 };
  const anuario = useQuery({
    queryKey: keysPostulaciones.todas(soloAnios),
    queryFn: () => listarTodasPostulaciones(soloAnios),
    enabled: !conInst,
  });
  const base = lista.data ?? anuario.data;
  const deps = useQuery({ queryKey: keysDepartamentos.todo, queryFn: listarDepartamentos });
  const ciudades = useQuery({ queryKey: keysCiudades.todo, queryFn: listarCiudades });
  const barrios = useQuery({ queryKey: keysBarrios.todo, queryFn: listarBarrios });
  const insts = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });
  const opciones = useQuery({
    queryKey: keysPreHorarios.opciones,
    queryFn: opcionesPreHorario,
    staleTime: 10 * 60 * 1000,
  });

  const anioElegido = lista.data?.anio ?? (anio || (base?.anioActual ?? ""));
  const anios = [...new Set([base?.anioActual ?? "", ...(base?.anios ?? [])].filter(Boolean))].sort(
    (a, b) => b.localeCompare(a),
  );
  const turnos = opciones.data?.turno ?? [];
  const nombreTurno = (t: number | null) =>
    t == null ? "" : (turnos.find((o) => o.valor === String(t))?.mostrar ?? String(t));

  // Las listas encadenadas, como las LOV en cascada de APEX.
  const ciudadesDep = (ciudades.data?.items ?? []).filter(
    (c) => f.idDepartamento == null || c.padre?.id === f.idDepartamento,
  );
  const depDeCiudad = new Map((ciudades.data?.items ?? []).map((c) => [c.id, c.padre?.id]));
  const barriosFil = (barrios.data?.items ?? []).filter(
    (b) =>
      (f.idCiudad == null || b.padre?.id === f.idCiudad) &&
      (f.idDepartamento == null || depDeCiudad.get(b.padre?.id ?? -1) === f.idDepartamento),
  );
  const instsFil = (insts.data?.items ?? []).filter(
    (i) =>
      (f.idDepartamento == null || i.idDepartamento === f.idDepartamento) &&
      (f.idCiudad == null || i.idCiudad === f.idCiudad) &&
      (f.idBarrio == null || i.idBarrio === f.idBarrio),
  );
  const opc = (xs: { id: number; nombre: string; extra?: string }[]): Opcion[] =>
    xs.map((x) => ({
      id: x.id,
      texto: x.nombre,
      extra: x.extra,
      busqueda: normalizar(`${x.nombre} ${x.extra ?? ""}`),
    }));
  const institucion = (insts.data?.items ?? []).find((i) => i.id === f.idInstitucion);

  const filas = lista.data?.items ?? [];
  const q = normalizar(buscar.trim());
  const visibles = q
    ? filas.filter((p) =>
        normalizar(
          [
            p.institucion,
            p.seccion,
            p.enfasis,
            p.materia,
            p.docente,
            p.telefono,
            p.facilitador,
          ].join(" "),
        ).includes(q),
      )
    : filas;

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: keysPostulaciones.todo });
    qc.invalidateQueries({ queryKey: keysInstituciones.lista });
  };

  const generar = useMutation({
    mutationFn: () => generarPostulaciones(f.idInstitucion!, f.turno),
    onSuccess: () => {
      invalidar();
      toast.success("Se generaron las postulaciones");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo generar"),
  });

  const eliminar = useMutation({
    mutationFn: () => eliminarPostulacionesLote(f.idInstitucion!, f.turno, anioElegido),
    onSuccess: (r) => {
      invalidar();
      toast.success("Se eliminaron las postulaciones", {
        description: r.salteadas
          ? `${r.eliminadas} eliminadas. ${r.salteadas} quedaron porque tienen intervenciones o evaluaciones.`
          : `${r.eliminadas} eliminadas.`,
      });
      setEliminando(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const imprimir = async () => {
    if (!institucion) return;
    setImprimiendo(true);
    try {
      const deLaInst = filas.filter((p) => p.idInstitucion === institucion.id);
      await abrirPdfEnPestana(
        () => generarPdfPostulaciones(institucion.nombre, deLaInst),
        nombrePdfPostulaciones(institucion.nombre, anioElegido),
      );
    } finally {
      setImprimiendo(false);
    }
  };

  const sinInst = f.idInstitucion == null ? "Elegí la institución en los parámetros" : undefined;
  const aEliminar = filas.filter((p) => p.idInstitucion === f.idInstitucion);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <h1 className="font-display mb-4 text-2xl font-bold">Postulaciones</h1>

        {/* La región "Parámetros" de APEX. */}
        <section className="mb-4 rounded-lg border border-border bg-card p-4 shadow-soft">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Campo etiqueta="Año">
              <select
                value={anioElegido}
                onChange={(e) => setAnio(e.target.value)}
                style={APEX.filtro}
                className="h-10 w-full rounded-md border border-input px-2 text-sm"
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Departamento">
              <select
                value={f.idDepartamento ?? ""}
                onChange={(e) =>
                  setF({
                    ...SIN_FILTROS,
                    turno: f.turno,
                    idDepartamento: e.target.value ? Number(e.target.value) : null,
                  })
                }
                style={APEX.filtro}
                className="h-10 w-full rounded-md border border-input px-2 text-sm"
              >
                <option value="">Todos</option>
                {(deps.data?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Filtro
              etiqueta="Ciudades"
              opciones={opc(ciudadesDep)}
              valor={f.idCiudad}
              texto={ciudadesDep.find((c) => c.id === f.idCiudad)?.nombre ?? null}
              onCambio={(id) => setF({ ...f, idCiudad: id, idBarrio: null, idInstitucion: null })}
            />
            <Filtro
              etiqueta="Barrios"
              opciones={opc(barriosFil.map((b) => ({ ...b, extra: b.padre?.nombre })))}
              valor={f.idBarrio}
              texto={barriosFil.find((b) => b.id === f.idBarrio)?.nombre ?? null}
              onCambio={(id) => setF({ ...f, idBarrio: id, idInstitucion: null })}
            />
            <Filtro
              etiqueta="Institución"
              opciones={opc(instsFil.map((i) => ({ ...i, extra: i.ciudad })))}
              valor={f.idInstitucion}
              texto={institucion?.nombre ?? null}
              onCambio={(id) => setF({ ...f, idInstitucion: id })}
            />
            <Campo etiqueta="Turno">
              <select
                value={f.turno ?? ""}
                onChange={(e) =>
                  setF({ ...f, turno: e.target.value ? Number(e.target.value) : null })
                }
                style={APEX.filtro}
                className="h-10 w-full rounded-md border border-input px-2 text-sm"
              >
                <option value=""></option>
                {turnos.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.mostrar}
                  </option>
                ))}
              </select>
            </Campo>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {puedeGenerar && (
              <Boton
                icono={<FolderPlus className="size-4" />}
                onClick={() => generar.mutate()}
                deshabilitado={!!sinInst || generar.isPending}
                titulo={sinInst}
                pendiente={generar.isPending}
              >
                Generar
              </Boton>
            )}
            {puedeEliminar && (
              <Boton
                icono={<Trash2 className="size-4" />}
                peligro
                onClick={() => setEliminando(true)}
                deshabilitado={!!sinInst}
                titulo={sinInst}
              >
                Eliminar
              </Boton>
            )}
            <Boton
              icono={<FileText className="size-4" />}
              onClick={() => void imprimir()}
              deshabilitado={!!sinInst || imprimiendo || lista.isLoading}
              titulo={sinInst}
              pendiente={imprimiendo}
            >
              Imprimir
            </Boton>
            <Boton
              icono={<Eraser className="size-4" />}
              onClick={() => {
                setF(SIN_FILTROS);
                setBuscar("");
              }}
            >
              Limpiar Filtros
            </Boton>
          </div>
        </section>

        {/* El IG "Postulaciones". */}
        <section className="rounded-lg border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">Postulaciones</h2>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={buscar}
                onChange={(e) => {
                  setBuscar(e.target.value);
                }}
                placeholder="Buscar"
                aria-label="Buscar en la grilla"
                className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {!conInst ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Elegí una institución en los parámetros para ver sus postulaciones.
            </p>
          ) : lista.isLoading ? (
            <Cargando />
          ) : lista.isError ? (
            <div className="p-4">
              <Fallo error={lista.error} texto="No se pudieron cargar las postulaciones" />
            </div>
          ) : !visibles.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Sin datos para los parámetros elegidos.
            </p>
          ) : (
            <>
              <div className="border-b border-border px-4 py-2">
                <LupaPlanilla zoom={zoom} setZoom={setZoom} ajustar={ajustar} />
              </div>
              {/*
                Como la grilla de la ficha (09/10/2026, a pedido): todas las
                filas a la vista y sin barra propia (se baja con el scroll de
                la página), columnas compactas de ancho fijo para que la lupa
                achique columnas y letras juntas, y el encabezado pegado bajo
                la cabecera de la app cuando la planilla entra a lo ancho. Si
                no entra, queda solo el desplazamiento de costado ("Ajustar"
                lo saca).
              */}
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
                      <Th />
                      <Th>Institución</Th>
                      <Th>Turno</Th>
                      <Th titulo="Sección">Secc.</Th>
                      {GRADOS.map((g) => (
                        <Th key={g.clave} centro>
                          {g.corto.replace("°", "º")}
                        </Th>
                      ))}
                      <Th>Énfasis</Th>
                      {MANUALES.map((m) => (
                        <Th key={m.clave} titulo={m.nombre} centro>
                          {m.corto}
                        </Th>
                      ))}
                      {DIAS.map((d) => (
                        <Th key={d.clave} titulo={d.nombre} centro>
                          {d.corto}
                        </Th>
                      ))}
                      <Th>Materia</Th>
                      <Th titulo="Nombre Profesor">Profesor</Th>
                      <Th>Teléfono</Th>
                      <Th>Facilitador</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/40">
                        <td className="border-b border-border/60 text-center">
                          <button
                            type="button"
                            onClick={() => setEditando(p)}
                            aria-label="Editar"
                            title="Editar"
                            className="inline-grid size-6 place-items-center rounded text-primary hover:bg-primary-soft"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </td>
                        <Td texto={p.institucion} />
                        <Td texto={nombreTurno(p.turno)} />
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
                        <Td texto={p.facilitador} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                Total {visibles.length}
              </div>
            </>
          )}
        </section>
      </div>

      {editando && (
        <EditorPostulacion
          key={editando.id}
          p={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={invalidar}
        />
      )}

      <AlertDialog
        open={eliminando}
        onOpenChange={(o) => !o && !eliminar.isPending && setEliminando(false)}
      >
        <AlertDialogContent className="max-w-[calc(100vw-2.5rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              ¿Está seguro de esta operación?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminan las postulaciones de {institucion?.nombre ?? "la institución"} en{" "}
              {anioElegido || "el año elegido"}
              {f.turno != null ? `, turno ${nombreTurno(f.turno)}` : ", todos los turnos"} (
              {aEliminar.length}). Las que tienen intervenciones o evaluaciones no se borran.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11 rounded-xl" disabled={eliminar.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={eliminar.isPending}
              onClick={(e) => {
                e.preventDefault();
                eliminar.mutate();
              }}
            >
              {eliminar.isPending && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Boton({
  icono,
  onClick,
  deshabilitado,
  titulo,
  pendiente,
  peligro,
  children,
}: {
  icono: ReactNode;
  onClick: () => void;
  deshabilitado?: boolean;
  titulo?: string;
  pendiente?: boolean;
  peligro?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      title={titulo}
      className={`flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold shadow-soft disabled:opacity-50 ${
        peligro
          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
    >
      {pendiente ? <Loader2 className="size-4 animate-spin" /> : icono}
      {children}
    </button>
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
