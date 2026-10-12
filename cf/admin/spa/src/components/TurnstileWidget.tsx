import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { WIDGET_ERROR_MESSAGE } from "~/lib/auth-errors";
import { loadTurnstile, type TurnstileApi, type TurnstileControl } from "~/lib/turnstile";

/**
 * Cloudflare's security check (Turnstile) inside a form. State and the token
 * live in `useTurnstile` (lib/turnstile.ts); this draws the widget and tells
 * that state what the widget said. It renders nothing when the deployment has
 * no site key (local runs, the mock), so a form without one works as before.
 *
 *   const turnstile = useTurnstile("login", config.turnstileSiteKey);
 *   <TurnstileWidget turnstile={turnstile} />
 *   <Button disabled={turnstile.blocked}>…</Button>
 *
 * The widget labels itself (its frame carries its own title and, with
 * `language: "id"`, its own Indonesian text), so nothing is added around it.
 * When it cannot run at all, the failure is said in an Alert (announced at
 * once), because otherwise the button would just stay disabled with no reason.
 */
export function TurnstileWidget({ turnstile }: { turnstile: TurnstileControl }) {
  const { siteKey, action, widget, failed } = turnstile;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = box.current;
    if (!siteKey || !container) return;
    let cancelled = false;
    let drawn: { api: TurnstileApi; id: string } | null = null;

    loadTurnstile().then(
      (api) => {
        if (cancelled) return;
        let id: string | undefined;
        try {
          id = api.render(container, {
            sitekey: siteKey,
            action,
            theme: "light", // the admin has one theme
            size: "flexible", // fills the column (300 px at the least)
            language: "id",
            callback: widget.onToken,
            "expired-callback": widget.onLost,
            "timeout-callback": widget.onLost,
            "error-callback": widget.onFailure,
          });
        } catch {
          id = undefined;
        }
        if (id === undefined) {
          widget.onFailure();
          return;
        }
        drawn = { api, id };
        widget.attach(api, id);
      },
      () => {
        if (!cancelled) widget.onFailure();
      },
    );

    return () => {
      cancelled = true;
      widget.detach();
      if (drawn) drawn.api.remove(drawn.id);
    };
  }, [siteKey, action, widget]);

  if (!siteKey) return null;
  return (
    <div className="space-y-3">
      {/* 65 px is the widget's height: the button below does not jump when it appears. */}
      <div ref={box} className="min-h-[65px]" />
      {failed && <Alert>{WIDGET_ERROR_MESSAGE}</Alert>}
    </div>
  );
}
