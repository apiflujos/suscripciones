import { HelpTip } from "../HelpTip";

type PillTone = "default" | "success" | "warning" | "danger" | "info";

interface PageSummaryPillProps {
  label: string;
  value: string | number;
  tone?: PillTone;
  tip?: string;
}

const toneClassMap: Record<PillTone, string> = {
  default: "pill-muted",
  success: "pill-ok",
  warning: "pill-warn",
  danger: "pill-bad",
  info: "pill-info"
};

export function PageSummaryPill({ label, value, tone = "default", tip }: PageSummaryPillProps) {
  const pillClass = toneClassMap[tone] || "pill-muted";
  
  return (
    <span className={`pill ${pillClass}`} title={tip ? `${label}: ${value} · ${tip}` : `${label}: ${value}`}>
      {label}: <strong>{value}</strong>
      {tip && <HelpTip text={tip} />}
    </span>
  );
}
