/**
 * Arma el bundle OTA y su manifiesto a partir de un build web ya hecho.
 *
 * Uso:  node scripts/build-ota.mjs [--dist dist/client] [--version 1.8.3]
 * Doc:  OTA.md
 *
 * Produce, dentro de `<dist>/ota/`:
 *
 *   bundle-<version>.zip   El contenido web que el APK va a descargar.
 *   updates.json           Lo que el plugin consulta para saber si hay algo nuevo.
 *
 * Los dos se publican junto al sitio, así que el mismo deploy que actualiza la
 * web actualiza el APK. No hay un segundo servidor que mantener.
 *
 * ── POR QUÉ ESTE SCRIPT Y NO EL CLI DE CAPGO ─────────────────────────────────
 *
 * El CLI oficial (`npx @capgo/cli bundle upload`) sube a Capgo Cloud, que es el
 * servicio de pago. Para self-hosted lo único que hace falta es un .zip y un JSON
 * con la forma que el plugin espera; eso es este archivo, sin cuenta ni
 * dependencia nueva.
 *
 * Se usa `node:zlib` + un writer de ZIP mínimo (~80 líneas, abajo) en vez de una
 * librería: el formato ZIP que necesitamos es el caso más simple posible —deflate
 * sin cifrado ni ZIP64— y meter una dependencia para esto pesa más que escribirlo.
 */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ── Argumentos ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const leer = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : porDefecto;
};

const dist = leer("dist", "dist/client");

/**
 * La versión del bundle. **Es la identidad del update**, no un número decorativo.
 *
 * El plugin compara por DESIGUALDAD contra la que tiene instalada, no por orden:
 * si difiere, actualiza. Eso lo hace apto para un hash de commit, pero también
 * significa que repetir una versión ya entregada deja a los teléfonos sin
 * actualizar, en silencio.
 *
 * Por defecto la calcula el workflow con el SHA del commit, que es único por
 * definición. Ver `.github/workflows/deploy.yml`.
 */
const version = leer("version", `dev-${Date.now()}`);

// ── ZIP mínimo ───────────────────────────────────────────────────────────────
//
// Formato: cabecera local por archivo + central directory + EOCD. Deflate crudo,
// sin ZIP64 (el bundle son ~2 MB y el límite es 4 GB) y sin data descriptors.

const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function armarZip(entradas) {
  const locales = [];
  const central = [];
  let offset = 0;

  for (const { ruta, datos } of entradas) {
    // Barras normales SIEMPRE: en Windows `path.join` deja "\", y un ZIP con
    // backslashes descomprime en Android como un solo archivo con el nombre
    // literal "assets\app.js" en vez de una carpeta. Se ve recién en el teléfono.
    const nombre = Buffer.from(ruta.split(sep).join("/"), "utf8");
    const comprimido = deflateRawSync(datos, { level: 9 });
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // firma
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // método: deflate
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // fecha (1980-01-01: build reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locales.push(local, nombre, comprimido);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // versión que lo creó
    cen.writeUInt16LE(20, 6); // versión necesaria
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comprimido.length, 20);
    cen.writeUInt32LE(datos.length, 24);
    cen.writeUInt16LE(nombre.length, 28);
    cen.writeUInt16LE(0, 30); // extra
    cen.writeUInt16LE(0, 32); // comentario
    cen.writeUInt16LE(0, 34); // disco
    cen.writeUInt16LE(0, 36); // atributos internos
    cen.writeUInt32LE(0, 38); // atributos externos
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nombre);

    offset += local.length + nombre.length + comprimido.length;
  }

  const cuerpoCentral = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cuerpoCentral.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locales, cuerpoCentral, eocd]);
}

// ── Recolectar los archivos ──────────────────────────────────────────────────

/**
 * Lo que NO va adentro del bundle OTA.
 *
 * `ota/` se excluye para que un bundle no se empaquete dentro del siguiente y
 * el tamaño crezca en cada deploy. Es el mismo problema que ya tuvo el APK con
 * `public/app.apk` (ver el comentario en `scripts/build-apk.ps1`).
 *
 * `CNAME` y `.nojekyll` son de GitHub Pages: no significan nada dentro de una
 * WebView y solo ocupan lugar.
 */
const EXCLUIR = new Set(["ota", "CNAME", ".nojekyll", "404.html", "_shell.html"]);

function recolectar(base, actual = base) {
  const salida = [];
  for (const entrada of readdirSync(actual)) {
    const completo = join(actual, entrada);
    const rel = relative(base, completo);
    if (EXCLUIR.has(rel.split(sep)[0])) continue;

    if (statSync(completo).isDirectory()) {
      salida.push(...recolectar(base, completo));
    } else {
      salida.push({ ruta: rel, datos: readFileSync(completo) });
    }
  }
  return salida;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const entradas = recolectar(dist).sort((a, b) => a.ruta.localeCompare(b.ruta));

if (!entradas.length) {
  console.error(`ERROR: no hay archivos en ${dist}. ¿Corriste el build primero?`);
  process.exit(1);
}

/*
 * El index.html es lo que la WebView abre. Si no está, el bundle se descarga
 * bien, se aplica, y la app queda en blanco — un fallo que solo se ve en el
 * teléfono y que el rollback tarda 10 s en deshacer.
 *
 * En este proyecto lo produce el paso de deploy copiando `_shell.html`, así que
 * es un orden que se puede romper al editar el workflow. Mejor cortar acá.
 */
if (!entradas.some((e) => e.ruta === "index.html")) {
  console.error(`ERROR: ${dist} no tiene index.html — el bundle dejaría la app en blanco.`);
  console.error("       Se genera copiando _shell.html; ver el workflow o build-apk.ps1.");
  process.exit(1);
}

const zip = armarZip(entradas);

/*
 * El checksum viaja en el manifiesto y el plugin lo verifica contra el .zip que
 * bajó. No es una firma —no prueba QUIÉN lo hizo— pero sí detecta una descarga
 * corrupta o truncada, que es lo que pasa cuando se corta la conexión a mitad.
 *
 * SHA-256: es lo que el plugin espera cuando no hay cifrado de por medio (el
 * CRC32 que aceptaba antes está marcado como deprecado en el código nativo).
 */
const checksum = createHash("sha256").update(zip).digest("hex");

const salidaDir = join(dist, "ota");
mkdirSync(salidaDir, { recursive: true });

/*
 * El nombre lleva la versión, así que cada deploy publica un archivo distinto.
 *
 * CONSECUENCIA CONOCIDA: GitHub Pages republica el sitio entero en cada deploy,
 * así que los .zip anteriores DESAPARECEN. Un teléfono que justo estaba bajando
 * el bundle viejo recibe un 404 a mitad de camino.
 *
 * No es un problema real y por eso no se mitiga: el plugin marca esa descarga
 * como fallida, la reintenta en el arranque siguiente y para entonces ya lee el
 * manifiesto nuevo, que apunta a un .zip que sí existe. El usuario no ve nada; a
 * lo sumo la actualización llega un arranque más tarde.
 *
 * Lo que SÍ sería un problema es reusar un nombre fijo (`bundle.zip`): un
 * teléfono podría quedarse con un .zip a medias que ya no coincide con el
 * checksum del manifiesto, y ahí el reintento fallaría siempre igual.
 */
const nombreZip = `bundle-${version}.zip`;
writeFileSync(join(salidaDir, nombreZip), zip);

/*
 * La URL del .zip tiene que ser ABSOLUTA: la resuelve el cliente nativo, que no
 * tiene una página desde la cual completar una ruta relativa. El plugin rechaza
 * la respuesta si no parsea como URL válida.
 */
const sitio = (leer("site", "https://www.ethospy.online") || "").replace(/\/+$/, "");

const manifiesto = {
  version,
  url: `${sitio}/ota/${nombreZip}`,
  checksum,
};

writeFileSync(join(salidaDir, "updates.json"), JSON.stringify(manifiesto, null, 2) + "\n");

const mb = (zip.length / 1024 / 1024).toFixed(2);
console.log(`OTA listo: ${entradas.length} archivos, ${mb} MB`);
console.log(`  versión:  ${version}`);
console.log(`  zip:      ${join(salidaDir, nombreZip)}`);
console.log(`  manifest: ${join(salidaDir, "updates.json")}`);
console.log(`  url:      ${manifiesto.url}`);
