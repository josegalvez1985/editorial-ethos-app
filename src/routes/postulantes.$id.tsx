import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BotonBorrar, Cargando, Fallo, SoloLectura } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { Pastillas, Quitar, Seccion, Texto } from "@/components/ficha-ui";
import { MapaPunto } from "@/components/mapa-punto";
import { PickerModal } from "@/components/picker-modal";
import { Avatar, DocCloudinary } from "@/components/postulante-documentos";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keysAniosLectivos, listarAniosLectivos } from "@/lib/anios-lectivos";
import { apiCiudades } from "@/lib/ciudades";
import { keysFacilitadores } from "@/lib/facilitadores";
import type { Opcion as OpcionPicker } from "@/lib/evaluaciones";
import { fechaCorta } from "@/lib/fechas";
import { usePermisos } from "@/lib/permisos";
import {
  ACEPTA,
  DIA_CORTO,
  DIAS,
  DOCS_CLOUDINARY,
  documentos,
  esDeCloudinary,
  edadDe,
  eliminarPostulante,
  ESTADO_CIVIL,
  estadoDe,
  escribirCoordenadas,
  escribirDias,
  estudia,
  FACTURA,
  guardarPostulante,
  keysPostulantes,
  LICENCIATURA,
  leerCoordenadas,
  leerDias,
  META_POSTULANTES,
  mostrar,
  obtenerPostulante,
  POSGRADO,
  revisarPostulante,
  SECUNDARIO,
  SI_NO,
  TALLES,
  TECNICO,
  TURNOS,
  VEHICULO,
  VIVE_CON,
  type CampoTexto,
  type Estado,
  type Ficha,
  type Postulante,
} from "@/lib/postulantes";
import { cn, normalizar } from "@/lib/utils";

export const Route = createFileRoute("/postulantes/$id")({
  head: () => ({ meta: [{ title: "Postulante — Juventud con Valores" }] }),
  component: FichaPage,
});

const RUTA = "/postulantes";

type Pestana = "datos" | "estudios" | "disponibilidad" | "iglesia" | "banco" | "documentos";

const PESTANAS: { clave: Pestana; texto: string }[] = [
  { clave: "datos", texto: "Datos" },
  { clave: "estudios", texto: "Estudios y trabajo" },
  { clave: "disponibilidad", texto: "Disponibilidad" },
  { clave: "iglesia", texto: "Iglesia" },
  { clave: "banco", texto: "Banco" },
  { clave: "documentos", texto: "Documentos" },
];

/** Los obligatorios (NOT NULL en la tabla), con su nombre y su pestaña. */
const OBLIGATORIOS: [CampoTexto, string, Pestana][] = [
  ["nombre_completo", "nombre completo", "datos"],
  ["cedula", "cédula", "datos"],
  ["fecha_nacimiento", "fecha de nacimiento", "datos"],
  ["edad", "edad", "datos"],
  ["nacionalidad", "nacionalidad", "datos"],
  ["estado_civil", "estado civil", "datos"],
  ["vive_con", "con quién vive", "datos"],
  ["hijos", "hijos", "datos"],
  ["telefono", "teléfono", "datos"],
  ["correo_electronico", "correo", "datos"],
  ["direccion", "dirección", "datos"],
  ["ubicacion_domicilio", "ubicación del domicilio", "datos"],
  ["secundario_estado", "secundaria", "estudios"],
  ["tecnico_estado", "técnico superior", "estudios"],
  ["licenciatura_estado", "licenciatura", "estudios"],
  ["posgrado_estado", "posgrado", "estudios"],
  ["actividad_laboral", "actividad laboral", "estudios"],
  ["movilidad_propia", "movilidad propia", "estudios"],
  ["computadora_propia", "computadora propia", "estudios"],
  ["internet_estable", "internet estable", "estudios"],
  ["manejo_office", "manejo de Office", "estudios"],
  ["dias_disponibles", "días disponibles", "disponibilidad"],
  ["turno", "turno", "disponibilidad"],
  ["iglesia_denominacion", "denominación", "iglesia"],
  ["iglesia_nombre", "iglesia", "iglesia"],
  ["pastor_nombre", "pastor", "iglesia"],
  ["pastor_telefono", "teléfono del pastor", "iglesia"],
  ["lider_nombre", "líder", "iglesia"],
  ["lider_telefono", "teléfono del líder", "iglesia"],
  ["bautizado_agua", "bautizado en agua", "iglesia"],
  ["areas_ministerio", "áreas de ministerio", "iglesia"],
  ["banco_nombre", "banco", "banco"],
  ["banco_sucursal", "sucursal", "banco"],
  ["titular_nombre", "titular", "banco"],
  ["titular_ci", "CI del titular", "banco"],
  ["tipo_cuenta", "tipo de cuenta", "banco"],
  ["numero_cuenta", "número de cuenta", "banco"],
  ["factura_tipo", "tipo de factura", "banco"],
  ["factura_emisor", "emisor de la factura", "banco"],
  ["ruc", "RUC", "banco"],
];

/** Para WhatsApp: el número con el 595 de Paraguay adelante. */
function numeroWhatsApp(tel: string) {
  const d = tel.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("595")) return d;
  return `595${d.replace(/^0/, "")}`;
}

/**
 * La ficha de un postulante (24/11/2026): cabecera con la foto, el contacto y
 * la revisión (aprobar / rechazar), y los ~75 campos en pestañas con un solo
 * Guardar. Los documentos de Cloudinary se suben, reemplazan y quitan en su
 * pestaña; los viejos se borran de Cloudinary al guardar.
 */
function FichaPage() {
  const { id } = Route.useParams();
  const idNum = Number(id);
  const q = useQuery({
    queryKey: keysPostulantes.ficha(idNum),
    queryFn: () => obtenerPostulante(idNum),
    meta: META_POSTULANTES,
  });

  return (
    <AppShell nav={false}>
      {q.isLoading ? (
        <Cargando />
      ) : q.error || !q.data ? (
        <div className="p-5">
          <Fallo error={q.error} texto="No se pudo cargar la postulación" />
        </div>
      ) : (
        // Remonta solo al cambiar de postulación: volver a la ventana (react-query
        // consulta de nuevo) no tiene que borrar lo que se está editando.
        <Formulario key={id} p={q.data} />
      )}
    </AppShell>
  );
}

function Formulario({ p }: { p: Postulante }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { puedeRuta } = usePermisos();
  const puedeGuardar = puedeRuta(RUTA, "actualizar");
  const puedeBorrar = puedeRuta(RUTA, "borrar");

  const [f, setF] = useState<Ficha>(p.ficha);
  const [pestana, setPestana] = useState<Pestana>("datos");
  const [revisando, setRevisando] = useState<Estado | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const set = <K extends keyof Ficha>(k: K, v: Ficha[K]) => setF((x) => ({ ...x, [k]: v }));
  const txt = (k: CampoTexto) => ({ valor: f[k], onCambio: (v: string) => set(k, v) });

  const ciudades = useQuery({ queryKey: apiCiudades.queryKey, queryFn: apiCiudades.listar });
  const anios = useQuery({ queryKey: keysAniosLectivos.todo, queryFn: listarAniosLectivos });
  const opcCiudad: OpcionPicker[] = (ciudades.data?.items ?? []).map((c) => ({
    id: c.id,
    texto: c.nombre,
    extra: c.padre?.nombre,
    busqueda: normalizar(`${c.nombre} ${c.padre?.nombre ?? ""}`),
  }));
  const ciudad = ciudades.data?.items.find((c) => c.id === f.id_ciudad);

  const faltan = [
    ...OBLIGATORIOS.filter(([k]) => !f[k].trim()),
    ...(f.id_ciudad == null ? [["id_ciudad", "ciudad", "datos"] as const] : []),
  ];
  const sinCambios = JSON.stringify(f) === JSON.stringify(p.ficha);
  const docs = documentos(f);
  const coords = leerCoordenadas(f.ubicacion_domicilio);
  const edad = edadDe(f.fecha_nacimiento);
  const estado = estadoDe(p.estado);

  const invalidar = () => qc.invalidateQueries({ queryKey: keysPostulantes.todo });

  const guardar = useMutation({
    mutationFn: () => guardarPostulante(p.id, f),
    onSuccess: (r) => {
      invalidar();
      if (r.aviso) toast.warning("Cambios guardados", { description: r.aviso, duration: 10000 });
      else toast.success("Cambios guardados");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  const borrar = useMutation({
    mutationFn: () => eliminarPostulante(p.id),
    onSuccess: (r) => {
      invalidar();
      const borrados = `${r.borrados} archivo${r.borrados === 1 ? "" : "s"} borrado${r.borrados === 1 ? "" : "s"}.`;
      if (r.aviso)
        toast.warning("Postulación eliminada", {
          description: `${borrados} ${r.aviso}`,
          duration: 15000,
        });
      else toast.success("Postulación eliminada", { description: borrados });
      navigate({ to: "/postulantes", replace: true });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo eliminar"),
  });

  const ocupado = guardar.isPending || borrar.isPending;
  const enviar = () => {
    if (faltan.length) {
      setPestana(faltan[0][2]);
      toast.error(`Falta completar: ${faltan.map(([, n]) => n).join(", ")}`);
      return;
    }
    guardar.mutate();
  };

  const tel = f.telefono.trim();
  const wa = numeroWhatsApp(tel);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        {/* Cabecera: quién es, cómo contactarlo y la revisión. */}
        <div className="px-5 pt-4">
          <Link
            to="/postulantes"
            className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Postulantes
          </Link>
          <div className="rounded-3xl border border-border/60 bg-card p-4 shadow-soft">
            <div className="flex items-start gap-4">
              <Avatar
                foto={f.foto_url || p.ficha.foto_url}
                nombre={f.nombre_completo}
                className="size-20 text-xl"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-[1.5rem] leading-tight font-bold">
                    {f.nombre_completo.trim() || "Sin nombre"}
                  </h1>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
                      estado.color,
                    )}
                  >
                    {estado.texto}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  CI {f.cedula || "—"}
                  {edad != null && ` · ${edad} años`}
                  {(ciudad?.nombre || p.ciudad) && ` · ${ciudad?.nombre ?? p.ciudad}`}
                  {` · ${p.anio}`}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {p.fecha_registro && `Llegó el ${fechaCorta(p.fecha_registro.slice(0, 10))} `}
                  {p.usuario ? `desde la app (${p.usuario})` : "por el formulario"}
                  {" · "}
                  {p.ficha.id_facilitador != null
                    ? `Ya fue facilitador${p.facilitador ? `: ${p.facilitador}` : ""}`
                    : "Postulante nuevo"}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {tel && (
                    <Contacto
                      href={`tel:${tel.replace(/[^\d+]/g, "")}`}
                      icono={Phone}
                      texto="Llamar"
                    />
                  )}
                  {wa && (
                    <Contacto
                      href={`https://wa.me/${wa}`}
                      icono={MessageCircle}
                      texto="WhatsApp"
                      externo
                    />
                  )}
                  {f.correo_electronico.trim() && (
                    <Contacto
                      href={`mailto:${f.correo_electronico.trim()}`}
                      icono={Mail}
                      texto="Correo"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* La revisión */}
            <div className="mt-4 border-t border-border/60 pt-3">
              {p.estado !== "PENDIENTE" && (
                <p className="mb-2.5 text-[12px] text-muted-foreground">
                  {estado.texto}
                  {p.fecha_revision &&
                    ` el ${fechaCorta(p.fecha_revision.slice(0, 10))} a las ${p.fecha_revision.slice(11, 16)}`}
                  {p.observacion_admin && (
                    <span className="mt-0.5 block text-foreground">“{p.observacion_admin}”</span>
                  )}
                </p>
              )}
              {puedeGuardar && (
                <div className="flex flex-wrap items-center gap-2">
                  {p.estado !== "APROBADA" && (
                    <button
                      type="button"
                      onClick={() => setRevisando("APROBADA")}
                      disabled={!sinCambios || ocupado}
                      className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-soft disabled:opacity-50"
                    >
                      <Check className="size-4" />
                      Aprobar
                    </button>
                  )}
                  {p.estado !== "RECHAZADA" && (
                    <button
                      type="button"
                      onClick={() => setRevisando("RECHAZADA")}
                      disabled={!sinCambios || ocupado}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-destructive/40 px-4 text-sm font-semibold text-destructive disabled:opacity-50"
                    >
                      <X className="size-4" />
                      Rechazar
                    </button>
                  )}
                  {p.estado !== "PENDIENTE" && (
                    <button
                      type="button"
                      onClick={() => setRevisando("PENDIENTE")}
                      disabled={!sinCambios || ocupado}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-border/60 px-4 text-sm font-semibold text-muted-foreground disabled:opacity-50"
                    >
                      <RotateCcw className="size-4" />
                      Volver a pendiente
                    </button>
                  )}
                  {!sinCambios && (
                    <span className="text-[11.5px] text-muted-foreground">
                      Guardá los cambios antes de revisar.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {!puedeGuardar && (
            <div className="mt-3">
              <SoloLectura texto="Solo lectura: tu usuario no puede modificar postulaciones." />
            </div>
          )}

          {/* Pestañas */}
          <div
            role="tablist"
            className="sticky top-0 z-10 -mx-5 mt-4 flex gap-1 overflow-x-auto border-b border-border/60 bg-background/95 px-5 backdrop-blur"
          >
            {PESTANAS.map((t) => {
              const falta = faltan.some(([, , tab]) => tab === t.clave);
              return (
                <button
                  key={t.clave}
                  type="button"
                  role="tab"
                  aria-selected={pestana === t.clave}
                  onClick={() => setPestana(t.clave)}
                  className={cn(
                    "relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-[13px] font-semibold whitespace-nowrap",
                    pestana === t.clave
                      ? "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.texto}
                  {t.clave === "documentos" && (
                    <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">
                      {docs.tiene}/{docs.esperados}
                    </span>
                  )}
                  {falta && (
                    <span
                      className="size-1.5 rounded-full bg-destructive"
                      aria-label="Falta completar"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <fieldset
          disabled={!puedeGuardar || ocupado}
          className="grid grid-cols-1 gap-4 px-5 pt-4 pb-6 lg:grid-cols-2"
        >
          {pestana === "datos" && (
            <>
              <Seccion titulo="Datos personales">
                <Texto etiqueta="Nombre completo" req largo={200} {...txt("nombre_completo")} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Texto etiqueta="Cédula" req largo={20} inputMode="numeric" {...txt("cedula")} />
                  <Texto
                    etiqueta="Fecha de nacimiento"
                    req
                    tipo="date"
                    valor={f.fecha_nacimiento}
                    onCambio={(v) => {
                      const e = edadDe(v);
                      setF((x) => ({
                        ...x,
                        fecha_nacimiento: v,
                        edad: e == null ? x.edad : String(e),
                      }));
                    }}
                    ayuda={edad != null ? `${edad} años` : undefined}
                  />
                </div>
                <Texto etiqueta="Nacionalidad" req largo={100} {...txt("nacionalidad")} />
                <Pastillas
                  etiqueta="Estado civil"
                  req
                  opciones={ESTADO_CIVIL}
                  {...txt("estado_civil")}
                />
                {f.estado_civil === "OTROS" && (
                  <Texto etiqueta="¿Cuál?" largo={100} {...txt("estado_civil_otro")} />
                )}
                <Pastillas etiqueta="Vive con" req opciones={VIVE_CON} {...txt("vive_con")} />
                <Pastillas etiqueta="Hijos" req opciones={SI_NO} {...txt("hijos")} />
                <Pastillas etiqueta="Talle de remera" opciones={TALLES} {...txt("talle_remera")} />
              </Seccion>

              <Seccion titulo="Contacto y domicilio">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Texto etiqueta="Teléfono" req largo={30} inputMode="tel" {...txt("telefono")} />
                  <Texto
                    etiqueta="Correo"
                    req
                    largo={200}
                    inputMode="email"
                    {...txt("correo_electronico")}
                  />
                </div>
                <PickerModal
                  label="Ciudad"
                  opciones={opcCiudad}
                  value={f.id_ciudad}
                  valueText={p.ciudad || null}
                  onChange={(o) => set("id_ciudad", o.id)}
                  placeholder="Elegir ciudad"
                  requerido
                />
                <Texto etiqueta="Dirección" req largo={300} {...txt("direccion")} />
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      Ubicación <span className="text-destructive">*</span>
                    </span>
                    {coords && (
                      <a
                        href={`https://www.google.com/maps?q=${coords[0]},${coords[1]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[12px] font-semibold text-primary"
                      >
                        <ExternalLink className="size-3.5" />
                        Google Maps
                      </a>
                    )}
                  </div>
                  <MapaPunto
                    punto={coords}
                    onCambio={
                      puedeGuardar
                        ? (lat, lng) => set("ubicacion_domicilio", escribirCoordenadas(lat, lng))
                        : undefined
                    }
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {puedeGuardar ? "Tocá el mapa o arrastrá el punto para corregirla. " : ""}
                    {coords
                      ? f.ubicacion_domicilio
                      : f.ubicacion_domicilio
                        ? `No son coordenadas: “${f.ubicacion_domicilio}”`
                        : "Sin ubicación."}
                  </p>
                </div>
              </Seccion>

              <Seccion titulo="La postulación">
                <Pastillas
                  etiqueta="Año lectivo"
                  req
                  opciones={(anios.data ?? []).map((a) => ({
                    valor: String(a.id),
                    mostrar: String(a.anio),
                  }))}
                  valor={String(f.id_anio)}
                  onCambio={(v) => v && set("id_anio", Number(v))}
                />
                <div>
                  <PickerModal
                    label="Facilitador que ya trabajó con la fundación"
                    nombre="facilitadores"
                    value={f.id_facilitador}
                    valueText={p.facilitador || null}
                    incluirId={p.ficha.id_facilitador}
                    onChange={(o) => set("id_facilitador", o.id)}
                    placeholder="Ninguno: es nuevo"
                  />
                  {f.id_facilitador != null && (
                    <Quitar onClick={() => set("id_facilitador", null)} />
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Proceso de postulación:{" "}
                  <span className="font-semibold text-foreground">
                    {mostrar(ACEPTA, p.acepta_proceso) || "—"}
                  </span>
                </p>
              </Seccion>
            </>
          )}

          {pestana === "estudios" && (
            <>
              <Seccion
                titulo="Estudios"
                ayuda="Con el título o la constancia de cada nivel al lado."
              >
                <Nivel
                  titulo="Secundaria"
                  opciones={SECUNDARIO}
                  estado={txt("secundario_estado")}
                  conTitulo={f.secundario_estado === "CONCLUIDO"}
                  tituloCampo={txt("secundario_titulo")}
                  doc="secundario_doc_url"
                  f={f}
                  p={p}
                  editable={puedeGuardar}
                  set={set}
                />
                <Nivel
                  titulo="Técnico superior"
                  opciones={TECNICO}
                  estado={txt("tecnico_estado")}
                  conTitulo={estudia(f.tecnico_estado)}
                  tituloCampo={txt("tecnico_titulo")}
                  anio={f.tecnico_estado === "CURSANDO" ? txt("tecnico_anio") : undefined}
                  doc="tecnico_doc_url"
                  f={f}
                  p={p}
                  editable={puedeGuardar}
                  set={set}
                />
                <Nivel
                  titulo="Licenciatura"
                  opciones={LICENCIATURA}
                  estado={txt("licenciatura_estado")}
                  conTitulo={estudia(f.licenciatura_estado)}
                  tituloCampo={txt("licenciatura_titulo")}
                  anio={f.licenciatura_estado === "CURSANDO" ? txt("licenciatura_anio") : undefined}
                  doc="licenciatura_doc_url"
                  f={f}
                  p={p}
                  editable={puedeGuardar}
                  set={set}
                />
                <Nivel
                  titulo="Posgrado"
                  opciones={POSGRADO}
                  estado={txt("posgrado_estado")}
                  conTitulo={estudia(f.posgrado_estado)}
                  tituloCampo={txt("posgrado_titulo")}
                  anio={f.posgrado_estado === "CURSANDO" ? txt("posgrado_anio") : undefined}
                  doc="posgrado_doc_url"
                  f={f}
                  p={p}
                  editable={puedeGuardar}
                  set={set}
                />
              </Seccion>

              <div className="space-y-4">
                <Seccion titulo="Trabajo">
                  <Pastillas
                    etiqueta="Trabaja actualmente"
                    req
                    opciones={SI_NO}
                    {...txt("actividad_laboral")}
                  />
                  {f.actividad_laboral === "SI" && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Texto etiqueta="Empresa" largo={200} {...txt("empresa")} />
                      <Texto etiqueta="Cargo" largo={200} {...txt("cargo")} />
                    </div>
                  )}
                </Seccion>
                <Seccion titulo="Herramientas">
                  <Pastillas
                    etiqueta="Movilidad propia"
                    req
                    opciones={SI_NO}
                    {...txt("movilidad_propia")}
                  />
                  {f.movilidad_propia === "SI" && (
                    <Pastillas etiqueta="Vehículo" opciones={VEHICULO} {...txt("tipo_vehiculo")} />
                  )}
                  <Pastillas
                    etiqueta="Computadora propia"
                    req
                    opciones={SI_NO}
                    {...txt("computadora_propia")}
                  />
                  <Pastillas
                    etiqueta="Internet estable (WiFi)"
                    req
                    opciones={SI_NO}
                    {...txt("internet_estable")}
                  />
                  <Pastillas
                    etiqueta="Maneja Office (Excel, PDF…)"
                    req
                    opciones={SI_NO}
                    {...txt("manejo_office")}
                  />
                </Seccion>
              </div>
            </>
          )}

          {pestana === "disponibilidad" && (
            <Seccion titulo="Disponibilidad">
              <Dias valor={f.dias_disponibles} onCambio={(v) => set("dias_disponibles", v)} />
              <Pastillas etiqueta="Turno" req opciones={TURNOS} {...txt("turno")} />
            </Seccion>
          )}

          {pestana === "iglesia" && (
            <>
              <Seccion titulo="Iglesia">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Texto etiqueta="Denominación" req largo={200} {...txt("iglesia_denominacion")} />
                  <Texto etiqueta="Iglesia" req largo={200} {...txt("iglesia_nombre")} />
                </div>
                <Pastillas
                  etiqueta="Bautizado en agua"
                  req
                  opciones={SI_NO}
                  {...txt("bautizado_agua")}
                />
                <Texto
                  etiqueta="Áreas, servicios o ministerios en los que sirve"
                  req
                  multilinea
                  {...txt("areas_ministerio")}
                />
              </Seccion>
              <Seccion titulo="Referencias">
                <Persona
                  titulo="Pastor"
                  nombre={txt("pastor_nombre")}
                  telefono={txt("pastor_telefono")}
                />
                <Persona
                  titulo="Líder directo"
                  nombre={txt("lider_nombre")}
                  telefono={txt("lider_telefono")}
                />
              </Seccion>
            </>
          )}

          {pestana === "banco" && (
            <>
              <Seccion titulo="Cuenta para los pagos">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Texto etiqueta="Banco" req largo={100} {...txt("banco_nombre")} />
                  <Texto etiqueta="Sucursal" req largo={100} {...txt("banco_sucursal")} />
                  <Texto etiqueta="Titular" req largo={200} {...txt("titular_nombre")} />
                  <Texto etiqueta="CI del titular" req largo={20} {...txt("titular_ci")} />
                  <Texto etiqueta="Tipo de cuenta" req largo={50} {...txt("tipo_cuenta")} />
                  <Texto etiqueta="Número de cuenta" req largo={50} {...txt("numero_cuenta")} />
                </div>
              </Seccion>
              <Seccion titulo="Facturación">
                <Pastillas
                  etiqueta="Tipo de factura"
                  req
                  opciones={FACTURA}
                  {...txt("factura_tipo")}
                />
                <Texto etiqueta="Emisor de la factura" req largo={200} {...txt("factura_emisor")} />
                <Texto etiqueta="RUC" req largo={30} {...txt("ruc")} />
              </Seccion>
            </>
          )}

          {pestana === "documentos" && (
            <>
              <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft lg:col-span-2">
                <div>
                  <h2 className="font-display text-lg font-bold">Documentos</h2>
                  <p className="text-[11.5px] text-muted-foreground">
                    Fotos y PDF. Lo que reemplaces o quites se borra al guardar.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {DOCS_CLOUDINARY.map((d) => (
                    <DocCloudinary
                      key={d.campo}
                      nombre={d.nombre}
                      url={f[d.campo]}
                      original={p.ficha[d.campo]}
                      corresponde={d.corresponde(f)}
                      cedula={f.cedula}
                      archivo={d.archivo}
                      editable={puedeGuardar}
                      onCambio={(v) => set(d.campo, v)}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </fieldset>

        {puedeBorrar && (
          <div className="flex items-center gap-3 px-5 pb-6">
            <BotonBorrar
              confirmar={confirmarBorrado}
              pendiente={borrar.isPending}
              deshabilitado={ocupado}
              onClick={() => (confirmarBorrado ? borrar.mutate() : setConfirmarBorrado(true))}
            />
            <p className="text-[11px] text-muted-foreground">
              {confirmarBorrado
                ? `Se borra la postulación y ${
                    DOCS_CLOUDINARY.filter((d) => esDeCloudinary(p.ficha[d.campo])).length
                  } archivo(s). Tocá de nuevo para confirmar.`
                : "Eliminar esta postulación."}
            </p>
          </div>
        )}

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
              {sinCambios ? "Sin cambios" : "Guardar cambios"}
            </button>
          </div>
        )}
      </form>

      {revisando && (
        <Revision
          p={p}
          estado={revisando}
          onCerrar={() => setRevisando(null)}
          onListo={() => {
            setRevisando(null);
            invalidar();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

function Contacto({
  href,
  icono: Icono,
  texto,
  externo,
}: {
  href: string;
  icono: typeof Phone;
  texto: string;
  externo?: boolean;
}) {
  return (
    <a
      href={href}
      {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex h-9 items-center gap-1.5 rounded-xl border border-border/60 px-3 text-[12.5px] font-semibold hover:border-primary/40"
    >
      <Icono className="size-4 text-primary" />
      {texto}
    </a>
  );
}

type CampoUI = { valor: string; onCambio: (v: string) => void };

/** Un nivel de estudios: su estado, el título, el año en curso y el documento. */
function Nivel({
  titulo,
  opciones,
  estado,
  conTitulo,
  tituloCampo,
  anio,
  doc,
  f,
  p,
  editable,
  set,
}: {
  titulo: string;
  opciones: { valor: string; mostrar: string }[];
  estado: CampoUI;
  conTitulo: boolean;
  tituloCampo: CampoUI;
  anio?: CampoUI;
  doc: (typeof DOCS_CLOUDINARY)[number]["campo"];
  f: Ficha;
  p: Postulante;
  editable: boolean;
  set: <K extends keyof Ficha>(k: K, v: Ficha[K]) => void;
}) {
  const d = DOCS_CLOUDINARY.find((x) => x.campo === doc)!;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 p-3 sm:grid-cols-[1fr_9rem]">
      <div className="space-y-3">
        <Pastillas etiqueta={titulo} req opciones={opciones} {...estado} />
        {conTitulo && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem]">
            <Texto etiqueta="Título / carrera" largo={200} {...tituloCampo} />
            {anio && <Texto etiqueta="Año" largo={10} placeholder="1/4" {...anio} />}
          </div>
        )}
      </div>
      {(conTitulo || f[doc] || p.ficha[doc]) && (
        <DocCloudinary
          nombre={estado.valor === "CURSANDO" ? "Constancia" : "Título"}
          url={f[doc]}
          original={p.ficha[doc]}
          corresponde={d.corresponde(f)}
          cedula={f.cedula}
          archivo={d.archivo}
          editable={editable}
          onCambio={(v) => set(doc, v)}
        />
      )}
    </div>
  );
}

/** De lunes a viernes, en pastillas que se marcan y desmarcan. */
function Dias({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  const marcados = leerDias(valor);
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">
        Días disponibles <span className="text-destructive">*</span>
      </span>
      <div className="grid grid-cols-5 gap-2">
        {DIAS.map((d) => {
          const on = marcados.has(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const s = new Set(marcados);
                if (on) s.delete(d);
                else s.add(d);
                onCambio(escribirDias(s));
              }}
              className={cn(
                "tap h-12 rounded-xl border text-sm font-semibold",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-background text-muted-foreground hover:border-primary/40",
              )}
            >
              {DIA_CORTO[d]}
            </button>
          );
        })}
      </div>
      {valor && !marcados.size && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
          Guardado como “{valor}”: no se reconoce ningún día.
        </p>
      )}
    </div>
  );
}

/** Pastor o líder: nombre, teléfono y un botón para llamar. */
function Persona({
  titulo,
  nombre,
  telefono,
}: {
  titulo: string;
  nombre: CampoUI;
  telefono: CampoUI;
}) {
  const tel = telefono.valor.trim();
  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_11rem_auto]">
      <Texto etiqueta={titulo} req largo={200} {...nombre} />
      <Texto etiqueta="Teléfono" req largo={30} inputMode="tel" {...telefono} />
      {tel ? (
        <a
          href={`tel:${tel.replace(/[^\d+]/g, "")}`}
          aria-label={`Llamar a ${titulo.toLowerCase()}`}
          className="grid size-11 place-items-center rounded-xl border border-border/60 text-primary hover:border-primary/40"
        >
          <Phone className="size-4" />
        </a>
      ) : (
        <span className="hidden sm:block sm:w-11" />
      )}
    </div>
  );
}

/** Aprobar, rechazar (con motivo) o volver a pendiente. */
function Revision({
  p,
  estado,
  onCerrar,
  onListo,
}: {
  p: Postulante;
  estado: Estado;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const qc = useQueryClient();
  const [obs, setObs] = useState(estado === "PENDIENTE" ? "" : p.observacion_admin);
  const rechazar = estado === "RECHAZADA";
  const falta = rechazar && !obs.trim();

  const enviar = useMutation({
    mutationFn: () => revisarPostulante(p.id, estado, obs),
    onSuccess: (r) => {
      if (estado === "APROBADA") {
        toast.success("Postulación aprobada", {
          description: r.facilitador
            ? `Ya está en Facilitadores: ${r.facilitador}.`
            : "Pasó a Facilitadores.",
          duration: 8000,
        });
        // También cambió Facilitadores (alta o actualización).
        qc.invalidateQueries({ queryKey: keysFacilitadores.todo });
      } else {
        toast.success(rechazar ? "Postulación rechazada" : "Volvió a pendiente");
      }
      onListo();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !enviar.isPending && onCerrar()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {estado === "APROBADA"
              ? "Aprobar la postulación"
              : rechazar
                ? "Rechazar la postulación"
                : "Volver a pendiente"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {p.ficha.nombre_completo}
            {estado === "APROBADA" && (
              <span className="mt-1.5 block leading-snug text-foreground">
                {p.ficha.id_facilitador != null
                  ? "Se actualizan sus datos en Facilitadores con los de la postulación y queda activo."
                  : "Se crea en Facilitadores con los datos de la postulación (o se actualiza, si ya hay uno con su cédula) y queda activo."}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (falta) {
              toast.error("Escribí el motivo del rechazo");
              return;
            }
            enviar.mutate();
          }}
          className="space-y-4"
        >
          <Texto
            etiqueta={rechazar ? "Motivo" : "Observación"}
            req={rechazar}
            multilinea
            largo={1000}
            valor={obs}
            onCambio={setObs}
            placeholder={rechazar ? "Por qué se rechaza" : "Opcional"}
          />
          <button
            type="submit"
            disabled={enviar.isPending || falta}
            className={cn(
              "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-soft disabled:opacity-50",
              estado === "APROBADA" ? "bg-emerald-600" : rechazar ? "bg-destructive" : "bg-primary",
            )}
          >
            {enviar.isPending && <Loader2 className="size-4 animate-spin" />}
            {estado === "APROBADA" ? "Aprobar" : rechazar ? "Rechazar" : "Volver a pendiente"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
