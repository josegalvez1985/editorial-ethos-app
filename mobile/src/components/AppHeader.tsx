import { Moon, Sun } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { fechaLarga } from "@/lib/fecha";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { fonts, radius } from "@/theme/colors";

/**
 * Cabecera: logo + saludo con la fecha debajo + cambio de tema.
 *
 * Cerrar sesión vive en el tab bar (`app/(tabs)/_layout.tsx`), igual que en la
 * web, para no tener dos accesos al mismo sitio.
 */
export function AppHeader() {
  const { theme, colors, toggle } = useTheme();
  const { user, ready } = useSession();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: insets.top + 10,
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Logo height={24} plate={theme === "dark"} />

      {/* Mientras revalidamos el token no sabemos el nombre: barras en gris en vez
          de un salto de "Hola," a "Hola, Jose Galvez". */}
      {!ready ? (
        <View style={styles.block}>
          <View style={[styles.skeleton, { backgroundColor: colors.muted, width: 130 }]} />
          <View
            style={[styles.skeleton, { backgroundColor: colors.muted, width: 96, height: 10 }]}
          />
        </View>
      ) : user ? (
        <View style={styles.block}>
          <Text style={[styles.greeting, { color: colors.foreground }]} numberOfLines={1}>
            Hola, <Text style={styles.greetingName}>{user.name}</Text>
          </Text>
          <Text style={[styles.fecha, { color: colors.mutedForeground }]} numberOfLines={1}>
            {fechaLarga()}
          </Text>
        </View>
      ) : (
        <View style={styles.spacer} />
      )}

      <Button
        variant="ghost"
        size="icon"
        onPress={toggle}
        accessibilityLabel={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
        icon={(c, s) =>
          theme === "dark" ? <Sun size={s} color={c} /> : <Moon size={s} color={c} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  block: { flex: 1, gap: 3 },
  greeting: { fontFamily: fonts.sans, fontSize: 14.5 },
  greetingName: { fontFamily: fonts.sansSemi },
  fecha: { fontFamily: fonts.sans, fontSize: 11.5 },
  spacer: { flex: 1 },
  skeleton: { height: 13, borderRadius: radius.pill },
});
