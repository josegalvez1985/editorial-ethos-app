import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, LogOut, Mail, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Mi cuenta — Juventud con Valores" },
      { name: "description", content: "Configura el tema y tus preferencias." },
    ],
  }),
  component: AccountPage,
});

/** Bloque de ajustes al estilo de la app de Ajustes: título chico + tarjeta con filas. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </h2>
      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
        {children}
      </div>
    </section>
  );
}

/* Acá vivía `Row`, la fila de ícono + título + descripción de los grupos de
   ajustes. Su último uso era "App instalable", que se quitó el 31/07/2026, así
   que quedó sin consumidores. Si vuelve a hacer falta una fila así, está en el
   historial de git. */

/**
 * Si un color es lo bastante claro como para necesitar texto oscuro encima.
 *
 * Luminancia relativa de WCAG: los coeficientes 0.2126/0.7152/0.0722 son el
 * aporte de cada canal a lo que el ojo percibe como brillo — el verde pesa diez
 * veces más que el azul. Un promedio simple de R+G+B daría que #0000ff (azul
 * puro) y #00ff00 (verde puro) son igual de claros, y no lo son ni cerca.
 *
 * EL UMBRAL ES 0.38 y está medido, no elegido a ojo. Las muestras del modo
 * oscuro son claras a propósito —tienen que verse sobre un fondo oscuro— y
 * caen entre 0.39 y 0.68, que es justo la zona donde un tilde blanco deja de
 * contrastar. Con 0.55 (el valor "intuitivo") ocho de las veintidós quedaban
 * por debajo de 2.5:1; con 0.38 el peor caso de las veintidós es 4.92:1.
 *
 * Si se agrega una paleta, verificar que su muestra no caiga cerca del umbral.
 */
function esClaro(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const canal = (v: number) => {
    const s = v / 255;
    // Rampa sRGB -> lineal: la pantalla no es lineal, el ojo tampoco.
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l =
    0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
  return l > 0.38;
}

function AccountPage() {
  const { theme, setTheme, palette, setPalette } = useTheme();
  const { user, logout } = useSession();
  const navigate = useNavigate();

  const displayName = user?.name ?? "Invitado";
  const displayEmail = user?.email ?? "invitado@ethos.mx";
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onLogout = async () => {
    await logout();
    toast.success("Sesión cerrada");
    navigate({ to: "/", replace: true });
  };

  const themeOptions = [
    { value: "light" as const, label: "Claro", icon: Sun },
    { value: "dark" as const, label: "Oscuro", icon: Moon },
  ];

  /*
   * Las muestras de color van CABLEADAS y no leídas de las variables CSS, a
   * propósito: la muestra tiene que mostrar el color de SU paleta, no el de la
   * que está aplicada. Un `bg-primary` acá pintaría las cuatro iguales.
   *
   * Cada par es [claro, oscuro] de esa paleta, y se muestra el que corresponde
   * al modo activo — así la muestra se parece a lo que va a pasar al tocarla.
   * Si se cambia un `--primary` en styles.css, actualizar acá.
   */
  const paletaOptions = [
    { value: "marca" as const, label: "Marca", colores: ["#27306a", "#8fb0dd"] },
    { value: "slate" as const, label: "Slate", colores: ["#334155", "#94a9c4"] },
    { value: "grafito" as const, label: "Grafito", colores: ["#27272a", "#d4d4d8"] },
    { value: "azul" as const, label: "Azul", colores: ["#1d4ed8", "#7cadf5"] },
    { value: "indigo" as const, label: "Índigo", colores: ["#4f46e5", "#a5b4fc"] },
    { value: "teal" as const, label: "Teal", colores: ["#0f6f6c", "#4fd1c5"] },
    { value: "verde" as const, label: "Verde", colores: ["#15803d", "#5fd68b"] },
    { value: "violeta" as const, label: "Violeta", colores: ["#7c3aed", "#c4a5fd"] },
    { value: "rosa" as const, label: "Rosa", colores: ["#be185d", "#f9a8d4"] },
    { value: "naranja" as const, label: "Naranja", colores: ["#c2410c", "#fdba74"] },
    { value: "ambar" as const, label: "Ámbar", colores: ["#a16207", "#fcd34d"] },
  ];

  return (
    <AppShell>
      <div className="px-5 pt-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Configuración
        </p>
        <h1 className="font-display mt-1 text-[2rem] leading-none font-bold">Mi cuenta</h1>

        {/* Perfil */}
        <div className="relative mt-5 overflow-hidden rounded-3xl bg-hero-gradient p-5 text-on-brand shadow-elegant">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:20px_20px]" />
          <div className="relative flex items-center gap-4">
            <div className="grid size-15 shrink-0 place-items-center rounded-full border-2 border-white/30 bg-white/15 text-lg font-bold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display truncate text-[1.35rem] leading-tight font-bold">
                {displayName}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-on-brand/80">
                <Mail className="size-3.5 shrink-0" />
                <span className="truncate">{displayEmail}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Acá estuvo el grupo "Seguridad" con el switch de acceso biométrico.
            Se quitó el 31/07/2026: ver APK.md. Hoy la contraseña se recuerda con
            el check del login, sin huella de por medio. */}

        <Group label="Apariencia">
          <div className="p-4">
            <p className="text-[15px] font-semibold">Tema</p>
            {/* Control segmentado: la opción activa se desliza sobre el riel */}
            <div
              role="radiogroup"
              aria-label="Tema"
              className="mt-3 flex gap-1 rounded-full bg-muted p-1"
            >
              {themeOptions.map((opt) => {
                const active = theme === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(opt.value)}
                    className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-all duration-200 ease-out ${
                      active
                        ? "bg-card text-foreground shadow-soft"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/*
            La paleta es un eje APARTE del claro/oscuro: se combinan, no se
            reemplazan. Cada paleta tiene su versión clara y su versión oscura,
            así que se puede tener "Teal oscuro" o "Slate claro".

            Solo cambia el color: la tipografía es la misma en las cuatro.
          */}
          <div className="p-4">
            <p className="text-[15px] font-semibold">Color</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Se combina con el modo claro u oscuro
            </p>
            {/* 3 columnas y no 2: con once opciones, dos columnas hacen una
                lista de seis filas que no entra en una pantalla de celular. */}
            <div
              role="radiogroup"
              aria-label="Paleta de colores"
              className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4"
            >
              {paletaOptions.map((opt) => {
                const active = palette === opt.value;
                // La muestra sigue al modo activo, para que se parezca al resultado.
                const muestra = theme === "dark" ? opt.colores[1] : opt.colores[0];
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPalette(opt.value)}
                    title={opt.label}
                    className={`tap flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2.5 transition-colors ${
                      active
                        ? "border-primary bg-primary-soft"
                        : "border-border/60 bg-card hover:bg-accent"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="relative grid size-7 shrink-0 place-items-center rounded-full border border-black/10 shadow-soft"
                      style={{ backgroundColor: muestra }}
                    >
                      {/* El tilde va DENTRO de la muestra: afuera obligaba a
                          angostar el texto y "Naranja" quedaba cortado.

                          El color se decide por luminancia y no es blanco fijo:
                          sobre las muestras claras del modo oscuro (ámbar
                          #fcd34d, grafito #d4d4d8) un tilde blanco desaparece. */}
                      {active && (
                        <Check
                          className="size-4 drop-shadow-sm"
                          style={{ color: esClaro(muestra) ? "#18181b" : "#ffffff" }}
                        />
                      )}
                    </span>
                    <span
                      className={`w-full truncate text-center text-[11.5px] leading-tight font-semibold ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Group>

        <Group label="Cuenta">
          <button
            type="button"
            onClick={onLogout}
            className="tap flex w-full items-center gap-3.5 p-4 text-left hover:bg-accent"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <LogOut className="size-5" />
            </div>
            <p className="flex-1 text-[15px] font-semibold text-destructive">Cerrar sesión</p>
          </button>
        </Group>
      </div>
    </AppShell>
  );
}
