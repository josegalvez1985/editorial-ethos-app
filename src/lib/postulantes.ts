/**
 * Postulantes a facilitador (`POSTULANTES_FACILITADORES`, 24/11/2026). Contrato
 * del backend: `backend/postulantes_facilitadores.sql`.
 *
 * **Tabla compartida:** la llena otra app (el formulario JV26 y la app de
 * facilitadores). El sitio revisa (aprobar / rechazar), corrige la ficha,
 * maneja los archivos de Cloudinary y borra; no da de alta.
 *
 * Los archivos son de dos clases:
 * - `*_url`: **Cloudinary** (foto, cédula y títulos). Se suben como las fotos
 *   de facturas (la firma la da el backend); al reemplazar o quitar uno, el
 *   backend borra el viejo de Cloudinary después de guardar.
 * - `*_archivo`: **OneDrive** (CV, certificados). Enlaces de texto: se abren y
 *   se editan, no se suben.
 */

import { authFetch } from "@/lib/api";
import { subirACloudinary } from "@/lib/cloudinary";
import { normalizar } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Las listas (los CHECK de la tabla)                                         */
/* -------------------------------------------------------------------------- */

export type Opcion = { valor: string; mostrar: string };
const op = (valor: string, mostrar: string): Opcion => ({ valor, mostrar });

export const SI_NO = [op("SI", "Sí"), op("NO", "No")];
export const ESTADO_CIVIL = [
  op("SOLTERO", "Soltero/a"),
  op("CASADO", "Casado/a"),
  op("OTROS", "Otros"),
];
export const VIVE_CON = [
  op("SOLO", "Solo/a"),
  op("PADRES", "Padres"),
  op("CONYUGE", "Cónyuge"),
  op("OTROS", "Otros"),
];
export const TALLES = ["P", "M", "G", "XG", "XXG", "XXXG", "XXXXG", "XXXXXG"].map((t) => op(t, t));
export const SECUNDARIO = [op("CONCLUIDO", "Concluido"), op("INCONCLUSO", "Inconcluso")];
export const TECNICO = [
  op("CONCLUIDO", "Concluido"),
  op("CURSANDO", "Cursando"),
  op("INCONCLUSO", "Inconcluso"),
  op("NO", "No"),
];
export const LICENCIATURA = [
  op("CONCLUIDA", "Concluida"),
  op("CURSANDO", "Cursando"),
  op("INCONCLUSA", "Inconclusa"),
  op("NO", "No"),
];
// Así en el CHECK de la tabla: CONCLUIDO pero INCONCLUSA.
export const POSGRADO = [
  op("CONCLUIDO", "Concluido"),
  op("CURSANDO", "Cursando"),
  op("INCONCLUSA", "Inconcluso"),
  op("NO", "No"),
];
export const VEHICULO = [op("AUTO", "Auto"), op("MOTOCICLETA", "Moto")];
export const TURNOS = [
  op("MANANA", "Mañana"),
  op("TARDE", "Tarde"),
  op("MANANA_Y_TARDE", "Mañana y tarde"),
];
export const FACTURA = [op("VIRTUAL", "Virtual"), op("FISICA", "Física")];
export const ACEPTA = [op("DE_ACUERDO", "De acuerdo"), op("NO_DE_ACUERDO", "No de acuerdo")];

export const mostrar = (lista: Opcion[], valor: string) =>
  lista.find((o) => o.valor === valor)?.mostrar ?? valor;

/** Concluido o cursando: tiene título o constancia que subir. */
export const estudia = (estado: string) => /^(CONCLUID|CURSANDO)/.test(estado);

/* -------------------------------------------------------------------------- */
/* Estado de la revisión                                                      */
/* -------------------------------------------------------------------------- */

export type Estado = "PENDIENTE" | "APROBADA" | "RECHAZADA";

export const ESTADOS: { valor: Estado; texto: string; plural: string; color: string }[] = [
  {
    valor: "PENDIENTE",
    texto: "Pendiente",
    plural: "Pendientes",
    color: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  {
    valor: "APROBADA",
    texto: "Aprobada",
    plural: "Aprobadas",
    color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  {
    valor: "RECHAZADA",
    texto: "Rechazada",
    plural: "Rechazadas",
    color: "bg-destructive/10 text-destructive",
  },
];
export const estadoDe = (v: string) => ESTADOS.find((e) => e.valor === v) ?? ESTADOS[0];

/* -------------------------------------------------------------------------- */
/* Días disponibles                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `DIAS_DISPONIBLES` es texto separado por comas. Se lee sin importar
 * mayúsculas ni tildes; se escribe en MAYÚSCULAS sin tilde ("LUNES,MIERCOLES"),
 * como los CHECK de la tabla (MANANA, CONYUGE). Si la otra app guarda distinto,
 * se cambia acá (ver la verificación previa del `.sql`).
 */
export const DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"] as const;
export const DIA_CORTO: Record<(typeof DIAS)[number], string> = {
  LUNES: "Lun",
  MARTES: "Mar",
  MIERCOLES: "Mié",
  JUEVES: "Jue",
  VIERNES: "Vie",
};

export function leerDias(texto: string): Set<string> {
  const partes = texto.split(/[,;]/).map((d) => normalizar(d.trim()).toUpperCase());
  return new Set(DIAS.filter((d) => partes.includes(d)));
}

export const escribirDias = (dias: Set<string>) => DIAS.filter((d) => dias.has(d)).join(",");

/* -------------------------------------------------------------------------- */
/* Ubicación y edad                                                           */
/* -------------------------------------------------------------------------- */

/** `"-25.30,-57.60"` → [lat, lng], o `null` si no son coordenadas. */
export function leerCoordenadas(texto: string): [number, number] | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(texto);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

export const escribirCoordenadas = (lat: number, lng: number) =>
  `${lat.toFixed(6)},${lng.toFixed(6)}`;

/** Los años cumplidos a hoy, o `null`. */
export function edadDe(fechaNac: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaNac);
  if (!m) return null;
  const hoy = new Date();
  let e = hoy.getFullYear() - Number(m[1]);
  const mes = hoy.getMonth() + 1;
  if (mes < Number(m[2]) || (mes === Number(m[2]) && hoy.getDate() < Number(m[3]))) e--;
  return e >= 0 && e < 120 ? e : null;
}

/* -------------------------------------------------------------------------- */
/* Los documentos                                                             */
/* -------------------------------------------------------------------------- */

export type CampoUrl =
  | "foto_url"
  | "cedula_frente_url"
  | "cedula_dorso_url"
  | "secundario_doc_url"
  | "tecnico_doc_url"
  | "licenciatura_doc_url"
  | "posgrado_doc_url";

export type CampoArchivo =
  | "cv_archivo"
  | "certificado_no_agresor_archivo"
  | "antecedente_judicial_archivo"
  | "antecedente_policial_archivo";

type ConEstudios = {
  secundario_estado: string;
  tecnico_estado: string;
  licenciatura_estado: string;
  posgrado_estado: string;
};

/**
 * Los de Cloudinary. `corresponde`: si se le pide (el título técnico solo si
 * el técnico está concluido o en curso, por ejemplo); los que no corresponden
 * y están vacíos no cuentan como faltantes.
 */
export const DOCS_CLOUDINARY: {
  campo: CampoUrl;
  nombre: string;
  archivo: string;
  corresponde: (p: ConEstudios) => boolean;
}[] = [
  { campo: "foto_url", nombre: "Foto carnet", archivo: "foto", corresponde: () => true },
  {
    campo: "cedula_frente_url",
    nombre: "Cédula (frente)",
    archivo: "cedula-frente",
    corresponde: () => true,
  },
  {
    campo: "cedula_dorso_url",
    nombre: "Cédula (dorso)",
    archivo: "cedula-dorso",
    corresponde: () => true,
  },
  {
    campo: "secundario_doc_url",
    nombre: "Título de bachiller",
    archivo: "titulo-bachiller",
    corresponde: (p) => p.secundario_estado === "CONCLUIDO",
  },
  {
    campo: "tecnico_doc_url",
    nombre: "Técnico superior",
    archivo: "tecnico",
    corresponde: (p) => estudia(p.tecnico_estado),
  },
  {
    campo: "licenciatura_doc_url",
    nombre: "Licenciatura",
    archivo: "licenciatura",
    corresponde: (p) => estudia(p.licenciatura_estado),
  },
  {
    campo: "posgrado_doc_url",
    nombre: "Posgrado",
    archivo: "posgrado",
    corresponde: (p) => estudia(p.posgrado_estado),
  },
];

export const DOCS_ONEDRIVE: { campo: CampoArchivo; nombre: string }[] = [
  { campo: "cv_archivo", nombre: "Currículum" },
  { campo: "certificado_no_agresor_archivo", nombre: "Certificado de no agresor" },
  { campo: "antecedente_judicial_archivo", nombre: "Antecedente judicial" },
  { campo: "antecedente_policial_archivo", nombre: "Antecedente policial" },
];

/** Cuántos documentos tiene de los que le corresponden. */
export function documentos(p: ConEstudios & Record<CampoUrl | CampoArchivo, string>) {
  const cloud = DOCS_CLOUDINARY.filter((d) => d.corresponde(p) || p[d.campo]);
  const tiene =
    cloud.filter((d) => p[d.campo]).length + DOCS_ONEDRIVE.filter((d) => p[d.campo]).length;
  return { tiene, esperados: cloud.length + DOCS_ONEDRIVE.length };
}

/** "4512330-cedula-frente.jpg". */
export const nombreDescarga = (cedula: string, archivo: string, ext: string) =>
  `${cedula.replace(/\D/g, "") || "postulante"}-${archivo}.${ext}`;

/** Un enlace que se puede abrir (OneDrive); una ruta de carpeta no. */
export const esEnlace = (s: string) => /^https?:\/\//i.test(s.trim());

/* -------------------------------------------------------------------------- */
/* El listado                                                                 */
/* -------------------------------------------------------------------------- */

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export type AnioPostulantes = { idAnio: number; anio: number; vigente: boolean; cantidad: number };

export type ResumenPostulante = ConEstudios &
  Record<CampoUrl | CampoArchivo, string> & {
    id: number;
    fecha_registro: string;
    nombre_completo: string;
    cedula: string;
    telefono: string;
    correo_electronico: string;
    edad: number | null;
    estado: Estado;
    fecha_revision: string;
    observacion_admin: string;
    id_facilitador: number | null;
    facilitador: string;
    usuario: string;
    ciudad: string;
    departamento: string;
    turno: string;
    dias_disponibles: string;
  };

const CAMPOS_RESUMEN_TEXTO = [
  "fecha_registro",
  "nombre_completo",
  "cedula",
  "telefono",
  "correo_electronico",
  "fecha_revision",
  "observacion_admin",
  "facilitador",
  "usuario",
  "ciudad",
  "departamento",
  "turno",
  "dias_disponibles",
  "secundario_estado",
  "tecnico_estado",
  "licenciatura_estado",
  "posgrado_estado",
  ...DOCS_CLOUDINARY.map((d) => d.campo),
  ...DOCS_ONEDRIVE.map((d) => d.campo),
] as const;

export async function listarPostulantes(idAnio: number | null): Promise<{
  idAnio: number | null;
  anios: AnioPostulantes[];
  postulantes: ResumenPostulante[];
}> {
  const r = (await authFetch(`revision-postulantes${idAnio ? `?id_anio=${idAnio}` : ""}`)) as {
    id_anio?: number;
    anios?: Record<string, unknown>[];
    data?: Record<string, unknown>[];
  };
  return {
    idAnio: n(r.id_anio),
    anios: (r.anios ?? []).map((a) => ({
      idAnio: Number(a.id_anio),
      anio: Number(a.anio),
      vigente: a.es_vigente === "S",
      cantidad: Number(a.cantidad ?? 0),
    })),
    postulantes: (r.data ?? []).map((x) => {
      const fila = Object.fromEntries(CAMPOS_RESUMEN_TEXTO.map((k) => [k, s(x[k])]));
      return {
        ...(fila as Record<(typeof CAMPOS_RESUMEN_TEXTO)[number], string>),
        id: Number(x.id),
        edad: n(x.edad),
        estado: estadoDe(s(x.estado)).valor,
        id_facilitador: n(x.id_facilitador),
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* La ficha                                                                   */
/* -------------------------------------------------------------------------- */

/** Los campos de texto editables, con el nombre de la columna. */
export const CAMPOS_TEXTO = [
  "correo_electronico",
  "direccion",
  "ubicacion_domicilio",
  "nombre_completo",
  "cedula",
  "fecha_nacimiento",
  "edad",
  "estado_civil",
  "estado_civil_otro",
  "vive_con",
  "hijos",
  "nacionalidad",
  "telefono",
  "talle_remera",
  "secundario_estado",
  "secundario_titulo",
  "tecnico_estado",
  "tecnico_titulo",
  "tecnico_anio",
  "licenciatura_estado",
  "licenciatura_titulo",
  "licenciatura_anio",
  "posgrado_estado",
  "posgrado_titulo",
  "posgrado_anio",
  "actividad_laboral",
  "empresa",
  "cargo",
  "movilidad_propia",
  "tipo_vehiculo",
  "computadora_propia",
  "internet_estable",
  "manejo_office",
  "dias_disponibles",
  "turno",
  "iglesia_denominacion",
  "iglesia_nombre",
  "pastor_nombre",
  "pastor_telefono",
  "lider_nombre",
  "lider_telefono",
  "bautizado_agua",
  "areas_ministerio",
  "banco_nombre",
  "banco_sucursal",
  "titular_nombre",
  "titular_ci",
  "tipo_cuenta",
  "numero_cuenta",
  "factura_tipo",
  "factura_emisor",
  "ruc",
  ...DOCS_CLOUDINARY.map((d) => d.campo),
  ...DOCS_ONEDRIVE.map((d) => d.campo),
] as const;

export type CampoTexto = (typeof CAMPOS_TEXTO)[number];

export type Ficha = Record<CampoTexto, string> & {
  id_anio: number;
  id_ciudad: number | null;
  id_facilitador: number | null;
};

/** Lo que se muestra y no se edita. */
export type Postulante = {
  ficha: Ficha;
  id: number;
  anio: number;
  fecha_registro: string;
  acepta_proceso: string;
  usuario: string;
  ciudad: string;
  departamento: string;
  facilitador: string;
  estado: Estado;
  observacion_admin: string;
  fecha_revision: string;
};

export async function obtenerPostulante(id: number): Promise<Postulante> {
  const r = (await authFetch(`revision-postulantes/${id}`)) as { data?: Record<string, unknown> };
  const x = r.data ?? {};
  const ficha = Object.fromEntries(CAMPOS_TEXTO.map((k) => [k, s(x[k])])) as Record<
    CampoTexto,
    string
  >;
  return {
    ficha: {
      ...ficha,
      id_anio: Number(x.id_anio),
      id_ciudad: n(x.id_ciudad),
      id_facilitador: n(x.id_facilitador),
    },
    id: Number(x.id),
    anio: Number(x.anio),
    fecha_registro: s(x.fecha_registro),
    acepta_proceso: s(x.acepta_proceso),
    usuario: s(x.usuario),
    ciudad: s(x.ciudad),
    departamento: s(x.departamento),
    facilitador: s(x.facilitador),
    estado: estadoDe(s(x.estado)).valor,
    observacion_admin: s(x.observacion_admin),
    fecha_revision: s(x.fecha_revision),
  };
}

/**
 * Guarda la ficha. El cuerpo va CRUDO (el backend lo lee con `:body_text`):
 * `areas_ministerio` es CLOB. Todo como texto. Devuelve el aviso de Cloudinary
 * si algún archivo viejo no se pudo borrar.
 */
export async function guardarPostulante(id: number, f: Ficha): Promise<{ aviso: string }> {
  const cuerpo: Record<string, string> = Object.fromEntries(
    CAMPOS_TEXTO.map((k) => [k, f[k].trim()]),
  );
  cuerpo.id_anio = String(f.id_anio);
  cuerpo.id_ciudad = f.id_ciudad == null ? "" : String(f.id_ciudad);
  cuerpo.id_facilitador = f.id_facilitador == null ? "" : String(f.id_facilitador);
  const r = (await authFetch(`revision-postulantes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  })) as { aviso?: string };
  return { aviso: s(r.aviso) };
}

/**
 * Aprobar, rechazar (con motivo) o volver a pendiente. Al aprobar, el trigger
 * de la tabla pasa al postulante a Facilitadores: devuelve a quién.
 */
export async function revisarPostulante(
  id: number,
  estado: Estado,
  observacion: string,
): Promise<{ facilitador: string }> {
  const r = (await authFetch(`revision-postulantes/${id}/estado`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ estado, observacion: observacion.trim() }),
  })) as { facilitador?: string };
  return { facilitador: s(r.facilitador) };
}

/** Borra la postulación y sus archivos de Cloudinary. */
export async function eliminarPostulante(id: number): Promise<{ aviso: string }> {
  const r = (await authFetch(`revision-postulantes/${id}`, { method: "DELETE" })) as {
    aviso?: string;
  };
  return { aviso: s(r.aviso) };
}

/** Sube una foto o un PDF a Cloudinary, como las facturas. Devuelve el enlace. */
export const subirArchivoPostulante = (archivo: File, onProgreso?: (p: number) => void) =>
  subirACloudinary(archivo, "revision-postulantes/firma", {
    // Un título escaneado pesa más que una factura electrónica. 10 MB es el
    // tope de Cloudinary en el plan gratuito.
    topePdfMb: 10,
    queEs: "un documento",
    onProgreso,
  });

/**
 * Las consultas de Postulantes NO se guardan en el navegador (`query-persist`):
 * traen cédulas, cuentas bancarias y datos personales, y la caché persistida
 * queda en `localStorage`. Igual que Pagos y Auditoría.
 */
export const META_POSTULANTES = { persistir: false } as const;

export const keysPostulantes = {
  todo: ["postulantes"] as const,
  lista: (idAnio: number | null) => ["postulantes", "lista", idAnio] as const,
  ficha: (id: number) => ["postulantes", "ficha", id] as const,
};
