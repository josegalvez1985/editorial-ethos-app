import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarX2, Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo } from "@/components/admin-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIAS,
  anioVigente,
  eliminarBloqueo,
  guardarBloqueo,
  keysBloqueos,
  leerFranjas,
  listarBloqueos,
  textoFranjas,
  type Bloqueo,
  type Dia,
  type DiasBloqueo,
  type Franja,
} from "@/lib/facilitadores-bloqueos";
import { fechaCorta } from "@/lib/fechas";
import { aHora, minutos, seSuperponen, textoDuracion } from "@/lib/horario-instituciones";
import { escribirHora, normalizarHora } from "@/lib/lupa";

/**
 * Los horarios bloqueados de UN facilitador (`FACILITADORES_DIAS_BLOQUEOS`,
 * 14/10/2026): un modal de Facilitadores, que se abre desde su tarjeta del
 * listado o desde su ficha. Ver `lib/facilitadores-bloqueos.ts`.
 *
 * - **Por año lectivo**, en pastillas; abre en el vigente.
 * - **Los cinco días con sus franjas** (desde – hasta), varias por día. Las
 *   horas se escriben solo con números, como en las grillas (`lib/lupa.ts`).
 * - **"Copiar los de {año}"** cuando el año elegido está vacío y otro tiene.
 * - **Sin permisos propios** (pedido de Jose): quien llega a Facilitadores
 *   carga, modifica y borra.
 */
export function BloqueosFacilitador({
  idFacilitador,
  nombre,
  onCerrar,
}: {
  idFacilitador: number;
  nombre: string;
  onCerrar: () => void;
}) {
  const consulta = useQuery({ queryKey: keysBloqueos.todo, queryFn: listarBloqueos });
  const [elegido, setElegido] = useState<number | null>(null);
  const [sucio, setSucio] = useState(false);

  const datos = consulta.data;
  const suyos = (datos?.bloqueos ?? []).filter((b) => b.idFacilitador === idFacilitador);
  const vigente = datos ? anioVigente(datos.anios) : undefined;
  // Los años que se ofrecen: el vigente, los que vienen y los que ya tienen bloqueos.
  const anios = (datos?.anios ?? []).filter(
    (a) =>
      a.id === vigente?.id ||
      (vigente != null && a.anio > vigente.anio) ||
      suyos.some((b) => b.idAnio === a.id),
  );
  const idAnio = elegido ?? vigente?.id ?? null;
  const anio = anios.find((a) => a.id === idAnio);
  const fila = suyos.find((b) => b.idAnio === idAnio);
  // De dónde copiar si el año está vacío: el más nuevo con bloqueos.
  const origen = !fila ? suyos.find((b) => b.idAnio !== idAnio) : undefined;

  const cerrar = () => {
    if (sucio && !window.confirm("Hay cambios sin guardar. ¿Cerrar igual?")) return;
    onCerrar();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && cerrar()}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">Horarios bloqueados</DialogTitle>
          <DialogDescription className="text-xs">
            {nombre}: cuándo no está disponible, de lunes a viernes.
          </DialogDescription>
        </DialogHeader>

        {consulta.isLoading ? (
          <Cargando />
        ) : consulta.isError ? (
          <Fallo error={consulta.error} texto="No se pudieron cargar los bloqueos" />
        ) : !anios.length || idAnio == null ? (
          <p className="rounded-xl bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            No hay años lectivos cargados: hacen falta para cargar bloqueos.
          </p>
        ) : (
          <div className="space-y-4">
            {anios.length === 1 && (
              <p className="text-sm font-semibold">
                Año lectivo {anio?.anio}
                {anio?.vigente && (
                  <span className="font-normal text-muted-foreground"> · actual</span>
                )}
              </p>
            )}
            {anios.length > 1 && (
              <div>
                <div role="tablist" aria-label="Año lectivo" className="flex flex-wrap gap-2">
                  {anios.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="tab"
                      aria-selected={a.id === idAnio}
                      disabled={sucio && a.id !== idAnio}
                      onClick={() => setElegido(a.id)}
                      className={`tap h-9 rounded-full border px-3.5 text-[13px] font-semibold disabled:opacity-50 ${
                        a.id === idAnio
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {a.anio}
                      {a.vigente && <span className="ml-1 opacity-70">· actual</span>}
                    </button>
                  ))}
                </div>
                {sucio && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Guardá los cambios de {anio?.anio} para pasar a otro año.
                  </p>
                )}
              </div>
            )}

            <Editor
              // Remonta al cambiar de año o cuando se crea la fila.
              key={`${idAnio}-${fila?.id ?? "nuevo"}`}
              idFacilitador={idFacilitador}
              idAnio={idAnio}
              anio={anio?.anio ?? null}
              fila={fila}
              origen={origen}
              largo={datos?.largo ?? 100}
              onSucio={setSucio}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * El botón que abre el modal, con cuántas franjas tiene en el año vigente.
 * `tarjeta`: al costado de cada tarjeta del listado; `ficha`: en la cabecera.
 */
export function BotonBloqueos({
  franjas,
  anio,
  nombre,
  onClick,
  variante = "tarjeta",
}: {
  franjas: number;
  anio?: number;
  nombre: string;
  onClick: () => void;
  variante?: "tarjeta" | "ficha";
}) {
  const detalle = franjas
    ? `${franjas} ${franjas === 1 ? "franja bloqueada" : "franjas bloqueadas"}${anio ? ` en ${anio}` : ""}`
    : `Sin horarios bloqueados${anio ? ` en ${anio}` : ""}`;
  if (variante === "ficha")
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/60 bg-card px-3.5 text-sm font-semibold text-primary shadow-soft hover:border-primary/40"
      >
        <CalendarX2 className="size-4" />
        Horarios bloqueados
        <span
          className={`rounded-full px-1.5 text-[11px] tabular-nums ${
            franjas ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {franjas}
        </span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      title={detalle}
      aria-label={`Horarios bloqueados de ${nombre}: ${detalle}`}
      className="tap m-1.5 ml-0 flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-muted/40 text-muted-foreground hover:bg-muted hover:text-primary"
    >
      <CalendarX2 className={`size-4 ${franjas ? "text-primary" : ""}`} />
      <span className={`text-[10.5px] font-semibold tabular-nums ${franjas ? "text-primary" : ""}`}>
        {franjas || "—"}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* El editor de un año                                                        */
/* -------------------------------------------------------------------------- */

type FranjaEditable = Franja & { key: number };
type Semana = Record<Dia, FranjaEditable[]>;

const cuando = (f: string) => (f ? `${fechaCorta(f.slice(0, 10))}, ${f.slice(11, 16)}` : "");

function Editor({
  idFacilitador,
  idAnio,
  anio,
  fila,
  origen,
  largo,
  onSucio,
}: {
  idFacilitador: number;
  idAnio: number;
  anio: number | null;
  fila?: Bloqueo;
  /** Otro año del facilitador con bloqueos, para copiar si este está vacío. */
  origen?: Bloqueo;
  largo: number;
  onSucio: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const sig = useRef(0);
  const nueva = (f: Franja): FranjaEditable => ({ ...f, key: ++sig.current });
  const desde = (d?: DiasBloqueo): Semana =>
    Object.fromEntries(
      DIAS.map((x) => [x.clave, d ? leerFranjas(d[x.clave]).franjas.map(nueva) : []]),
    ) as Semana;

  const [semana, setSemana] = useState<Semana>(() => desde(fila?.dias));
  const [ultima, setUltima] = useState<number | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  // Lo que la base tiene y no se entiende como franja: se muestra, no se pierde callado.
  const sobrantes = fila
    ? DIAS.map((d) => ({ dia: d, partes: leerFranjas(fila.dias[d.clave]).sobrante })).filter(
        (x) => x.partes.length,
      )
    : [];

  const texto = Object.fromEntries(
    DIAS.map((d) => [d.clave, textoFranjas(semana[d.clave])]),
  ) as DiasBloqueo;
  const inicial = Object.fromEntries(
    DIAS.map((d) => [d.clave, textoFranjas(leerFranjas(fila?.dias[d.clave] ?? "").franjas)]),
  ) as DiasBloqueo;
  const sinCambios = DIAS.every((d) => texto[d.clave] === inicial[d.clave]) && !sobrantes.length;
  const vacio = DIAS.every((d) => !texto[d.clave]);

  // Avisa al modal si hay algo sin guardar (para no cambiar de año ni cerrar sin querer).
  const sucio = !sinCambios && !(vacio && !fila);
  useEffect(() => onSucio(sucio), [sucio, onSucio]);

  const errores = Object.fromEntries(
    DIAS.map((d) => [d.clave, erroresDia(semana[d.clave], texto[d.clave], largo)]),
  ) as Record<Dia, ReturnType<typeof erroresDia>>;
  const hayErrores = DIAS.some(
    (d) => errores[d.clave].dia || errores[d.clave].franjas.some(Boolean),
  );

  const cambiar = (dia: Dia, lista: FranjaEditable[]) => setSemana((s) => ({ ...s, [dia]: lista }));

  const agregar = (dia: Dia) => {
    const lista = semana[dia];
    // Propone la siguiente: arranca donde terminó la última y dura una hora.
    const fin = minutos(lista[lista.length - 1]?.hasta ?? "");
    const f = nueva(
      fin != null && fin < 23 * 60
        ? { desde: aHora(fin), hasta: aHora(Math.min(fin + 60, 23 * 60 + 59)) }
        : { desde: "", hasta: "" },
    );
    setUltima(f.key);
    cambiar(dia, [...lista, f]);
  };

  const invalidar = () => qc.invalidateQueries({ queryKey: keysBloqueos.todo });

  const guardar = useMutation({
    mutationFn: () => guardarBloqueo(fila?.id ?? null, { idFacilitador, idAnio, dias: texto }),
    onSuccess: () => {
      onSucio(false);
      invalidar();
      toast.success(fila ? "Bloqueos actualizados" : "Bloqueos cargados");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarBloqueo(fila!.id),
    onSuccess: () => {
      onSucio(false);
      invalidar();
      toast.success(`Sin bloqueos en ${anio ?? "ese año"}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <div className="space-y-3">
      {!fila && vacio && origen && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-border/80 px-3 py-2.5">
          <p className="text-[12px] text-muted-foreground">Todavía no tiene bloqueos en {anio}.</p>
          <button
            type="button"
            onClick={() => setSemana(desde(origen.dias))}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary-soft px-3 text-[13px] font-semibold text-primary"
          >
            <Copy className="size-3.5" />
            Copiar los de {origen.anio ?? "otro año"}
          </button>
        </div>
      )}

      {sobrantes.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            Hay texto guardado que no es una franja HH:MM - HH:MM:{" "}
            {sobrantes.map((x) => `${x.dia.nombre} "${x.partes.join(", ")}"`).join("; ")}. Al
            guardar se descarta: cargalo como franja si hace falta.
          </span>
        </p>
      )}

      <fieldset disabled={ocupado} className="space-y-2">
        {DIAS.map((d) => {
          const lista = semana[d.clave];
          const err = errores[d.clave];
          const total = lista.reduce((n, f) => {
            const i = minutos(f.desde);
            const h = minutos(f.hasta);
            return i != null && h != null && h > i ? n + h - i : n;
          }, 0);
          return (
            <section key={d.clave} className="rounded-xl border border-border/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{d.nombre}</h3>
                <span className="text-[11px] text-muted-foreground">
                  {lista.length
                    ? `${lista.length} ${lista.length === 1 ? "franja" : "franjas"}${
                        total ? ` · ${textoDuracion(total)}` : ""
                      }`
                    : "Libre"}
                </span>
              </div>

              {lista.map((f, i) => (
                <div key={f.key} className="mt-2">
                  <div className="flex items-center gap-2">
                    <Hora
                      etiqueta={`${d.nombre}, desde`}
                      valor={f.desde}
                      enfocar={f.key === ultima}
                      onCambio={(v) =>
                        cambiar(
                          d.clave,
                          lista.map((x, j) => (j === i ? { ...x, desde: v } : x)),
                        )
                      }
                    />
                    <span className="text-muted-foreground">–</span>
                    <Hora
                      etiqueta={`${d.nombre}, hasta`}
                      valor={f.hasta}
                      onCambio={(v) =>
                        cambiar(
                          d.clave,
                          lista.map((x, j) => (j === i ? { ...x, hasta: v } : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        cambiar(
                          d.clave,
                          lista.filter((_, j) => j !== i),
                        )
                      }
                      aria-label={`Quitar la franja del ${d.nombre.toLowerCase()}`}
                      className="ml-auto grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {err.franjas[i] && (
                    <p className="mt-1 text-[11.5px] text-destructive">{err.franjas[i]}</p>
                  )}
                </div>
              ))}
              {err.dia && <p className="mt-1 text-[11.5px] text-destructive">{err.dia}</p>}

              <button
                type="button"
                onClick={() => agregar(d.clave)}
                className="mt-2 flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-border px-3 text-[13px] font-semibold text-primary hover:border-primary/40"
              >
                <Plus className="size-3.5" />
                Agregar franja
              </button>
            </section>
          );
        })}
      </fieldset>

      {fila && (fila.cargadoEl || fila.modificadoEl) && (
        <p className="text-[11px] text-muted-foreground">
          {fila.cargadoEl &&
            `Cargado el ${cuando(fila.cargadoEl)}${fila.cargadoPor ? ` por ${fila.cargadoPor}` : ""}`}
          {fila.modificadoEl &&
            ` · modificado el ${cuando(fila.modificadoEl)}${
              fila.modificadoPor ? ` por ${fila.modificadoPor}` : ""
            }`}
        </p>
      )}

      <div className="flex gap-2">
        {fila && !vacio && (
          <BotonBorrar
            confirmar={confirmarBorrado}
            pendiente={borrar.isPending}
            deshabilitado={ocupado}
            onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
          />
        )}
        {fila && vacio ? (
          // Sin franjas no se guarda: dejarlo libre es borrar la fila del año.
          <button
            type="button"
            onClick={() => borrar.mutate()}
            disabled={ocupado}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {borrar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarX2 className="size-4" />
            )}
            Dejarlo libre en {anio}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => guardar.mutate()}
            disabled={ocupado || sinCambios || vacio || hayErrores}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {vacio
              ? "Cargá al menos una franja"
              : hayErrores
                ? "Revisá las franjas"
                : sinCambios
                  ? "Sin cambios"
                  : fila
                    ? "Guardar cambios"
                    : `Guardar bloqueos de ${anio}`}
          </button>
        )}
      </div>
      {confirmarBorrado && fila && !vacio && (
        <p className="text-[11px] text-muted-foreground">
          Se borran todos los bloqueos de {anio}. Tocá de nuevo para confirmar.
        </p>
      )}
    </div>
  );
}

/**
 * Los problemas de un día: por franja (incompleta, al revés, se pisa con otra)
 * y del día entero (no entra en la columna). Los mismos que rechaza el backend.
 */
function erroresDia(lista: Franja[], texto: string, largo: number) {
  const franjas = lista.map((f, i) => {
    if (!f.desde && !f.hasta) return null; // vacía: no se guarda
    const a = minutos(f.desde);
    const b = minutos(f.hasta);
    if (a == null || b == null) return "Completá las dos horas (HH:MM).";
    if (b <= a) return "Termina antes de empezar.";
    const pisa = lista.find(
      (o, j) =>
        j !== i &&
        seSuperponen({ inicio: o.desde, fin: o.hasta }, { inicio: f.desde, fin: f.hasta }),
    );
    return pisa ? `Se pisa con ${pisa.desde} – ${pisa.hasta}: juntalas en una.` : null;
  });
  const dia =
    texto.length > largo ? "No entran tantas franjas en el día: juntá las que van seguidas." : null;
  return { franjas, dia };
}

/** Una hora escrita solo con números: "730" → "07:30" al salir. */
function Hora({
  etiqueta,
  valor,
  onCambio,
  enfocar,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  enfocar?: boolean;
}) {
  return (
    <input
      value={valor}
      onChange={(e) => onCambio(escribirHora(e.target.value))}
      onBlur={(e) => onCambio(normalizarHora(e.target.value))}
      inputMode="numeric"
      autoComplete="off"
      autoFocus={enfocar}
      placeholder="00:00"
      maxLength={5}
      aria-label={etiqueta}
      className="h-11 w-[5.5rem] rounded-xl border border-input bg-background px-2 text-center text-base tabular-nums outline-none focus:border-primary/60"
    />
  );
}
