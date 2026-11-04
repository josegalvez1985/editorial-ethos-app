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

/** La ruta de la página cuyos permisos usan las facturas. */
export const RUTA_FACTURAS = "/totales-facilitador";

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
 */
export async function guardarFactura(id: number | null, d: DatosFactura): Promise<number> {
  const r = (await authFetch(
    id == null ? "facturas-facilitadores" : `facturas-facilitadores/${id}`,
    {
      method: id == null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    },
  )) as { id_factura?: number };
  return Number(r.id_factura ?? id ?? 0);
}

/** Borra la factura. El archivo de Cloudinary queda: es la constancia. */
export async function eliminarFactura(id: number): Promise<void> {
  await authFetch(`facturas-facilitadores/${id}`, { method: "DELETE" });
}

/* -------------------------------------------------------------------------- */
/* La foto                                                                    */
/* -------------------------------------------------------------------------- */

/** El tope de Cloudinary para un archivo en el plan gratuito. */
export const TOPE_FOTO_MB = 10;

/** Lo que se acepta: una foto o el PDF de la factura electrónica. */
export const TIPOS_FOTO = "image/*,application/pdf";

type Firma = { upload_url: string; campos: Record<string, string> };

/**
 * Sube la foto o el PDF a Cloudinary y devuelve su `secure_url`.
 *
 * El preset es Signed: primero se pide la firma a Oracle (que controla sesión
 * y permiso, y guarda el secreto), después el archivo va **directo** del
 * navegador a Cloudinary con esos campos. Con XHR y no `fetch` para tener el
 * progreso, que en el celular con una foto grande se nota.
 *
 * Lo subido queda en Cloudinary aunque después no se guarde la factura.
 */
export async function subirFotoFactura(
  archivo: File,
  onProgreso?: (porcentaje: number) => void,
): Promise<string> {
  if (archivo.size > TOPE_FOTO_MB * 1024 * 1024) {
    throw new Error(`El archivo pasa de ${TOPE_FOTO_MB} MB`);
  }
  const firma = (await authFetch("facturas-facilitadores/firma-foto", {
    method: "POST",
  })) as Partial<Firma>;
  if (!firma.upload_url || !firma.campos) {
    throw new Error("El backend no devolvió la firma para subir la foto");
  }

  const form = new FormData();
  form.append("file", archivo);
  for (const [k, v] of Object.entries(firma.campos)) form.append(k, String(v));

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", firma.upload_url!);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgreso?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("No se pudo conectar con Cloudinary"));
    xhr.onload = () => {
      let r: { secure_url?: string; error?: { message?: string } } = {};
      try {
        r = JSON.parse(xhr.responseText);
      } catch {
        /* sin JSON: cae al error genérico */
      }
      if (xhr.status >= 200 && xhr.status < 300 && r.secure_url) resolve(r.secure_url);
      else reject(new Error(r.error?.message ?? `Cloudinary respondió ${xhr.status}`));
    };
    xhr.send(form);
  });
}

/** Si el enlace es de un PDF (la factura electrónica). */
export const esPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

/**
 * Una miniatura liviana del archivo, con una transformación de Cloudinary en
 * el mismo enlace: la foto achicada, o la primera página del PDF como imagen.
 * Si el enlace no es de Cloudinary, el original.
 */
export function miniatura(url: string, lado = 320): string {
  if (!url.includes("/upload/")) return url;
  const t = esPdf(url)
    ? `c_limit,w_${lado},h_${lado},pg_1,f_jpg,q_auto`
    : `c_limit,w_${lado},h_${lado},f_auto,q_auto`;
  const conTransformacion = url.replace("/upload/", `/upload/${t}/`);
  return esPdf(url) ? conTransformacion.replace(/\.pdf(\?|$)/i, ".jpg$1") : conTransformacion;
}

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
  periodo: (desde: string, hasta: string) => ["facturas-facilitadores", desde, hasta] as const,
};
