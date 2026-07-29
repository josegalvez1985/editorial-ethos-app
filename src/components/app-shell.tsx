import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { BottomNav } from "@/components/bottom-nav";

/**
 * Marco de las pantallas con sesión: cabecera arriba, tab bar abajo y el
 * contenido en una sola columna.
 *
 * La app se usa desde el celular, así que en pantallas grandes no estiramos el
 * contenido: lo dejamos en una columna del ancho de un teléfono con bordes a los
 * lados. Así se ve igual en los dos sitios y no hay que diseñar dos veces.
 */
export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40">
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background sm:border-x sm:border-border/60">
        <AppHeader />
        {/* pb-28: hueco para que el tab bar fijo no tape el final del contenido */}
        <main className="flex-1 pb-28">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
