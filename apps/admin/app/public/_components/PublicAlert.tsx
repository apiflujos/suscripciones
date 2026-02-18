import type { ReactNode } from "react";

type PublicAlertProps = {
  children: ReactNode;
};

export function PublicAlert({ children }: PublicAlertProps) {
  return (
    <div
      className="card cardPad"
      style={{ borderColor: "rgba(217, 83, 79, 0.22)", background: "rgba(217, 83, 79, 0.08)" }}
      role="status"
      aria-live="polite"
    >
      {children}
    </div>
  );
}
