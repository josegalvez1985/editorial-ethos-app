import { createFileRoute } from "@tanstack/react-router";

/**
 * Proxy server-side hacia ORDS.
 *
 * El navegador llama a `/api/ords/...` (mismo origen) y el servidor reenvía a
 * Oracle. Por eso el front web NO necesita CORS. Además mantiene el token fuera
 * de la URL.
 *
 * La app Expo de `mobile/` no pasa por acá: pega directo a ORDS, que es válido
 * porque el `fetch` de React Native no aplica CORS.
 *
 * Esto exige un deploy CON servidor Node. Si algún día se sirve como sitio
 * estático, este archivo no corre y habría que habilitar CORS en ORDS.
 */

const ORDS_TARGET = process.env.ORDS_TARGET ?? "https://oracleapex.com";
const ORDS_PREFIX = process.env.ORDS_PREFIX ?? "/ords/fundcarac/ethos/";

/**
 * Resuelve el destino y comprueba que siga colgando de ORDS_PREFIX. `null` si se
 * sale, y ahí el handler corta con 404.
 *
 * POR QUÉ: antes el splat se concatenaba crudo a la URL. `fetch` resuelve los
 * `../`, así que un pedido a `/api/ords/../../_/db-api/stable/` no llegaba a
 * `/ords/fundcarac/ethos/...` sino a `/ords/_/db-api/` —la API de administración
 * SQL de ORDS— usando este proxy como pivote. El host nunca fue controlable
 * (no es SSRF), pero el prefijo es la ÚNICA frontera de autorización que tiene
 * este archivo, porque el `Authorization` se reenvía sin validarse.
 *
 * La normalización la hace `new URL()`, el mismo algoritmo que después aplica
 * `fetch`: comparar sobre el `pathname` ya resuelto evita que una codificación
 * rara pase el chequeo y después signifique otra cosa.
 */
function resolverDestino(splat: string, search: string): URL | null {
  // %2f y %5c son barras codificadas: ORDS las decodifica y volverían a abrir el
  // escape que este chequeo cierra. Se rechazan antes de resolver.
  if (/%2f|%5c/i.test(splat)) return null;

  const base = new URL(ORDS_PREFIX, ORDS_TARGET);
  let destino: URL;
  try {
    destino = new URL(splat + search, base);
  } catch {
    return null;
  }

  // El origin tiene que seguir siendo el mismo: `new URL("//evil.com/x", base)`
  // es una URL protocol-relative y cambia de host sin usar un solo `../`.
  if (destino.origin !== base.origin) return null;
  if (!destino.pathname.startsWith(ORDS_PREFIX)) return null;
  return destino;
}

async function forward(request: Request, splat: string): Promise<Response> {
  const incoming = new URL(request.url);
  const destino = resolverDestino(splat, incoming.search);
  if (!destino) {
    return new Response(JSON.stringify({ success: false, message: "Ruta no válida" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const target = destino.href;

  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("authorization", auth);
  headers.set("accept", "application/json");
  headers.set("user-agent", "Mozilla/5.0 (ethos-proxy)");

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // arrayBuffer y no text(): text() corrompe binarios.
    const body = await request.arrayBuffer();
    // Solo mandar body+content-type si hay payload: un DELETE con content-type
    // JSON y cuerpo vacío hace que ORDS responda 400 ("Expected {,[ but got EOF").
    if (body.byteLength > 0) {
      init.body = body;
      headers.set("content-type", request.headers.get("content-type") ?? "application/json");
    }
  }

  const res = await fetch(target, init);
  const contentType = res.headers.get("content-type") ?? "application/json";
  const body = await res.arrayBuffer();
  const outHeaders: Record<string, string> = { "content-type": contentType };
  const cacheControl = res.headers.get("cache-control");
  if (cacheControl) outHeaders["cache-control"] = cacheControl;
  return new Response(body, { status: res.status, headers: outHeaders });
}

// Los cuatro verbos declarados a propósito: si falta uno, ese método cae al SPA
// y falla en silencio con un 404 de HTML.
export const Route = createFileRoute("/api/ords/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => forward(request, params._splat ?? ""),
      POST: ({ request, params }) => forward(request, params._splat ?? ""),
      PUT: ({ request, params }) => forward(request, params._splat ?? ""),
      DELETE: ({ request, params }) => forward(request, params._splat ?? ""),
    },
  },
});
