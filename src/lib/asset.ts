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
