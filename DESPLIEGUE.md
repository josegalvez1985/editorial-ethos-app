# Despliegue del sitio — GitHub Pages

El sitio se publica desde GitHub Pages con el workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), en cada push a `main`.

**Hoy vive en <https://josegalvez1985.github.io/editorial-ethos-app/>**, sin dominio propio. Para
volver a `www.ethospy.online` hay que arreglar el DNS y prender la variable `CUSTOM_DOMAIN`: está
todo en [Dominio propio](#2-dominio-propio-opcional-hoy-apagado).

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

### 2. Dominio propio (opcional, hoy apagado)

Sin dominio propio, Pages publica en `https://<usuario>.github.io/<repo>/` y **todo el sitio
cuelga de `/editorial-ethos-app/`**. Eso lo resuelve solo el workflow (ver
[La base del sitio](#la-base-del-sitio)); no hay nada que configurar.

#### Por qué se apagó

`www.ethospy.online` quedó en un **bucle de redirecciones** y el sitio entero dejó de responder:

```
www.ethospy.online/loquesea
  → 301 (Server: hcdn — Hostinger)  →  https://josegalvez1985.github.io/editorial-ethos-app
  → 301 (Server: GitHub.com)        →  http://www.ethospy.online     ← por el CNAME de Pages
  → 301 → ... sin fin
```

El DNS apunta a Hostinger (`ethospy.online` → `A 2.57.91.91`, `www` → `CNAME ethospy.online`), que
tiene un **redirect** hacia la URL de `github.io` —y de paso se come el path—, y Pages rebota de
vuelta al dominio propio porque el artefacto traía un `CNAME`. Uno solo de los dos lados no alcanza
para romperlo: hacen falta los dos.

Por eso el `CNAME` **ya no vive en `public/`**. Lo escribe el workflow únicamente si existe la
variable `CUSTOM_DOMAIN`, así que un DNS mal apuntado no puede volver a dejar el sitio en bucle.

#### Para volver a prenderlo

1. **DNS**, en el panel de Hostinger: borrar el redirect / parking de `ethospy.online` y dejar
   registros que apunten a GitHub Pages, no a Hostinger:

   | Tipo | Nombre | Valor |
   | --- | --- | --- |
   | `CNAME` | `www` | `josegalvez1985.github.io` |
   | `A` | `@` | `185.199.108.153` |
   | `A` | `@` | `185.199.109.153` |
   | `A` | `@` | `185.199.110.153` |
   | `A` | `@` | `185.199.111.153` |

   Comprobalo antes de seguir: `curl -sI https://www.ethospy.online/` tiene que responder
   `Server: GitHub.com`. Si dice `hcdn`, el redirect de Hostinger sigue puesto.

2. **Variable**: Settings → Secrets and variables → Actions → Variables → `CUSTOM_DOMAIN` =
   `www.ethospy.online`. Con eso el workflow vuelve a escribir el `CNAME` y compila con la base en
   `/` en vez de `/editorial-ethos-app/`.

3. **Settings → Pages → Custom domain**: `www.ethospy.online` → Save, y después **Enforce HTTPS**
   (tarda unos minutos mientras GitHub emite el certificado).

Para volver atrás, borrar la variable y volver a pushear.

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

Sin dominio propio el sitio no está en la raíz sino en `/editorial-ethos-app/`, y un build hecho
para la raíz ahí **no carga nada**: los chunks, el CSS, el favicon y el manifest se piden a
`https://josegalvez1985.github.io/...` y devuelven 404 en bloque.

El workflow calcula el prefijo (`/` con `CUSTOM_DOMAIN`, `/<repo>/` sin él) y lo pasa como
`BASE_PATH`. De ahí salen tres cosas:

| Quién | Qué hace con la base |
| --- | --- |
| [`vite.config.ts`](vite.config.ts) → `base` | Prefija los assets que emite el bundler (chunks, CSS) y define `import.meta.env.BASE_URL`. |
| [`src/router.tsx`](src/router.tsx) → `basepath` | Sin esto el router no reconoce ninguna URL y toda la app muestra el 404 propio. |
| [`src/lib/asset.ts`](src/lib/asset.ts) → `asset()` | Para los archivos de `public/` escritos a mano en el JSX (`logo.png`, `favicon.png`, `app.apk`…): vite **no** reescribe esas rutas. |

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
`/`, que es lo que sirve `npx serve`.

Para reproducir el build real de Pages —el que cuelga de `/editorial-ethos-app/`— hay que servirlo
desde una carpeta con ese nombre, o si no todo da 404:

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

## El APK viaja dentro del sitio

`public/app.apk` se publica junto con el resto, así que queda descargable en
`https://www.ethospy.online/app.apk`. Lo genera `npm run apk`
(ver [`APK.md`](APK.md)), que lo copia ahí automáticamente.

**Costo a tener en cuenta:** son ~4 MB y el `.gitignore` no excluye `*.apk`, así que **cada APK
que commitees suma 4 MB al historial de git para siempre**. Si se vuelve pesado, las salidas son
publicarlo como GitHub Release en vez de en `public/`, o dejar de commitearlo y subirlo a mano.

---

## Qué NO se despliega acá

- **El backend.** Los scripts de [`backend/`](backend/) se corren a mano en APEX. Un push no
  toca Oracle.
- **La app Expo de `mobile/`.** No forma parte del sitio.
- **El APK no se recompila solo.** Si cambiás el front, el sitio se actualiza con el push pero el
  APK instalado en los celulares no: hay que correr `npm run apk` y repartirlo de nuevo.
