export type NotificationScheduleResult = {
  scheduled?: number;
  sentNow?: number;
  rulesActive?: boolean;
  errors?: string[];
};

export function firstNotificationDeliveryError(result: NotificationScheduleResult | null | undefined): string {
  const error = String(result?.errors?.[0] || "").trim();
  if (error) return error;
  if (result?.rulesActive && Number(result?.sentNow || 0) <= 0) return "notification_not_delivered";
  return "";
}

export function didNotificationSendNow(result: NotificationScheduleResult | null | undefined): boolean {
  return Number(result?.sentNow || 0) > 0;
}
