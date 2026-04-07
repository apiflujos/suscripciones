"use client";

import type { CSSProperties, KeyboardEventHandler, ReactNode, Ref } from "react";

type AppModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: CSSProperties["width"];
  maxWidth?: CSSProperties["maxWidth"];
  panelClassName?: string;
  bodyClassName?: string;
  headerActions?: ReactNode;
  closeLabel?: string;
  closeOnBackdrop?: boolean;
  panelRef?: Ref<HTMLDivElement>;
  panelOnKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  ariaLabelledBy?: string;
  panelTabIndex?: number;
};

export function AppModal({
  open,
  onClose,
  title,
  children,
  footer,
  width,
  maxWidth,
  panelClassName,
  bodyClassName,
  headerActions,
  closeLabel = "Cerrar",
  closeOnBackdrop = true,
  panelRef,
  panelOnKeyDown,
  ariaLabelledBy,
  panelTabIndex
}: AppModalProps) {
  if (!open) return null;

  const panelStyle: CSSProperties = {
    ...(width ? { width } : {}),
    ...(maxWidth ? { maxWidth } : {})
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={panelClassName ? `modal-panel ${panelClassName}` : "modal-panel"}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={panelOnKeyDown}
        tabIndex={panelTabIndex}
      >
        <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {headerActions}
            <button
              type="button"
              className="ghost modal-close"
              onClick={onClose}
              aria-label={closeLabel}
              data-modal-close="true"
              data-loader="off"
            >
              X
            </button>
          </div>
        </div>

        <div className={bodyClassName || "modal-body"}>{children}</div>

        {footer ? <div className="module-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
