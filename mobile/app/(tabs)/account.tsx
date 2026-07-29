import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Fingerprint, LogIn, Mail, Moon, Sun, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";
import { useColors, useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { fonts, radius, type ThemeName } from "@/theme/colors";

const themeOptions: { value: ThemeName; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

/** Bloque de ajustes: título chico + tarjeta con filas. Espejo de la web. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.group}>
      <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <View
        style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        {children}
      </View>
    </View>
  );
}

function Row({
  icon: Icon,
  title,
  hint,
  trailing,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  trailing?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon size={19} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]}>{title}</Text>
        {hint ? (
          <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>{hint}</Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

export default function AccountScreen() {
  const { theme, colors, setTheme } = useTheme();
  const { sesion, user, biometry, biometryDisponible, setBiometry } = useSession();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const displayName = user?.name ?? "Invitado";
  const displayEmail = user?.email ?? "invitado@ethos.mx";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // setBiometry hace el trabajo sucio (huella + keystore) y lanza con el motivo
  // exacto si no se pudo. Acá solo lo traducimos a un toast.
  const onBiometry = async (v: boolean) => {
    try {
      await setBiometry(v);
      toast.success(v ? "Biometría activada" : "Biometría desactivada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar la biometría");
    }
  };

  const biometryHint = !sesion
    ? "Inicia sesión con tu contraseña para poder activarla."
    : !biometryDisponible
      ? "Este dispositivo no tiene huella ni rostro configurados."
      : "Usa tu huella o rostro para entrar más rápido.";

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headline}>
          <Text style={[styles.kicker, { color: colors.mutedForeground }]}>CONFIGURACIÓN</Text>
          <Text style={[styles.h1, { color: colors.foreground }]}>Mi cuenta</Text>
        </View>

        <LinearGradient
          colors={colors.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profile}
        >
          <View style={[styles.avatar, { backgroundColor: colors.overlayStrong }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>
              {displayName}
            </Text>
            <View style={styles.profileMail}>
              <Mail size={13} color="rgba(255,255,255,0.8)" />
              <Text style={styles.profileEmail} numberOfLines={1}>
                {displayEmail}
              </Text>
            </View>
          </View>
        </LinearGradient>

        <Group label="Seguridad">
          <Row
            icon={Fingerprint}
            title="Acceso biométrico"
            hint={biometryHint}
            trailing={
              <Switch
                value={biometry}
                onValueChange={onBiometry}
                disabled={!sesion || !biometryDisponible}
                trackColor={{ false: colors.input, true: colors.primary }}
                thumbColor="#ffffff"
              />
            }
          />
        </Group>

        <Group label="Apariencia">
          <View style={styles.themeBlock}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>Tema</Text>
            {/* Control segmentado: la opción activa se levanta sobre el riel */}
            <View
              accessibilityRole="radiogroup"
              style={[styles.segmented, { backgroundColor: colors.muted }]}
            >
              {themeOptions.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setTheme(opt.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={[
                      styles.segment,
                      active && { backgroundColor: colors.card },
                      active && styles.segmentActive,
                    ]}
                  >
                    <Icon size={16} color={active ? colors.foreground : colors.mutedForeground} />
                    <Text
                      style={[
                        styles.segmentText,
                        { color: active ? colors.foreground : colors.mutedForeground },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Group>

        {/* Cerrar sesión vive en el tab bar. Acá solo queda el caso contrario:
            estar en la app sin sesión activa. */}
        {!sesion ? (
          <Group label="Cuenta">
            <View style={styles.loginRow}>
              <Button
                label="Iniciar sesión"
                variant="outline"
                onPress={() => router.replace("/")}
                icon={(c, s) => <LogIn size={s} color={c} />}
              />
            </View>
          </Group>
        ) : null}

        <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
          Editorial Ethos · app Android
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18 },
  headline: { gap: 4 },
  kicker: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 1 },
  h1: { fontFamily: fonts.displayBlack, fontSize: 31, letterSpacing: -0.7 },

  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: radius.xxl + 4,
    padding: 18,
    marginTop: 18,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
  },
  avatarText: { fontFamily: fonts.sansBold, fontSize: 18, color: "#ffffff" },
  profileText: { flex: 1, gap: 4 },
  profileName: { fontFamily: fonts.displayBlack, fontSize: 21, color: "#ffffff" },
  profileMail: { flexDirection: "row", alignItems: "center", gap: 6 },
  profileEmail: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: "rgba(255,255,255,0.82)",
    flex: 1,
  },

  group: { marginTop: 26, gap: 8 },
  groupLabel: { fontFamily: fonts.sansSemi, fontSize: 11, letterSpacing: 1, paddingHorizontal: 4 },
  groupCard: {
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.sansSemi, fontSize: 15 },
  rowHint: { fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 18 },

  themeBlock: { padding: 16, gap: 12 },
  segmented: { flexDirection: "row", borderRadius: radius.pill, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    height: 40,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  segmentActive: {
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: { fontFamily: fonts.sansSemi, fontSize: 14 },

  loginRow: { padding: 16 },
  footnote: { fontFamily: fonts.sans, fontSize: 11.5, textAlign: "center", marginTop: 32 },
});
