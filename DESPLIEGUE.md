# Despliegue del sitio — GitHub Pages

El sitio se publica desde GitHub Pages con el workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), en cada push a `main`.

**El sitio vive en <https://www.ethospy.online/>**: el dominio **sirve** el sitio, no redirige a
otro lado, así que la URL que queda a la vista mientras se navega es siempre la del dominio. El
`github.io` sigue existiendo, pero responde un `301` hacia el dominio.
Ver [El dominio ethospy.online](#2-el-dominio-ethospyonline).

---

## Lo primero: el proxy NO corre

GitHub Pages sirve **archivos estáticos**. No hay Node, así que
[`src/routes/api/ords.$.ts`](src/routes/api/ords.$.ts) —el proxy que reenvía a Oracle— no se
ejecuta. El build estático lo saca del bundle y apunta `VITE_API_URL` **directo a ORDS**.

El README ya anticipaba esto: *"Si se sirviera como sitio estático, el proxy no correría y habría
que apuntar `VITE_API_URL` directo a ORDS y depender de los headers CORS."* Eso es exactamente lo
que pasa ahora, y tiene tres consecuencias que conviene tener presentes:

1. **El sitio depende del CORS abierto de ORDS.** Si algún día se cierra
   (`Access-Control-Allow-Origin`), el login deja de funcionar en la web. Ya eran dos los clientes
   que dependen de eso —el APK y ahora el sitio—, así que ese header pasó a ser parte del
   contrato, no un detalle.
2. **El token viaja del navegador a Oracle directamente**, sin pasar por un mismo origen. Antes el
   proxy lo mantenía fuera de la URL y del alcance de otros orígenes.
3. **La URL de ORDS es pública**: está embebida en el JS y cualquiera puede leerla. No es un
   secreto ni lo era antes, pero ahora está a la vista en el sitio.

Si esto no es aceptable, la alternativa es un hosting con Node (Vercel, Fly, un VPS) y volver al
build SSR por defecto. Ahí el proxy vuelve a correr y no hace falta nada de este archivo.

---

## Configuración en GitHub (una sola vez)

### 1. Habilitar Pages con origen "GitHub Actions"

**Settings → Pages → Build and deployment → Source: `GitHub Actions`.**

No elijas "Deploy from a branch": el workflow publica un artefacto, no una rama `gh-pages`.

### 2. El dominio ethospy.online

El sitio **se sirve en el dominio**. Eso es lo que hace que la URL a la vista sea
`www.ethospy.online/evaluaciones` y no la de `github.io`, en la primera carga y en toda la
navegación posterior.

**Un redirect no sirve para esto.** Un `301` cambia la barra de direcciones por definición: se
entra por el dominio y se termina en la URL de destino. La única forma de que el dominio se quede
es que GitHub Pages responda *en* ese dominio, y para eso el DNS tiene que apuntar a GitHub.

Son tres ajustes y **el orden importa** (ver el bucle más abajo):

1. **DNS**, en Hostinger (hPanel → Dominios → DNS): **borrar la redirección** y apuntar el dominio
   a GitHub Pages. Antes apuntaba a Hostinger (`ethospy.online` → `A 2.57.91.91`, `www` → `CNAME
   ethospy.online`):

   | Tipo | Nombre | Valor |
   | --- | --- | --- |
   | `CNAME` | `www` | `josegalvez1985.github.io` |
   | `A` | `@` | `185.199.108.153` |
   | `A` | `@` | `185.199.109.153` |
   | `A` | `@` | `185.199.110.153` |
   | `A` | `@` | `185.199.111.153` |

   Los cuatro registros `A` del apex son los que dejan que `ethospy.online` sin `www` funcione:
   Pages lo redirige solo hacia `www`, que es el dominio configurado.

   Verificalo antes de seguir —puede tardar desde minutos hasta unas horas en propagar:

   ```powershell
   curl.exe -s -o NUL -D - https://www.ethospy.online/
   #  Server: GitHub.com  → el DNS ya apunta a GitHub (un 404 acá es normal todavía).
   #  Server: hcdn        → sigue contestando Hostinger; la redirección no se borró o falta propagar.
   ```

2. **Build**: nada que configurar. El dominio es el valor por defecto en
   [`deploy.yml`](.github/workflows/deploy.yml), así que alcanza con un push a `main` (o Actions →
   *Desplegar a GitHub Pages* → **Run workflow**). Ese build hace dos cosas: compila con la base en
   `/` en vez de `/editorial-ethos-app/`, y escribe el `CNAME` en el artefacto.

   **Por qué el build necesita saber el dominio, si el `CNAME` ya se lo dice a Pages:** son dos
   cosas distintas. El `CNAME` define *dónde se sirve* el sitio; la base define con qué prefijo se
   **hornean** las rutas de los assets dentro del HTML y el JS, y eso pasa en tiempo de
   compilación. Un build hecho para `/editorial-ethos-app/` y servido en la raíz del dominio pide
   `https://www.ethospy.online/editorial-ethos-app/assets/…` y devuelve 404 en bloque: página en
   blanco.

3. **Settings → Pages**: el `CNAME` del artefacto deja el *Custom domain* puesto solo. Comprobá
   que diga `www.ethospy.online` y marcá **Enforce HTTPS** cuando se habilite (tarda unos minutos
   mientras GitHub emite el certificado; hasta entonces aparece en gris).

Para comprobar que quedó bien:

```powershell
curl.exe -s -o NUL -D - https://www.ethospy.online/evaluaciones
#  200 (Server: GitHub.com)  → listo, el dominio sirve el sitio.

curl.exe -s -o NUL -D - https://josegalvez1985.github.io/editorial-ethos-app/
#  301 → https://www.ethospy.online/  → correcto: ahora el github.io es el que redirige.
```

#### El bucle de redirecciones (por qué el paso 1 va primero)

Con dominio propio configurado, Pages responde `301` en `github.io` mandando al dominio. Si del
lado de Hostinger sigue viva la redirección que va en la dirección contraria, los dos se apuntan
entre sí y **no responde ninguna de las dos URLs**:

```
www.ethospy.online/loquesea
  → 301 (Server: hcdn — Hostinger)  →  https://josegalvez1985.github.io/editorial-ethos-app/…
  → 301 (Server: GitHub.com)        →  https://www.ethospy.online/…    ← porque Pages tiene dominio propio
  → 301 → ... sin fin
```

Ninguno de los dos lados solo alcanza para romperlo: hacen falta los dos apuntándose entre sí. Por
eso primero se saca el redirect de Hostinger y recién después se prende `CUSTOM_DOMAIN`.

#### Para volver al github.io

Tres cosas, y las tres hacen falta:

1. Vaciar el valor por defecto de `CUSTOM_DOMAIN` en [`deploy.yml`](.github/workflows/deploy.yml)
   (las dos apariciones). No alcanza con dejar la repository variable vacía: en las expresiones de
   Actions, `vars.X || 'default'` toma el default también cuando la variable existe pero está en
   blanco.
2. Borrar el `CNAME` de la raíz del repo y volver a pushear.
3. **Vaciar a mano el Custom domain** en Settings → Pages: que el artefacto deje de traer el
   `CNAME` no borra el dominio ya guardado.

### 3. Opcional: apuntar a otro ORDS

Si el backend se muda, **Settings → Secrets and variables → Actions → Variables → New variable**:

- Nombre: `VITE_API_URL`
- Valor: `https://oracleapex.com/ords/<otro>/ethos/`

El workflow la usa si existe, y si no cae en la de `fundcarac`. Es una *variable*, no un *secret*:
termina embebida en el JS público, así que no tiene sentido ocultarla.

---

## Qué hace el build (y por qué cada paso)

`STATIC_BUILD=1` en [`vite.config.ts`](vite.config.ts) apaga nitro y prende el modo SPA de
TanStack Start. Después el workflow hace tres cosas sobre `dist/client`:

| Paso | Por qué |
| --- | --- |
| `cp _shell.html index.html` | El prerender deja el shell con ese nombre; Pages sirve `index.html`. |
| `cp index.html 404.html` | Pages devuelve `404.html` en cualquier ruta que no exista como archivo. Siendo el mismo shell, el router resuelve `/evaluaciones`, `/account`, etc. del lado del cliente. **Sin esto, entrar directo a una URL que no sea `/` da el 404 de GitHub.** |
| `touch .nojekyll` | Jekyll ignora todo lo que empieza con `_`. Sin este archivo se come el shell. |

Los tres están también en [`public/`](public/) o en el script local, así que el resultado es el
mismo se compile donde se compile.

### La base del sitio

Con el dominio propio el sitio cuelga de la **raíz** (`/`), que es el caso simple. El otro
escenario sigue soportado y es el que hay que tener en la cabeza si algún día se apaga
`CUSTOM_DOMAIN`: el Pages de proyecto publica en `/editorial-ethos-app/`, y un build hecho para la
raíz ahí **no carga nada** —los chunks, el CSS, el favicon y el manifest se piden a
`https://josegalvez1985.github.io/...` y devuelven 404 en bloque.

El workflow calcula el prefijo (`/` con `CUSTOM_DOMAIN`, `/<repo>/` sin él) y lo pasa como
`BASE_PATH`. De ahí salen tres cosas:

| Quién | Qué hace con la base |
| --- | --- |
| [`vite.config.ts`](vite.config.ts) → `base` | Prefija los assets que emite el bundler (chunks, CSS) y define `import.meta.env.BASE_URL`. |
| [`src/router.tsx`](src/router.tsx) → `basepath` | Sin esto el router no reconoce ninguna URL y toda la app muestra el 404 propio. |
| [`src/lib/asset.ts`](src/lib/asset.ts) → `asset()` | Para los archivos de `public/` escritos a mano en el JSX (`logo.png`, `favicon.png`, `app.apk`…): vite **no** reescribe esas rutas. |

### La vista previa al compartir el link

Cuando se pega `www.ethospy.online` en WhatsApp, Telegram o X, el logo que aparece sale del
`og:image` de [`src/routes/__root.tsx`](src/routes/__root.tsx). Dos cosas lo hacen funcionar y las
dos se rompen fácil:

1. **La URL tiene que ser absoluta.** El crawler lee el HTML sin una página desde la cual resolver
   `/logo.png`. Por eso el workflow calcula el origen (`https://www.ethospy.online`) y lo pasa como
   `VITE_SITE_URL`, que consume [`assetAbsoluto()`](src/lib/asset.ts). Sale del mismo
   `CUSTOM_DOMAIN` que la base, así que no hay nada extra que configurar.
2. **Las tags viven solo en `__root.tsx`, no por ruta.** Todas las URLs sirven el mismo
   `_shell.html`, así que el crawler ve siempre las mismas tags. Cuando `index.tsx` tenía las
   suyas, compartir el sitio mostraba **"Iniciar sesión — Editorial Ethos"**.

Se usa `logo.png` y no los `icon-*.png` porque esos son RGBA: la transparencia se renderiza
**negra** en la vista previa de WhatsApp y X.

Si cambiás la imagen, acordate de que los scrapers **cachean**: hay que forzar el refresco desde el
[Sharing Debugger de Facebook](https://developers.facebook.com/tools/debug/) para ver el cambio.

Si agregás un archivo de `public/` referenciado desde el código, pasalo por `asset()`. Y en el
manifest ([`public/site.webmanifest`](public/site.webmanifest)) las rutas son **relativas** a
propósito: ahí no hay forma de inyectar la base, y así funciona en los dos escenarios.

## Probarlo en local antes de pushear

```powershell
npm run build:static
npx serve dist\client
```

Hace lo mismo que el workflow ([`scripts/build-static.ps1`](scripts/build-static.ps1)) y verifica
que estén `index.html`, `404.html` y `.nojekyll` antes de darse por bueno. Compila con la base en
`/`, que es lo que sirve `npx serve` **y lo mismo que se publica con el dominio propio**.

Para reproducir el otro escenario —el Pages de proyecto, que cuelga de `/editorial-ethos-app/`—
hay que servirlo desde una carpeta con ese nombre, o si no todo da 404:

```powershell
powershell -File scripts\build-static.ps1 -basePath "/editorial-ethos-app/"
New-Item -ItemType Directory -Force dist\preview | Out-Null
Copy-Item dist\client dist\preview\editorial-ethos-app -Recurse -Force
npx serve dist\preview      # abrir /editorial-ethos-app/
```

Para apuntar a otro backend sin tocar nada:

```powershell
powershell -File scripts\build-static.ps1 -apiUrl "https://oracleapex.com/ords/otro/ethos/"
```

---

## El APK ya NO se publica con el sitio

`npm run apk` sigue dejando el resultado en `public/app.apk`, pero ese archivo **no se commitea**:
`*.apk` está en [`.gitignore`](.gitignore). Son ~4 MB por build y git los guardaría para siempre
—un binario no se comprime entre versiones como el texto—, así que cada release engordaba el
historial sin vuelta atrás.

Consecuencia: **el APK se reparte a mano**, fuera del repo. Y como el sitio ya no tiene el archivo,
el ítem "Descargar app para Android" del login está **apagado**: lo controla la constante
`DESCARGA_APK_URL` en [`src/routes/index.tsx`](src/routes/index.tsx), hoy en `""`.

Para volver a ofrecerlo desde el sitio hace falta darle una URL estable —un GitHub Release es lo
natural, porque no toca el historial— y poner esa URL en `DESCARGA_APK_URL`. El ítem reaparece
solo; el JSX quedó intacto.

> El historial ya carga con el peso de los APK commiteados antes. Sacarlo ahora evita seguir
> sumando, pero no achica lo ya guardado: eso requeriría reescribir el historial.

---

## Qué NO se despliega acá

- **El backend.** Los scripts de [`backend/`](backend/) se corren a mano en APEX. Un push no
  toca Oracle.
- **La app Expo de `mobile/`.** No forma parte del sitio.
- **El APK no se recompila solo.** Si cambiás el front, el sitio se actualiza con el push pero el
  APK instalado en los celulares no: hay que correr `npm run apk` y repartirlo de nuevo.
