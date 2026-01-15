import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';

// Explicitly define interfaces for Props and State to ensure TypeScript correctly identifies members like this.props and this.state
interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Use class property to correctly initialize state
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    // Accessing this.state is now correctly typed
    if (this.state.hasError) {
      return (
        <div style={{ background: '#000', color: '#fff', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px' }}>
          <div>
            <h1 style={{ color: '#ef4444' }}>⚠️ Ops! Ocorreu um erro.</h1>
            <p>A aplicação travou ao carregar. Clique no botão abaixo para reiniciar o sistema.</p>
            <button 
              onClick={() => window.location.href = '/'}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '8px', cursor: 'pointer', marginTop: '20px', fontWeight: 'bold' }}
            >
              REINICIAR SISTEMA
            </button>
          </div>
        </div>
      );
    }
    // Accessing this.props is now correctly typed via the ErrorBoundaryProps interface
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <app />
    </ErrorBoundary>
  </React.StrictMode>
);
