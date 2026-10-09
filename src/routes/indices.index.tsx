import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, ListOrdered, Loader2, Lock, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Buscador, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Pastillas, Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { textoUsos } from "@/lib/facilitadores";
import {
  eliminarIndice,
  guardarIndice,
  invalidarIndices,
  keysIndices,
  listarIndices,
  type Indice,
} from "@/lib/indices";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

export const Route = createFileRoute("/indices/")({
  head: () => ({
    meta: [
      { title: "Índices — Juventud con Valores" },
      { name: "description", content: "Los índices de cada manual, en orden." },
    ],
  }),
  component: IndicesPage,
});

const RUTA = "/indices";

/** La pastilla "Otro manual…" del diálogo. */
const OTRO = "__otro__";

/** "3" o "3,5": como se lee en el manual impreso. */
const fmtNro = (n: number) => n.toLocaleString("es-PY", { maximumFractionDigits: 6 });

/** El texto del campo como número (acepta coma o punto), o null si no es uno válido. */
const leerNro = (v: string) => {
  const t = v.trim().replace(",", ".");
  const n = Number(t);
  return t && Number.isFinite(n) && n >= 0 ? n : null;
};

/** El manual "es el mismo" sin importar mayúsculas, tildes ni espacios, como lo junta el backend. */
const claveManual = (m: string) => normalizar(m.trim().replace(/\s+/g, " "));

/** El número que sigue al más alto del manual (entero): lo que se propone al agregar. */
const siguienteNro = (items: Indice[], manual: string) => {
  const k = claveManual(manual);
  const nros = items.filter((x) => claveManual(x.manual) === k).map((x) => x.nro);
  return nros.length ? Math.floor(Math.max(...nros)) + 1 : 1;
};

type Abierto = { indice: Indice } | { nuevo: true; manual: string } | null;

/**
 * Índices: la página 28 de APEX (un IG de solo lectura sobre
 * `INDICES_MANUALES`) y su modal 29 (Crear Índice), que acá es el diálogo de la
 * pantalla con los permisos de la 28. Backend: `backend/indices.sql`. El ícono
 * es el que ya tenía en el menú (`ListOrdered`): no se cambia.
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Agrupado por manual y en orden**, como el índice impreso, con una
 *   pastilla por manual para ver uno solo. El IG mezclaba todo en una grilla.
 * - **Buscador** por título, o por número si se escribe un número.
 * - **Agregar desde el manual**: el botón de cada grupo abre el alta con ese
 *   manual elegido y el número siguiente ya puesto, y "Agregar y seguir" deja
 *   el diálogo abierto con el próximo número para cargar un índice entero de
 *   corrido.
 * - **El manual se elige de los que hay**, con "Otro manual…" para uno nuevo;
 *   si se escribe uno que ya existe con otras mayúsculas, se avisa y se guarda
 *   en el de siempre (no hay tabla de manuales: el texto es el identificador).
 * - **No deja repetir un número dentro del manual** (el "índice siguiente" de
 *   evaluaciones e intervenciones ordena por número) y **cada tarjeta dice
 *   dónde se usa**. Uno en uso no se borra ni cambia de manual.
 */
function IndicesPage() {
  const { puedeRuta } = usePermisos();
  const [buscar, setBuscar] = useState("");
  /** "" = todos los manuales. */
  const [manualSel, setManualSel] = useState("");
  const [abierto, setAbierto] = useState<Abierto>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: keysIndices.todo,
    queryFn: listarIndices,
  });

  const items = data?.items ?? [];
  const puedeAgregar = puedeRuta(RUTA, "insertar");

  // Los manuales en el orden del backend (alfabético), con su cantidad.
  const manuales: { manual: string; n: number }[] = [];
  for (const x of items) {
    const m = manuales.find((y) => y.manual === x.manual);
    if (m) m.n++;
    else manuales.push({ manual: x.manual, n: 1 });
  }
  // Si el elegido desaparece (se movió su último índice), se vuelve a Todos.
  const sel = manuales.some((m) => m.manual === manualSel) ? manualSel : "";

  const q = normalizar(buscar.trim());
  const qNro = leerNro(buscar);
  const filas = items.filter(
    (x) =>
      (!sel || x.manual === sel) &&
      (!q ||
        normalizar(x.titulo).includes(q) ||
        (!sel && normalizar(x.manual).includes(q)) ||
        (qNro != null && x.nro === qNro)),
  );
  const grupos = manuales
    .map((m) => ({ manual: m.manual, filas: filas.filter((x) => x.manual === m.manual) }))
    .filter((g) => g.filas.length);

  const nuevo = (manual = sel) => setAbierto({ nuevo: true, manual });

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display flex items-center gap-2 text-2xl font-bold">
              Índices
              {data && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {items.length}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              El contenido de cada manual, en el orden en que se da en clase.
            </p>
          </div>
          {puedeAgregar && (
            <button
              type="button"
              onClick={() => nuevo()}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Nuevo índice</span>
              <span className="sm:hidden">Nuevo</span>
            </button>
          )}
        </div>

        {manuales.length > 1 && (
          <div role="tablist" aria-label="Filtrar por manual" className="mb-3 flex flex-wrap gap-2">
            {[{ manual: "", n: items.length }, ...manuales].map((m) => {
              const activo = sel === m.manual;
              return (
                <button
                  key={m.manual || "todos"}
                  type="button"
                  role="tab"
                  aria-selected={activo}
                  onClick={() => setManualSel(m.manual)}
                  className={`tap flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold ${
                    activo
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.manual || "Todos"}
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      activo ? "bg-white/20" : "bg-muted"
                    }`}
                  >
                    {m.n}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {items.length > 6 && (
          <Buscador valor={buscar} onCambio={setBuscar} placeholder="Buscar por título o número…" />
        )}

        {isLoading ? (
          <Cargando />
        ) : isError ? (
          <Fallo error={error} texto="No se pudo cargar la lista de índices" />
        ) : !grupos.length ? (
          <div className="py-12 text-center">
            <ListOrdered className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              {q ? "Ningún índice coincide con la búsqueda." : "Todavía no hay índices."}
            </p>
            {!q && puedeAgregar && (
              <button
                type="button"
                onClick={() => nuevo()}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Cargar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {grupos.map((g) => (
              <section key={g.manual} aria-label={g.manual}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="font-display min-w-0 truncate text-base font-bold">
                    {g.manual}
                    <span className="ml-2 text-xs font-semibold text-muted-foreground tabular-nums">
                      {g.filas.length}
                      {g.filas.length === 1 ? " índice" : " índices"}
                    </span>
                  </h2>
                  {puedeAgregar && (
                    <button
                      type="button"
                      onClick={() => nuevo(g.manual)}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-primary hover:bg-primary-soft"
                    >
                      <Plus className="size-3.5" />
                      Agregar
                    </button>
                  )}
                </div>
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
                  {g.filas.map((x) => (
                    <li key={x.id}>
                      <Tarjeta x={x} onAbrir={() => setAbierto({ indice: x })} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {abierto != null && (
        <EditorIndice
          key={"indice" in abierto ? abierto.indice.id : `nuevo-${abierto.manual}`}
          indice={"indice" in abierto ? abierto.indice : null}
          manualInicial={"indice" in abierto ? abierto.indice.manual : abierto.manual}
          todos={items}
          manuales={manuales.map((m) => m.manual)}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Tarjeta({ x, onAbrir }: { x: Indice; onAbrir: () => void }) {
  const usos = textoUsos(x.usos);
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="tap flex h-full w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-soft hover:border-primary/40"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-sm font-bold text-primary tabular-nums">
        {fmtNro(x.nro)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold">{x.titulo}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">
          {usos ? `Se usa ${usos}` : "Sin uso"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** El modal 29 de APEX (Crear Índice): alta, edición y baja. */
function EditorIndice({
  indice,
  manualInicial,
  todos,
  manuales,
  onCerrar,
}: {
  indice: Indice | null;
  manualInicial: string;
  todos: Indice[];
  manuales: string[];
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = indice == null;

  // Sin manual elegido y con uno solo cargado, se propone ese.
  const manualPropuesto = manualInicial || (manuales.length === 1 ? manuales[0] : "");
  const [manual, setManual] = useState(manualPropuesto);
  /** Escribiendo un manual que no está en la lista. Sin manuales, es lo único que hay. */
  const [otro, setOtro] = useState(!manuales.length);
  const [nro, setNro] = useState(
    indice
      ? String(indice.nro)
      : manualPropuesto
        ? String(siguienteNro(todos, manualPropuesto))
        : "",
  );
  /** Si el número lo escribió la persona, cambiar de manual ya no lo pisa. */
  const [nroTocado, setNroTocado] = useState(!nuevo);
  const [titulo, setTitulo] = useState(indice?.titulo ?? "");
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  /** Cuántos se agregaron con "Agregar y seguir" sin cerrar. */
  const [agregados, setAgregados] = useState(0);

  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");
  const enUso = !!indice?.usos.length;

  const limpio = (v: string) => v.trim().replace(/\s+/g, " ");
  const manualLimpio = limpio(manual);
  const tituloLimpio = limpio(titulo);
  const nroNum = leerNro(nro);

  // Lo que el backend va a hacer con un manual escrito a mano.
  const manualExistente = otro
    ? manuales.find((m) => claveManual(m) === claveManual(manualLimpio))
    : undefined;
  const manualFinal = manualExistente ?? manualLimpio;
  const mismoManual = !nuevo && claveManual(manualFinal) === claveManual(indice.manual);
  const cambioNro = !nuevo && nroNum !== indice.nro;

  // Mismo criterio que el backend: solo se controla si es alta o si cambia el
  // manual o el número (un repetido viejo se puede seguir editando).
  const ocupado =
    nroNum != null && (nuevo || !mismoManual || cambioNro)
      ? todos.find(
          (x) =>
            x.id !== indice?.id &&
            claveManual(x.manual) === claveManual(manualFinal) &&
            x.nro === nroNum,
        )
      : undefined;
  const sugerido = manualFinal ? siguienteNro(todos, manualFinal) : null;

  const sinCambios = !nuevo && mismoManual && !cambioNro && tituloLimpio === limpio(indice.titulo);
  const listo =
    puedeGuardar &&
    !!manualFinal &&
    nroNum != null &&
    !!tituloLimpio &&
    !ocupado &&
    !sinCambios &&
    !(enUso && !mismoManual);

  const elegirManual = (m: string) => {
    const esOtro = m === OTRO;
    setOtro(esOtro);
    setManual(esOtro ? "" : m);
    if (!nroTocado) setNro(esOtro ? "" : String(siguienteNro(todos, m)));
  };

  const guardar = useMutation({
    mutationFn: (_seguir: boolean) =>
      guardarIndice(indice?.id ?? null, {
        manual: manualFinal,
        nro: nroNum!,
        titulo: tituloLimpio,
      }),
    onSuccess: (r, seguir) => {
      invalidarIndices(qc);
      if (seguir) {
        // Queda abierto en el mismo manual, con el número que sigue.
        toast.success(`Índice ${fmtNro(nroNum!)} agregado`);
        setAgregados((n) => n + 1);
        setOtro(false);
        setManual(r.manual);
        setNro(String(Math.floor(nroNum!) + 1));
        setNroTocado(false);
        setTitulo("");
        return;
      }
      toast.success(nuevo ? `Índice ${fmtNro(nroNum!)} agregado` : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarIndice(indice!.id),
    onSuccess: () => {
      invalidarIndices(qc);
      toast.success(`Índice ${fmtNro(indice!.nro)} eliminado`);
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const pendiente = guardar.isPending || borrar.isPending;

  const opcionesManual = [
    ...manuales.map((m) => ({ valor: m, mostrar: m })),
    { valor: OTRO, mostrar: "Otro manual…" },
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && !pendiente && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {nuevo ? "Nuevo índice" : `Índice ${fmtNro(indice.nro)}`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {nuevo
              ? agregados
                ? `${agregados} agregado${agregados === 1 ? "" : "s"}. Seguí con el próximo o cerrá.`
                : "Un tema del manual, con el número con que figura en el índice impreso."
              : enUso
                ? `${indice.manual}. Se usa ${textoUsos(indice.usos)}.`
                : `${indice.manual}. Todavía no se usa en ninguna intervención ni evaluación.`}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) guardar.mutate(false);
          }}
          className="space-y-4"
        >
          <fieldset disabled={!puedeGuardar || pendiente} className="space-y-4">
            {enUso ? (
              /* REGLAS, 2 de indices.sql: las intervenciones guardan el manual. */
              <div>
                <span className="mb-1.5 block text-sm font-medium">Manual</span>
                <p className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{indice!.manual}</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  No cambia de manual: las intervenciones que lo usan guardan este.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {manuales.length > 0 && (
                  <Pastillas
                    etiqueta="Manual"
                    req
                    opciones={opcionesManual}
                    valor={otro ? OTRO : manual}
                    onCambio={elegirManual}
                  />
                )}
                {otro && (
                  <Texto
                    etiqueta={manuales.length ? "Nombre del manual nuevo" : "Manual"}
                    req
                    largo={100}
                    valor={manual}
                    onCambio={(v) => {
                      setManual(v);
                      // Si resulta ser uno que ya existe, sigue su numeración.
                      if (!nroTocado) setNro(v.trim() ? String(siguienteNro(todos, v)) : "");
                    }}
                    placeholder="Ej.: Manual 7mo grado"
                    ayuda={
                      manualExistente
                        ? `Ya existe como "${manualExistente}": se agrega ahí.`
                        : "Se suma a la lista de manuales de inventario, transferencias e intervenciones."
                    }
                  />
                )}
              </div>
            )}

            <div>
              <Texto
                etiqueta="Nro. índice"
                req
                inputMode="decimal"
                valor={nro}
                onCambio={(v) => {
                  setNro(v);
                  setNroTocado(true);
                }}
                placeholder="Ej.: 12"
              />
              {nro.trim() && nroNum == null ? (
                <p className="mt-1 text-xs text-destructive">
                  Tiene que ser un número, cero o más.
                </p>
              ) : ocupado ? (
                <p className="mt-1 text-xs text-destructive">
                  Ya existe el {fmtNro(ocupado.nro)} en este manual: “{ocupado.titulo}”.
                </p>
              ) : enUso && cambioNro ? (
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-px size-3 shrink-0" />
                  Cambia el orden: el índice que se propone como siguiente en evaluaciones e
                  intervenciones sale de este número.
                </p>
              ) : (
                sugerido != null &&
                nroNum !== sugerido &&
                nuevo && (
                  <button
                    type="button"
                    onClick={() => {
                      setNro(String(sugerido));
                      setNroTocado(false);
                    }}
                    className="mt-1 text-xs font-semibold text-primary"
                  >
                    Usar el siguiente: {sugerido}
                  </button>
                )
              )}
            </div>

            <Texto
              etiqueta="Título"
              req
              multilinea
              largo={500}
              valor={titulo}
              onCambio={setTitulo}
              placeholder="Ej.: El respeto en la familia"
            />
          </fieldset>

          {!puedeGuardar && (
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} índices.`}
            />
          )}

          {puedeBorrar && enUso && (
            <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-px size-3.5 shrink-0" />
              <span>No se puede eliminar: se usa {textoUsos(indice!.usos)}.</span>
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {puedeBorrar && !enUso && (
              <BotonBorrar
                confirmar={confirmarBorrado}
                pendiente={borrar.isPending}
                deshabilitado={pendiente}
                onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
              />
            )}
            {puedeGuardar && nuevo && (
              <button
                type="button"
                disabled={pendiente || !listo}
                onClick={() => guardar.mutate(true)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-primary/40 px-3 text-sm font-semibold text-primary disabled:opacity-50"
              >
                {guardar.isPending && guardar.variables && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Agregar y seguir
              </button>
            )}
            {puedeGuardar && (
              <button
                type="submit"
                disabled={pendiente || !listo}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
              >
                {guardar.isPending && !guardar.variables && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {nuevo ? "Agregar" : sinCambios ? "Sin cambios" : "Guardar cambios"}
              </button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
