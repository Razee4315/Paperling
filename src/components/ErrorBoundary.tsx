import { Component, ErrorInfo, ReactNode } from "react";
import { revealMainWindow } from "../utils/appWindow";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Paperling crashed:", error, errorInfo);
        // A crash during App's mount means its reveal effect never ran and the
        // window (created hidden) would stay invisible. Show it here so the user
        // actually sees this fallback UI instead of a running-but-hidden app.
        revealMainWindow();
    }

    handleReload = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="h-screen flex flex-col items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)] p-8">
                    <div className="flex flex-col items-center gap-6 max-w-md text-center">
                        <span className="material-symbols-outlined text-[48px] text-[var(--danger)]">
                            error
                        </span>
                        <h1 className="text-xl font-bold">Something went wrong</h1>
                        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                            Paperling encountered an unexpected error. Your file data should be safe.
                        </p>
                        {this.state.error && (
                            <pre className="w-full text-left text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4 overflow-auto max-h-32 text-[var(--text-secondary)]">
                                {this.state.error.message}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReload}
                            className="flex items-center gap-2 bg-[var(--accent)] text-[var(--accent-text)] font-medium text-sm px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
                        >
                            <span className="material-symbols-outlined text-[20px]">refresh</span>
                            Try Again
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
