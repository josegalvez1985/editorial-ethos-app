import { Image, StyleSheet, View, type ViewStyle } from "react-native";

import { radius } from "@/theme/colors";

/** Proporción real del wordmark recortado (assets/logo.png). */
const RATIO = 1547 / 1055;

type Props = {
  /** Alto del wordmark en px. El ancho se calcula con la proporción del logo. */
  height?: number;
  /**
   * El logo es tinta oscura sobre blanco, así que en modo oscuro necesita
   * una placa blanca detrás para no desaparecer.
   */
  plate?: boolean;
  style?: ViewStyle;
};

export function Logo({ height = 28, plate = true, style }: Props) {
  const pad = Math.round(height * 0.28);

  return (
    <View
      style={[
        plate && {
          backgroundColor: "#ffffff",
          borderRadius: radius.md,
          paddingHorizontal: pad,
          paddingVertical: Math.round(pad * 0.7),
        },
        style,
      ]}
    >
      <Image
        source={require("../../assets/logo.png")}
        style={{ height, width: height * RATIO }}
        resizeMode="contain"
        accessibilityLabel="Editorial Ethos"
      />
    </View>
  );
}

export const logoStyles = StyleSheet.create({
  shadow: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});
