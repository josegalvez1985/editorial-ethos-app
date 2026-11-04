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
import { descargarBlob } from "@/lib/excel";

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

/**
 * El tope de una FOTO ya achicada (04/11/2026; antes 10 MB para todo, el
 * máximo de Cloudinary en el plan gratuito, y después 3 MB). `achicarFoto` la
 * deja por debajo: lo normal es 250–500 KB.
 */
export const TOPE_FOTO_KB = 600;

/**
 * El tope de un PDF, que sube tal cual: el de una factura electrónica pesa
 * menos de 1 MB. Esto solo frena un escaneo de muchas páginas.
 */
export const TOPE_PDF_MB = 3;

/**
 * Lo más grande que se acepta ELEGIR antes de achicar: una foto de celular
 * anda por 3–12 MB. Más que esto no es una foto de factura, y decodificarla
 * en el celular puede quedarse sin memoria.
 */
const TOPE_ORIGINAL_MB = 40;

/**
 * Los intentos para que la foto entre en `TOPE_FOTO_KB`: [lado largo en px,
 * calidad JPEG]. Se usa el PRIMERO que entra, o sea el más nítido posible.
 * 2000 px en una factura A4 son ~240 ppp; 1400 px, ~170 ppp, que todavía se
 * lee bien, timbrado incluido. Una foto de factura suele entrar en el primero.
 */
const INTENTOS: [lado: number, calidad: number][] = [
  [2000, 0.85],
  [2000, 0.75],
  [1600, 0.75],
  [1400, 0.7],
  [1200, 0.65],
];

/**
 * Achica una foto en el navegador antes de subirla, para que no pase de
 * `TOPE_FOTO_KB` sin perder nitidez: prueba `INTENTOS` en orden y se queda con
 * el primero que entra (si ninguno entra, el más liviano). La pasa a JPEG,
 * girada según su EXIF y con fondo blanco (un PNG transparente no queda negro).
 *
 * Devuelve el ORIGINAL sin tocar si no es una foto (PDF), si el navegador no
 * la puede leer (p. ej. HEIC en Chrome) o si ya era más liviana que lo que se
 * logra: nunca empeora lo que ya era chico.
 */
async function achicarFoto(archivo: File): Promise<File> {
  if (!archivo.type.startsWith("image/") || /gif|svg/.test(archivo.type)) return archivo;
  if (archivo.size <= TOPE_FOTO_KB * 1024 && archivo.type === "image/jpeg") return archivo;
  if (typeof createImageBitmap === "undefined") return archivo;

  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    return archivo;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bmp.close();
    return archivo;
  }

  let mejor: Blob | null = null;
  try {
    for (const [lado, calidad] of INTENTOS) {
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const ancho = Math.max(1, Math.round(bmp.width * escala));
      const alto = Math.max(1, Math.round(bmp.height * escala));
      if (canvas.width !== ancho || canvas.height !== alto) {
        canvas.width = ancho;
        canvas.height = alto;
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, ancho, alto);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, ancho, alto);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", calidad));
      if (blob && (!mejor || blob.size < mejor.size)) mejor = blob;
      if (blob && blob.size <= TOPE_FOTO_KB * 1024) break;
    }
  } finally {
    bmp.close();
  }

  if (!mejor || mejor.size >= archivo.size) return archivo;
  const nombre = `${archivo.name.replace(/\.[^.]+$/, "") || "factura"}.jpg`;
  return new File([mejor], nombre, { type: "image/jpeg" });
}

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
 * Una foto se achica antes (`achicarFoto`): lo que se guarda es esa versión,
 * no el original. Los PDF suben como están.
 *
 * Lo subido queda en Cloudinary aunque después no se guarde la factura.
 */
export async function subirFotoFactura(
  elegido: File,
  onProgreso?: (porcentaje: number) => void,
): Promise<string> {
  if (elegido.size > TOPE_ORIGINAL_MB * 1024 * 1024) {
    throw new Error(`El archivo pasa de ${TOPE_ORIGINAL_MB} MB: no parece una foto de factura`);
  }
  const archivo = await achicarFoto(elegido);
  if (archivo.type === "application/pdf") {
    if (archivo.size > TOPE_PDF_MB * 1024 * 1024) {
      throw new Error(`El PDF pasa de ${TOPE_PDF_MB} MB`);
    }
  } else if (archivo.size > TOPE_FOTO_KB * 1024) {
    throw new Error(
      `La foto pasa de ${TOPE_FOTO_KB} KB y no se pudo achicar (¿es HEIC?): sacale una foto con la cámara o elegí un JPG`,
    );
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
 * El nombre del archivo al descargarla: `<fecha>-<nro_factura>.<ext>`, p. ej.
 * `2026-10-31-001-001-0001234.pdf` (pedido el 04/11/2026). La fecha en
 * año-mes-día para que en una carpeta queden ordenadas. La extensión, la del
 * archivo en Cloudinary.
 */
export function nombreArchivoFactura(fecha: string, nroFactura: string, url: string): string {
  const ext = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";
  const base = [fecha, nroFactura].filter(Boolean).join("-") || "factura";
  return `${base.replace(/[^0-9A-Za-z_-]+/g, "-")}.${ext}`;
}

/**
 * Descarga la foto o el PDF de la factura con `nombre`. Lo baja como blob
 * (Cloudinary responde con CORS abierto) para poder ponerle el nombre; si eso
 * falla, abre el enlace con `fl_attachment`, que hace que Cloudinary lo mande
 * como descarga con ese mismo nombre. En el APK la WebView puede no descargar,
 * igual que con los Excel.
 */
export async function descargarArchivoFactura(url: string, nombre: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(url);
  } catch {
    // Sin red hacia Cloudinary o el navegador bloqueó el fetch: que lo baje
    // Cloudinary directo, como adjunto y con el mismo nombre.
    const sinExt = nombre.replace(/\.[^.]+$/, "");
    window.open(url.replace("/upload/", `/upload/fl_attachment:${sinExt}/`), "_blank", "noopener");
    return;
  }
  // Cloudinary contestó que no: abrir el enlace mostraría la misma página de error.
  if (r.status === 404) throw new Error("El archivo de la factura ya no está en Cloudinary.");
  if (!r.ok) throw new Error(`Cloudinary respondió ${r.status} al descargar la factura.`);
  descargarBlob(await r.blob(), nombre);
}

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
