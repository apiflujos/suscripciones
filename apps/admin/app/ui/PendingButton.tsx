"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingText: string;
  children: ReactNode;
};

export function PendingButton({ pendingText, children, disabled, ...props }: PendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button {...props} disabled={disabled || pending}>
      {pending ? pendingText : children}
    </button>
  );
}
