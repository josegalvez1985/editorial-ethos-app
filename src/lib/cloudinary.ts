/**
 * Subir, mostrar y descargar archivos de Cloudinary. Salió de
 * `lib/facturas-facilitadores.ts` el 24/11/2026, cuando Postulantes también
 * necesitó subir fotos y PDF: el backend de cada módulo firma (con su permiso
 * y su preset) y acá está el resto. Ver `backend/cloudinary.sql`.
 */

import { authFetch } from "@/lib/api";
import { descargarBlob } from "@/lib/excel";

/**
 * El tope de una FOTO ya achicada (04/11/2026; antes 10 MB para todo, el
 * máximo de Cloudinary en el plan gratuito, y después 3 MB). `achicarFoto` la
 * deja por debajo: lo normal es 250–500 KB.
 */
export const TOPE_FOTO_KB = 600;

/**
 * Lo más grande que se acepta ELEGIR antes de achicar: una foto de celular
 * anda por 3–12 MB. Más que esto no es una foto, y decodificarla en el celular
 * puede quedarse sin memoria.
 */
const TOPE_ORIGINAL_MB = 40;

/**
 * Los intentos para que la foto entre en `TOPE_FOTO_KB`: [lado largo en px,
 * calidad JPEG]. Se usa el PRIMERO que entra, o sea el más nítido posible.
 * 2000 px en una hoja A4 son ~240 ppp; 1400 px, ~170 ppp, que todavía se lee
 * bien, timbrado incluido.
 */
const INTENTOS: [lado: number, calidad: number][] = [
  [2000, 0.85],
  [2000, 0.75],
  [1600, 0.75],
  [1400, 0.7],
  [1200, 0.65],
];

/** Lo que se acepta: una foto o un PDF. */
export const TIPOS_ARCHIVO = "image/*,application/pdf";

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
  const nombre = `${archivo.name.replace(/\.[^.]+$/, "") || "archivo"}.jpg`;
  return new File([mejor], nombre, { type: "image/jpeg" });
}

type Firma = { upload_url: string; campos: Record<string, string> };

/**
 * Sube una foto o un PDF a Cloudinary y devuelve su `secure_url`.
 *
 * El preset es Signed: primero se pide la firma al backend del módulo
 * (`rutaFirma`, un POST que controla sesión y permiso y guarda el secreto),
 * después el archivo va **directo** del navegador a Cloudinary con esos
 * campos. Con XHR y no `fetch` para tener el progreso, que en el celular con
 * una foto grande se nota.
 *
 * Una foto se achica antes (`achicarFoto`): lo que se guarda es esa versión,
 * no el original. Los PDF suben como están, hasta `topePdfMb`.
 *
 * Lo subido queda en Cloudinary aunque después no se guarde el registro.
 */
export async function subirACloudinary(
  elegido: File,
  rutaFirma: string,
  opciones: {
    topePdfMb: number;
    /** Para el error de "demasiado grande": "una foto de factura". */
    queEs: string;
    onProgreso?: (porcentaje: number) => void;
  },
): Promise<string> {
  if (elegido.size > TOPE_ORIGINAL_MB * 1024 * 1024) {
    throw new Error(`El archivo pasa de ${TOPE_ORIGINAL_MB} MB: no parece ${opciones.queEs}`);
  }
  const archivo = await achicarFoto(elegido);
  if (archivo.type === "application/pdf") {
    if (archivo.size > opciones.topePdfMb * 1024 * 1024) {
      throw new Error(`El PDF pasa de ${opciones.topePdfMb} MB`);
    }
  } else if (archivo.size > TOPE_FOTO_KB * 1024) {
    throw new Error(
      `La foto pasa de ${TOPE_FOTO_KB} KB y no se pudo achicar (¿es HEIC?): sacale una foto con la cámara o elegí un JPG`,
    );
  }
  const firma = (await authFetch(rutaFirma, { method: "POST" })) as Partial<Firma>;
  if (!firma.upload_url || !firma.campos) {
    throw new Error("El backend no devolvió la firma para subir el archivo");
  }

  const form = new FormData();
  form.append("file", archivo);
  for (const [k, v] of Object.entries(firma.campos)) form.append(k, String(v));

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", firma.upload_url!);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opciones.onProgreso?.(Math.round((e.loaded / e.total) * 100));
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

/** Si el enlace es de un PDF. */
export const esPdf = (url: string) => /\.pdf(\?|$)/i.test(url);

/** La extensión del archivo del enlace ("jpg", "pdf"…), o `jpg`. */
export const extension = (url: string) =>
  /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";

/**
 * Descarga el archivo con `nombre`. Lo baja como blob (Cloudinary responde con
 * CORS abierto) para poder ponerle el nombre; si eso falla, abre el enlace con
 * `fl_attachment`, que hace que Cloudinary lo mande como descarga con ese mismo
 * nombre. En el APK la WebView puede no descargar, igual que con los Excel.
 *
 * `deQue`: para los errores ("de la factura").
 */
export async function descargarDeCloudinary(
  url: string,
  nombre: string,
  deQue: string,
): Promise<void> {
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
  if (r.status === 404) throw new Error(`El archivo ${deQue} ya no está en Cloudinary.`);
  if (!r.ok) throw new Error(`Cloudinary respondió ${r.status} al descargar el archivo ${deQue}.`);
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
