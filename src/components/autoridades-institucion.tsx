import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Phone, Plus, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { Pastillas, Quitar, Texto } from "@/components/ficha-ui";
import { PickerModal } from "@/components/picker-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApiAutoridades, Autoridad } from "@/lib/autoridades";
import type { Opcion } from "@/lib/evaluaciones";
import { keysInstituciones } from "@/lib/instituciones";
import { iniciales } from "@/lib/navegacion";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

/**
 * La pestaña Autoridades de la ficha de una institución: los dos IG de la
 * región "Autoridades" del modal 21 de APEX (Directores y Coordinadores) y sus
 * modales de alta de persona (35 Crear Director, 46 Crear Coordinador).
 *
 * Las dos tablas tienen la misma forma —persona + período + cargo/tipo + nivel
 * + turno + estado + teléfono— y comparten esta pantalla, no el backend: cada
 * una tiene su script y su `lib/` (`instituciones-directores.ts`,
 * `instituciones-coordinadores.ts`), que le pasan sus funciones en
 * {@link ApiAutoridades}. Mismo criterio que `<CatalogoNombre>`.
 *
 * Distinto de APEX:
 *
 * - **Tarjetas en lugar de dos grillas editables**, con el teléfono para tocar
 *   y llamar. Arranca mostrando las vigentes (ESTADO 'A'); "Todas" suma las
 *   de períodos viejos.
 * - **Alta y edición en un diálogo**, una fila por vez, guardada al momento.
 * - **La persona nueva se carga en el mismo diálogo** ("¿No está en la
 *   lista?"), sin abrir otro modal encima, y avisa si ya hay alguien con ese
 *   nombre para no duplicarlo.
 */

/** `tel:` y no texto plano, como en `director-card.tsx`: se llama con un toque. */
const telHref = (t: string) => `tel:${t.replace(/\s+/g, "")}`;

/* -------------------------------------------------------------------------- */
/* La pestaña                                                                 */
/* -------------------------------------------------------------------------- */

type Filtro = "vigentes" | "todas";

export function AutoridadesInstitucion({
  idInstitucion,
  apis,
}: {
  idInstitucion: number;
  apis: ApiAutoridades[];
}) {
  const [filtro, setFiltro] = useState<Filtro>("vigentes");
  const [abierto, setAbierto] = useState<{ api: ApiAutoridades; fila: Autoridad | null } | null>(
    null,
  );

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Filtrar autoridades" className="flex flex-wrap gap-2">
        {(
          [
            ["vigentes", "Vigentes"],
            ["todas", "Todas, con períodos anteriores"],
          ] as const
        ).map(([clave, label]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={filtro === clave}
            onClick={() => setFiltro(clave)}
            className={`tap h-9 rounded-full border px-3.5 text-[13px] font-semibold ${
              filtro === clave
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {apis.map((api) => (
          <Grupo
            key={api.ruta}
            api={api}
            idInstitucion={idInstitucion}
            filtro={filtro}
            onAbrir={(fila) => setAbierto({ api, fila })}
          />
        ))}
      </div>

      {abierto && (
        <EditorAutoridad
          key={`${abierto.api.ruta}-${abierto.fila?.id ?? "nueva"}`}
          api={abierto.api}
          idInstitucion={idInstitucion}
          fila={abierto.fila}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

/** Lo que el usuario puede hacer en una de las dos tablas (ver los `.sql`). */
function usePuede(api: ApiAutoridades) {
  const { puedeRuta } = usePermisos();
  // Modificar la institución alcanza: el IG estaba en su modal (21).
  const ficha = puedeRuta("/instituciones", "actualizar");
  return {
    insertar: ficha || puedeRuta(api.ruta, "insertar"),
    actualizar: ficha || puedeRuta(api.ruta, "actualizar"),
    borrar: ficha || puedeRuta(api.ruta, "borrar"),
    crearPersona: ficha || puedeRuta(api.rutaPersonas, "insertar"),
  };
}

function Grupo({
  api,
  idInstitucion,
  filtro,
  onAbrir,
}: {
  api: ApiAutoridades;
  idInstitucion: number;
  filtro: Filtro;
  onAbrir: (fila: Autoridad | null) => void;
}) {
  const puede = usePuede(api);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: api.key(idInstitucion),
    queryFn: () => api.listar(idInstitucion),
  });
  const t = api.textos;
  const todas = data ?? [];
  const filas = filtro === "todas" ? todas : todas.filter((a) => a.activo);
  const ocultas = todas.length - filas.length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold">
          {t.titulo}
          {data && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
              {filas.length}
            </span>
          )}
        </h2>
        {puede.insertar && (
          <button
            type="button"
            onClick={() => onAbrir(null)}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-border px-3.5 text-sm font-semibold text-primary hover:border-primary/40"
          >
            <Plus className="size-4" />
            Agregar
          </button>
        )}
      </div>

      {isLoading ? (
        <Cargando />
      ) : isError ? (
        <Fallo error={error} texto={`No se pudieron cargar los ${t.titulo.toLowerCase()}`} />
      ) : !filas.length ? (
        <div className="rounded-2xl border border-dashed border-border/80 px-4 py-6 text-center">
          <UsersRound className="mx-auto size-8 text-muted-foreground/40" />
          <p className="mt-2 text-sm text-muted-foreground">
            {filtro === "vigentes"
              ? `${t.femenino ? "Ninguna" : "Ningún"} ${t.singular} vigente.`
              : `Todavía no hay ${t.titulo.toLowerCase()} cargados.`}
          </p>
          {ocultas > 0 && (
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              Hay {ocultas} de períodos anteriores o inactivos: tocá “Todas” para verlos.
            </p>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {filas.map((a) => (
            <li key={a.id}>
              <Tarjeta a={a} api={api} onAbrir={() => onAbrir(a)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tarjeta({ a, api, onAbrir }: { a: Autoridad; api: ApiAutoridades; onAbrir: () => void }) {
  const detalle = [a.rol, a.nivel, a.turno].filter(Boolean).join(" · ");
  const telefono = a.telefono || a.personaTelefono;
  return (
    <div className="h-full rounded-2xl border border-border/60 bg-card shadow-soft">
      <button
        type="button"
        onClick={onAbrir}
        className="tap flex w-full items-start gap-3 p-3 text-left"
      >
        <span
          aria-hidden
          className={`grid size-10 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
            a.activo ? "bg-hero-gradient text-on-brand" : "bg-muted text-muted-foreground"
          }`}
        >
          {iniciales(a.persona || "?")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-sm font-semibold">
              {a.persona || `Sin ${api.textos.singular}`}
            </span>
            {!a.activo && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                Inactivo
              </span>
            )}
          </span>
          <span className="block text-[12px] text-muted-foreground">
            {detalle || `Sin ${api.textos.rol.toLowerCase()} cargado`}
          </span>
          <span className="block text-[11.5px] text-muted-foreground">
            {a.periodo ? `Período ${a.periodo}` : "Sin período"}
          </span>
        </span>
      </button>
      {telefono && (
        <a
          href={telHref(telefono)}
          className="tap mx-3 mb-3 -mt-1 inline-flex items-center gap-1.5 pl-[3.25rem] text-[13px] font-medium text-primary"
        >
          <Phone className="size-3.5 shrink-0" />
          {telefono}
        </a>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Alta y edición                                                             */
/* -------------------------------------------------------------------------- */

/** El año del calendario: lo que proponía APEX (`to_char(sysdate,'yyyy')`). */
const anioCalendario = () => String(new Date().getFullYear());

function EditorAutoridad({
  api,
  idInstitucion,
  fila,
  onCerrar,
}: {
  api: ApiAutoridades;
  idInstitucion: number;
  fila: Autoridad | null;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const puede = usePuede(api);
  const t = api.textos;
  const nueva = fila == null;
  const puedeGuardar = nueva ? puede.insertar : puede.actualizar;
  const puedeBorrar = !nueva && puede.borrar;

  const opciones = useQuery({
    queryKey: api.keyOpciones,
    queryFn: api.opciones,
    staleTime: 10 * 60 * 1000,
  });
  const personas = useQuery({ queryKey: api.personas.key, queryFn: api.personas.listar });
  // Las filas de la institución, para proponer los períodos que ya usa.
  const filas = useQuery({
    queryKey: api.key(idInstitucion),
    queryFn: () => api.listar(idInstitucion),
  });

  const estados = opciones.data?.estado ?? [];
  const estadoActivo = estados.find((e) => e.valor.toUpperCase() === "A")?.valor ?? "A";

  const [idPersona, setIdPersona] = useState<number | null>(fila?.idPersona ?? null);
  const [personaNueva, setPersonaNueva] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telPersona, setTelPersona] = useState("");
  const [ci, setCi] = useState("");
  const [periodo, setPeriodo] = useState(fila?.periodo ?? anioCalendario());
  const [rol, setRol] = useState(fila?.rol ?? "");
  const [nivel, setNivel] = useState(fila?.nivel ?? "");
  const [turno, setTurno] = useState(fila?.turno ?? "");
  // Sin la lista todavía, "A": es lo que proponía APEX y lo que usan los datos.
  const [estado, setEstado] = useState(fila?.estado ?? "");
  const estadoElegido = estado || (nueva ? estadoActivo : "");
  const [telefono, setTelefono] = useState(fila?.telefono ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const lista = personas.data ?? [];
  const opcPersonas: Opcion[] = lista.map((p) => {
    const extra = [p.ci && `CI ${p.ci}`, p.telefono].filter(Boolean).join(" · ");
    return {
      id: p.id,
      texto: p.nombre,
      extra: extra || undefined,
      busqueda: normalizar(`${p.nombre} ${p.ci} ${p.telefono}`),
    };
  });
  const elegida = lista.find((p) => p.id === idPersona);
  // Alguien ya cargado con el mismo nombre (sin tildes ni mayúsculas).
  const homonimo = personaNueva
    ? lista.find((p) => normalizar(p.nombre.trim()) === normalizar(nombre.trim()))
    : undefined;

  const sugeridos = [
    ...new Set([anioCalendario(), ...(filas.data ?? []).map((f) => f.periodo).filter(Boolean)]),
  ]
    .sort()
    .reverse()
    .slice(0, 4);

  const faltan = [
    ...(personaNueva
      ? nombre.trim()
        ? []
        : ["nombre y apellido"]
      : idPersona
        ? []
        : [t.singular]),
    ...(periodo.trim() ? [] : ["período"]),
    ...(estadoElegido ? [] : ["estado"]),
  ];

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: api.key(idInstitucion) });
    // El listado muestra el director vigente y cuántas autoridades hay.
    qc.invalidateQueries({ queryKey: keysInstituciones.lista });
  };

  const guardar = useMutation({
    mutationFn: async () => {
      let id = idPersona;
      if (personaNueva) {
        id = await api.personas.crear({
          nombre_apellido: nombre.trim(),
          nro_telefono: telPersona.trim(),
          nro_ci: ci.trim(),
        });
        // Si lo que sigue falla, la persona ya existe: el reintento la usa en
        // vez de crearla de nuevo.
        setIdPersona(id);
        setPersonaNueva(false);
        qc.invalidateQueries({ queryKey: api.personas.key });
      }
      return api.guardar(fila?.id ?? null, {
        idInstitucion,
        idPersona: id!,
        periodo: periodo.trim(),
        rol,
        nivel,
        turno,
        estado: estadoElegido,
        telefono: telefono.trim(),
      });
    },
    onSuccess: () => {
      invalidar();
      toast.success(nueva ? `${capital(t.singular)} agregado` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => api.quitar(fila!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`${capital(t.singular)} quitado de la institución`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo quitar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nueva ? `Agregar ${t.singular}` : fila?.persona || capital(t.singular)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nueva
              ? `Queda en la institución con el período, ${t.rol.toLowerCase()} y turno que elijas.`
              : `Período ${fila?.periodo || "sin cargar"}.`}
          </DialogDescription>
        </DialogHeader>

        {opciones.isLoading || personas.isLoading ? (
          <Cargando />
        ) : opciones.isError || personas.isError ? (
          <Fallo
            error={opciones.error ?? personas.error}
            texto="No se pudieron cargar las listas"
          />
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
              {personaNueva ? (
                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                    <UserPlus className="size-4" />
                    {capital(t.singular)} nuevo
                  </p>
                  <Texto
                    etiqueta="Nombre y apellido"
                    req
                    largo={400}
                    valor={nombre}
                    onCambio={setNombre}
                  />
                  {homonimo && (
                    <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
                      Ya hay un {t.singular} “{homonimo.nombre}”
                      {homonimo.ci ? ` (CI ${homonimo.ci})` : ""}.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setIdPersona(homonimo.id);
                          setPersonaNueva(false);
                        }}
                        className="font-semibold underline"
                      >
                        Usar ese
                      </button>{" "}
                      para no cargarlo dos veces.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Texto
                      etiqueta="Teléfono"
                      largo={80}
                      inputMode="tel"
                      valor={telPersona}
                      onCambio={setTelPersona}
                    />
                    <Texto
                      etiqueta="Nro. de CI"
                      largo={80}
                      inputMode="numeric"
                      valor={ci}
                      onCambio={setCi}
                    />
                  </div>
                  <Quitar texto="Elegir de la lista" onClick={() => setPersonaNueva(false)} />
                </div>
              ) : (
                <div>
                  <PickerModal
                    label={capital(t.singular)}
                    opciones={opcPersonas}
                    value={idPersona}
                    valueText={elegida?.nombre ?? fila?.persona ?? null}
                    onChange={(o) => setIdPersona(o.id)}
                    placeholder={`Elegir ${t.singular}`}
                    requerido
                  />
                  {puede.crearPersona && (
                    <button
                      type="button"
                      onClick={() => setPersonaNueva(true)}
                      className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-primary"
                    >
                      <UserPlus className="size-3.5" />
                      ¿No está en la lista? Cargar {t.femenino ? "una nueva" : "uno nuevo"}
                    </button>
                  )}
                </div>
              )}

              <div>
                <Texto etiqueta="Período" req largo={50} valor={periodo} onCambio={setPeriodo} />
                {sugeridos.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {sugeridos.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPeriodo(p)}
                        className={`h-8 rounded-full border px-3 text-[12px] font-semibold ${
                          periodo === p
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Pastillas
                etiqueta={t.rol}
                opciones={opciones.data!.rol}
                valor={rol}
                onCambio={setRol}
              />
              <Pastillas
                etiqueta="Nivel"
                opciones={opciones.data!.nivel}
                valor={nivel}
                onCambio={setNivel}
              />
              <Pastillas
                etiqueta="Turno"
                opciones={opciones.data!.turno}
                valor={turno}
                onCambio={setTurno}
              />
              <Pastillas
                etiqueta="Estado"
                req
                opciones={estados}
                valor={estadoElegido}
                onCambio={setEstado}
              />
              <Texto
                etiqueta="Teléfono en esta institución"
                largo={200}
                inputMode="tel"
                valor={telefono}
                onCambio={setTelefono}
                ayuda={
                  (elegida?.telefono ?? fila?.personaTelefono)
                    ? `Si queda vacío se usa el de su ficha: ${elegida?.telefono ?? fila?.personaTelefono}.`
                    : "Opcional."
                }
              />
            </fieldset>

            {!puedeGuardar && (
              <SoloLectura
                texto={`Solo lectura: tu usuario no puede ${nueva ? "agregar" : "modificar"} ${t.titulo.toLowerCase()} de instituciones.`}
              />
            )}

            <div className="flex gap-2">
              {puedeBorrar && (
                <BotonBorrar
                  confirmar={confirmarBorrado}
                  pendiente={borrar.isPending}
                  deshabilitado={ocupado}
                  onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
                />
              )}
              {puedeGuardar && (
                <button
                  type="submit"
                  disabled={ocupado}
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
                >
                  {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
                  {nueva ? "Agregar" : "Guardar cambios"}
                </button>
              )}
            </div>
            {confirmarBorrado && (
              <p className="text-[11px] text-muted-foreground">
                Se quita de esta institución; la persona sigue cargada. Tocá de nuevo para
                confirmar.
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
