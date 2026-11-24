/**
 * Las facturas de los facilitadores (`FACTURAS_FACILITADORES`). Contrato del
 * backend: `backend/facturas_facilitadores.sql`; la subida de la foto,
 * `backend/cloudinary.sql`.
 *
 * No es una página: es el diálogo de Totales por Facilitador
 * (`/totales-facilitador`, la 55) y usa sus permisos.
 *
 * Una factura = un facilitador en un período. `cantidad` y `sueldo` son los del
 * reporte al facturar y `monto` lo calcula el backend: si después se corrige
 * una marcación, la factura queda como se pagó.
 */

import { authFetch } from "@/lib/api";
import {
  descargarDeCloudinary,
  extension,
  subirACloudinary,
  TIPOS_ARCHIVO,
} from "@/lib/cloudinary";

export type Factura = {
  id: number;
  idFacilitador: number;
  facilitador: string;
  /** Siempre `001-001-0000123`: el backend lo normaliza. */
  nroFactura: string;
  timbrado: string;
  /** `YYYY-MM-DD`. */
  fechaFactura: string;
  fechaDesde: string;
  fechaHasta: string;
  cantidad: number;
  sueldo: number;
  monto: number;
  observacion: string;
  /** Enlace de Cloudinary a la foto o el PDF, o `""`. */
  fotoUrl: string;
  /** `YYYY-MM-DDTHH:MI`, hora de Paraguay. */
  cargadoEl: string;
  cargadoPor: string;
  modificadoEl: string;
  modificadoPor: string;
};

export type ListaFacturas = {
  facturas: Factura[];
  /** Si Cloudinary está configurado en Oracle. Sin eso no se ofrece subir fotos. */
  fotosHabilitadas: boolean;
  largoObservacion: number;
};

export type DatosFactura = {
  id_facilitador: number;
  nro_factura: string;
  timbrado: string;
  fecha_factura: string;
  fecha_desde: string;
  fecha_hasta: string;
  cantidad: number;
  sueldo: number;
  observacion: string;
  /** `""` no la cambia; para sacarla va `quitar_foto`. */
  foto_url: string;
  quitar_foto?: "S";
};

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Las facturas cuyo período toca `[desde, hasta]` (todas, sin rango). Con
 * `idFacilitador`, solo las de ese facilitador.
 */
export async function listarFacturas(filtro: {
  desde?: string;
  hasta?: string;
  idFacilitador?: number;
}): Promise<ListaFacturas> {
  const q = new URLSearchParams();
  if (filtro.desde) q.set("desde", filtro.desde);
  if (filtro.hasta) q.set("hasta", filtro.hasta);
  if (filtro.idFacilitador) q.set("id_facilitador", String(filtro.idFacilitador));
  const r = (await authFetch(`facturas-facilitadores?${q}`)) as {
    data?: Record<string, unknown>[];
    fotos_habilitadas?: boolean;
    largo_observacion?: number;
  };
  return {
    fotosHabilitadas: r.fotos_habilitadas === true,
    largoObservacion: n(r.largo_observacion) || 2000,
    facturas: (r.data ?? []).map((x) => ({
      id: n(x.id_factura),
      idFacilitador: n(x.id_facilitador),
      facilitador: s(x.facilitador),
      nroFactura: s(x.nro_factura),
      timbrado: s(x.timbrado),
      fechaFactura: s(x.fecha_factura),
      fechaDesde: s(x.fecha_desde),
      fechaHasta: s(x.fecha_hasta),
      cantidad: n(x.cantidad),
      sueldo: n(x.sueldo),
      monto: n(x.monto),
      observacion: s(x.observacion),
      fotoUrl: s(x.foto_url),
      cargadoEl: s(x.cargado_el),
      cargadoPor: s(x.cargado_por),
      modificadoEl: s(x.modificado_el),
      modificadoPor: s(x.modificado_por),
    })),
  };
}

/**
 * Alta (`id` null) o modificación. Devuelve el id. 409 si el número ya está
 * cargado para el facilitador o si el período se pisa con otra factura suya.
 *
 * Si se reemplazó o se quitó la foto, el backend borra la anterior de
 * Cloudinary después de guardar; `aviso` dice si eso falló (la factura quedó
 * guardada igual).
 */
export async function guardarFactura(
  id: number | null,
  d: DatosFactura,
): Promise<{ id: number; aviso: string }> {
  const r = (await authFetch(
    id == null ? "facturas-facilitadores" : `facturas-facilitadores/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    },
  )) as { id_factura?: number; aviso?: string };
  return { id: Number(r.id_factura ?? id ?? 0), aviso: s(r.aviso) };
}

/**
 * Borra la factura y, después, su foto de Cloudinary (04/11/2026). `aviso`
 * dice si el archivo no se pudo borrar: la factura se borró igual.
 *
 * Sin `Content-Type` ni cuerpo: con JSON vacío ORDS responde 400.
 */
export async function eliminarFactura(id: number): Promise<{ aviso: string }> {
  const r = (await authFetch(`facturas-facilitadores/${id}`, { method: "DELETE" })) as {
    aviso?: string;
  };
  return { aviso: s(r.aviso) };
}

/* -------------------------------------------------------------------------- */
/* La foto                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * La subida, la miniatura y la descarga son de `lib/cloudinary.ts` desde el
 * 24/11/2026 (las usa también Postulantes). Acá quedan los nombres de siempre.
 */
export { esPdf, miniatura, TOPE_FOTO_KB } from "@/lib/cloudinary";

/**
 * El tope de un PDF, que sube tal cual: el de una factura electrónica pesa
 * menos de 1 MB. Esto solo frena un escaneo de muchas páginas.
 */
export const TOPE_PDF_MB = 3;

/** Lo que se acepta: una foto o el PDF de la factura electrónica. */
export const TIPOS_FOTO = TIPOS_ARCHIVO;

/** Sube la foto o el PDF de la factura y devuelve su `secure_url`. */
export const subirFotoFactura = (elegido: File, onProgreso?: (porcentaje: number) => void) =>
  subirACloudinary(elegido, "facturas-facilitadores/firma-foto", {
    topePdfMb: TOPE_PDF_MB,
    queEs: "una foto de factura",
    onProgreso,
  });

/**
 * El nombre del archivo al descargarla: `<fecha>-<nro_factura>.<ext>`, p. ej.
 * `2026-10-31-001-001-0001234.pdf` (pedido el 04/11/2026). La fecha en
 * año-mes-día para que en una carpeta queden ordenadas. La extensión, la del
 * archivo en Cloudinary.
 */
export function nombreArchivoFactura(fecha: string, nroFactura: string, url: string): string {
  const base = [fecha, nroFactura].filter(Boolean).join("-") || "factura";
  return `${base.replace(/[^0-9A-Za-z_-]+/g, "-")}.${extension(url)}`;
}

/** Descarga la foto o el PDF de la factura con `nombre`. */
export const descargarArchivoFactura = (url: string, nombre: string) =>
  descargarDeCloudinary(url, nombre, "de la factura");

/* -------------------------------------------------------------------------- */
/* El número                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * El número con el formato `001-001-0000123`, o `null` si no se puede llevar
 * a él. La misma regla que `f_nro_factura` del backend: acepta los 13 dígitos
 * juntos o cada parte sin sus ceros de la izquierda (`1-1-123`).
 */
export function formatearNroFactura(texto: string): string | null {
  const v = texto.replace(/\s+/g, "");
  if (/^\d{13}$/.test(v)) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  const m = /^(\d{1,3})-(\d{1,3})-(\d{1,7})$/.exec(v);
  if (!m) return null;
  return `${m[1].padStart(3, "0")}-${m[2].padStart(3, "0")}-${m[3].padStart(7, "0")}`;
}

/**
 * Por revisar: la subió el facilitador desde su app (`facilitador-hub`,
 * `sql/facturas_app_ethos.sql`) con cantidad y sueldo en 0, y falta que el
 * administrador los complete. Guardarla desde acá la deja revisada: el backend
 * exige cantidad de 1 en adelante. Sin columna de estado (04/11/2026).
 */
export const porRevisar = (f: Pick<Factura, "cantidad">) => f.cantidad === 0;

/** Si dos períodos `YYYY-MM-DD` comparten al menos un día. */
export const sePisan = (a: { desde: string; hasta: string }, b: { desde: string; hasta: string }) =>
  a.desde <= b.hasta && a.hasta >= b.desde;

export const keysFacturas = {
  todo: ["facturas-facilitadores"] as const,
  /** Todas las cargadas, sin filtro de período. */
  todas: ["facturas-facilitadores", "todas"] as const,
  periodo: (desde: string, hasta: string) => ["facturas-facilitadores", desde, hasta] as const,
  /** Pagos a Facilitadores: bajo `todo`, así guardar o borrar una factura la refresca. */
  pagos: (desde: string, hasta: string) =>
    ["facturas-facilitadores", "pagos", desde, hasta] as const,
};

/* -------------------------------------------------------------------------- */
/* Pagos a Facilitadores (Tesorería)                                          */
/* -------------------------------------------------------------------------- */

/** La pantalla de Tesorería (04/11/2026). Su permiso de consultar lo pide el backend. */
export const RUTA_PAGOS = "/pagos-facilitadores";

/**
 * Las consultas de Pagos NO se guardan en el navegador (`query-persist`): traen
 * cuentas bancarias, y la caché persistida queda en `localStorage`. Igual que
 * Auditoría y los permisos.
 */
export const META_PAGOS = { persistir: false } as const;

/** Una factura con lo que Tesorería necesita para pagarla. */
export type PagoFactura = {
  id: number;
  idFacilitador: number;
  facilitador: string;
  nroCi: string;
  ruc: string;
  nombreEmisor: string;
  tipoFactura: string;
  telefono: string;
  email: string;
  nroFactura: string;
  timbrado: string;
  /** `YYYY-MM-DD`, como las demás fechas de este archivo. */
  fechaFactura: string;
  fechaDesde: string;
  fechaHasta: string;
  cantidad: number;
  sueldo: number;
  monto: number;
  observacion: string;
  fotoUrl: string;
  banco: string;
  sucursalBanco: string;
  titular: string;
  ciTitular: string;
  tipoCuenta: string;
  nroCuenta: string;
};

/**
 * Las facturas EMITIDAS entre `desde` y `hasta` (fecha de la factura, no el
 * período que cubren), con los datos bancarios del facilitador. 403 si el
 * usuario no tiene la página de Pagos para consultar.
 */
export async function listarPagos(desde: string, hasta: string): Promise<PagoFactura[]> {
  const q = new URLSearchParams({ desde, hasta });
  const r = (await authFetch(`facturas-facilitadores/pagos?${q}`)) as {
    data?: Record<string, unknown>[];
  };
  return (r.data ?? []).map((x) => ({
    id: n(x.id_factura),
    idFacilitador: n(x.id_facilitador),
    facilitador: s(x.facilitador),
    nroCi: s(x.nro_ci),
    ruc: s(x.ruc),
    nombreEmisor: s(x.nombre_emisor),
    tipoFactura: s(x.tipo_factura),
    telefono: s(x.telefono),
    email: s(x.email),
    nroFactura: s(x.nro_factura),
    timbrado: s(x.timbrado),
    fechaFactura: s(x.fecha_factura),
    fechaDesde: s(x.fecha_desde),
    fechaHasta: s(x.fecha_hasta),
    cantidad: n(x.cantidad),
    sueldo: n(x.sueldo),
    monto: n(x.monto),
    observacion: s(x.observacion),
    fotoUrl: s(x.foto_url),
    banco: s(x.nombre_banco),
    sucursalBanco: s(x.sucursal_banco),
    titular: s(x.titular_banco),
    ciTitular: s(x.nro_ci_titular_banco),
    tipoCuenta: s(x.tipo_cuenta),
    nroCuenta: s(x.nro_cuenta),
  }));
}
