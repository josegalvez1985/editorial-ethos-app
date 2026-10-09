import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";

import { Cargando, SoloLectura } from "@/components/admin-ui";
import { PickerModal } from "@/components/picker-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keysCiudades, listarCiudades } from "@/lib/ciudades";
import type { Opcion } from "@/lib/evaluaciones";
import { keysFacilitadores, listarFacilitadores } from "@/lib/facilitadores";
import { keysInstituciones, listarInstituciones } from "@/lib/instituciones";
import { escribirHora, normalizarHora } from "@/lib/lupa";
import { usePermisos } from "@/lib/permisos";
import {
  COLORES_APEX as APEX,
  DIAS,
  eliminarPostulacion,
  GRADOS,
  guardarPostulacion,
  keysPostulaciones,
  MANUALES,
  opcionesPostulacion,
  type PostulacionFila,
} from "@/lib/postulaciones";
import { keysPreHorarios, opcionesPreHorario } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

/** La pantalla dueña del modal: sus permisos son los de la página 20. */
const RUTA = "/postulaciones";

const cant = (n: number) => (n ? String(n) : "");

/**
 * El modal 22 de APEX (Crear Postulación), con sus campos y colores por grupo.
 * Lo abren el lápiz de Postulaciones (página 20, `/postulaciones`) y la
 * institución de la Consulta de Postulaciones (página 24,
 * `/consulta-postulaciones`), como en APEX. Guarda y borra con los permisos de
 * la 20 o los de la ficha de la institución; sin ellos queda de solo lectura.
 * También exporta las piezas con el formato de APEX que usa la 20.
 */

export function Campo({
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
export function Filtro({
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

/**
 * Una hora del modal escrita a mano, como en la grilla de la ficha (09/10/2026,
 * a pedido): sin el reloj del <input type="time"> y editable con un clic. Se
 * escriben solo los números ("730" → "07:30" al salir).
 */
function EntradaHora({
  valor,
  onCambio,
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  className: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="--:--"
      maxLength={5}
      value={valor}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onCambio(escribirHora(e.target.value))}
      onBlur={(e) => {
        const n = normalizarHora(e.target.value);
        if (n !== e.target.value) onCambio(n);
      }}
      style={APEX.dia}
      className={`${className} tabular-nums placeholder:text-slate-500`}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* El modal 22 (Crear Postulación)                                            */
/* -------------------------------------------------------------------------- */

/** Los grados en el orden en que APEX buscaba el valor a copiar (COPIAR_VALOR). */
const ORDEN_COPIA = ["g1m", "g2m", "g3m", "g2", "g3", "g4", "g5", "g6", "g7", "g8"] as const;

export function EditorPostulacion({
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
    mutationFn: (datos: Record<string, string>) => guardarPostulacion(p.id, idInstitucion!, datos),
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
              // Las horas, completadas como al salir del campo (con Enter no se sale).
              const horas = DIAS.flatMap((x) => [`${x.clave}_desde`, `${x.clave}_hasta`]);
              const datos = { ...d };
              for (const k of horas) datos[k] = normalizarHora(datos[k]);
              const mal = DIAS.filter((x) =>
                [datos[`${x.clave}_desde`], datos[`${x.clave}_hasta`]].some(
                  (h) => h && !/^\d{2}:\d{2}$/.test(h),
                ),
              );
              if (mal.length) {
                setD(datos);
                toast.error(`Hora mal escrita: ${mal.map((x) => x.nombre).join(", ")}`);
                return;
              }
              guardar.mutate(datos);
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
                      <EntradaHora
                        valor={d[`${x.clave}_desde`]}
                        onCambio={(v) => set(`${x.clave}_desde`, v)}
                        className={input}
                      />
                    </Campo>
                    <Campo etiqueta={`${x.nombre} Hasta`}>
                      <EntradaHora
                        valor={d[`${x.clave}_hasta`]}
                        onCambio={(v) => set(`${x.clave}_hasta`, v)}
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
