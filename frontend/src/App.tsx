import { useEffect, useState } from "react";

const BACKEND_URL = "http://localhost:8000";

export default function App() {
  const [backendStatus, setBackendStatus] = useState("checking…");

  useEffect(() => {
    fetch(`${BACKEND_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.status === "ok" ? "OK" : "unexpected response"))
      .catch(() => setBackendStatus("unreachable"));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">AI Evals</h1>
        <p className="mt-3 text-lg text-slate-600">
          Compare AI models on output quality — side by side.
        </p>
        <p className="mt-6 text-sm text-slate-500">
          Backend health: <span className="font-medium text-slate-800">{backendStatus}</span>
        </p>
      </div>
    </main>
  );
}
