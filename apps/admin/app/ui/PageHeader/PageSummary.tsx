import { PageSummaryPill } from "./PageSummaryPill";

type PillTone = "default" | "success" | "warning" | "danger" | "info";

interface SummaryItem {
  label: string;
  value: string | number;
  tone?: PillTone;
  tip?: string;
}

interface PageSummaryProps {
  items: SummaryItem[];
  separator?: string;
}

export function PageSummary({ items, separator = "·" }: PageSummaryProps) {
  return (
    <div className="page-summary">
      {items.map((item, index) => (
        <span key={item.label} className="page-summary-item">
          <PageSummaryPill
            label={item.label}
            value={item.value}
            tone={item.tone}
            tip={item.tip}
          />
          {index < items.length - 1 && (
            <span className="page-summary-separator">{separator}</span>
          )}
        </span>
      ))}
    </div>
  );
}
