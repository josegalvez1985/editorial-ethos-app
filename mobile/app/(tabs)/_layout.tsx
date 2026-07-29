import { Tabs, useRouter } from "expo-router";
import { House, LogOut, User, type LucideIcon } from "lucide-react-native";
import { StyleSheet, View, type ColorValue } from "react-native";

import { useSession } from "@/lib/session";
import { useColors } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { fonts, radius } from "@/theme/colors";

export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  const toast = useToast();
  const { logout } = useSession();

  const onLogout = async () => {
    await logout();
    toast.success("Sesión cerrada");
    router.replace("/");
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 66,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11.5 },
        tabBarIconStyle: { height: 30 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Inicio",
          tabBarIcon: (p) => <TabIcon icon={House} {...p} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Cuenta",
          tabBarIcon: (p) => <TabIcon icon={User} {...p} />,
        }}
      />
      {/*
        "Salir" es una acción, no una pantalla: interceptamos el toque y nunca
        navegamos. El archivo `logout.tsx` existe solo porque expo-router exige
        una ruta por pestaña.
      */}
      <Tabs.Screen
        name="logout"
        options={{
          title: "Salir",
          tabBarIcon: (p) => <TabIcon icon={LogOut} {...p} />,
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            void onLogout();
          },
        }}
      />
    </Tabs>
  );
}

/**
 * Icono dentro de una pastilla que se colorea y se ensancha en la pestaña activa
 * (patrón de Material 3). Espejo del tab bar de la web.
 */
function TabIcon({
  icon: Icon,
  color,
  focused,
}: {
  icon: LucideIcon;
  /** Lo que entrega React Navigation en `tabBarIcon`, no siempre un string. */
  color: ColorValue;
  focused: boolean;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.pill,
        focused
          ? { width: 62, backgroundColor: colors.primarySoft }
          : { width: 44, backgroundColor: "transparent" },
      ]}
    >
      <Icon size={20} color={String(color)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 30,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
