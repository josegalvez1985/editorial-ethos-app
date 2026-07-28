import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type User = { name: string; email: string };
type Ctx = {
  user: User | null;
  biometry: boolean;
  login: (email: string) => void;
  logout: () => void;
  setBiometry: (v: boolean) => void;
};

const SessionContext = createContext<Ctx | null>(null);
const USER_KEY = "ethos-user";
const BIO_KEY = "ethos-biometry";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [biometry, setBiometryState] = useState(false);

  useEffect(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      if (u) setUser(JSON.parse(u));
      setBiometryState(localStorage.getItem(BIO_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const login = (email: string) => {
    const name = email.split("@")[0] || "Lector";
    const u = { email, name: name.charAt(0).toUpperCase() + name.slice(1) };
    setUser(u);
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  };

  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  };

  const setBiometry = (v: boolean) => {
    setBiometryState(v);
    try {
      localStorage.setItem(BIO_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <SessionContext.Provider value={{ user, biometry, login, logout, setBiometry }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
