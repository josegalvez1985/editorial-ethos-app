/**
 * Antepone la base del build a un archivo de `public/`.
 *
 * El sitio no siempre cuelga de la raíz del dominio: en GitHub Pages sin dominio
 * propio vive en `https://<usuario>.github.io/<repo>/`, así que un `/logo.png`
 * escrito a mano se va a `https://<usuario>.github.io/logo.png` y da 404.
 *
 * Vite reescribe solo las URLs que pasan por el bundler (imports, CSS); las
 * rutas absolutas del JSX hay que prefijarlas acá. `BASE_URL` es la `base` de
 * `vite.config.ts` y siempre termina en barra: vale `/` en dev, en el APK y con
 * dominio propio, y `/<repo>/` en el Pages de proyecto.
 */
export function asset(ruta: string): string {
  return `${import.meta.env.BASE_URL}${ruta.replace(/^\/+/, "")}`;
}

/**
 * Igual que `asset()`, pero con el origen del sitio adelante.
 *
 * Es para las URLs que **tienen** que ser absolutas: las meta tags de Open Graph.
 * WhatsApp, Facebook y X leen el HTML fuera de contexto —no hay una página desde
 * la cual resolver una ruta relativa—, así que un `/logo.png` en `og:image` no les
 * dice nada y la vista previa del link sale sin imagen. Es el motivo más común de
 * "comparto el link y no aparece el logo".
 *
 * El origen entra por `VITE_SITE_URL` en tiempo de build: lo calcula
 * `.github/workflows/deploy.yml` a partir de `CUSTOM_DOMAIN` (ver DESPLIEGUE.md).
 * Si falta —dev, o el build del APK, donde a nadie le importa el Open Graph— cae
 * en la ruta relativa: no rompe nada, solo se pierde la miniatura al compartir.
 */
export function assetAbsoluto(ruta: string): string {
  const origen = (import.meta.env.VITE_SITE_URL ?? "").replace(/\/+$/, "");
  return `${origen}${asset(ruta)}`;
}
