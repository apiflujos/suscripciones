import Link from "next/link";

interface Tab {
  label: string;
  href: string;
  active: boolean;
  count?: number;
}

interface PageTabsProps {
  tabs: Tab[];
}

export function PageTabs({ tabs }: PageTabsProps) {
  return (
    <div className="page-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.label}
          className={`page-tab ${tab.active ? "is-active" : ""}`}
          href={tab.href}
          prefetch={false}
        >
          {tab.label}
          {typeof tab.count === "number" && (
            <span className="page-tab-count">{tab.count}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
