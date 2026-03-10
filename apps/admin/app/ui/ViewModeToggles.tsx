"use client";

import { CopyButton } from "./CopyButton";

type ViewMode = "cards" | "lista" | "kanban";

export function ViewModeToggles({
  currentMode,
  baseParams,
  showKanban = false
}: {
  currentMode: ViewMode;
  baseParams: Record<string, string>;
  showKanban?: boolean;
}) {
  const modes: Array<{ key: ViewMode; label: string; icon: string }> = [
    { key: "cards", label: "Cards", icon: "▦" },
    { key: "lista", label: "Lista", icon: "☰" }
  ];
  
  if (showKanban) {
    modes.push({ key: "kanban", label: "Kanban", icon: "⊞" });
  }

  return (
    <div className="viewModeToggles" style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {modes.map((mode) => {
        const isActive = currentMode === mode.key;
        const params = new URLSearchParams(baseParams);
        params.set("vista", mode.key);
        const href = `?${params.toString()}`;
        
        return (
          <a
            key={mode.key}
            className={`ghost btn-compact btn-icon-only ${isActive ? "is-active" : ""}`}
            href={href}
            title={`${mode.label} (clic para cambiar)`}
            style={{
              minWidth: 28,
              width: 28,
              height: 28,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              lineHeight: 1
            }}
          >
            {mode.icon}
          </a>
        );
      })}
    </div>
  );
}
