/**
 * La postulación evaluada: UNA tarjeta con los datos de la clase, y un modal
 * para cambiarla cuando el facilitador tiene más de una en esa institución.
 *
 * ── QUÉ PROBLEMA RESUELVE ────────────────────────────────────────────────────
 *
 * Un facilitador puede dar clase en varios grados de la misma institución. Hasta
 * ahora la evaluación no decía en cuál: el backend intentaba deducirlo cruzando
 * facilitador + institución + año, y cuando había más de un candidato guardaba
 * `NULL` antes que adivinar (ver `f_postulacion` en el SQL, que dejaba anotado
 * que la salida correcta era exactamente esto).
 *
 * ── UNA TARJETA, NO UNA LISTA ────────────────────────────────────────────────
 *
 * Se ve **una sola** tarjeta —la elegida— y tocarla abre el modal con las demás.
 * Una lista de tarjetas siempre visibles empujaba el resto del formulario varias
 * pantallas hacia abajo cuando el facilitador tenía cinco o seis clases.
 *
 * Dentro del modal sí van todas como tarjetas: para distinguir dos postulaciones
 * del mismo facilitador hay que ver grado, sección, turno y docente A LA VEZ, y
 * eso no entra en el renglón de texto que muestra `PickerModal`.
 */

import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, Clock, Loader2, Users } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  listarPostulaciones,
  nombreTurno,
  STALE_LISTAS,
  type Postulacion,
} from "@/lib/evaluaciones";

/** "7mo grado · Sección A", con lo que haya cargado. */
function titulo(p: Postulacion) {
  const partes = [
    p.grado ? `${p.grado} grado` : null,
    p.seccion ? `Sección ${p.seccion}` : null,
  ].filter(Boolean);

  // Sin grado ni sección la tarjeta necesita ALGO que la identifique, o quedan
  // dos visualmente idénticas y la elección se vuelve una lotería.
  return partes.length ? partes.join(" · ") : `Postulación #${p.id_postulacion}`;
}

/**
 * El contenido de la tarjeta. Se usa en los dos lados —el campo del formulario y
 * cada opción del modal— para que lo elegido se vea igual que lo que se eligió.
 */
function Datos({ p }: { p: Postulacion }) {
  const turno = nombreTurno(p.turno);
  // Énfasis y materia dicen lo mismo desde dos tablas y suele venir uno u otro.
  const materias = [...new Set([p.enfasis, p.materia].filter(Boolean))] as string[];

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-[15px] leading-snug font-bold">{titulo(p)}</h3>
        {turno && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {turno}
          </span>
        )}
      </div>

      {/* La matrícula: es el VALOR de la columna del grado, no un id. Ver
          `lov_postulaciones` en el SQL. */}
      {p.alumnos != null && (
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Users className="size-3.5 shrink-0" />
          {p.alumnos} alumnos
        </p>
      )}

      {p.horario && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Clock className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{p.horario}</span>
        </p>
      )}

      {p.docente && (
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Docente: <span className="font-medium text-foreground">{p.docente}</span>
        </p>
      )}

      {materias.length > 0 && (
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{materias.join(" · ")}</span>
        </p>
      )}

      {p.programa && (
        <span className="mt-2 inline-block rounded-lg bg-muted px-2.5 py-1 text-[11px] leading-snug font-semibold text-muted-foreground">
          {p.programa}
        </span>
      )}

      {/*
        EL ÍNDICE QUE LE TOCA A ESTA CLASE. Va acá abajo, después del programa,
        porque es el dato que decide: el evaluador elige la postulación viendo
        qué índice sigue, sin tener que seleccionarla primero para enterarse.

        Lo calcula el backend (el posterior al último con SI_NO='Si' en
        INTERVENCIONES). Cuando no hay —clase sin intervenciones, o manual ya
        terminado— no se muestra nada: proponer el índice 1 sin saber el manual
        sería inventar, y un cartel de "sin índice" en cada tarjeta es ruido.
      */}
      {p.indice_titulo && (
        <div className="mt-2 rounded-lg border border-primary/30 bg-primary-soft px-2.5 py-1.5">
          <p className="text-[11px] font-semibold text-muted-foreground">
            Índice a desarrollar
            {/* De dónde sale: sin esto el número aparece solo y no hay forma de
                saber si es el que corresponde. */}
            {p.nro_indice_ultimo != null && ` · sigue al ${p.nro_indice_ultimo}`}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug font-bold">
            {/* El número delante: es como el evaluador tiene el manual impreso
                delante, y el título solo no lo ubica. */}
            {p.nro_indice != null ? `${p.nro_indice} · ` : ""}
            {p.indice_titulo}
          </p>
        </div>
      )}
    </>
  );
}

export function PostulacionPicker({
  idFacilitador,
  idInstitucion,
  value,
  onChange,
  todosPorDefecto = false,
}: {
  idFacilitador: number | null;
  idInstitucion: number | null;
  value: number | null;
  /**
   * La postulación completa y no solo su id: el formulario necesita además el
   * `id_indice` que viene resuelto en ella, porque el índice de la evaluación
   * es el que le toca a la clase elegida. `null` al deseleccionar.
   */
  onChange: (p: Postulacion | null) => void;
  /**
   * Arrancar mostrando TODAS las clases, no solo las de hoy.
   *
   * Lo usa la carga manual de intervenciones atrasadas, donde el filtro por día
   * de hoy no sirve por definición: se está cargando una clase de la semana
   * pasada. En evaluaciones se deja en `false`, que es el caso normal.
   */
  todosPorDefecto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  /*
   * Por defecto se piden SOLO las clases de HOY: una evaluación se carga el día
   * que se observa la clase, así que las de otros días son ruido. El día lo
   * resuelve el backend con la fecha del servidor.
   *
   * `todos` es la salida manual, para los casos que el filtro no cubre: cargar
   * una evaluación al día siguiente, o corregir una vieja. `todosPorDefecto` lo
   * deja prendido desde el arranque para quien nunca carga en el día.
   */
  const [todos, setTodos] = useState(todosPorDefecto);

  /*
   * Los dos ids son OBLIGATORIOS en el backend, que responde 400 sin ellos. Sin
   * esta guarda, abrir el formulario vacío dispararía una llamada fallida antes
   * de que el usuario elija nada.
   */
  const habilitada = idFacilitador != null && idInstitucion != null;

  const { data, isLoading, isError } = useQuery({
    // `todos` va en la key: sin él, pedir todas devolvería la caché del día.
    queryKey: ["postulaciones", idFacilitador, idInstitucion, todos],
    queryFn: () => listarPostulaciones(idFacilitador!, idInstitucion!, todos ? "TODOS" : undefined),
    enabled: habilitada,
    staleTime: STALE_LISTAS,
  });

  // Antes de elegir institución no se muestra nada: un "elegí primero…" suma
  // ruido a un formulario que ya es largo.
  if (!habilitada) return null;

  const elegida = data?.find((p) => p.id_postulacion === value) ?? null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">Postulación</label>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Buscando postulaciones…
        </div>
      ) : isError ? (
        /*
         * Un fallo acá NO bloquea el guardado: la postulación es trazabilidad, no
         * un dato obligatorio, y el backend la deduce igual. Por eso es un aviso
         * y no un error rojo que sugiera que hay algo que resolver.
         */
        <p className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground">
          No se pudieron cargar las postulaciones. La evaluación se puede guardar igual.
        </p>
      ) : !data?.length ? (
        /*
         * Sin resultados. Distinguir los dos casos importa: con el filtro del día
         * puesto, "no tiene ninguna" sería MENTIRA —puede tener clases el resto de
         * la semana—, y el evaluador buscaría un problema que no existe.
         */
        <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            {todos
              ? "Este facilitador no tiene postulaciones cargadas en esta institución para el año lectivo actual."
              : "No tiene clases hoy en esta institución."}
          </p>
          {!todos && (
            <button
              type="button"
              onClick={() => setTodos(true)}
              className="tap mt-2 text-[13px] font-semibold text-primary"
            >
              Ver las de todos los días
            </button>
          )}
        </div>
      ) : (
        <Dialog open={abierto} onOpenChange={setAbierto}>
          <DialogTrigger asChild>
            <button
              type="button"
              className={`tap flex w-full items-start gap-2 rounded-2xl border p-3.5 text-left transition-colors ${
                elegida
                  ? "border-primary/40 bg-card"
                  : "border-input bg-card hover:border-primary/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                {elegida ? (
                  <Datos p={elegida} />
                ) : (
                  <span className="text-base text-muted-foreground">Seleccionar</span>
                )}
              </div>
              <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </button>
          </DialogTrigger>

          {/* Mismas medidas que PickerModal: el formulario tiene que sentirse
              uniforme aunque acá adentro vayan tarjetas y no renglones. */}
          <DialogContent className="grid max-h-[85vh] w-[calc(100vw-2rem)] max-w-md grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
            <DialogHeader className="px-5 pt-5 pb-3 text-left">
              <DialogTitle className="font-display text-xl">Postulación</DialogTitle>
              <DialogDescription className="text-xs">
                {todos ? "Todas las clases de la semana" : "Las clases de hoy"}
              </DialogDescription>
              {/* El escape para cuando la evaluación no es del día: cargar una
                  ayer, o corregir una vieja. */}
              {!todos && (
                <button
                  type="button"
                  onClick={() => setTodos(true)}
                  className="tap mt-1 self-start text-[13px] font-semibold text-primary"
                >
                  Ver las de todos los días
                </button>
              )}
            </DialogHeader>

            <div className="space-y-2 overflow-y-auto overscroll-contain px-3 pb-4">
              {data.map((p) => {
                const esta = p.id_postulacion === value;
                return (
                  <button
                    key={p.id_postulacion}
                    type="button"
                    aria-pressed={esta}
                    onClick={() => {
                      // Volver a tocar la elegida la deselecciona: un clic por
                      // error, si no, no se puede deshacer. "Ninguna" es válido:
                      // el backend vuelve a deducirla.
                      onChange(esta ? null : p);
                      setAbierto(false);
                    }}
                    className={`tap w-full rounded-xl border p-3 text-left transition-colors ${
                      esta ? "border-primary bg-primary-soft" : "border-border/60 bg-card"
                    }`}
                  >
                    <Datos p={p} />
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <p className="mt-1.5 text-xs text-muted-foreground">
        Opcional. Indica qué grado se evaluó cuando el facilitador tiene varios en esta institución.
      </p>
    </div>
  );
}
