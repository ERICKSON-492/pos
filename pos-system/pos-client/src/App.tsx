import { useEffect, useState } from "react";
import { Login } from "./components/Login";
import { PosTerminal } from "./components/PosTerminal";
import { setAuthToken, startSyncLoop } from "./api/client";

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("pos_token"));

  useEffect(() => {
    if (token) {
      setAuthToken(token);
      localStorage.setItem("pos_token", token);
    }
  }, [token]);

  useEffect(() => {
    const stop = startSyncLoop();
    return stop;
  }, []);

  if (!token) return <Login onLogin={setToken} />;
  return <PosTerminal />;
}
