"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstNotificationDeliveryError = firstNotificationDeliveryError;
exports.didNotificationSendNow = didNotificationSendNow;
function firstNotificationDeliveryError(result) {
    const error = String(result?.errors?.[0] || "").trim();
    if (error)
        return error;
    if (result?.rulesActive && Number(result?.sentNow || 0) <= 0)
        return "notification_not_delivered";
    return "";
}
function didNotificationSendNow(result) {
    return Number(result?.sentNow || 0) > 0;
}
