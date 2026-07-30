# Despliegue del sitio — GitHub Pages / www.ethospy.online

El sitio se publica en **<https://www.ethospy.online>** desde GitHub Pages, con el workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), en cada push a `main`.

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

### 2. Dominio propio

**Settings → Pages → Custom domain:** `www.ethospy.online` → Save.
Después marcá **Enforce HTTPS** (puede tardar unos minutos en habilitarse mientras GitHub emite el
certificado).

El archivo [`public/CNAME`](public/CNAME) ya tiene el dominio y viaja en cada build, así que el
dominio no se pierde al republicar.

### 3. DNS del dominio

En el panel de tu proveedor de `ethospy.online`:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| `CNAME` | `www` | `josegalvez1985.github.io` |

Y si querés que `ethospy.online` sin `www` también funcione, los cuatro `A` del apex a las IP de
GitHub Pages:

| Tipo | Nombre | Valor |
| --- | --- | --- |
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |

GitHub redirige del apex al `www` (o al revés) según lo que pongas en *Custom domain*.

### 4. Opcional: apuntar a otro ORDS

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

## Probarlo en local antes de pushear

```powershell
npm run build:static
npx serve dist\client
```

Hace exactamente lo mismo que el workflow ([`scripts/build-static.ps1`](scripts/build-static.ps1))
y verifica que estén `index.html`, `404.html`, `.nojekyll` y `CNAME` antes de darse por bueno.

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
