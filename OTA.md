# Actualización OTA: cambiar la app sin repartir un APK

**El problema que resuelve.** Hasta ahora, cambiar un menú o un campo de un
formulario obligaba a compilar un APK, subir el `versionCode`, pasarlo por
WhatsApp y esperar a que cada persona lo instale. Un cambio de una línea costaba
una repartija.

Desde el **05/08/2026** el APK se actualiza solo: se hace `git push`, GitHub
Pages publica el sitio **y** un bundle web, y los teléfonos lo levantan al
reabrir la app.

Implementado con [`@capgo/capacitor-updater`](https://github.com/Cap-go/capacitor-updater)
(MPL-2.0), **self-hosted**: el bundle sale del mismo GitHub Pages que ya sirve el
sitio. Sin cuenta, sin servicio de pago, sin infraestructura nueva.

---

## Lo primero: qué viaja por OTA y qué no

Es **la** distinción que hay que tener clara. El bundle OTA lleva **solo la parte
web**.

| Cambio | ¿Llega por OTA? |
| --- | --- |
| Un menú, una pantalla, un campo de formulario | **Sí** |
| Validaciones, textos, estilos, colores, paletas | **Sí** |
| Lógica de `src/lib/*.ts`, rutas nuevas | **Sí** |
| Un plugin nativo de Capacitor | **No** — APK nuevo |
| Ícono, splash, nombre visible | **No** — APK nuevo |
| Permisos del `AndroidManifest.xml` | **No** — APK nuevo |
| `minSdkVersion` / `targetSdkVersion` | **No** — APK nuevo |

En la práctica, casi todo lo que se toca día a día es la primera mitad.

**Regla simple:** si el cambio está en `src/`, `public/` o `styles.css`, va por
OTA. Si tocaste `android/`, `capacitor.config.ts` o instalaste un paquete con
código nativo, hace falta APK.

---

## Cómo se comporta, paso a paso

1. Hacés `git push` a `main`.
2. El workflow compila el sitio, arma `ota/bundle-<sha>.zip` y `ota/updates.json`,
   y publica todo en `https://www.ethospy.online/`.
3. El teléfono, **la próxima vez que abra la app con internet**, consulta el
   `updates.json`. Si la versión difiere de la instalada, baja el `.zip` en
   segundo plano.
4. El bundle se aplica **cuando la app pasa a segundo plano**. O sea: el usuario
   ve los cambios **la próxima vez que la abre**.

### Sin internet

La app **abre igual**, con el último bundle que llegó a bajarse. Los assets que
vinieron dentro del APK son el piso: nunca se queda sin nada que mostrar.

Cuando vuelve la conexión, se actualiza sola y ahí queda.

### Por qué no se aplica al instante

Es a propósito (`autoUpdate: "atBackground"`). Aplicar un bundle recarga la
WebView; hacerlo mientras alguien carga una evaluación le borraría lo tipeado,
porque el formulario vive en estado de React y no hay borrador persistido.

Si algún día se quiere más agresivo, las opciones son `"onLaunch"` (aplica en
arranque en frío) o `"always"` (apenas termina de bajar), en
[`capacitor.config.ts`](capacitor.config.ts). **No las pongas sin resolver antes
el borrador del formulario.**

---

## El rollback automático, que es la red de seguridad

Cuando se aplica un bundle nuevo, el plugin arranca un cronómetro de 10 segundos.
Si el JS no llama a `notifyAppReady()` antes de que suene, da el bundle por roto,
**lo borra y vuelve al anterior**.

Eso es lo que evita el peor escenario posible: publicar un bundle que no arranca y
dejar a todos los teléfonos con la app muerta **y sin forma de recibir el arreglo**.
Con el rollback, se recuperan solos.

El aviso lo manda [`src/lib/ota.ts`](src/lib/ota.ts), llamado desde
[`src/router.tsx`](src/router.tsx). Dos detalles que **no hay que cambiar**:

- **No es un `useEffect`.** Va en el módulo del router, que se ejecuta apenas
  carga el bundle. Si dependiera de que React monte, un error en cualquier
  provider de `__root.tsx` haría revertir un bundle sano.
- **No espera a la red.** El bundle es válido si el JS corre. Que el backend
  responda es otro problema, y atarlos haría que una caída de ORDS pareciera un
  bundle roto.

En la web esto es un no-op: `Capacitor.isNativePlatform()` da `false` y el plugin
ni se importa (va por `import()` dinámico, así que tampoco entra al chunk de
arranque del sitio).

---

## Qué hay que hacer al publicar

### Un cambio de web: nada

`git push` y listo.

### Un cambio nativo: APK nuevo

1. Subí `versionCode` **y** `versionName` en
   [`android/app/build.gradle`](android/app/build.gradle).
2. `npm run apk`.
3. Repartí el `.apk`.

Al instalarse, `resetWhenUpdate: true` **descarta los bundles OTA descargados** y
la app arranca con la web que vino adentro del APK nuevo. Esto es importante:
evita que un APK 1.9 con un plugin nativo nuevo quede corriendo el bundle web de
1.8, que no conoce ese plugin. Desde ahí vuelve a actualizarse por OTA.

---

## Probar el OTA localmente

```bash
# 1. Build web como lo hace el deploy
STATIC_BUILD=1 npx vite build
cp dist/client/_shell.html dist/client/index.html

# 2. Armar el bundle apuntando a donde lo vayas a servir
npm run ota -- --version prueba-1 --site http://TU-IP:8080
```

Deja `dist/client/ota/bundle-prueba-1.zip` y `updates.json`. Servís `dist/client`
con cualquier servidor estático, cambiás `updateUrl` en
[`capacitor.config.ts`](capacitor.config.ts) a `http://TU-IP:8080/ota/updates.json`,
compilás el APK y probás.

**Para ver qué pasa** (es la única forma de diagnosticar):

```bash
adb logcat | grep -i capacitor-updater
```

**Ojo con `http://` en pruebas:** Android bloquea texto plano por defecto. Para
una prueba local hay que habilitarlo en el manifest, y **hay que sacarlo después**.
En producción es HTTPS y no hace falta.

---

## Decisiones tomadas

### Los bundles NO van cifrados (05/08/2026)

El plugin soporta cifrado end-to-end (`publicKey` + clave RSA privada + el CLI de
Capgo para cifrar cada bundle). **No se activó**, a conciencia:

- El bundle se sirve por HTTPS desde **tu propio** GitHub Pages. El riesgo que el
  cifrado cubre —un servidor de updates ajeno— no aplica.
- Para envenenar el bundle hay que vulnerar la cuenta de GitHub, y quien la tenga
  ya puede modificar el repo entero, o sea el APK. El cifrado no cierra ese
  agujero: lo mueve.
- Cuesta una clave RSA privada más que **no se puede perder** (si se pierde, ningún
  teléfono acepta updates nuevos) y meter el CLI de Capgo en el workflow.

**Si algún día se activa:** agregar `publicKey` en `capacitor.config.ts` y cifrar
el `.zip` con el CLI. Ojo con una trampa del código nativo: apenas hay `publicKey`,
el plugin **exige checksum cifrado en toda descarga** y rechaza cualquier bundle
sin cifrar. Es todo o nada — hay que cambiar el workflow y repartir un APK nuevo
en el mismo movimiento, o los teléfonos dejan de actualizarse.

Lo que sí hay hoy es un **SHA-256** en el manifiesto, que el plugin verifica. No
prueba quién armó el bundle, pero sí detecta una descarga corrupta o cortada.

### La versión es el SHA del commit

El plugin compara la versión **por desigualdad**, no por orden: si difiere de la
instalada, actualiza. Un SHA es único por definición.

Un semver a mano sería peor: habría que acordarse de subirlo en cada push, y
repetir uno ya entregado deja a los teléfonos sin actualizar **en silencio**.

### Las estadísticas están apagadas

`statsUrl: ""`. Por defecto el plugin le reporta el uso de la app a los servidores
de Capgo; siendo self-hosted no hay razón para mandarle datos a un tercero.

### El OTA solo se genera con dominio propio

El paso del workflow tiene `if: env.CUSTOM_DOMAIN != ''`. La URL del `.zip` queda
absoluta dentro del `updates.json` y `updateUrl` apunta al dominio: publicarlo bajo
el `github.io` generaría un manifiesto que ningún teléfono consulta.

**Si algún día se apaga el dominio** (ver `DESPLIEGUE.md`), el OTA deja de
publicarse — los APK instalados siguen andando con lo que tengan, pero no reciben
nada nuevo hasta que se resuelva la URL.

---

## Cuando algo no funciona

| Síntoma | Causa probable |
| --- | --- |
| No actualiza nunca | ¿`updates.json` responde 200 en el dominio? ¿La versión cambió respecto de la instalada? |
| Actualiza y vuelve atrás sola | El bundle no llama a `notifyAppReady()` a tiempo: hay un error de JS que rompe el arranque. `adb logcat`. |
| "Checksum failed" | El `.zip` cambió después de generarse el manifiesto. Se arregla en el próximo deploy. |
| Baja pero no se ve el cambio | Falta cerrar y reabrir: se aplica al pasar a segundo plano. |
| Anda en la web pero no en el APK | ¿Es un cambio nativo? Esos no van por OTA — mirá la tabla del principio. |

Un detalle esperable, no un bug: cada deploy republica el sitio y **borra los
`.zip` anteriores**. Un teléfono que estaba justo bajando el bundle viejo recibe un
404, el plugin marca la descarga como fallida y reintenta en el arranque siguiente
contra el manifiesto nuevo. Se corrige solo; a lo sumo la actualización llega un
arranque más tarde.

---

## Los archivos

| Archivo | Qué hace |
| --- | --- |
| [`capacitor.config.ts`](capacitor.config.ts) | `updateUrl`, `autoUpdate`, `resetWhenUpdate` |
| [`src/lib/ota.ts`](src/lib/ota.ts) | `notifyAppReady()` — evita el rollback |
| [`src/router.tsx`](src/router.tsx) | Dispara el aviso al cargar el bundle |
| [`scripts/build-ota.mjs`](scripts/build-ota.mjs) | Arma el `.zip` y el `updates.json` |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Lo publica en cada push |
