# Editorial Ethos — App Android (Expo / React Native)

App nativa que se compila a APK. Login real contra Oracle APEX/ORDS.

Es uno de los dos frontends del repo; el otro es el sitio web en la raíz
([`../README.md`](../README.md)). **No comparten código.**

## Configurar la API

La URL del backend vive en `app.json` → `expo.extra.apiUrl`. Es lo que queda embebido en
el APK:

```json
"extra": { "apiUrl": "https://oracleapex.com/ords/fundcarac/ethos/" }
```

Para apuntar a otro entorno en desarrollo sin tocar `app.json`, crea `mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://oracleapex.com/ords/otro/ethos/
```

`EXPO_PUBLIC_API_URL` gana sobre `extra.apiUrl`.

A diferencia del sitio web, acá **no hay proxy**: la app pega directo a ORDS. Es válido
porque el `fetch` de React Native no aplica CORS.

## Correr en el celular

1. Instala **Expo Go** (Play Store / App Store).
2. El celular y la computadora en la **misma red Wi-Fi**.
3. Desde `mobile/`:

   ```bash
   npm install
   npm start
   ```

4. Escanea el QR con Expo Go (Android) o con la cámara (iOS).
   Si el QR falla: Expo Go → *Enter URL manually* → `exp://<IP-de-tu-PC>:8081`.

Si ves cambios que no se reflejan, es caché de Metro: `npm start -- --clear`.

## Generar el APK

Se compila **en la nube con EAS**, sin Android Studio:

```bash
npm install -g eas-cli
eas login              # cuenta gratuita de Expo
eas init               # crea extra.eas.projectId en app.json
npm run build:apk      # eas build --platform android --profile preview
```

EAS entrega un enlace de descarga del `.apk`, instalable en cualquier Android. El perfil
`production` (`npm run build:aab`) genera el `.aab` para Play Store.

## Estructura

```
app/                  rutas (expo-router, file-based)
  _layout.tsx         providers: tema, sesión, toasts + fuentes
  index.tsx           login (contraseña + biometría, ambos contra ORDS)
  (tabs)/_layout.tsx  barra de pestañas inferior
  (tabs)/home.tsx     inicio
  (tabs)/account.tsx  cuenta y ajustes
src/
  theme/colors.ts     paleta (portada de la web, ajustada al logo)
  lib/api.ts          cliente ORDS: login/logout/me + authFetch
  lib/biometric.ts    huella + credenciales en el keystore del sistema
  lib/theme.tsx       tema claro/oscuro persistido en AsyncStorage
  lib/session.tsx     sesión persistida en AsyncStorage
  lib/toast.tsx       reemplazo nativo de sonner
  components/         Logo, AppHeader y primitivas de UI
assets/               iconos generados desde el logo de la marca
```

## Equivalencias con la versión web

| Web                        | Móvil                                  |
| -------------------------- | -------------------------------------- |
| TanStack Router            | expo-router                            |
| Tailwind / shadcn-ui       | StyleSheet + `src/components/ui`       |
| `localStorage`             | `@react-native-async-storage`          |
| `sonner`                   | `src/lib/toast.tsx`                    |
| `lucide-react`             | `lucide-react-native`                  |
| gradiente CSS              | `expo-linear-gradient`                 |
| proxy `/api/ords/`         | llamada directa a ORDS                 |
| biometría no disponible    | `expo-local-authentication` + keystore |

## Cómo funciona la biometría

El backend solo entiende usuario+contraseña, así que la huella **no reemplaza al login: lo
desbloquea.**

1. El usuario entra con contraseña. Las credenciales quedan **solo en memoria**.
2. En *Cuenta* activa el acceso biométrico → se pide la huella → las credenciales pasan al
   keystore del sistema (`expo-secure-store`, cifrado por el SO).
3. En el siguiente arranque, el botón de biometría pide la huella, recupera las credenciales
   y hace el `POST /auth/login` de siempre. El servidor no ve nada distinto.

Consecuencias, todas intencionales:

- Si entraste con una sesión restaurada (o con la propia huella), nunca vimos tu contraseña
  en esa ejecución y **no** se puede activar la biometría; hay que cerrar sesión y entrar con
  contraseña. Lo dice el toast.
- Al desactivarla, las credenciales se borran del keystore.
- Si cambias tu contraseña en APEX, el primer login biométrico falla, se limpia el keystore y
  la app te manda a entrar con contraseña.
- El botón de biometría **no aparece** en el login si no está activada: sin credenciales
  guardadas no podría hacer nada.

## Sesión

- El token de ORDS dura **6 horas** y se guarda en AsyncStorage.
- Al arrancar, la app llama a `GET /auth/me` para confirmar que sigue vivo. Si el backend lo
  rechaza, vuelve al login.
- Si esa revalidación falla por **red** (sin datos, Wi-Fi caído) la sesión se conserva:
  quedarse sin señal no debería expulsarte de la app.
