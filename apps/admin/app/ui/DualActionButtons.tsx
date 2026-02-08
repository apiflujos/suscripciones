"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type DualActionButtonsProps = {
  primaryLabel: string;
  primaryPendingLabel: string;
  primaryClassName?: string;
  secondaryLabel: string;
  secondaryPendingLabel: string;
  secondaryClassName?: string;
  secondaryFormAction?: (formData: FormData) => void;
};

export function DualActionButtons({
  primaryLabel,
  primaryPendingLabel,
  primaryClassName,
  secondaryLabel,
  secondaryPendingLabel,
  secondaryClassName,
  secondaryFormAction
}: DualActionButtonsProps) {
  const { pending } = useFormStatus();
  const [intent, setIntent] = useState<"primary" | "secondary" | null>(null);

  const primaryText = pending && (intent === "primary" || intent === null) ? primaryPendingLabel : primaryLabel;
  const secondaryText = pending && intent === "secondary" ? secondaryPendingLabel : secondaryLabel;

  return (
    <>
      <button
        className={secondaryClassName}
        type="submit"
        formAction={secondaryFormAction}
        disabled={pending}
        onClick={() => setIntent("secondary")}
      >
        {secondaryText}
      </button>
      <button className={primaryClassName} type="submit" disabled={pending} onClick={() => setIntent("primary")}>
        {primaryText}
      </button>
    </>
  );
}
