import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { useColors } from "@/lib/theme";
import { fonts } from "@/theme/colors";

export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background }]}>
      <Text style={[styles.code, { color: colors.primary }]}>404</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Página no encontrada</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        La pantalla que buscas no existe o fue movida.
      </Text>
      <Button label="Volver al inicio" onPress={() => router.replace("/")} style={styles.cta} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 6 },
  code: { fontFamily: fonts.displayBlack, fontSize: 72 },
  title: { fontFamily: fonts.sansSemi, fontSize: 18, marginTop: 8 },
  body: { fontFamily: fonts.sans, fontSize: 14, textAlign: "center", lineHeight: 21 },
  cta: { marginTop: 20 },
});
