import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  CalendarDays,
  Clock,
  GraduationCap,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  User,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { SelectorModal } from "@/components/selector-modal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DIAS,
  DIAS_CORTO,
  DIAS_LABEL,
  diaDeAgenda,
  diasDeAgenda,
  formatearHorario,
  keysAgendas,
  listarAgendas,
  opcionesAgenda,
  sinTilde,
  STALE_OPCIONES,
  type Agenda,
  type FiltrosAgenda,
  type FiltrosOpciones,
} from "@/lib/agendas";
import { nombreTurno } from "@/lib/evaluaciones";

export const Route = createFileRoute("/agendas/")({
  head: () => ({
    meta: [
      { title: "Agendas — Juventud con Valores" },
      { name: "description", content: "Horario semanal de los facilitadores." },
    ],
  }),
  component: AgendasPage,
});

/**
 * La medida de UN campo de filtro, y de todos.
 *
 * Es una constante y no ocho copias de `"h-11 px-3.5 text-sm"` porque el
 * problema que vino a arreglar fue justamente ese: ocho literales sueltos que se
 * fueron desparejando —dos `h-10`, dos `h-11`, un `w-32`— hasta que la fila se
 * veía desalineada. Con una constante, cambiar la altura es una línea y no
 * puede quedar a medias.
 *
 * `h-11` (44px) es el mínimo cómodo para tocar con el dedo, y coincide con el
 * input de búsqueda de al lado.
 */
const ALTO_CAMPO = "h-11 px-3.5 text-sm";

/**
 * El horario semanal de los facilitadores.
 *
 * ## QUÉ REEMPLAZA
 *
 * La página 30 de la app APEX: un *faceted search* sobre `V_AGENDA` con una
 * columna de facetas a la izquierda y una tabla de 17 columnas a la derecha.
 *
 * ## DOS PRESENTACIONES DEL MISMO DATO
 *
 * | | Celular (`< lg`) | Escritorio (`≥ lg`) |
 * | --- | --- | --- |
 * | Las filas | tarjetas | **tabla**, como la de APEX |
 * | El detalle | modal al tocar | modal al hacer clic |
 *
 * La tabla vuelve en escritorio porque ahí sí se lee: es la vista que permite
 * comparar veinte filas de un golpe, que es para lo que existe un reporte. En el
 * teléfono la misma tabla obliga a scrollear en dos ejes, y por eso ahí son
 * tarjetas. Es la misma consulta y los mismos datos: cambia cómo se dibujan.
 *
 * ## LOS FILTROS SON UNA CASCADA, Y EL DÍA MANDA
 *
 * El día es el primero porque es el que más recorta: una agenda se consulta para
 * saber quién trabaja hoy. Elegido el día, **los combos de abajo se recalculan**
 * y ofrecen solo lo que existe ese día — igual que las facetas de APEX, que
 * recalculaban sus conteos con cada selección.
 *
 * Cada combo se excluye a sí mismo de esa cuenta (lo hace el backend): si el de
 * facilitadores se filtrara por el facilitador elegido, quedaría con un solo
 * elemento y no habría cómo cambiarlo.
 */
function AgendasPage() {
  const [texto, setTexto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [anio, setAnio] = useState("");
  const [dia, setDia] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [turno, setTurno] = useState("");
  const [manual, setManual] = useState("");
  const [idFacilitador, setIdFacilitador] = useState("");
  const [idInstitucion, setIdInstitucion] = useState("");
  const [detalle, setDetalle] = useState<Agenda | null>(null);

  // Debounce: sin esto cada tecla dispara una consulta contra Oracle, que además
  // pagina. 350 ms es la pausa natural al terminar de escribir un nombre.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  /*
   * `anio` vacío NO es "todos los años": es "no mandes el parámetro", y ahí el
   * backend usa el año lectivo activo — el mismo default que tenía la faceta
   * P30_ANIO. Para ver todos hay que elegir "Todos" explícitamente.
   */
  const filtros: FiltrosAgenda = {
    anio: anio || undefined,
    dia: dia || undefined,
    departamento: departamento || undefined,
    ciudad: ciudad || undefined,
    turno: turno ? Number(turno) : undefined,
    manual: manual || undefined,
    id_facilitador: idFacilitador ? Number(idFacilitador) : undefined,
    id_institucion: idInstitucion ? Number(idInstitucion) : undefined,
    buscar: buscar || undefined,
    limite: 100,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: keysAgendas.lista(filtros),
    queryFn: () => listarAgendas(filtros),
  });

  /*
   * Los combos se recalculan con TODOS los filtros menos el texto libre.
   *
   * La búsqueda queda afuera a propósito: se escribe letra por letra, y meterla
   * acá haría que los combos se recorten mientras se tipea —hasta quedar
   * vacíos con una palabra a medio escribir— y dispararía una consulta de
   * opciones por cada tecla.
   */
  const paraOpciones: FiltrosOpciones = {
    anio: anio || undefined,
    dia: dia || undefined,
    departamento: departamento || undefined,
    ciudad: ciudad || undefined,
    turno: turno ? Number(turno) : undefined,
    manual: manual || undefined,
    id_facilitador: idFacilitador ? Number(idFacilitador) : undefined,
    id_institucion: idInstitucion ? Number(idInstitucion) : undefined,
  };

  const { data: opciones } = useQuery({
    queryKey: keysAgendas.opciones(paraOpciones),
    queryFn: () => opcionesAgenda(paraOpciones),
    staleTime: STALE_OPCIONES,
    // Sin esto los combos parpadean a "sin opciones" en cada cambio de filtro,
    // mientras vuelve la consulta nueva.
    placeholderData: (previa) => previa,
  });

  const filas = data?.data ?? [];
  const activos = [dia, departamento, ciudad, turno, manual, idFacilitador, idInstitucion].filter(
    Boolean,
  ).length;

  const limpiar = () => {
    setDia("");
    setDepartamento("");
    setCiudad("");
    setTurno("");
    setManual("");
    setIdFacilitador("");
    setIdInstitucion("");
  };

  /*
   * Cambiar de departamento LIMPIA la ciudad.
   *
   * Sin esto queda una combinación imposible —Central + una ciudad de Itapúa— y
   * el reporte sale vacío sin que se vea por qué: los dos filtros se ven
   * válidos por separado. Es el único acoplamiento entre dos filtros, y existe
   * porque la ciudad cuelga del departamento.
   *
   * Se limpia siempre, incluso al pasar a "Todos": la ciudad elegida podría no
   * estar en el departamento nuevo, y comprobarlo acá duplicaría la lógica que
   * el backend ya aplica.
   */
  const cambiarDepartamento = (v: string) => {
    setDepartamento(v);
    setCiudad("");
  };

  /*
   * Los años salen de los datos, con "Todos" al final. El primero es `""` = "Año
   * lectivo", que NO manda el parámetro y deja decidir al backend: es el default
   * de la pantalla y el que tenía la faceta original.
   */
  const opcionesAnio = useMemo(
    () => [
      { valor: "", texto: "Año lectivo", extra: "El año activo" },
      ...(opciones?.anios ?? []).map((a) => ({ valor: a, texto: a })),
      { valor: "TODOS", texto: "Todos los años" },
    ],
    [opciones?.anios],
  );

  /*
   * Los días que EXISTEN con el resto de los filtros puestos. El valor viaja sin
   * tilde ("Miercoles") porque es lo que compara el backend; lo que se ve lleva
   * tilde.
   */
  const opcionesDia = useMemo(() => {
    const presentes = opciones?.dias ?? [];
    return [
      { valor: "", texto: "Todos los días" },
      ...DIAS.filter((d) => presentes.includes(sinTilde(DIAS_LABEL[d]))).map((d) => ({
        valor: sinTilde(DIAS_LABEL[d]),
        texto: DIAS_LABEL[d],
      })),
    ];
  }, [opciones?.dias]);

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Agendas</h1>
            <p className="text-xs text-muted-foreground">Horario semanal de los facilitadores</p>
          </div>

          {/* Solo aparece si hay algo que limpiar. Va acá arriba, alineado al
              título, y no metido entre los campos: es una ACCIÓN sobre el
              formulario, no un campo más, y mezclarlo con ellos era parte de lo
              que hacía ver la fila despareja. */}
          {activos > 0 && (
            <button
              onClick={limpiar}
              aria-label={`Limpiar ${activos} filtro${activos === 1 ? "" : "s"}`}
              className="tap flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <RotateCcw className="size-3.5" />
              Limpiar ({activos})
            </button>
          )}
        </div>

        {/*
          ── LOS FILTROS: UNA SOLA GRILLA, TODOS DEL MISMO TAMAÑO ─────────────

          Antes eran tres bloques con medidas distintas —el Año encajado en un
          `w-32` al lado del título, el Día ocupando una fila entero, los otros
          seis de a dos— y con tres alturas mezcladas (`h-10`, `h-11`). Ninguna
          de esas diferencias significaba nada: eran siete campos del mismo tipo
          dibujados de cuatro maneras.

          Ahora es UNA grilla y **todos los campos miden igual** (`h-11`, que es
          el objetivo táctil cómodo en un teléfono). La jerarquía —qué filtro
          importa más— la da el ORDEN de lectura, no el tamaño: Día primero,
          después dónde, después quién.

          Las columnas crecen con la pantalla: 1 en teléfono chico, 2 en cuanto
          entra, 3 en tablet y 4 en escritorio. Los siete campos entran en dos
          filas parejas en vez de una barra ancha y una grilla suelta.

          El título va SIEMPRE visible: sin él, un combo con un valor elegido
          dice solo "Mañana" o "CARACTER" y no hay forma de saber de qué campo
          es. Y como el título ya dice el campo, el `placeholder` dice el VALOR
          por defecto —"Todos", "Todas"— en vez de repetirlo.
        */}
        <div className="mb-4 grid grid-cols-1 gap-x-3 gap-y-3.5 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {/* El día primero: es el que más recorta y el que se usa siempre
              —"quién trabaja hoy"—. Los demás cuelgan de él. */}
          <SelectorModal
            label="Día"
            value={dia}
            onChange={setDia}
            placeholder="Todos los días"
            descripcion="Los días con clases cargadas"
            opciones={opcionesDia}
            className={ALTO_CAMPO}
          />

          {/* Dónde: departamento y después ciudad, que cuelga de él. */}
          <SelectorModal
            label="Departamento"
            value={departamento}
            onChange={cambiarDepartamento}
            placeholder="Todos"
            opciones={[
              { valor: "", texto: "Todos" },
              ...(opciones?.departamentos ?? []).map((d) => ({ valor: d, texto: d })),
            ]}
            className={ALTO_CAMPO}
          />
          <SelectorModal
            label="Ciudad"
            value={ciudad}
            onChange={setCiudad}
            placeholder="Todas"
            descripcion={
              departamento ? `Las ciudades de ${departamento}` : "Todas las ciudades con agenda"
            }
            opciones={[
              { valor: "", texto: "Todas" },
              ...(opciones?.ciudades ?? []).map((c) => ({ valor: c, texto: c })),
            ]}
            className={ALTO_CAMPO}
          />

          {/* Quién y qué. */}
          <SelectorModal
            label="Facilitador"
            value={idFacilitador}
            onChange={setIdFacilitador}
            placeholder="Todos"
            opciones={[
              { valor: "", texto: "Todos" },
              ...(opciones?.facilitadores ?? []).map((f) => ({
                valor: String(f.id),
                texto: f.nombre,
              })),
            ]}
            className={ALTO_CAMPO}
          />
          <SelectorModal
            label="Institución"
            value={idInstitucion}
            onChange={setIdInstitucion}
            placeholder="Todas"
            opciones={[
              { valor: "", texto: "Todas" },
              ...(opciones?.instituciones ?? []).map((i) => ({
                valor: String(i.id),
                texto: i.nombre,
              })),
            ]}
            className={ALTO_CAMPO}
          />
          <SelectorModal
            label="Turno"
            value={turno}
            onChange={setTurno}
            placeholder="Todos"
            opciones={[
              { valor: "", texto: "Todos" },
              // Solo los turnos presentes, y con la etiqueta de `nombreTurno`
              // para que digan lo mismo que en el resto de la app.
              ...(opciones?.turnos ?? []).map((t) => ({
                valor: String(t),
                texto: nombreTurno(t) ?? `Turno ${t}`,
              })),
            ]}
            className={ALTO_CAMPO}
          />
          <SelectorModal
            label="Manual"
            value={manual}
            onChange={setManual}
            placeholder="Todos"
            opciones={[
              { valor: "", texto: "Todos" },
              ...(opciones?.manuales ?? []).map((m) => ({ valor: m, texto: m })),
            ]}
            className={ALTO_CAMPO}
          />

          {/* El año cierra la grilla como un campo más. Antes vivía arriba en
              un `w-32` fijo, que lo dejaba más angosto que todo lo demás y con
              su etiqueta desalineada del resto. */}
          <SelectorModal
            label="Año"
            value={anio}
            onChange={setAnio}
            opciones={opcionesAnio}
            className={ALTO_CAMPO}
          />
        </div>

        {/* ── Búsqueda ─────────────────────────────────────────────────────
            Va abajo y sola: es el único filtro que se escribe en vez de
            elegirse, y separarla de la grilla lo deja claro sin decirlo. Misma
            altura que los combos, y su `<label>` con las mismas clases que el
            de `SelectorModal` para que la fila cierre pareja. */}
        <div className="mb-4">
          <label htmlFor="buscar-agenda" className="mb-1.5 block text-sm font-medium">
            Buscar
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="buscar-agenda"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Facilitador, institución, ciudad…"
              className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-sm outline-none focus:border-primary/40"
            />
            {texto && (
              <button
                onClick={() => setTexto("")}
                aria-label="Limpiar búsqueda"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── Resultado ────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Cargando…
          </div>
        ) : isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No se pudieron cargar las agendas.
          </p>
        ) : !filas.length ? (
          <div className="py-12 text-center">
            <CalendarDays className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {buscar || activos
                ? "Ninguna agenda coincide con los filtros."
                : "No hay agendas cargadas para este año."}
            </p>
            {(buscar || activos) && (
              <button
                onClick={() => {
                  setTexto("");
                  limpiar();
                }}
                className="mt-3 text-sm font-medium text-primary"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            {/* El total y no solo lo que se ve: la lista está paginada y sin
                esto no hay forma de saber que hay más. */}
            <p className="mb-2 text-xs text-muted-foreground">
              {data!.total} agenda{data!.total === 1 ? "" : "s"}
              {filas.length < data!.total && ` · mostrando ${filas.length}`}
            </p>

            {/* Tarjetas en celular… */}
            <ul className="space-y-2 lg:hidden">
              {filas.map((a) => (
                <Tarjeta key={a.id_postulacion} a={a} onVer={() => setDetalle(a)} />
              ))}
            </ul>

            {/* …y la tabla de APEX en escritorio. */}
            <Tabla filas={filas} onVer={setDetalle} />

            {filas.length < data!.total && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Afiná la búsqueda o los filtros para ver el resto.
              </p>
            )}
          </>
        )}
      </div>

      <Detalle a={detalle} onClose={() => setDetalle(null)} />
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Escritorio: la tabla                                                       */
/* -------------------------------------------------------------------------- */

/**
 * El reporte como tabla, al estilo del de APEX. **Solo en `≥ lg`.**
 *
 * Lleva las mismas columnas que la página 30, con dos diferencias:
 *
 * - **Los cinco días son UNA columna** ("Lunes · 06:40 a 07:20") y no cinco.
 *   Con una fila = un día, cuatro de esas cinco columnas estaban siempre vacías
 *   y ocupaban la mitad del ancho de la tabla.
 * - **Materia sale resuelta**, no como el id crudo que devuelve la vista.
 *
 * `overflow-x-auto` en el contenedor: la tabla puede pasarse del ancho en una
 * pantalla chica de escritorio, y tiene que scrollear ELLA, nunca la página.
 */
function Tabla({ filas, onVer }: { filas: Agenda[]; onVer: (a: Agenda) => void }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-soft lg:block">
      <table className="w-full text-sm">
        <thead>
          {/* `sticky`: con 100 filas, el encabezado se pierde al scrollear y no
              hay forma de saber qué columna se está leyendo. */}
          <tr className="sticky top-0 border-b border-border/60 bg-muted/50 text-left text-xs">
            <Th>Facilitador</Th>
            <Th>Institución</Th>
            {/* Ciudad sí, departamento no: en la tabla el departamento sería una
                columna casi constante —todas las filas de un reporte filtrado
                comparten departamento— y el ancho hace falta para lo demás.
                Está en el detalle, junto a la ciudad. */}
            <Th>Ciudad</Th>
            <Th>Día y horario</Th>
            <Th>Turno</Th>
            <Th>Grado</Th>
            <Th>Docente</Th>
            <Th>Énfasis</Th>
            <Th>Materia</Th>
            <Th>Manual</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((a) => {
            const d = diaDeAgenda(a);
            return (
              <tr
                key={a.id_postulacion}
                onClick={() => onVer(a)}
                className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
              >
                <Td className="font-medium">
                  {a.nombre_facilitador ?? `#${a.id_facilitador}`}
                  {a.estado === "Inactivo" && (
                    <span className="ml-1.5 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-bold text-destructive">
                      Inactiva
                    </span>
                  )}
                </Td>
                <Td>{a.nombre_institucion ?? `#${a.id_institucion}`}</Td>
                <Td>{a.ciudad ?? "—"}</Td>
                <Td>
                  {d ? (
                    <span className="whitespace-nowrap">
                      <span className="font-medium">{DIAS_LABEL[d.dia]}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatearHorario(d.horario)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Sin horario</span>
                  )}
                </Td>
                <Td>{nombreTurno(a.turno) ?? "—"}</Td>
                <Td>
                  {a.grado ?? "—"}
                  {a.seccion && <span className="text-muted-foreground"> “{a.seccion}”</span>}
                </Td>
                <Td>{a.nombre_profesor ?? "—"}</Td>
                <Td>{a.enfasis ?? "—"}</Td>
                <Td>{a.materia ?? "—"}</Td>
                <Td>{a.manual ?? "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2.5 font-semibold text-muted-foreground">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}

/* -------------------------------------------------------------------------- */
/* Celular: la tarjeta                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Una agenda en el celular.
 *
 * Muestra lo que se lee de un vistazo —quién, dónde, cuándo— y deja el resto
 * (docente, énfasis, materia, usuario) para el modal. La tabla de APEX ponía las
 * 17 columnas a la vez y en un teléfono no se podía leer ninguna.
 */
function Tarjeta({ a, onVer }: { a: Agenda; onVer: () => void }) {
  const dia = diaDeAgenda(a);
  const turno = nombreTurno(a.turno);

  return (
    <li>
      <button
        onClick={onVer}
        className="tap w-full rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-soft"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {a.nombre_facilitador ?? `Facilitador #${a.id_facilitador}`}
          </p>
          {/* El manual identifica la serie del material; es lo que más se busca
              después del nombre, así que va arriba y no en el pie. */}
          {a.manual && (
            <span className="shrink-0 rounded-md bg-primary-soft px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {a.manual}
            </span>
          )}
        </div>

        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Building2 className="size-3 shrink-0" />
          {a.nombre_institucion ?? `Institución #${a.id_institucion}`}
        </p>

        {/* La ciudad va en su propia línea con su ícono: pegada al nombre de la
            institución —que es largo— quedaría cortada por el `truncate` justo
            en el dato que la distingue de otra homónima. */}
        {a.ciudad && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {a.ciudad}
          </p>
        )}

        {/* El día y la hora: es el dato que define una agenda. Va destacado y no
            en la línea gris de abajo con todo lo demás. */}
        <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium">
          <Clock className="size-3.5 shrink-0 text-primary" />
          {dia ? (
            <>
              <span>{DIAS_LABEL[dia.dia]}</span>
              <span className="text-muted-foreground">·</span>
              <span>{formatearHorario(dia.horario)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Sin horario cargado</span>
          )}
        </p>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {a.grado && (
            <span className="font-medium text-foreground">
              {a.grado}
              {a.seccion && ` “${a.seccion}”`}
            </span>
          )}
          {turno && <span>{turno}</span>}
          {a.enfasis && <span>{a.enfasis}</span>}
          {a.materia && <span>{a.materia}</span>}
          {/* Solo se marca la inactiva: la activa es el caso normal y una
              etiqueta en cada tarjeta sería ruido. */}
          {a.estado === "Inactivo" && (
            <span className="rounded bg-destructive/10 px-1 py-0.5 font-bold text-destructive">
              Inactiva
            </span>
          )}
        </p>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* El detalle                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * **Todas** las columnas de `V_AGENDA`, en los dos layouts.
 *
 * Es donde vive lo que ni la tarjeta ni la tabla muestran: el usuario APEX del
 * facilitador y el número de postulación, que son los que permiten encontrar la
 * fila en APEX cuando alguien reporta un problema.
 */
function Detalle({ a, onClose }: { a: Agenda | null; onClose: () => void }) {
  if (!a) return null;

  const dias = diasDeAgenda(a);
  const turno = nombreTurno(a.turno);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {a.nombre_facilitador ?? `Facilitador #${a.id_facilitador}`}
          </DialogTitle>
        </DialogHeader>

        {/* La semana completa. Los días sin clase se muestran atenuados en vez
            de omitirse: así se ve de un golpe qué días trabaja y cuáles no, que
            es lo que la tabla de cinco columnas de APEX mostraba bien. */}
        <div className="grid grid-cols-5 gap-1.5">
          {DIAS.map((d) => {
            const h = dias.find((x) => x.dia === d)?.horario ?? null;
            return (
              <div
                key={d}
                className={`rounded-xl border p-2 text-center ${
                  h ? "border-primary/40 bg-primary-soft" : "border-border/60 bg-muted/30"
                }`}
              >
                <p
                  className={`text-[10px] font-bold ${h ? "text-primary" : "text-muted-foreground"}`}
                >
                  {DIAS_CORTO[d]}
                </p>
                {h ? (
                  <>
                    <p className="mt-0.5 text-[11px] leading-tight font-semibold">{h.desde}</p>
                    {h.hasta && (
                      <p className="text-[10px] leading-tight text-muted-foreground">{h.hasta}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/50">—</p>
                )}
              </div>
            );
          })}
        </div>

        <dl className="mt-4 space-y-2.5 text-sm">
          <Dato icono={Building2} label="Institución" valor={a.nombre_institucion} />
          {/* Los dos juntos y en orden geográfico, que es como se lee una
              dirección. La tabla muestra solo la ciudad; acá está el par. */}
          <Dato icono={MapPin} label="Ciudad" valor={a.ciudad} />
          <Dato label="Departamento" valor={a.departamento} />
          <Dato
            icono={GraduationCap}
            label="Grado"
            valor={[a.grado, a.seccion && `Sección “${a.seccion}”`].filter(Boolean).join(" · ")}
          />
          <Dato icono={Clock} label="Turno" valor={turno} />
          <Dato icono={User} label="Docente" valor={a.nombre_profesor} />
          <Dato label="Énfasis" valor={a.enfasis} />
          <Dato label="Materia" valor={a.materia} />
          <Dato label="Manual" valor={a.manual} />
          <Dato label="Año" valor={a.anio} />
          {/* El estado solo cuando NO es activo: ver la nota en `Tarjeta`. */}
          {a.estado && a.estado !== "Activo" && <Dato label="Estado" valor={a.estado} />}
          {/* Para soporte: con esto se encuentra la fila en APEX. */}
          <Dato label="Usuario" valor={a.usuario} />
          <Dato label="N.º de postulación" valor={String(a.id_postulacion)} />
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** Una fila del detalle. No se pinta si no hay valor. */
function Dato({
  icono: Icono,
  label,
  valor,
}: {
  icono?: typeof Building2;
  label: string;
  valor: string | null;
}) {
  if (!valor) return null;
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {Icono && <Icono className="size-3.5" />}
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-right text-sm font-medium">{valor}</dd>
    </div>
  );
}
