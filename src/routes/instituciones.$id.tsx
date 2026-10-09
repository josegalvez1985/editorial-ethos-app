import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CalendarCheck,
  CalendarClock,
  Clock,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  Lock,
  Save,
  School,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { AutoridadesInstitucion } from "@/components/autoridades-institucion";
import { Pastillas, Quitar, Seccion, Texto } from "@/components/ficha-ui";
import { HorarioInstitucion } from "@/components/horario-institucion";
import { PickerModal } from "@/components/picker-modal";
import { PostulacionesInstitucion } from "@/components/postulaciones-institucion";
import { PreHorariosInstitucion } from "@/components/pre-horarios-institucion";
import { apiBarrios } from "@/lib/barrios";
import { apiCiudades } from "@/lib/ciudades";
import type { Opcion } from "@/lib/evaluaciones";
import { keysFacilitadores, listarFacilitadores, textoUsos } from "@/lib/facilitadores";
import {
  apiCoordinadoresInstitucion,
  keysCoordinadoresInstitucion,
} from "@/lib/instituciones-coordinadores";
import {
  apiDirectoresInstitucion,
  keysDirectoresInstitucion,
} from "@/lib/instituciones-directores";
import {
  asignarFacilitadorPreHorarios,
  eliminarInstitucion,
  esActiva,
  fichaVacia,
  guardarInstitucion,
  keysInstituciones,
  linkUbicacion,
  obtenerInstitucion,
  opcionesInstitucion,
  type DatosInstitucion,
  type FichaInstitucion,
  type ListaInstituciones,
  type OpcionesInstitucion,
} from "@/lib/instituciones";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

type Pestana = "datos" | "autoridades" | "horario" | "prehorarios" | "postulaciones";
const PESTANAS: Pestana[] = ["datos", "autoridades", "horario", "prehorarios", "postulaciones"];

export const Route = createFileRoute("/instituciones/$id")({
  head: () => ({
    meta: [{ title: "Institución — Juventud con Valores" }],
  }),
  // La pestaña va en la URL: volver desde otra pantalla deja donde estaba.
  validateSearch: (s: Record<string, unknown>): { tab?: Pestana } => ({
    tab: PESTANAS.includes(s.tab as Pestana) && s.tab !== "datos" ? (s.tab as Pestana) : undefined,
  }),
  component: FichaPage,
});

const RUTA = "/instituciones";

/**
 * La ficha de una institución: el modal 21 de APEX (Crear Institución) y lo
 * que colgaba de él —los IG de Directores y Coordinadores, los modales 35 y 46
 * de alta de persona, el 33 (Horarios), el 43 (Pre Horarios), el 38 (Datos de
 * postulaciones) y la página 60 (su PDF e imagen)— en una pantalla con
 * pestañas, con los permisos de la página 16.
 *
 * - **Datos**: la institución, con un solo Guardar al pie, como la ficha de
 *   Facilitadores. Incluye el "Actualizar Facilitador" de la 21.
 * - **Autoridades** y **Horario**: listas que se guardan fila por fila, en
 *   diálogos (`<AutoridadesInstitucion>`, `<HorarioInstitucion>`). Horario era
 *   el botón "Horario IE" del 21.
 * - **Pre-horarios** y **Postulaciones**: grillas editables iguales a los IG
 *   de la 43 y la 38 (`<PreHorariosInstitucion>`, `<PostulacionesInstitucion>`);
 *   Postulaciones lleva además el PDF y la imagen del formulario. Eran los
 *   botones "Pre Postulación" y "Postulaciones" del 21.
 *
 * `$id` es el número, o `nueva` para el alta. Las pestañas de listas
 * necesitan la institución guardada: en el alta solo está Datos.
 */
function FichaPage() {
  const { id } = Route.useParams();
  const nueva = id === "nueva";
  const idNum = nueva ? null : Number(id);

  const ficha = useQuery({
    queryKey: keysInstituciones.ficha(idNum ?? 0),
    queryFn: () => obtenerInstitucion(idNum!),
    enabled: idNum != null,
  });
  const opciones = useQuery({
    queryKey: keysInstituciones.opciones,
    queryFn: opcionesInstitucion,
    staleTime: 10 * 60 * 1000,
  });

  const cargando = (!nueva && ficha.isLoading) || opciones.isLoading;
  const error = ficha.error ?? opciones.error;

  return (
    <AppShell nav={false}>
      {cargando ? (
        <Cargando />
      ) : error ? (
        <div className="p-5">
          <Fallo error={error} texto="No se pudo cargar la institución" />
        </div>
      ) : (
        // Remonta al cambiar de institución (por ejemplo, después de un alta).
        <Ficha key={id} idNum={idNum} ficha={ficha.data ?? null} opciones={opciones.data!} />
      )}
    </AppShell>
  );
}

function Ficha({
  idNum,
  ficha,
  opciones,
}: {
  idNum: number | null;
  ficha: FichaInstitucion | null;
  opciones: OpcionesInstitucion;
}) {
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const nueva = idNum == null;
  const pestana: Pestana = nueva ? "datos" : (tab ?? "datos");
  // Una pestaña visitada queda montada (oculta) al cambiar: así Datos no
  // pierde lo que se estaba escribiendo y volver a una lista es instantáneo.
  const [visitadas, setVisitadas] = useState<Set<Pestana>>(() => new Set([pestana]));

  const ir = (p: Pestana) => {
    setVisitadas((v) => new Set(v).add(p));
    navigate({
      to: "/instituciones/$id",
      params: { id: String(idNum) },
      search: p === "datos" ? {} : { tab: p },
      replace: true,
    });
  };

  const ubicacion = ficha
    ? [ficha.departamento, ficha.ciudad, ficha.barrio].filter(Boolean).join(" › ")
    : "";

  return (
    <div>
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {nueva ? "Nueva institución" : `Institución #${idNum}`}
        </p>
        <h1 className="font-display mt-1 flex flex-wrap items-center gap-2 text-[1.75rem] leading-tight font-bold">
          {ficha?.nombre || (nueva ? "Sin nombre" : "Institución")}
          {ficha && !esActiva(ficha.estado) && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-sans text-xs font-semibold text-muted-foreground">
              Inactiva
            </span>
          )}
        </h1>
        {ubicacion && <p className="mt-1 text-xs text-muted-foreground">{ubicacion}</p>}

        <div
          role="tablist"
          aria-label="Secciones de la ficha"
          className="mt-4 flex flex-wrap gap-2"
        >
          {(
            [
              ["datos", "Datos", School],
              ["autoridades", "Autoridades", UsersRound],
              ["horario", "Horario", Clock],
              ["prehorarios", "Pre-horarios", CalendarCheck],
              ["postulaciones", "Postulaciones", FileText],
            ] as const
          ).map(([clave, label, Icono]) => {
            const activa = pestana === clave;
            const bloqueada = nueva && clave !== "datos";
            return (
              <button
                key={clave}
                type="button"
                role="tab"
                aria-selected={activa}
                disabled={bloqueada}
                onClick={() => ir(clave)}
                className={`tap flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-sm font-semibold disabled:opacity-50 ${
                  activa
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icono className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
        {nueva && (
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Guardá la institución para cargar sus autoridades, su horario y sus pre-horarios.
          </p>
        )}
      </div>

      <div hidden={pestana !== "datos"}>
        <Datos idNum={idNum} ficha={ficha} opciones={opciones} />
      </div>
      {idNum != null && visitadas.has("autoridades") && (
        <div hidden={pestana !== "autoridades"} className="px-5 pt-4 pb-24">
          <AutoridadesInstitucion
            idInstitucion={idNum}
            apis={[apiDirectoresInstitucion, apiCoordinadoresInstitucion]}
          />
        </div>
      )}
      {idNum != null && visitadas.has("horario") && (
        <div hidden={pestana !== "horario"} className="px-5 pt-4 pb-24">
          <HorarioInstitucion idInstitucion={idNum} />
        </div>
      )}
      {idNum != null && visitadas.has("prehorarios") && (
        <div hidden={pestana !== "prehorarios"} className="px-5 pt-4 pb-24">
          <PreHorariosInstitucion
            idInstitucion={idNum}
            idFacilitadorInstitucion={ficha?.id_facilitador ?? null}
          />
        </div>
      )}
      {idNum != null && visitadas.has("postulaciones") && (
        <div hidden={pestana !== "postulaciones"} className="px-5 pt-4 pb-24">
          <PostulacionesInstitucion
            idInstitucion={idNum}
            nombreInstitucion={ficha?.nombre ?? ""}
            onIrPreHorarios={() => ir("prehorarios")}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pestaña Datos                                                              */
/* -------------------------------------------------------------------------- */

function Datos({
  idNum,
  ficha,
  opciones,
}: {
  idNum: number | null;
  ficha: FichaInstitucion | null;
  opciones: OpcionesInstitucion;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { puedeRuta } = usePermisos();
  const nueva = idNum == null;
  const inicial: DatosInstitucion = ficha
    ? {
        nombre: ficha.nombre,
        estado: ficha.estado,
        id_ciudad: ficha.id_ciudad,
        id_barrio: ficha.id_barrio,
        direccion: ficha.direccion,
        ubicacion: ficha.ubicacion,
        zona: ficha.zona,
        comentario: ficha.comentario,
        id_facilitador: ficha.id_facilitador,
      }
    : fichaVacia(opciones.estado);
  const [f, setF] = useState<DatosInstitucion>(inicial);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [confirmarAsignar, setConfirmarAsignar] = useState(false);

  const puedeGuardar = puedeRuta(RUTA, nueva ? "insertar" : "actualizar");
  const puedeBorrar = !nueva && puedeRuta(RUTA, "borrar");
  const enUso = ficha ? textoUsos(ficha.usos) : null;

  const set = <K extends keyof DatosInstitucion>(k: K, v: DatosInstitucion[K]) =>
    setF((x) => ({ ...x, [k]: v }));
  const txt = (k: "nombre" | "direccion" | "ubicacion" | "zona" | "comentario") => ({
    valor: f[k],
    onCambio: (v: string) => set(k, v),
  });

  const ciudades = useQuery({ queryKey: apiCiudades.queryKey, queryFn: apiCiudades.listar });
  const barrios = useQuery({ queryKey: apiBarrios.queryKey, queryFn: apiBarrios.listar });
  const facilitadores = useQuery({
    queryKey: keysFacilitadores.lista,
    queryFn: listarFacilitadores,
  });

  const opcion = (id: number, texto: string, extra?: string): Opcion => ({
    id,
    texto,
    extra,
    busqueda: normalizar(`${texto} ${extra ?? ""}`),
  });
  const opcCiudad = (ciudades.data?.items ?? []).map((i) =>
    opcion(i.id, i.nombre, i.padre?.nombre),
  );
  const opcBarrio = (barrios.data?.items ?? [])
    .filter((b) => f.id_ciudad == null || b.padre?.id === f.id_ciudad)
    .map((b) => opcion(b.id, b.nombre, f.id_ciudad == null ? b.padre?.nombre : undefined));
  // Los activos, más el guardado aunque hoy esté inactivo: si no, no se vería.
  const opcFacilitador = (facilitadores.data ?? [])
    .filter((x) => x.activo || x.id === f.id_facilitador)
    .map((x) =>
      opcion(
        x.id,
        x.nombre,
        [x.ci && `CI ${x.ci}`, !x.activo && "Inactivo"].filter(Boolean).join(" · "),
      ),
    );
  const nombreCiudad = ciudades.data?.items.find((c) => c.id === f.id_ciudad)?.nombre;

  // Otra institución con el mismo nombre en la misma ciudad (sin tildes ni
  // mayúsculas). Solo aviso: con el listado en caché, sin pedirlo de nuevo.
  const lista = qc.getQueryData<ListaInstituciones>(keysInstituciones.lista);
  const repetida = f.nombre.trim()
    ? lista?.items.find(
        (i) =>
          i.id !== idNum &&
          i.idCiudad === f.id_ciudad &&
          normalizar(i.nombre.trim()) === normalizar(f.nombre.trim()),
      )
    : undefined;

  const cambiaEstado = ficha != null && ficha.estado.trim() !== "" && f.estado !== ficha.estado;
  const estadoNuevo = opciones.estado.find((e) => e.valor === f.estado)?.mostrar ?? f.estado;

  const faltan = [
    ...(f.nombre.trim() ? [] : ["nombre"]),
    ...(f.estado ? [] : ["estado"]),
    ...(f.id_ciudad == null ? ["ciudad"] : []),
  ];
  const sinCambios = JSON.stringify(f) === JSON.stringify(inicial);

  const guardar = useMutation({
    mutationFn: () => guardarInstitucion(idNum, f),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: keysInstituciones.todo });
      if (r.autoridadesCambiadas > 0) {
        // TRG_UPD_ESTADO_INSTITUCIONES les cambió el estado (ver el .sql).
        qc.invalidateQueries({ queryKey: keysDirectoresInstitucion.institucion(r.id) });
        qc.invalidateQueries({ queryKey: keysCoordinadoresInstitucion.institucion(r.id) });
      }
      toast.success(nueva ? "Institución creada" : "Cambios guardados", {
        description: nueva
          ? "Ya podés cargar sus autoridades y su horario."
          : r.autoridadesCambiadas > 0
            ? `${r.autoridadesCambiadas} autoridad(es) pasaron a “${estadoNuevo}”.`
            : undefined,
      });
      if (nueva)
        navigate({ to: "/instituciones/$id", params: { id: String(r.id) }, replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarInstitucion(idNum!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keysInstituciones.todo });
      toast.success("Institución eliminada");
      navigate({ to: "/instituciones", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const asignar = useMutation({
    mutationFn: () => asignarFacilitadorPreHorarios(idNum!),
    onSuccess: (n) => {
      setConfirmarAsignar(false);
      qc.invalidateQueries({ queryKey: keysInstituciones.todo });
      toast.success(`${n} pre-horario(s) con ${ficha?.facilitador || "el facilitador"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo asignar"),
  });

  const ocupado = guardar.isPending || borrar.isPending || asignar.isPending;
  const enviar = () => {
    if (faltan.length) {
      toast.error(`Falta completar: ${faltan.join(", ")}`);
      return;
    }
    guardar.mutate();
  };

  // "Actualizar facilitador": con el facilitador GUARDADO y algo que actualizar.
  const conAsignar =
    !nueva &&
    puedeRuta(RUTA, "actualizar") &&
    ficha != null &&
    ficha.id_facilitador != null &&
    ficha.preSinFacilitador > 0;
  const facilitadorSinGuardar = f.id_facilitador !== inicial.id_facilitador;
  const mapa = linkUbicacion(f.ubicacion);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      {!puedeGuardar && (
        <div className="px-5 pt-4">
          <SoloLectura
            texto={`Solo lectura: tu usuario no puede ${nueva ? "agregar" : "modificar"} instituciones.`}
          />
        </div>
      )}

      <fieldset
        disabled={!puedeGuardar || ocupado}
        className="grid grid-cols-1 gap-4 px-5 pt-4 pb-6 lg:grid-cols-2"
      >
        <Seccion titulo="Institución">
          <Texto etiqueta="Nombre" req largo={800} {...txt("nombre")} />
          {repetida && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
              Ya hay una institución “{repetida.nombre}” en {repetida.ciudad || "esa ciudad"}.
            </p>
          )}
          <Pastillas
            etiqueta="Estado"
            req
            opciones={opciones.estado}
            valor={f.estado}
            onCambio={(v) => set("estado", v)}
          />
          {cambiaEstado && (
            <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0" />
              Al guardar, sus directores y coordinadores pasan a “{estadoNuevo}” también: lo hace la
              base, como en APEX.
            </p>
          )}
          <Texto etiqueta="Observación" largo={2000} multilinea {...txt("comentario")} />
        </Seccion>

        <Seccion titulo="Ubicación" ayuda="Departamento y país salen de la ciudad.">
          <div>
            <PickerModal
              label="Ciudad"
              opciones={opcCiudad}
              value={f.id_ciudad}
              valueText={nombreCiudad ?? ficha?.ciudad ?? null}
              onChange={(o) => setF((x) => ({ ...x, id_ciudad: o.id, id_barrio: null }))}
              placeholder="Elegir ciudad"
              requerido
            />
          </div>
          <div>
            <PickerModal
              label="Barrio"
              opciones={opcBarrio}
              value={f.id_barrio}
              valueText={
                barrios.data?.items.find((b) => b.id === f.id_barrio)?.nombre ??
                ficha?.barrio ??
                null
              }
              onChange={(o) => {
                const b = barrios.data?.items.find((x) => x.id === o.id);
                setF((x) => ({ ...x, id_barrio: o.id, id_ciudad: b?.padre?.id ?? x.id_ciudad }));
              }}
              placeholder={f.id_ciudad == null ? "Elegir barrio" : "Elegir barrio de esa ciudad"}
            />
            {f.id_barrio != null && <Quitar onClick={() => set("id_barrio", null)} />}
          </div>
          <Texto etiqueta="Dirección" largo={800} {...txt("direccion")} />
          <Texto etiqueta="Zona" largo={2000} {...txt("zona")} />
          <Texto
            etiqueta="Ubicación"
            largo={4000}
            {...txt("ubicacion")}
            ayuda={
              mapa ? (
                <a
                  href={mapa}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-primary"
                >
                  <ExternalLink className="size-3" />
                  Abrir en el mapa
                </a>
              ) : (
                "Un link de Google Maps o las coordenadas."
              )
            }
          />
        </Seccion>

        <Seccion
          titulo="Facilitador"
          ayuda="El que acompaña a la institución. Se propone en sus pre-horarios."
        >
          <div>
            <PickerModal
              label="Facilitador"
              opciones={opcFacilitador}
              value={f.id_facilitador}
              valueText={
                facilitadores.data?.find((x) => x.id === f.id_facilitador)?.nombre ??
                ficha?.facilitador ??
                null
              }
              onChange={(o) => set("id_facilitador", o.id)}
              placeholder="Sin facilitador"
            />
            {f.id_facilitador != null && (
              <Quitar texto="Sin facilitador" onClick={() => set("id_facilitador", null)} />
            )}
          </div>
        </Seccion>
      </fieldset>

      {/*
        El botón "Actualizar Facilitador" de la página 21, fuera del fieldset:
        no es un campo, es una acción sobre lo ya guardado.
      */}
      {conAsignar && (
        <div className="px-5 pb-6">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
            <p className="flex items-start gap-2 text-sm">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold">
                  {ficha!.preSinFacilitador} pre-horario(s) de {ficha!.anio}
                </span>{" "}
                todavía no tienen facilitador.
                {ficha!.preSinFacilitadorConfirmados > 0 && (
                  <span className="block text-[11.5px] text-muted-foreground">
                    {ficha!.preSinFacilitadorConfirmados} ya están confirmados: su postulación se
                    vuelve a generar con el facilitador, como en APEX.
                  </span>
                )}
              </span>
            </p>
            {facilitadorSinGuardar ? (
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                Guardá primero el cambio de facilitador.
              </p>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => (confirmarAsignar ? asignar.mutate() : setConfirmarAsignar(true))}
                  className={`flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
                    confirmarAsignar
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary-soft text-primary"
                  }`}
                >
                  {asignar.isPending && <Loader2 className="size-4 animate-spin" />}
                  {confirmarAsignar
                    ? "¿Seguro? Tocá para confirmar"
                    : `Asignarles a ${ficha!.facilitador}`}
                </button>
                {confirmarAsignar && (
                  <button
                    type="button"
                    onClick={() => setConfirmarAsignar(false)}
                    className="text-[12px] font-medium text-muted-foreground"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {puedeBorrar && (
        <div className="px-5 pb-6">
          {enUso ? (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              No se puede eliminar mientras se use {enUso}.
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <BotonBorrar
                confirmar={confirmarBorrado}
                pendiente={borrar.isPending}
                deshabilitado={ocupado}
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
              />
              <p className="text-[11px] text-muted-foreground">
                {confirmarBorrado
                  ? "Se borra con sus autoridades y su horario. Tocá de nuevo para confirmar."
                  : "Eliminar esta institución."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Guardar siempre a mano, al pie de la pantalla. */}
      {puedeGuardar && (
        <div className="sticky bottom-0 z-20 border-t border-border/60 bg-background/95 px-5 py-3 pb-safe backdrop-blur">
          <button
            type="submit"
            disabled={ocupado || sinCambios}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50 lg:ml-auto lg:w-64"
          >
            {guardar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {nueva ? "Crear institución" : sinCambios ? "Sin cambios" : "Guardar cambios"}
          </button>
        </div>
      )}
    </form>
  );
}
