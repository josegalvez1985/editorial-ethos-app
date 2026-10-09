import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Eraser, FileText, FolderPlus, Loader2, Pencil, Search, Trash2, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import { Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { PickerModal } from "@/components/picker-modal";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keysBarrios, listarBarrios } from "@/lib/barrios";
import { keysCiudades, listarCiudades } from "@/lib/ciudades";
import { keysDepartamentos, listarDepartamentos } from "@/lib/departamentos";
import type { Opcion } from "@/lib/evaluaciones";
import { keysFacilitadores, listarFacilitadores } from "@/lib/facilitadores";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import { generarPdfPostulaciones, nombrePdfPostulaciones } from "@/lib/pdf-postulaciones";
import { usePermisos } from "@/lib/permisos";
import {
  DIAS,
  eliminarPostulacion,
  eliminarPostulacionesLote,
  generarPostulaciones,
  GRADOS,
  guardarPostulacion,
  keysPostulaciones,
  listarTodasPostulaciones,
  MANUALES,
  opcionesPostulacion,
  type FiltrosPostulaciones,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/postulaciones/")({
  head: () => ({
    meta: [
      { title: "Postulaciones — Juventud con Valores" },
      { name: "description", content: "Las postulaciones de todas las instituciones, por año." },
    ],
  }),
  component: PostulacionesPage,
});

const RUTA = "/postulaciones";

/**
 * Los colores de APEX (el CSS en línea de las páginas 20 y 22), con la letra
 * oscura para que se lean igual en el tema oscuro.
 */
const APEX = {
  filtro: { backgroundColor: "#aed6f1", color: "#0f172a" },
  ubicacion: { backgroundColor: "#d1f2eb", color: "#0f172a" },
  grado: { backgroundColor: "#d4e6f1", color: "#0f172a" },
  dia: { backgroundColor: "#e8daef", color: "#0f172a" },
  docente: { backgroundColor: "#d5d8dc", color: "#0f172a" },
  observacion: { backgroundColor: "#f2d7d5", color: "#0f172a" },
  facilitador: { backgroundColor: "#2e86c1", color: "#ffffff" },
} satisfies Record<string, CSSProperties>;

const SIN_FILTROS: Omit<FiltrosPostulaciones, "anio"> = {
  idDepartamento: null,
  idCiudad: null,
  idBarrio: null,
  idInstitucion: null,
  turno: null,
};

/** Cuántas filas se pintan de entrada; "Mostrar más" suma de a tanto (scroll del IG). */
const PAGINA = 200;

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
  const [mostrar, setMostrar] = useState(PAGINA);
  const [editando, setEditando] = useState<PostulacionFila | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);

  const filtros: FiltrosPostulaciones = { anio, ...f };
  const lista = useQuery({
    queryKey: keysPostulaciones.todas(filtros),
    queryFn: () => listarTodasPostulaciones(filtros),
  });
  const deps = useQuery({ queryKey: keysDepartamentos.todo, queryFn: listarDepartamentos });
  const ciudades = useQuery({ queryKey: keysCiudades.todo, queryFn: listarCiudades });
  const barrios = useQuery({ queryKey: keysBarrios.todo, queryFn: listarBarrios });
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
                  setMostrar(PAGINA);
                }}
                placeholder="Buscar"
                aria-label="Buscar en la grilla"
                className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {lista.isLoading ? (
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
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-max min-w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <Th />
                      <Th>Institución</Th>
                      <Th>Turno</Th>
                      <Th>Seccion</Th>
                      {GRADOS.map((g) => (
                        <Th key={g.clave}>{g.corto.replace("°", "º")}</Th>
                      ))}
                      <Th>Énfasis</Th>
                      {MANUALES.map((m) => (
                        <Th key={m.clave}>{m.nombre}</Th>
                      ))}
                      {DIAS.map((d) => (
                        <Th key={d.clave}>{d.corto}</Th>
                      ))}
                      <Th>Materia</Th>
                      <Th>Nombre Profesor</Th>
                      <Th>Telefono</Th>
                      <Th>Facilitador</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.slice(0, mostrar).map((p) => (
                      <tr key={p.id} className="border-b border-border/60 hover:bg-muted/40">
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setEditando(p)}
                            aria-label="Editar"
                            title="Editar"
                            className="grid size-7 place-items-center rounded text-primary hover:bg-primary-soft"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        </td>
                        <Td ancho>{p.institucion}</Td>
                        <Td>{nombreTurno(p.turno)}</Td>
                        <Td>{p.seccion}</Td>
                        {GRADOS.map((g) => (
                          <Td key={g.clave} num>
                            {cant(p.grados[g.clave])}
                          </Td>
                        ))}
                        <Td>{p.enfasis}</Td>
                        {MANUALES.map((m) => (
                          <td
                            key={m.clave}
                            className="border-x border-border/40 px-2 py-1.5 text-center font-semibold tabular-nums"
                            style={{ backgroundColor: m.color, color: m.tinta }}
                          >
                            {cant(p.manuales[m.clave])}
                          </td>
                        ))}
                        {DIAS.map((d) => (
                          <Td key={d.clave}>{franja(p.dias[d.clave])}</Td>
                        ))}
                        <Td>{p.materia}</Td>
                        <Td ancho>{p.docente}</Td>
                        <Td>{p.telefono}</Td>
                        <Td ancho>{p.facilitador}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[12px] text-muted-foreground">
                <span>
                  Total {visibles.length}
                  {visibles.length > mostrar ? ` · mostrando ${mostrar}` : ""}
                </span>
                {visibles.length > mostrar && (
                  <button
                    type="button"
                    onClick={() => setMostrar((n) => n + PAGINA)}
                    className="font-semibold text-primary"
                  >
                    Mostrar más
                  </button>
                )}
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

function Campo({
  etiqueta,
  req,
  children,
}: {
  etiqueta: string;
  req?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[13px] font-medium">
        {etiqueta}
        {req && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}

/** Una LOV emergente de APEX ("Todos" = sin valor), con la cruz para limpiarla. */
function Filtro({
  etiqueta,
  opciones,
  valor,
  texto,
  onCambio,
  estilo = APEX.filtro,
  vacio = "Todos",
  req,
}: {
  etiqueta: string;
  opciones: Opcion[];
  valor: number | null;
  texto: string | null;
  onCambio: (id: number | null) => void;
  estilo?: CSSProperties;
  vacio?: string;
  req?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-end gap-1">
      {/* El color de APEX en el botón del campo. `key`: al limpiarlo desde
          afuera, el picker no recuerda el texto elegido antes. */}
      <div
        className="min-w-0 flex-1 [&_button]:!min-h-10 [&_button]:!rounded-md [&_button]:!py-1.5 [&_button]:!text-sm [&_label]:!mb-1 [&_label]:!text-[13px]"
        style={{
          ["--fondo" as string]: estilo.backgroundColor,
          ["--tinta" as string]: estilo.color,
        }}
      >
        <div className="[&_button]:![background-color:var(--fondo)] [&_button_span]:![color:var(--tinta)]">
          <PickerModal
            key={valor ?? "x"}
            label={etiqueta}
            opciones={opciones}
            value={valor}
            valueText={texto}
            onChange={(o) => onCambio(o.id)}
            placeholder={vacio}
            requerido={req}
          />
        </div>
      </div>
      {valor != null && (
        <button
          type="button"
          onClick={() => onCambio(null)}
          aria-label={`Quitar ${etiqueta.toLowerCase()}`}
          title="Quitar"
          className="mb-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

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

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="border-x border-b border-border/60 px-2 py-2 text-left text-[12px] font-semibold whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({ children, num, ancho }: { children?: ReactNode; num?: boolean; ancho?: boolean }) {
  return (
    <td
      className={`border-x border-border/40 px-2 py-1.5 whitespace-nowrap ${
        num ? "text-center tabular-nums" : ""
      } ${ancho ? "max-w-[18rem] truncate" : ""}`}
    >
      {children}
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* El modal 22 (Crear Postulación)                                            */
/* -------------------------------------------------------------------------- */

/** Los grados en el orden en que APEX buscaba el valor a copiar (COPIAR_VALOR). */
const ORDEN_COPIA = ["g1m", "g2m", "g3m", "g2", "g3", "g4", "g5", "g6", "g7", "g8"] as const;

function EditorPostulacion({
  p,
  onCerrar,
  onGuardado,
}: {
  p: PostulacionFila;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { puedeRuta } = usePermisos();
  const ficha = puedeRuta("/instituciones", "actualizar");
  const puedeGuardar = ficha || puedeRuta(RUTA, "actualizar");
  const puedeBorrar = ficha || puedeRuta(RUTA, "borrar");

  const opciones = useQuery({
    queryKey: keysPreHorarios.opciones,
    queryFn: opcionesPreHorario,
    staleTime: 10 * 60 * 1000,
  });
  const estados = useQuery({
    queryKey: keysPostulaciones.opciones,
    queryFn: opcionesPostulacion,
    staleTime: 10 * 60 * 1000,
  });
  const ciudades = useQuery({ queryKey: keysCiudades.todo, queryFn: listarCiudades });
  const insts = useQuery({ queryKey: keysInstituciones.lista, queryFn: listarInstituciones });
  const facs = useQuery({ queryKey: keysFacilitadores.lista, queryFn: listarFacilitadores });

  const [ciudad, setCiudad] = useState<number | null>(null);
  const [idInstitucion, setIdInstitucion] = useState<number | null>(p.idInstitucion);
  const [d, setD] = useState<Record<string, string>>(() => ({
    turno: p.turno == null ? "" : String(p.turno),
    seccion: p.seccion,
    id_enfasis: p.idEnfasis == null ? "" : String(p.idEnfasis),
    ...Object.fromEntries(GRADOS.map((g) => [g.clave, cant(p.grados[g.clave])])),
    ...Object.fromEntries(MANUALES.map((m) => [m.clave, cant(p.manuales[m.clave])])),
    ...Object.fromEntries(
      DIAS.flatMap((x) => [
        [`${x.clave}_desde`, p.dias[x.clave].desde],
        [`${x.clave}_hasta`, p.dias[x.clave].hasta],
      ]),
    ),
    id_materia: p.idMateria == null ? "" : String(p.idMateria),
    id_docente: p.idDocente == null ? "" : String(p.idDocente),
    telefono: p.telefono,
    observacion: p.observacion,
    id_facilitador: p.idFacilitador == null ? "" : String(p.idFacilitador),
    estado: p.estado,
    obs_estado: p.obsEstado,
  }));
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const set = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }));

  // COPIAR_VALOR de APEX: el primer grado con cantidad.
  const sugerido = () => {
    for (const k of ORDEN_COPIA) if (Number(d[k]) > 0) return d[k];
    return d.g9;
  };

  const instsCiudad = (insts.data?.items ?? []).filter(
    (i) => ciudad == null || i.idCiudad === ciudad || i.id === idInstitucion,
  );
  const docentes = (opciones.data?.docentes ?? []).filter(
    (x) => x.activo || String(x.id) === d.id_docente,
  );
  const facilitadores = (facs.data ?? []).filter(
    (x) => x.activo || String(x.id) === d.id_facilitador,
  );

  const faltan = [...(idInstitucion == null ? ["institución"] : []), ...(d.turno ? [] : ["turno"])];

  const guardar = useMutation({
    mutationFn: () => guardarPostulacion(p.id, idInstitucion!, d),
    onSuccess: () => {
      onGuardado();
      toast.success("Postulación actualizada");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });
  const borrar = useMutation({
    mutationFn: () => eliminarPostulacion(p.id),
    onSuccess: () => {
      onGuardado();
      toast.success("Postulación eliminada");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });
  const ocupado = guardar.isPending || borrar.isPending;

  const cargando = opciones.isLoading || insts.isLoading;
  const input = "h-9 w-full rounded-md border border-input px-2 text-sm outline-none";

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle className="text-xl">Crear Postulación</DialogTitle>
          <DialogDescription className="text-xs">
            {p.institucion}
            {p.anio ? ` · ${p.anio}` : ""}
            {p.usos ? ` · con ${p.usos} intervención(es) o evaluación(es)` : ""}
          </DialogDescription>
        </DialogHeader>

        {cargando ? (
          <Cargando />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (faltan.length) {
                toast.error(`Falta completar: ${faltan.join(", ")}`);
                return;
              }
              guardar.mutate();
            }}
            className="space-y-4"
          >
            <fieldset disabled={!puedeGuardar || ocupado} className="space-y-4">
              {/* Parámetros: la ciudad solo filtra la institución, como en APEX. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Filtro
                  etiqueta="Ciudad"
                  opciones={(ciudades.data?.items ?? []).map((c) => ({
                    id: c.id,
                    texto: c.nombre,
                    extra: c.padre?.nombre,
                    busqueda: normalizar(`${c.nombre} ${c.padre?.nombre ?? ""}`),
                  }))}
                  valor={ciudad}
                  texto={ciudades.data?.items.find((c) => c.id === ciudad)?.nombre ?? null}
                  onCambio={setCiudad}
                  estilo={APEX.ubicacion}
                  vacio="Todas"
                />
                <Filtro
                  etiqueta="Institución"
                  req
                  opciones={instsCiudad.map((i) => ({
                    id: i.id,
                    texto: i.nombre,
                    extra: i.ciudad,
                    busqueda: normalizar(`${i.nombre} ${i.ciudad}`),
                  }))}
                  valor={idInstitucion}
                  texto={
                    insts.data?.items.find((i) => i.id === idInstitucion)?.nombre ?? p.institucion
                  }
                  onCambio={setIdInstitucion}
                  estilo={APEX.ubicacion}
                  vacio="Elegir"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Campo etiqueta="Turno" req>
                  <select
                    value={d.turno}
                    onChange={(e) => set("turno", e.target.value)}
                    style={APEX.grado}
                    className={input}
                  >
                    <option value=""></option>
                    {(opciones.data?.turno ?? []).map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.mostrar}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Énfasis">
                  <select
                    value={d.id_enfasis}
                    onChange={(e) => set("id_enfasis", e.target.value)}
                    style={APEX.grado}
                    className={input}
                  >
                    <option value=""></option>
                    {(opciones.data?.enfasis ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Sección">
                  <input
                    value={d.seccion}
                    maxLength={5}
                    onChange={(e) => set("seccion", e.target.value.toUpperCase())}
                    style={APEX.grado}
                    className={input}
                  />
                </Campo>
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
                {GRADOS.map((g) => (
                  <Campo key={g.clave} etiqueta={g.corto.replace("°", "º")}>
                    <input
                      value={d[g.clave]}
                      inputMode="numeric"
                      onChange={(e) => set(g.clave, e.target.value.replace(/\D/g, ""))}
                      style={APEX.grado}
                      className={`${input} text-center tabular-nums`}
                    />
                  </Campo>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {MANUALES.map((m) => (
                  <Campo key={m.clave} etiqueta={m.nombre}>
                    <input
                      value={d[m.clave]}
                      inputMode="numeric"
                      onFocus={() => {
                        if (!d[m.clave]) set(m.clave, sugerido());
                      }}
                      onChange={(e) => set(m.clave, e.target.value.replace(/\D/g, ""))}
                      style={{ backgroundColor: m.color, color: m.tinta }}
                      className={`${input} text-center font-semibold tabular-nums`}
                    />
                  </Campo>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5">
                {DIAS.map((x) => (
                  <div key={x.clave} className="grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                    <Campo etiqueta={`${x.nombre} Desde`}>
                      <input
                        type="time"
                        value={d[`${x.clave}_desde`]}
                        onChange={(e) => set(`${x.clave}_desde`, e.target.value)}
                        style={APEX.dia}
                        className={input}
                      />
                    </Campo>
                    <Campo etiqueta={`${x.nombre} Hasta`}>
                      <input
                        type="time"
                        value={d[`${x.clave}_hasta`]}
                        onChange={(e) => set(`${x.clave}_hasta`, e.target.value)}
                        style={APEX.dia}
                        className={input}
                      />
                    </Campo>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo etiqueta="Materia">
                  <select
                    value={d.id_materia}
                    onChange={(e) => set("id_materia", e.target.value)}
                    style={APEX.docente}
                    className={input}
                  >
                    <option value=""></option>
                    {(opciones.data?.materias ?? []).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Filtro
                  etiqueta="Docente"
                  opciones={docentes.map((x) => ({
                    id: x.id,
                    texto: x.nombre,
                    extra: x.telefono || undefined,
                    busqueda: normalizar(`${x.nombre} ${x.telefono}`),
                  }))}
                  valor={d.id_docente ? Number(d.id_docente) : null}
                  texto={docentes.find((x) => String(x.id) === d.id_docente)?.nombre ?? null}
                  onCambio={(id) => set("id_docente", id == null ? "" : String(id))}
                  estilo={APEX.docente}
                  vacio="Sin Docente"
                />
                <Campo etiqueta="Teléfono">
                  <input
                    value={d.telefono}
                    maxLength={500}
                    onChange={(e) => set("telefono", e.target.value)}
                    style={APEX.docente}
                    className={input}
                  />
                </Campo>
              </div>

              <Campo etiqueta="Observación">
                <textarea
                  value={d.observacion}
                  maxLength={1000}
                  rows={4}
                  onChange={(e) => set("observacion", e.target.value)}
                  style={APEX.observacion}
                  className="w-full rounded-md border border-input px-2 py-1.5 text-sm outline-none"
                />
              </Campo>

              <Filtro
                etiqueta="Facilitador"
                opciones={facilitadores.map((x) => ({
                  id: x.id,
                  texto: x.nombre,
                  busqueda: normalizar(x.nombre),
                }))}
                valor={d.id_facilitador ? Number(d.id_facilitador) : null}
                texto={
                  facilitadores.find((x) => String(x.id) === d.id_facilitador)?.nombre ??
                  (p.facilitador || null)
                }
                onCambio={(id) => set("id_facilitador", id == null ? "" : String(id))}
                estilo={APEX.facilitador}
                vacio="Sin Facilitador"
              />

              <div role="radiogroup" aria-label="Estado">
                <span className="mb-1 block text-[13px] font-medium">Estado</span>
                <div className="grid grid-cols-3 gap-2">
                  {(estados.data?.estado ?? []).map((o) => (
                    <label key={o.valor} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="estado"
                        checked={d.estado === o.valor}
                        onChange={() => set("estado", o.valor)}
                      />
                      {o.mostrar}
                    </label>
                  ))}
                </div>
              </div>

              <Campo etiqueta="Observación del Estado">
                <textarea
                  value={d.obs_estado}
                  maxLength={2000}
                  rows={4}
                  onChange={(e) => set("obs_estado", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
                />
              </Campo>
            </fieldset>

            {!puedeGuardar && (
              <SoloLectura texto="Solo lectura: tu usuario no puede modificar postulaciones." />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <button
                type="button"
                onClick={onCerrar}
                disabled={ocupado}
                className="h-9 rounded-md border border-border px-4 text-sm font-semibold"
              >
                Cancelar
              </button>
              <div className="flex gap-2">
                {puedeBorrar && (
                  <button
                    type="button"
                    disabled={ocupado || p.usos > 0}
                    title={p.usos > 0 ? "Tiene intervenciones o evaluaciones" : undefined}
                    onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
                    className={`flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-semibold disabled:opacity-50 ${
                      confirmarBorrado
                        ? "bg-destructive text-destructive-foreground"
                        : "border border-destructive/50 text-destructive"
                    }`}
                  >
                    {borrar.isPending && <Loader2 className="size-4 animate-spin" />}
                    {confirmarBorrado ? "¿Suprimir?" : "Suprimir"}
                  </button>
                )}
                {puedeGuardar && (
                  <button
                    type="submit"
                    disabled={ocupado}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
                    Aplicar Cambios
                  </button>
                )}
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
