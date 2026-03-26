interface PageActionsProps {
  children: React.ReactNode;
}

export function PageActions({ children }: PageActionsProps) {
  return (
    <div className="page-actions">
      {children}
    </div>
  );
}
