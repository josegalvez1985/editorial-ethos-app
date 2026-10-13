/**
 * El formulario de un envío de gráficas: CABECERA (la gráfica y la fecha) y
 * DETALLE (los destinos). Alta en `/envios-graficas/nuevo` y edición en
 * `/envios-graficas/$id`, como Transferencias (13/10/2026: el envío pasó de
 * una tabla a cabecera y detalle).
 *
 * - **Arriba la cabecera:** la gráfica, con las ya usadas como sugerencia (un
 *   toque y queda escrita igual), y la fecha del envío (hoy, de entrada).
 * - **Un destino por tarjeta:** departamento y ciudad (la ciudad se puede
 *   buscar sin elegir antes el departamento: lo completa sola), la sucursal en
 *   pastillas y los siete manuales con su color, con el total en vivo.
 * - **Cada destino sugiere sus cantidades** con lo que postularon las
 *   instituciones de su ciudad (ver `sumarSugerencia` en lib/envios-graficas):
 *   se cargan solas si la tarjeta está vacía y nunca pisan lo escrito. Avisa si
 *   a esa ciudad ya se mandó algo ese año.
 * - **El pie fijo** dice qué falta en el mismo botón de Guardar, como el de
 *   Transferencias, y tiene el borrar (con un segundo toque para confirmar).
 *
 * Guardar manda la cabecera y TODOS los destinos: el backend actualiza los que
 * cambiaron, agrega los nuevos y borra los que ya no están.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  FileDown,
  Lightbulb,
  Loader2,
  Package,
  MapPin,
  Plus,
  Save,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, SoloLectura } from "@/components/admin-ui";
import { EtiquetaCampo, Pastillas, Texto } from "@/components/ficha-ui";
import { PickerModal } from "@/components/picker-modal";
import {
  eliminarEnvio,
  filtrosSugerencia,
  guardarEnvio,
  keysEnvios,
  dividir,
  PAQUETES,
  paquetesDe,
  textoDivision,
  type Division,
  manualesEnCero,
  sumarSugerencia,
  type DatosEnvio,
  type EnvioGrafica,
  type ListaEnvios,
  type Sugerencia,
} from "@/lib/envios-graficas";
import type { Opcion } from "@/lib/evaluaciones";
import { hoyISO } from "@/lib/fechas";
import { abrirPdfEnPestana } from "@/lib/pdf-base";
import { usePermisos } from "@/lib/permisos";
import {
  keysPostulaciones,
  listarTodasPostulaciones,
  MANUALES,
  type ClaveManual,
} from "@/lib/postulaciones";
import { useSession } from "@/lib/session";
import { normalizar } from "@/lib/utils";

export const RUTA_ENVIOS = "/envios-graficas";

const numero = new Intl.NumberFormat("es-PY");

/** Un destino del formulario. Las cantidades como texto: es lo que da el input. */
type Destino = {
  /** Solo para React: no viaja al backend. */
  clave: string;
  /** `ID_ENVIO` de la línea guardada, o `null` si es nueva. */
  id: number | null;
  depId: number | null;
  ciuId: number | null;
  sucursal: string;
  comentario: string;
  manuales: Record<ClaveManual, string>;
};

/** Las cantidades como los campos del formulario: el 0 queda vacío. */
const aTexto = (c: Record<ClaveManual, number>) =>
  Object.fromEntries(
    MANUALES.map((m) => [m.clave, c[m.clave] ? String(c[m.clave]) : ""]),
  ) as Record<ClaveManual, string>;

const aNumeros = (c: Record<ClaveManual, string>) =>
  Object.fromEntries(MANUALES.map((m) => [m.clave, Number(c[m.clave] || 0)])) as Record<
    ClaveManual,
    number
  >;

const totalDe = (c: Record<ClaveManual, string>) =>
  MANUALES.reduce((a, m) => a + Number(c[m.clave] || 0), 0);

/** Solo dígitos, sin ceros a la izquierda: "007" → "7". */
const soloDigitos = (v: string) =>
  v
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, 7);

/** Lo que viaja al backend: sirve también para saber si algo cambió. */
function datosDe(grafica: string, fecha: string, destinos: Destino[]): DatosEnvio {
  return {
    nombre_grafica: grafica.trim().replace(/\s+/g, " "),
    fecha,
    lineas: destinos.map((d) => ({
      ...(d.id != null ? { id_envio: d.id } : {}),
      id_departamento: d.depId ?? 0,
      id_ciudad: d.ciuId ?? 0,
      sucursal: d.sucursal,
      comentario: d.comentario.trim(),
      ...aNumeros(d.manuales),
    })),
  };
}

export function EnvioGraficaForm({
  previa,
  lista,
}: {
  /** El envío guardado; sin él, es un alta. */
  previa?: EnvioGrafica;
  lista: ListaEnvios;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { puedeRuta } = usePermisos();
  const nuevo = previa == null;
  const puedeGuardar = puedeRuta(RUTA_ENVIOS, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA_ENVIOS, "borrar");

  const siguiente = useRef(0);
  const nuevaClave = () => `nuevo-${++siguiente.current}`;
  // Una sola sucursal: ya elegida en cada destino nuevo.
  const sucursalUnica = lista.sucursales.length === 1 ? lista.sucursales[0].nombre : "";
  const destinoVacio = (sucursal = sucursalUnica): Destino => ({
    clave: nuevaClave(),
    id: null,
    depId: null,
    ciuId: null,
    sucursal,
    comentario: "",
    manuales: aTexto(manualesEnCero()),
  });

  const [grafica, setGrafica] = useState(previa?.grafica ?? "");
  const [fecha, setFecha] = useState(previa?.fecha ?? hoyISO());
  const [destinos, setDestinos] = useState<Destino[]>(() =>
    previa
      ? previa.lineas.map((l) => ({
          clave: `l-${l.id}`,
          id: l.id,
          depId: l.idDepartamento,
          ciuId: l.idCiudad,
          sucursal: l.sucursal,
          comentario: l.comentario,
          manuales: aTexto(l.manuales),
        }))
      : [destinoVacio()],
  );
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  // Lo guardado, para "Sin cambios". Se calcula una vez: `previa` no cambia
  // mientras el formulario está montado (la página lo rearma al guardar).
  const [inicial] = useState(() =>
    previa ? JSON.stringify(datosDe(previa.grafica, previa.fecha, destinos)) : "",
  );

  const cambiar = (clave: string, f: (d: Destino) => Destino) =>
    setDestinos((prev) => prev.map((d) => (d.clave === clave ? f(d) : d)));
  const agregar = () =>
    // El destino nuevo arranca con la sucursal del último: suele ser la misma.
    setDestinos((prev) => [...prev, destinoVacio(prev.at(-1)?.sucursal || sucursalUnica)]);
  const quitar = (clave: string) => setDestinos((prev) => prev.filter((d) => d.clave !== clave));

  const limpia = grafica.trim().replace(/\s+/g, " ");
  // Las gráficas ya usadas que se parecen a lo escrito: un toque y queda igual.
  const usadas = [...new Set(lista.envios.map((e) => e.grafica))];
  const sugeridas = usadas
    .filter((g) => g !== limpia && normalizar(g).includes(normalizar(limpia)))
    .slice(0, 6);

  const total = destinos.reduce((a, d) => a + totalDe(d.manuales), 0);
  const datos = datosDe(grafica, fecha, destinos);
  const sinCambios = !nuevo && JSON.stringify(datos) === inicial;

  // Lo mismo que valida el backend, dicho en el botón antes de mandar.
  const repetido = (() => {
    for (let i = 0; i < destinos.length; i++)
      for (let k = 0; k < i; k++)
        if (
          destinos[i].ciuId != null &&
          destinos[i].ciuId === destinos[k].ciuId &&
          destinos[i].sucursal === destinos[k].sucursal
        )
          return `Los destinos ${k + 1} y ${i + 1} son la misma ciudad y sucursal`;
    return null;
  })();
  const incompleto = destinos.findIndex(
    (d) => d.depId == null || d.ciuId == null || !d.sucursal || totalDe(d.manuales) === 0,
  );
  const falta: string | null = !limpia
    ? "Escribí la gráfica"
    : !fecha
      ? "Elegí la fecha"
      : destinos.length === 0
        ? "Agregá un destino"
        : incompleto >= 0
          ? (() => {
              const d = destinos[incompleto];
              const n = `Destino ${incompleto + 1}`;
              return d.depId == null || d.ciuId == null
                ? `${n}: elegí la ciudad`
                : !d.sucursal
                  ? `${n}: elegí la sucursal`
                  : `${n}: cargá algún manual`;
            })()
          : repetido;

  const invalidar = () => qc.invalidateQueries({ queryKey: keysEnvios.todo });

  const guardar = useMutation({
    mutationFn: () => guardarEnvio(previa?.id ?? null, datos),
    onSuccess: (id) => {
      invalidar();
      toast.success(nuevo ? `Envío de ${limpia} registrado` : "Cambios guardados", {
        description: `${destinos.length} ${destinos.length === 1 ? "destino" : "destinos"} · ${numero.format(total)} manuales.`,
      });
      // Al envío guardado: ahí está su PDF, y la página rearma el formulario
      // con los ids de las líneas nuevas.
      navigate({ to: "/envios-graficas/$id", params: { id: String(id) } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarEnvio(previa!.id),
    onSuccess: () => {
      invalidar();
      toast.success(`Envío de ${previa!.grafica} eliminado`);
      navigate({ to: "/envios-graficas" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;

  return (
    <div className="space-y-5 pb-32 lg:pb-6">
      <fieldset disabled={!puedeGuardar || ocupado} className="space-y-5">
        {/* ── Cabecera ──────────────────────────────────────────────── */}
        <section className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_12rem]">
            <div>
              <Texto
                etiqueta="Gráfica"
                req
                largo={lista.largo}
                valor={grafica}
                onCambio={setGrafica}
                placeholder="Ej.: Gráfica Central"
              />
              {sugeridas.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sugeridas.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrafica(g)}
                      className="tap rounded-full border border-border/60 bg-background px-2.5 py-1 text-[12px] font-medium hover:border-primary/40"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Texto etiqueta="Fecha" req tipo="date" valor={fecha} onCambio={setFecha} />
          </div>
        </section>

        {/* ── Destinos ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Destinos</h2>
              <p className="text-[11.5px] text-muted-foreground">
                {destinos.length} {destinos.length === 1 ? "destino" : "destinos"} ·{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {numero.format(total)}
                </span>{" "}
                manuales
              </p>
            </div>
            {puedeGuardar && destinos.length > 0 && (
              <button
                type="button"
                onClick={agregar}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary-soft px-3 text-sm font-semibold text-primary"
              >
                <Plus className="size-4" />
                Destino
              </button>
            )}
          </div>

          {destinos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-10 text-center">
              <MapPin className="mx-auto size-8 text-muted-foreground/40" />
              <p className="mt-2 px-4 text-sm text-muted-foreground">
                Agregá la ciudad y la sucursal a la que van los manuales.
              </p>
              {puedeGuardar && (
                <button
                  type="button"
                  onClick={agregar}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                >
                  <Plus className="size-4" />
                  Agregar destino
                </button>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {destinos.map((d, i) => (
                <DestinoCard
                  key={d.clave}
                  indice={i + 1}
                  destino={d}
                  lista={lista}
                  idEnvio={previa?.id ?? null}
                  anio={fecha.slice(0, 4)}
                  editable={puedeGuardar}
                  onCambio={(f) => cambiar(d.clave, f)}
                  onQuitar={destinos.length > 1 ? () => quitar(d.clave) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </fieldset>

      {!puedeGuardar && (
        <SoloLectura
          texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} envíos de gráficas.`}
        />
      )}

      {/* ── Pie fijo ────────────────────────────────────────────────── */}
      {(puedeGuardar || puedeBorrar) && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border/60 pb-safe lg:sticky lg:-mx-5">
          <div className="mx-auto flex max-w-[480px] gap-2 px-5 py-3 lg:mr-0">
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
                type="button"
                onClick={() => guardar.mutate()}
                disabled={ocupado || falta != null || sinCambios}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
              >
                {guardar.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {/* El botón dice QUÉ FALTA en vez de solo estar gris. */}
                {falta ??
                  (nuevo ? "Registrar envío" : sinCambios ? "Sin cambios" : "Guardar cambios")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Un destino                                                                 */
/* -------------------------------------------------------------------------- */

function DestinoCard({
  indice,
  destino: d,
  lista,
  idEnvio,
  anio,
  editable,
  onCambio,
  onQuitar,
}: {
  indice: number;
  destino: Destino;
  lista: ListaEnvios;
  /** El envío que se edita, para no contarlo en "ya se mandó". */
  idEnvio: number | null;
  /** El año de la fecha del envío. */
  anio: string;
  editable: boolean;
  onCambio: (f: (d: Destino) => Destino) => void;
  /** Sin él no se puede quitar (es el único destino). */
  onQuitar?: () => void;
}) {
  const nombreDep = new Map(lista.departamentos.map((x) => [x.id, x.nombre]));
  const opcionesDep: Opcion[] = lista.departamentos.map((x) => ({
    id: x.id,
    texto: x.nombre,
    busqueda: normalizar(x.nombre),
  }));
  // Sin departamento elegido se ofrecen todas, con su departamento al lado:
  // elegir la ciudad completa el departamento.
  const opcionesCiu: Opcion[] = lista.ciudades
    .filter((c) => d.depId == null || c.idDepartamento === d.depId)
    .map((c) => ({
      id: c.id,
      texto: c.nombre,
      extra: d.depId == null ? nombreDep.get(c.idDepartamento) : undefined,
      busqueda: normalizar(`${c.nombre} ${nombreDep.get(c.idDepartamento) ?? ""}`),
    }));
  const ciudad = lista.ciudades.find((c) => c.id === d.ciuId)?.nombre ?? "";
  const total = totalDe(d.manuales);

  // La sugerencia de la ciudad. Misma clave que `postulaciones/todas`.
  const conCiudad = d.depId != null && d.ciuId != null;
  const sug = useQuery({
    queryKey: keysPostulaciones.todas(filtrosSugerencia(d.depId ?? 0, d.ciuId ?? 0)),
    queryFn: () => listarTodasPostulaciones(filtrosSugerencia(d.depId!, d.ciuId!)),
    enabled: conCiudad && editable,
    select: sumarSugerencia,
  });
  const sugerencia = conCiudad && editable ? sug.data : undefined;

  // Se carga sola con los manuales vacíos o si siguen siendo la sugerencia de
  // la ciudad anterior, sin tocar. Lo escrito no se pisa.
  const autoCargada = useRef<string | null>(null);
  useEffect(() => {
    if (!sugerencia?.total) return;
    const nueva = aTexto(sugerencia.manuales);
    onCambio((x) => {
      const vacios = MANUALES.every((m) => !x.manuales[m.clave]);
      const sinTocar = autoCargada.current === JSON.stringify(x.manuales);
      if (!vacios && !sinTocar) return x;
      autoCargada.current = JSON.stringify(nueva);
      return { ...x, manuales: nueva };
    });
    // `onCambio` es una función nueva en cada render del padre: va solo la sugerencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugerencia]);
  const usando =
    !!sugerencia?.total &&
    MANUALES.every((m) => Number(d.manuales[m.clave] || 0) === sugerencia.manuales[m.clave]);

  // Lo que ya se mandó a esa ciudad ese año, en OTROS envíos.
  const yaEnviado = lista.envios
    .filter((e) => e.id !== idEnvio && e.fecha.startsWith(anio))
    .flatMap((e) => e.lineas.filter((l) => l.idCiudad === d.ciuId));

  return (
    <li className="space-y-4 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary-soft text-[12px] font-bold text-primary tabular-nums">
            {indice}
          </span>
          {ciudad && d.sucursal ? `${d.sucursal} · ${ciudad}` : `Destino ${indice}`}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {numero.format(total)} manuales
          </span>
          {editable && onQuitar && (
            <button
              type="button"
              onClick={onQuitar}
              aria-label={`Quitar el destino ${indice}`}
              title="Quitar este destino"
              className="tap -mr-1 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PickerModal
          label="Departamento"
          opciones={opcionesDep}
          value={d.depId}
          onChange={(o) =>
            onCambio((x) => {
              // La ciudad elegida queda solo si es de ese departamento.
              const c = lista.ciudades.find((y) => y.id === x.ciuId);
              return {
                ...x,
                depId: o.id,
                ciuId: c && c.idDepartamento !== o.id ? null : x.ciuId,
              };
            })
          }
          placeholder="Elegir departamento"
          requerido
        />
        <PickerModal
          label="Ciudad"
          opciones={opcionesCiu}
          value={d.ciuId}
          onChange={(o) =>
            onCambio((x) => ({
              ...x,
              ciuId: o.id,
              depId: lista.ciudades.find((c) => c.id === o.id)?.idDepartamento ?? x.depId,
            }))
          }
          placeholder={d.depId == null ? "Buscar ciudad" : "Elegir ciudad"}
          requerido
        />
      </div>

      <Pastillas
        etiqueta="Sucursal"
        req
        opciones={lista.sucursales.map((s) => ({ valor: s.nombre, mostrar: s.nombre }))}
        valor={d.sucursal}
        onCambio={(v) => onCambio((x) => ({ ...x, sucursal: v }))}
      />

      {conCiudad && editable && (
        <SugerenciaPostulaciones
          ciudad={ciudad}
          cargando={sug.isLoading}
          error={sug.error}
          sugerencia={sugerencia}
          usando={usando}
          anioEnvio={anio}
          yaEnviado={yaEnviado.length}
          yaEnviadoTotal={yaEnviado.reduce((a, l) => a + l.cantidad, 0)}
          onUsar={() =>
            sugerencia && onCambio((x) => ({ ...x, manuales: aTexto(sugerencia.manuales) }))
          }
        />
      )}

      <div>
        <div className="flex items-baseline justify-between">
          <EtiquetaCampo texto="Manuales" req />
          <span className="text-[12px] text-muted-foreground">
            Total{" "}
            <span className="font-bold text-foreground tabular-nums">{numero.format(total)}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MANUALES.map((m) => (
            // El nombre arriba y el número abajo: en una sola fila, con
            // cuatro columnas, el campo tapaba el nombre (13/10/2026).
            <label
              key={m.clave}
              className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/60 bg-background p-2"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: m.color }}
                  aria-hidden
                />
                <span className="text-[13px] font-medium">{m.nombre}</span>
              </span>
              <input
                value={d.manuales[m.clave]}
                onChange={(ev) =>
                  onCambio((x) => ({
                    ...x,
                    manuales: { ...x.manuales, [m.clave]: soloDigitos(ev.target.value) },
                  }))
                }
                inputMode="numeric"
                placeholder="0"
                aria-label={`Cantidad de ${m.nombre} para el destino ${indice}`}
                className="h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-right text-base tabular-nums outline-none focus:border-primary/40 lg:text-sm"
              />
              {/* Cómo se arma: paquetes de 100, 50 y 25, y lo suelto. */}
              <span className="min-h-[1rem] text-right text-[10.5px] leading-tight text-muted-foreground tabular-nums">
                {textoDivision(dividir(Number(d.manuales[m.clave] || 0)), true)}
              </span>
            </label>
          ))}
        </div>
        {total > 0 && <Paquetes division={paquetesDe({ manuales: aNumeros(d.manuales) })} />}
      </div>

      <Texto
        etiqueta="Comentario"
        multilinea
        largo={lista.largoComentario}
        valor={d.comentario}
        onCambio={(v) => onCambio((x) => ({ ...x, comentario: v }))}
        placeholder="Una observación de este destino (opcional)"
      />
    </li>
  );
}

/**
 * Los paquetes de un destino: la división de cada manual, sumada (ver
 * "Los paquetes" en lib/envios-graficas). No se guarda: se calcula.
 */
function Paquetes({ division }: { division: Division }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/50 px-3 py-2 text-[12px]">
      <Package className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Paquetes:</span>
      {PAQUETES.map((p) => (
        <span
          key={p}
          className={`rounded-md bg-card px-1.5 py-0.5 font-semibold tabular-nums ${
            division.paquetes[p] ? "" : "opacity-40"
          }`}
        >
          {division.paquetes[p]} de {p}
        </span>
      ))}
      <span
        className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
          division.sueltos
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "bg-card opacity-40"
        }`}
      >
        {division.sueltos} sueltos
      </span>
    </div>
  );
}

/**
 * La sugerencia de cantidades de un destino: la suma de las postulaciones
 * activas de las instituciones de la ciudad en el año lectivo actual, con el
 * detalle por institución plegado y lo que ya se le mandó a esa ciudad.
 */
function SugerenciaPostulaciones({
  ciudad,
  cargando,
  error,
  sugerencia,
  usando,
  anioEnvio,
  yaEnviado,
  yaEnviadoTotal,
  onUsar,
}: {
  ciudad: string;
  cargando: boolean;
  error: unknown;
  sugerencia: Sugerencia | undefined;
  usando: boolean;
  anioEnvio: string;
  /** Líneas de OTROS envíos del mismo año a esta ciudad, y sus manuales. */
  yaEnviado: number;
  yaEnviadoTotal: number;
  onUsar: () => void;
}) {
  const [verInstituciones, setVerInstituciones] = useState(false);

  if (cargando) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Buscando las postulaciones de {ciudad}…
      </p>
    );
  }
  if (error || !sugerencia) {
    return (
      <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-[12px] text-muted-foreground">
        No se pudo armar la sugerencia: {error instanceof Error ? error.message : "sin datos"}.
        Cargá las cantidades a mano.
      </p>
    );
  }
  if (!sugerencia.total) {
    return (
      <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-[12px] text-muted-foreground">
        Ninguna institución de {ciudad} tiene manuales en sus postulaciones activas de{" "}
        {sugerencia.anio}: no hay cantidades para sugerir.
      </p>
    );
  }

  const n = sugerencia.instituciones.length;
  return (
    <section className="space-y-2.5 rounded-2xl border border-primary/25 bg-primary-soft/30 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-[12.5px] leading-snug">
          <p className="font-semibold">Sugerido: {numero.format(sugerencia.total)} manuales</p>
          <p className="text-muted-foreground">
            Lo que postularon {n === 1 ? "la institución" : `las ${n} instituciones`} de {ciudad} en{" "}
            {sugerencia.anio} ({sugerencia.postulaciones}{" "}
            {sugerencia.postulaciones === 1 ? "postulación activa" : "postulaciones activas"}).
          </p>
        </div>
        {usando ? (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-primary">
            <Check className="size-3.5" />
            En uso
          </span>
        ) : (
          <button
            type="button"
            onClick={onUsar}
            className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-[12px] font-semibold text-primary-foreground"
          >
            Usar sugerencia
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MANUALES.filter((m) => sugerencia.manuales[m.clave] > 0).map((m) => (
          <span
            key={m.clave}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ backgroundColor: m.color, color: m.tinta }}
          >
            {m.nombre} {numero.format(sugerencia.manuales[m.clave])}
          </span>
        ))}
      </div>

      {yaEnviado > 0 && (
        <p className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
          Ojo: en {anioEnvio} ya hay {yaEnviado} {yaEnviado === 1 ? "envío" : "envíos"} a {ciudad}{" "}
          en otros registros ({numero.format(yaEnviadoTotal)} manuales).
        </p>
      )}

      <button
        type="button"
        onClick={() => setVerInstituciones((v) => !v)}
        aria-expanded={verInstituciones}
        className="flex items-center gap-1 text-[12px] font-semibold text-primary"
      >
        <ChevronDown
          className={`size-3.5 transition-transform ${verInstituciones ? "rotate-180" : ""}`}
        />
        {verInstituciones ? "Ocultar" : "Ver"} por institución
      </button>
      {verInstituciones && (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          {sugerencia.instituciones.map((i) => (
            <li key={i.id} className="px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] font-medium">{i.nombre}</span>
                <span className="shrink-0 text-[12.5px] font-bold tabular-nums">
                  {numero.format(i.total)}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {MANUALES.filter((m) => i.manuales[m.clave] > 0)
                  .map((m) => `${m.nombre} ${numero.format(i.manuales[m.clave])}`)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* El botón PDF (lo usan el listado y la pantalla de un envío)                */
/* -------------------------------------------------------------------------- */

/**
 * Lleno, como el PDF de los otros reportes. La pestaña se abre dentro del clic:
 * ver `abrirPdfEnPestana`.
 */
export function BotonPdf({
  generar,
  archivo,
  titulo,
  deshabilitado,
}: {
  generar: (usuario: string) => Promise<Blob>;
  archivo: string;
  titulo: string;
  deshabilitado?: boolean;
}) {
  const { sesion } = useSession();
  const [generando, setGenerando] = useState(false);

  function abrir() {
    setGenerando(true);
    // SIN await antes de esta llamada, o el navegador bloquea la pestaña.
    abrirPdfEnPestana(() => generar(sesion?.nombre ?? ""), archivo)
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo generar el PDF"))
      .finally(() => setGenerando(false));
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={generando || deshabilitado}
      title={titulo}
      className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
    >
      {generando ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
      PDF
    </button>
  );
}
