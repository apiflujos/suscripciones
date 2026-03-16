"use client";

export function ViewModeToggles({
  currentMode,
  baseParams,
  showKanban = false
}: {
  currentMode: "cards" | "lista" | "kanban";
  baseParams: Record<string, string>;
  showKanban?: boolean;
}) {
  const modes: Array<{ key: "cards" | "lista" | "kanban"; label: string; svg: string }> = [
    {
      key: "cards",
      label: "Cards",
      svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>'
    },
    {
      key: "lista",
      label: "Lista",
      svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="12" height="2" rx="0.5"/><rect x="2" y="7" width="12" height="2" rx="0.5"/><rect x="2" y="11" width="12" height="2" rx="0.5"/></svg>'
    }
  ];

  if (showKanban) {
    modes.push({
      key: "kanban",
      label: "Kanban",
      svg: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="3" height="12" rx="0.5"/><rect x="6.5" y="2" width="3" height="8" rx="0.5"/><rect x="11" y="2" width="3" height="10" rx="0.5"/></svg>'
    });
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
            className={`ghost btn-compact btn-icon-only btn-noicon ${isActive ? "is-active" : ""}`}
            href={href}
            title={`${mode.label} (clic para cambiar)`}
            style={{
              minWidth: 28,
              width: 28,
              height: 28,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center"
            }}
            dangerouslySetInnerHTML={{ __html: mode.svg }}
          />
        );
      })}
    </div>
  );
}
