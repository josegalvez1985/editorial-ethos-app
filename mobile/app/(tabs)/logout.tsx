/**
 * Pestaña "Salir": no es una pantalla de verdad.
 *
 * expo-router necesita un archivo por cada `Tabs.Screen`, pero el toque lo
 * intercepta el listener de `(tabs)/_layout.tsx` (`e.preventDefault()`), cierra
 * la sesión y manda al login. Este componente no se llega a montar.
 */
export default function LogoutTab() {
  return null;
}
