import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Pastillas, Quitar, Seccion, Texto } from "@/components/ficha-ui";
import { PickerModal } from "@/components/picker-modal";
import { apiBarrios } from "@/lib/barrios";
import { apiCiudades } from "@/lib/ciudades";
import type { Opcion } from "@/lib/evaluaciones";
import {
  eliminarFacilitador,
  esSi,
  fichaVacia,
  guardarFacilitador,
  keysFacilitadores,
  obtenerFacilitador,
  opcionesFacilitador,
  textoUsos,
  type CampoTexto,
  type Ficha,
  type ValorLista,
} from "@/lib/facilitadores";
import { apiNacionalidades } from "@/lib/nacionalidades";
import { usePermisos } from "@/lib/permisos";
import { campo, normalizar } from "@/lib/utils";

export const Route = createFileRoute("/facilitadores/$id")({
  head: () => ({
    meta: [{ title: "Facilitador — Juventud con Valores" }],
  }),
  component: FichaPage,
});

const RUTA = "/facilitadores";

/** Los obligatorios, con su nombre para el aviso. Como en la página 15 de APEX. */
const OBLIGATORIOS: [CampoTexto, string][] = [
  ["nombre_apellido", "nombre y apellido"],
  ["nro_ci", "nro. de CI"],
  ["fecha_nacimiento", "fecha de nacimiento"],
  ["estado_civil", "estado civil"],
  ["con_quien_vive", "con quién vive"],
  ["hijos", "hijos"],
  ["telefono", "teléfono"],
  ["direccion", "dirección"],
  ["activo", "activo"],
];

/**
 * La ficha de un facilitador: la página 15 de APEX y sus modales 63 a 66, en
 * una sola pantalla con secciones y un solo "Guardar" (ver `lib/facilitadores.ts`).
 *
 * `$id` es el número, o `nuevo` para el alta.
 */
function FichaPage() {
  const { id } = Route.useParams();
  const nuevo = id === "nuevo";
  const idNum = nuevo ? null : Number(id);

  const ficha = useQuery({
    queryKey: keysFacilitadores.ficha(idNum ?? 0),
    queryFn: () => obtenerFacilitador(idNum!),
    enabled: idNum != null,
  });
  const opciones = useQuery({
    queryKey: keysFacilitadores.opciones,
    queryFn: opcionesFacilitador,
    staleTime: 10 * 60 * 1000,
  });

  const cargando = (!nuevo && ficha.isLoading) || opciones.isLoading;
  const error = ficha.error ?? opciones.error;

  return (
    <AppShell nav={false}>
      {cargando ? (
        <Cargando />
      ) : error ? (
        <div className="p-5">
          <Fallo error={error} texto="No se pudo cargar la ficha" />
        </div>
      ) : (
        <Formulario
          // Remonta al cambiar de ficha (por ejemplo, después de un alta).
          key={id}
          idNum={idNum}
          inicial={ficha.data ?? fichaVacia()}
          usos={ficha.data?.usos ?? []}
          opciones={opciones.data!}
        />
      )}
    </AppShell>
  );
}

function Formulario({
  idNum,
  inicial,
  usos,
  opciones,
}: {
  idNum: number | null;
  inicial: Ficha;
  usos: { tabla: string; cantidad: number }[];
  opciones: NonNullable<Awaited<ReturnType<typeof opcionesFacilitador>>>;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { puedeRuta } = usePermisos();
  const [f, setF] = useState<Ficha>(inicial);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const nuevo = idNum == null;
  const puedeGuardar = puedeRuta(RUTA, nuevo ? "insertar" : "actualizar");
  const puedeBorrar = !nuevo && puedeRuta(RUTA, "borrar");
  const enUso = textoUsos(usos);

  const set = <K extends keyof Ficha>(k: K, v: Ficha[K]) => setF((x) => ({ ...x, [k]: v }));
  const txt = (k: CampoTexto) => ({ valor: f[k], onCambio: (v: string) => set(k, v) });

  const nacionalidades = useQuery({
    queryKey: apiNacionalidades.queryKey,
    queryFn: apiNacionalidades.listar,
  });
  const ciudades = useQuery({ queryKey: apiCiudades.queryKey, queryFn: apiCiudades.listar });
  const barrios = useQuery({ queryKey: apiBarrios.queryKey, queryFn: apiBarrios.listar });

  const opcion = (id: number, texto: string, extra?: string): Opcion => ({
    id,
    texto,
    extra,
    busqueda: normalizar(`${texto} ${extra ?? ""}`),
  });
  const opcNac = (nacionalidades.data?.items ?? []).map((i) => opcion(i.id, i.nombre));
  const opcCiudad = (ciudades.data?.items ?? []).map((i) =>
    opcion(i.id, i.nombre, i.padre?.nombre),
  );
  const opcBarrio = (barrios.data?.items ?? [])
    .filter((b) => f.id_ciudad == null || b.padre?.id === f.id_ciudad)
    .map((b) => opcion(b.id, b.nombre, f.id_ciudad == null ? b.padre?.nombre : undefined));

  const faltan = [
    ...OBLIGATORIOS.filter(([k]) => !f[k].trim()).map(([, n]) => n),
    ...(f.id_nacionalidad == null ? ["nacionalidad"] : []),
  ];
  const sinCambios = JSON.stringify(f) === JSON.stringify(inicial);

  const invalidar = () => qc.invalidateQueries({ queryKey: keysFacilitadores.todo });

  const guardar = useMutation({
    mutationFn: () => guardarFacilitador(idNum, f),
    onSuccess: (nuevoId) => {
      invalidar();
      toast.success(nuevo ? "Facilitador creado" : "Cambios guardados");
      if (nuevo)
        navigate({ to: "/facilitadores/$id", params: { id: String(nuevoId) }, replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarFacilitador(idNum!),
    onSuccess: () => {
      invalidar();
      toast.success("Facilitador eliminado");
      navigate({ to: "/facilitadores", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const enviar = () => {
    if (faltan.length) {
      toast.error(`Falta completar: ${faltan.join(", ")}`);
      return;
    }
    guardar.mutate();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        enviar();
      }}
    >
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {nuevo ? "Nuevo facilitador" : `Facilitador #${idNum}`}
        </p>
        <h1 className="font-display mt-1 text-[1.75rem] leading-tight font-bold">
          {f.nombre_apellido.trim() || "Sin nombre"}
        </h1>
        {!nuevo && (
          <p className="mt-1 text-xs text-muted-foreground">
            {enUso ? `Se usa ${enUso}.` : "Todavía no se usa en ningún lado."}
          </p>
        )}
        {!puedeGuardar && (
          <div className="mt-3">
            <SoloLectura
              texto={`Solo lectura: tu usuario no puede ${nuevo ? "agregar" : "modificar"} facilitadores.`}
            />
          </div>
        )}
      </div>

      <fieldset
        disabled={!puedeGuardar || ocupado}
        className="grid grid-cols-1 gap-4 px-5 pt-4 pb-6 lg:grid-cols-2"
      >
        <Seccion titulo="Datos personales">
          <Texto etiqueta="Nombre y apellido" req largo={500} {...txt("nombre_apellido")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto etiqueta="Nro. de CI" req largo={100} inputMode="numeric" {...txt("nro_ci")} />
            <Texto etiqueta="Fecha de nacimiento" req tipo="date" {...txt("fecha_nacimiento")} />
          </div>
          <PickerModal
            label="Nacionalidad"
            opciones={opcNac}
            value={f.id_nacionalidad}
            onChange={(o) => set("id_nacionalidad", o.id)}
            placeholder="Elegir nacionalidad"
            requerido
          />
          <Pastillas
            etiqueta="Estado civil"
            req
            opciones={opciones.estado_civil}
            {...txt("estado_civil")}
          />
          <Pastillas
            etiqueta="Con quién vive"
            req
            opciones={opciones.con_quien_vive}
            {...txt("con_quien_vive")}
          />
          <Pastillas etiqueta="Hijos" req opciones={opciones.si_no} {...txt("hijos")} />
        </Seccion>

        <Seccion titulo="Contacto y ubicación">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto etiqueta="Teléfono" req largo={500} inputMode="tel" {...txt("telefono")} />
            <Texto etiqueta="Email" largo={500} inputMode="email" {...txt("email")} />
          </div>
          <Texto etiqueta="Dirección" req largo={1000} multilinea {...txt("direccion")} />
          <div>
            <PickerModal
              label="Ciudad"
              opciones={opcCiudad}
              value={f.id_ciudad}
              onChange={(o) => setF((x) => ({ ...x, id_ciudad: o.id, id_barrio: null }))}
              placeholder="Elegir ciudad"
            />
            {f.id_ciudad != null && (
              <Quitar onClick={() => setF((x) => ({ ...x, id_ciudad: null, id_barrio: null }))} />
            )}
          </div>
          <div>
            <PickerModal
              label="Barrio"
              opciones={opcBarrio}
              value={f.id_barrio}
              onChange={(o) => {
                const b = barrios.data?.items.find((x) => x.id === o.id);
                setF((x) => ({ ...x, id_barrio: o.id, id_ciudad: b?.padre?.id ?? x.id_ciudad }));
              }}
              placeholder={f.id_ciudad == null ? "Elegir barrio" : "Elegir barrio de esa ciudad"}
            />
            {f.id_barrio != null && <Quitar onClick={() => set("id_barrio", null)} />}
          </div>
          <Texto
            etiqueta="Ubicación"
            ayuda="Un link de Google Maps o las coordenadas."
            largo={1000}
            {...txt("ubicacion")}
          />
        </Seccion>

        <Seccion titulo="Iglesia">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto etiqueta="Denominación" largo={200} {...txt("denominacion")} />
            <Texto etiqueta="Iglesia" largo={200} {...txt("nombre_iglesia")} />
            <Texto etiqueta="Pastor" largo={200} {...txt("nombre_pastor")} />
            <Texto
              etiqueta="Teléfono del pastor"
              largo={100}
              inputMode="tel"
              {...txt("nro_telefono_pastor")}
            />
            <Texto etiqueta="Líder" largo={200} {...txt("nombre_lider")} />
            <Texto
              etiqueta="Teléfono del líder"
              largo={100}
              inputMode="tel"
              {...txt("nro_telefono_lider")}
            />
          </div>
          <Pastillas
            etiqueta="Bautizado en agua"
            opciones={opciones.si_no}
            {...txt("bautizado_agua")}
          />
          <Texto etiqueta="Área de servicio" largo={500} {...txt("area_servicio")} />
        </Seccion>

        <Seccion titulo="Herramientas">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Pastillas etiqueta="Computadora" opciones={opciones.si_no} {...txt("computadora")} />
            <Pastillas etiqueta="Internet" opciones={opciones.si_no} {...txt("internet")} />
            <Pastillas etiqueta="Office" opciones={opciones.si_no} {...txt("office")} />
            <Pastillas etiqueta="Vehículo" opciones={opciones.si_no} {...txt("vehiculo")} />
          </div>
          {/* El tipo solo tiene sentido si tiene vehículo; si ya estaba cargado, se muestra igual. */}
          {(esSi(f.vehiculo) || f.tipo_vehiculo) && (
            <Texto etiqueta="Tipo de vehículo" largo={100} {...txt("tipo_vehiculo")} />
          )}
        </Seccion>

        <Seccion titulo="Banco y facturación">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto etiqueta="Banco" largo={200} {...txt("nombre_banco")} />
            <Texto etiqueta="Sucursal" largo={200} {...txt("sucursal_banco")} />
            <Texto etiqueta="Titular" largo={200} {...txt("titular_banco")} />
            <Texto
              etiqueta="CI del titular"
              largo={50}
              inputMode="numeric"
              {...txt("nro_ci_titular_banco")}
            />
            <Texto etiqueta="Tipo de cuenta" largo={100} {...txt("tipo_cuenta")} />
            <Texto etiqueta="Nro. de cuenta" largo={100} {...txt("nro_cuenta")} />
            <Texto etiqueta="Nombre del emisor" largo={200} {...txt("nombre_emisor")} />
            <Texto etiqueta="RUC" largo={50} {...txt("ruc")} />
          </div>
          <Pastillas
            etiqueta="Tipo de facturación"
            opciones={opciones.tipo_factura}
            {...txt("tipo_factura")}
          />
        </Seccion>

        <Seccion titulo="En el sistema">
          <Pastillas etiqueta="Activo" req opciones={opciones.si_no} {...txt("activo")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Texto
              etiqueta="Usuario"
              ayuda="El de APEX, para entrar al sistema."
              largo={100}
              mayusculas
              {...txt("usuario")}
            />
            <Texto etiqueta="Fecha de ingreso" tipo="date" {...txt("fecha_ingreso")} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Pastillas etiqueta="Credencial" opciones={opciones.si_no} {...txt("credencial")} />
            <Pastillas
              etiqueta="Pide ubicación al intervenir"
              opciones={opciones.si_no}
              {...txt("ind_ubicacion_postulacion")}
            />
          </div>
          <Texto etiqueta="Observación" largo={1000} multilinea {...txt("observacion")} />
        </Seccion>

        <Seccion titulo="Nominado por" ayuda="Quién lo propuso como facilitador.">
          <Lista
            filas={f.nominados}
            onCambio={(v) => set("nominados", v)}
            nueva={() => ({ id: null, tipo_relacion: "", nombre_apellido: "", nro_telefono: "" })}
            campos={[
              { k: "tipo_relacion", etiqueta: "Relación", req: true, largo: 50 },
              { k: "nombre_apellido", etiqueta: "Nombre y apellido", req: true, largo: 500 },
              { k: "nro_telefono", etiqueta: "Teléfono", largo: 100 },
            ]}
            vacio="Nadie cargado."
          />
        </Seccion>

        <Seccion titulo="Referencias personales">
          <Lista
            filas={f.referencias}
            onCambio={(v) => set("referencias", v)}
            nueva={() => ({ id: null, tipo_relacion: "", nombre_apellido: "", nro_telefono: "" })}
            campos={[
              { k: "tipo_relacion", etiqueta: "Relación", req: true, largo: 50 },
              { k: "nombre_apellido", etiqueta: "Nombre y apellido", req: true, largo: 500 },
              { k: "nro_telefono", etiqueta: "Teléfono", largo: 100 },
            ]}
            vacio="Ninguna referencia cargada."
          />
        </Seccion>

        <Seccion titulo="Nivel académico">
          <Lista
            filas={f.estudios}
            onCambio={(v) => set("estudios", v)}
            nueva={() => ({ id: null, nivel_academico: "", titulo: "", anio: "" })}
            campos={[
              {
                k: "nivel_academico",
                etiqueta: "Nivel",
                req: true,
                opciones: opciones.nivel_academico,
              },
              { k: "titulo", etiqueta: "Título", largo: 2000 },
              { k: "anio", etiqueta: "Año", largo: 200 },
            ]}
            vacio="Ningún estudio cargado."
          />
        </Seccion>

        <Seccion titulo="Situación laboral">
          <Lista
            filas={f.laborales}
            onCambio={(v) => set("laborales", v)}
            nueva={() => ({ id: null, empresa: "", cargo: "", anio: "" })}
            campos={[
              { k: "empresa", etiqueta: "Empresa", req: true, largo: 800 },
              { k: "cargo", etiqueta: "Cargo", largo: 800 },
              { k: "anio", etiqueta: "Año", largo: 200 },
            ]}
            vacio="Ningún trabajo cargado."
          />
        </Seccion>
      </fieldset>

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
                  ? "Se borra con sus referencias, estudios y trabajos. Tocá de nuevo para confirmar."
                  : "Eliminar este facilitador."}
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
            {nuevo ? "Crear facilitador" : sinCambios ? "Sin cambios" : "Guardar cambios"}
          </button>
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas del formulario                                                      */
/* -------------------------------------------------------------------------- */

type CampoLista<T> = {
  k: keyof T & string;
  etiqueta: string;
  req?: boolean;
  largo?: number;
  opciones?: ValorLista[];
};

/**
 * Las cuatro listas de la ficha (los modales 63 a 66 de APEX): cada fila es
 * una tarjetita con sus campos y un botón para sacarla. Se guardan con la ficha.
 */
function Lista<T extends { id: number | null }>({
  filas,
  onCambio,
  nueva,
  campos,
  vacio,
}: {
  filas: T[];
  onCambio: (v: T[]) => void;
  nueva: () => T;
  campos: CampoLista<T>[];
  vacio: string;
}) {
  const cambiar = (i: number, k: keyof T, v: string) =>
    onCambio(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  return (
    <div className="space-y-2">
      {!filas.length && <p className="text-xs text-muted-foreground">{vacio}</p>}
      {filas.map((fila, i) => (
        <div
          key={fila.id ?? `n${i}`}
          className="relative rounded-xl border border-border/60 p-3 pr-11"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {campos.map((c) => (
              <label key={c.k} className="block">
                <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
                  {c.etiqueta} {c.req && <span className="text-destructive">*</span>}
                </span>
                {c.opciones ? (
                  <select
                    value={String(fila[c.k] ?? "")}
                    onChange={(e) => cambiar(i, c.k, e.target.value)}
                    className={`${campo} h-11`}
                  >
                    <option value="">Elegir…</option>
                    {c.opciones.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.mostrar}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={String(fila[c.k] ?? "")}
                    onChange={(e) => cambiar(i, c.k, e.target.value)}
                    maxLength={c.largo}
                    className={`${campo} h-11`}
                  />
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onCambio(filas.filter((_, j) => j !== i))}
            aria-label="Quitar"
            className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onCambio([...filas, nueva()])}
        className="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-border px-3.5 text-sm font-semibold text-primary hover:border-primary/40"
      >
        <Plus className="size-4" />
        Agregar
      </button>
    </div>
  );
}
