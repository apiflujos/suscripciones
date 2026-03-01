import type { ReactNode } from "react";

type PublicAlertProps = {
  children: ReactNode;
};

export function PublicAlert({ children }: PublicAlertProps) {
  return (
    <div className="publicAlert" role="status" aria-live="polite">
      <div className="publicAlertIcon" aria-hidden="true">
        !
      </div>
      <div className="publicAlertContent">{children}</div>
    </div>
  );
}
