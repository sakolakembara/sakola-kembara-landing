import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the pathname) clears a caught error, so leaving a broken page recovers. */
  resetKey?: string;
  /** "page" sits inside the shell; "app" covers the whole screen. */
  variant?: "page" | "app";
}

interface State {
  failed: boolean;
}

/**
 * Catches a crash while rendering and shows a message in Indonesian instead of
 * a blank screen. React logs the error itself; nothing is sent anywhere (there
 * is no error reporting service in the admin yet).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally empty: React already reports it to the console. Kept so a
    // reporter can be added in one place.
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const full = this.props.variant === "app";
    return (
      <div className={full ? "flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-16" : "p-6 md:p-10"}>
        <div className="mx-auto w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-8 text-center md:p-10">
          <Heading level="subsection" as="h1" className="mb-2 text-gray-900">
            Gagal memuat halaman admin
          </Heading>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            Terjadi kesalahan di browser. Coba lagi atau muat ulang halaman. Jika terus terjadi, hubungi tim teknis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => this.setState({ failed: false })}>Coba lagi</Button>
            <Button href="/" variant="neutral">
              Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
