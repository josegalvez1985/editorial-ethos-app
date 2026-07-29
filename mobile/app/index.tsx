import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Eye, EyeOff, Fingerprint, Lock, UserRound } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { fonts, radius } from "@/theme/colors";

export default function LoginScreen() {
  const router = useRouter();
  const colors = useColors();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { sesion, ready, login, loginBiometrico, biometry, biometryDisponible } = useSession();

  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Sesión ya validada contra el backend: entramos directo.
  useEffect(() => {
    if (ready && sesion) router.replace("/home");
  }, [ready, sesion, router]);

  const onSubmit = async () => {
    setError("");
    if (!usuario || !password) {
      setError("Ingresa tu usuario y contraseña");
      return;
    }
    setLoading(true);
    try {
      await login(usuario, password);
      toast.success("Bienvenido a Editorial Ethos");
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      // Sin este finally, un error deja el botón deshabilitado para siempre.
      setLoading(false);
    }
  };

  const onBiometric = async () => {
    setError("");
    setLoading(true);
    try {
      await loginBiometrico();
      toast.success("Acceso biométrico verificado");
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos verificar tu identidad");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={colors.heroGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + 28 }]}
      >
        <Logo height={46} />
      </LinearGradient>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.foreground }]}>Bienvenido</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Inicia sesión</Text>

          <View style={styles.fields}>
            <Field
              label="Usuario"
              value={usuario}
              onChangeText={setUsuario}
              placeholder="tu usuario"
              autoComplete="username"
              icon={(c, s) => <UserRound size={s} color={c} />}
              returnKeyType="next"
            />

            <Field
              label="Contraseña"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry={!showPass}
              autoComplete="current-password"
              icon={(c, s) => <Lock size={s} color={c} />}
              onSubmitEditing={onSubmit}
              returnKeyType="go"
              trailing={
                <Pressable
                  onPress={() => setShowPass((s) => !s)}
                  accessibilityLabel="Mostrar contraseña"
                  hitSlop={8}
                >
                  {showPass ? (
                    <EyeOff size={18} color={colors.mutedForeground} />
                  ) : (
                    <Eye size={18} color={colors.mutedForeground} />
                  )}
                </Pressable>
              }
            />
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <Button
            label={loading ? "Iniciando..." : "Entrar"}
            size="lg"
            loading={loading}
            onPress={onSubmit}
          />

          {/* Solo si ya está activada: sin credenciales en el keystore el botón
              no puede hacer nada y solo genera frustración. */}
          {biometry && biometryDisponible ? (
            <>
              <View style={styles.divider}>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>o</Text>
                <View style={[styles.rule, { backgroundColor: colors.border }]} />
              </View>

              <Button
                label="Acceder con biometría"
                variant="outline"
                size="lg"
                disabled={loading}
                onPress={onBiometric}
                icon={(c, s) => <Fingerprint size={s} color={c} />}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderBottomLeftRadius: radius.xxl + 8,
    borderBottomRightRadius: radius.xxl + 8,
  },
  form: { paddingHorizontal: 24, paddingTop: 26, gap: 16 },
  title: { fontFamily: fonts.displayBlack, fontSize: 28, letterSpacing: -0.5 },
  subtitle: { fontFamily: fonts.sans, fontSize: 14, marginTop: -10 },
  fields: { gap: 16, marginTop: 4 },
  error: { fontFamily: fonts.sansMedium, fontSize: 13.5, marginTop: -6 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontFamily: fonts.sans, fontSize: 12 },
});
