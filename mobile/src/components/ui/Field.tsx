import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from "react-native";

import { useColors } from "@/lib/theme";
import { fonts, radius } from "@/theme/colors";

type Props = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps["autoComplete"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  /** Icono a la izquierda del campo. */
  icon?: (color: string, size: number) => ReactNode;
  /** Acción a la derecha (p. ej. mostrar/ocultar contraseña). */
  trailing?: ReactNode;
  /** Contenido opcional a la derecha de la etiqueta. */
  labelAction?: ReactNode;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps["returnKeyType"];
};

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoComplete,
  autoCapitalize = "none",
  icon,
  trailing,
  labelAction,
  onSubmitEditing,
  returnKeyType,
}: Props) {
  const colors = useColors();

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        {labelAction}
      </View>

      <View
        style={[styles.inputWrap, { borderColor: colors.input, backgroundColor: colors.card }]}
      >
        {icon ? <View style={styles.icon}>{icon(colors.mutedForeground, 18)}</View> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          style={[styles.input, { color: colors.foreground }]}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontFamily: fonts.sansMedium, fontSize: 13.5 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
  },
  icon: { marginRight: 8 },
  trailing: { marginLeft: 8, padding: 4 },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 15, paddingVertical: 13 },
});
