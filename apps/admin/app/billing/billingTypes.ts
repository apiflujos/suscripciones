export type CollectionMode = "AUTO_DEBIT" | "AUTO_LINK" | "MANUAL_LINK";

export type EstadoSimpleInfo = {
  label: string;
  class: string;
};

export type EstadoInfo = EstadoSimpleInfo & {
  key: "si" | "no" | "mora";
};

export type CollectionStatusArgs = {
  status: string;
  dueAt: unknown;
  graceDays?: number;
  collectionCyclePaid?: boolean;
  nowDate?: Date;
};

export type CardCollectionStateArgs = {
  status: string;
  dueAt: unknown;
  graceDays?: number;
  collectionCyclePaid?: boolean;
  nowTs?: number;
};

export type BadgeInfo = {
  heading: string;
  value: string;
  className: string;
  title?: string;
};

export type BillingPageSearchParams = Record<string, string | string[] | undefined>;

export type BillingPageContentProps = {
  searchParams?: Promise<BillingPageSearchParams>;
};

export type TenantOption = {
  id: string;
  name: string;
};
