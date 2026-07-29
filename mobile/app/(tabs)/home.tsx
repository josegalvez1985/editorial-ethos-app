import { StyleSheet, View } from "react-native";

import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/lib/theme";

/**
 * Pantalla de inicio.
 *
 * Sin contenido todavía: el saludo y la fecha viven en `AppHeader` y el backend
 * aún no expone artículos.
 */
export default function HomeScreen() {
  const colors = useColors();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
