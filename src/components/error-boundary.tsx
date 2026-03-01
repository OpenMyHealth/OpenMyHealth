import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
  resetKey: number;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
      resetKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
      resetKey: 0,
    };
  }

  componentDidCatch(error: Error): void {
    console.error("[ui] uncaught render error:", error);
  }

  reset = (): void => {
    this.setState((current) => ({
      error: null,
      resetKey: current.resetKey + 1,
    }));
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
