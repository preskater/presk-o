"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";
import { revokeOtherSessionsAction, revokeSessionAction } from "./session-actions";

/**
 * Revocation controls.
 *
 * Both actions are confirmed inside the page rather than with `window.confirm`:
 * the second step names what disappears, stays keyboard-accessible and can be read
 * by a screen reader. The server re-checks ownership on its own; these components
 * are a comfort, not a guard.
 */

const SECONDARY_BUTTON =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";
const DANGER_BUTTON =
  "rounded-md bg-rose-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-60";

function ErrorLine({ result }: { result: ActionResult | null }) {
  if (!result || result.status === "ok") {
    return null;
  }

  return (
    <span className="text-xs text-rose-700 dark:text-rose-400" role="alert">
      {result.message}
    </span>
  );
}

/** Revokes one non-current session. */
export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(): void {
    startTransition(async () => {
      const outcome = await revokeSessionAction({ id: sessionId });
      setResult(outcome);

      if (outcome.status === "ok") {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  if (!confirming) {
    return (
      <span className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
          className={SECONDARY_BUTTON}
        >
          Révoquer
        </button>
        <ErrorLine result={result} />
      </span>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-xs">Révoquer cette session ? Elle devra se reconnecter.</span>
      <span className="flex gap-1">
        <button type="button" onClick={remove} disabled={pending} className={DANGER_BUTTON}>
          {pending ? "Révocation..." : "Confirmer"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className={SECONDARY_BUTTON}
        >
          Annuler
        </button>
      </span>
      <ErrorLine result={result} />
    </span>
  );
}

/** Revokes every active session except the one making the request. */
export function RevokeOtherSessionsButton({ otherCount }: { otherCount: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(): void {
    startTransition(async () => {
      const outcome = await revokeOtherSessionsAction();
      setResult(outcome);

      if (outcome.status === "ok") {
        setConfirming(false);
        router.refresh();
      }
    });
  }

  const label =
    otherCount > 1
      ? `Révoquer les ${otherCount} autres sessions`
      : "Révoquer l'autre session";

  // Once the last other session is gone, the confirmation has nothing left to act
  // on; only the success message is worth keeping on screen.
  if (otherCount === 0 && result?.status !== "ok") {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {otherCount === 0 ? null : confirming ? (
        <>
          <span className="text-sm">
            Révoquer toutes les sessions sauf celle-ci ? Les autres appareils devront se
            reconnecter.
          </span>
          <span className="flex gap-1">
            <button type="button" onClick={remove} disabled={pending} className={DANGER_BUTTON}>
              {pending ? "Révocation..." : "Confirmer"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className={SECONDARY_BUTTON}
            >
              Annuler
            </button>
          </span>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
          className={SECONDARY_BUTTON}
        >
          {label}
        </button>
      )}

      {result?.status === "ok" ? (
        <span className="text-xs text-zinc-600 dark:text-zinc-400" role="status">
          {result.message}
        </span>
      ) : (
        <ErrorLine result={result} />
      )}
    </div>
  );
}
