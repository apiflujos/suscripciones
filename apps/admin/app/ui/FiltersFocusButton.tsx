"use client";

export function FiltersFocusButton({ label = "Filtros" }: { label?: string }) {
  const focusFilters = () => {
    const container = document.querySelector(".page-header-standard-filters");
    if (!container) return;
    const target = container.querySelector("select, input, button") as HTMLElement | null;
    if (target) {
      target.focus();
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  return (
    <button
      className="ghost btn-compact btn-icon-only btn-filter"
      type="button"
      aria-label={label}
      title={label}
      onClick={focusFilters}
    />
  );
}
