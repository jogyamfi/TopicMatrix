import { useEffect, useState } from 'react';

interface HealthResponse {
  status: string;
}

// Proves the T1 loop end to end: Vite -> proxy -> Node API -> shared health route.
// Replaced by the real dashboard shell at P6.
export default function App(): React.JSX.Element {
  const [health, setHealth] = useState<'checking' | 'ok' | 'error'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/healthz')
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => {
        if (!cancelled) setHealth(data.status === 'ok' ? 'ok' : 'error');
      })
      .catch(() => {
        if (!cancelled) setHealth('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>TopicMatrix</h1>
      <p>API health: {health}</p>
    </main>
  );
}
