import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Global error boundary (P6 task 7) — catches render errors anywhere below it so one broken
 * screen doesn't take down the whole app shell. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center" role="alert">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="max-w-md text-sm text-muted-foreground">{this.state.error.message}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}
