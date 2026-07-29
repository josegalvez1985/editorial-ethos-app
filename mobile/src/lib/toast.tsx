import { CircleAlert, CircleCheck, Info } from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/lib/theme";
import { fonts, radius } from "@/theme/colors";

/** Reemplazo nativo de `sonner`: mismo API mínimo (success / error / info). */
type Variant = "success" | "error" | "info";
type ToastState = { message: string; variant: Variant } | null;

const ToastContext = createContext<((message: string, variant?: Variant) => void) | null>(
  null,
);

const DURATION = 2600;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: Variant = "success") => {
    setToast({ message, variant });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), DURATION);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ToastView toast={toast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside ToastProvider");
  return useMemo(
    () => ({
      success: (m: string) => show(m, "success"),
      error: (m: string) => show(m, "error"),
      info: (m: string) => show(m, "info"),
    }),
    [show],
  );
}

function ToastView({ toast }: { toast: ToastState }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: toast ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [toast, anim]);

  if (!toast) return null;

  const Icon =
    toast.variant === "error" ? CircleAlert : toast.variant === "info" ? Info : CircleCheck;
  const tint =
    toast.variant === "error"
      ? colors.destructive
      : toast.variant === "info"
        ? colors.mutedForeground
        : colors.primary;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          top: insets.top + 12,
          opacity: anim,
          transform: [
            { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.toast, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Icon size={18} color={tint} />
        <Text style={[styles.text, { color: colors.foreground }]} numberOfLines={2}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, zIndex: 100 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  text: { flex: 1, fontFamily: fonts.sansMedium, fontSize: 14 },
});
