"use client";

export function RunCampaignButton({
  disabled,
  label = "Enviar"
}: {
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      className="ghost"
      type="submit"
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        if (!confirm("¿Enviar esta campaña ahora?")) {
          e.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
