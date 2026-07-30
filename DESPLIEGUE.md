# Despliegue del sitio — GitHub Pages

El sitio se publica desde GitHub Pages con el workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), en cada push a `main`.

**El sitio vive en <https://josegalvez1985.github.io/editorial-ethos-app/>**, y `ethospy.online`
es una **redirección** hacia ahí: se entra por el dominio, pero la URL que queda a la vista es la
de `github.io`. Ver [El dominio ethospy.online](#2-el-dominio-ethospyonline-redirección).

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

### 2. El dominio ethospy.online (redirección)

El sitio **no se sirve en el dominio**: `ethospy.online` está en Hostinger y lo único que hace es
un `301` hacia `https://josegalvez1985.github.io/editorial-ethos-app/`. El dominio es la puerta de
entrada; la URL final es la de `github.io`.

Son dos ajustes, y **los dos son necesarios**:

| Dónde | Qué |
| --- | --- |
| Hostinger (hPanel del dominio) | Redirección de `ethospy.online` y `www` → `https://josegalvez1985.github.io/editorial-ethos-app/` |
| GitHub → Settings → Pages | **Custom domain VACÍO** |

#### Por qué el "Custom domain" tiene que quedar vacío

Con un dominio propio configurado, Pages responde `301` en `github.io` mandando al dominio. Sumado
al redirect de Hostinger que va en la dirección contraria, queda un **bucle** y no responde
ninguna de las dos URLs:

```
www.ethospy.online/loquesea
  → 301 (Server: hcdn — Hostinger)  →  https://josegalvez1985.github.io/editorial-ethos-app/…
  → 301 (Server: GitHub.com)        →  http://www.ethospy.online/…    ← porque Pages tiene dominio propio
  → 301 → ... sin fin
```

Ninguno de los dos lados solo alcanza para romperlo: hacen falta los dos apuntándose entre sí. Por
eso el `CNAME` **ya no vive en `public/`** —lo escribe el workflow solo si existe la variable
`CUSTOM_DOMAIN`—, pero ojo: **borrar el archivo no borra el dominio ya guardado** en Settings →
Pages. Eso hay que sacarlo a mano una vez.

Para comprobar que quedó bien:

```powershell
curl.exe -s -o NUL -D - https://josegalvez1985.github.io/editorial-ethos-app/home
#  200  → listo. Si aparece "301 → www.ethospy.online", el Custom domain sigue puesto.
```

#### Si algún día querés servir el sitio EN el dominio

Es la alternativa: la URL se queda en `www.ethospy.online` y el sitio vuelve a colgar de la raíz.
Cuesta tres pasos:

1. **DNS**, en Hostinger: borrar la redirección y apuntar el dominio a GitHub Pages —hoy apunta a
   Hostinger (`ethospy.online` → `A 2.57.91.91`, `www` → `CNAME ethospy.online`):

   | Tipo | Nombre | Valor |
   | --- | --- | --- |
   | `CNAME` | `www` | `josegalvez1985.github.io` |
   | `A` | `@` | `185.199.108.153` |
   | `A` | `@` | `185.199.109.153` |
   | `A` | `@` | `185.199.110.153` |
   | `A` | `@` | `185.199.111.153` |

   Verificalo antes de seguir: `curl -sI https://www.ethospy.online/` tiene que responder
   `Server: GitHub.com`. Si dice `hcdn`, la redirección sigue puesta.

2. **Variable**: Settings → Secrets and variables → Actions → Variables → `CUSTOM_DOMAIN` =
   `www.ethospy.online`. El workflow vuelve a escribir el `CNAME` y compila con la base en `/` en
   vez de `/editorial-ethos-app/`.

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
<https://josegalvez1985.github.io/editorial-ethos-app/app.apk>. Lo genera `npm run apk`
(ver [`APK.md`](APK.md)), que lo copia ahí automáticamente.

La pantalla de login lo ofrece con un ítem "Descargar app para Android"
([`src/routes/index.tsx`](src/routes/index.tsx)), que arma la URL con `asset()` para que siga
funcionando cambie o no la base. Ese ítem **no** se muestra dentro del propio APK: el build de
Capacitor saca `app.apk` del bundle para que cada APK no empaquete al anterior adentro.

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
