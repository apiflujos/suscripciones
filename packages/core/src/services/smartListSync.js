"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSmartListById = syncSmartListById;
exports.syncAllSmartLists = syncAllSmartLists;
const prisma_1 = require("../db/prisma");
const smartList_1 = require("./smartList");
async function syncSmartListById(id) {
    const smartList = await prisma_1.prisma.smartList.findUnique({ where: { id } });
    if (!smartList || !smartList.enabled)
        return { ok: false, reason: "not_found_or_disabled" };
    const recipients = await (0, smartList_1.computeSmartListRecipients)(smartList.rules);
    const recipientIds = new Set(recipients.map((r) => r.id));
    let added = 0;
    let removed = 0;
    for (const customer of recipients) {
        await prisma_1.prisma.smartListMember.upsert({
            where: { smartListId_customerId: { smartListId: smartList.id, customerId: customer.id } },
            create: { smartListId: smartList.id, customerId: customer.id, active: true, lastSeenAt: new Date() },
            update: { active: true, lastSeenAt: new Date() }
        });
        added += 1;
    }
    const currentMembers = await prisma_1.prisma.smartListMember.findMany({
        where: { smartListId: smartList.id, active: true }
    });
    for (const member of currentMembers) {
        if (recipientIds.has(member.customerId))
            continue;
        await prisma_1.prisma.smartListMember.update({
            where: { id: member.id },
            data: { active: false }
        });
        removed += 1;
    }
    await prisma_1.prisma.smartList.update({ where: { id: smartList.id }, data: { lastRunAt: new Date() } });
    return { ok: true, added, removed };
}
async function syncAllSmartLists() {
    const lists = await prisma_1.prisma.smartList.findMany({ where: { enabled: true } });
    const results = [];
    for (const list of lists) {
        const out = await syncSmartListById(list.id).catch(() => null);
        if (out?.ok) {
            results.push({ id: list.id, added: out.added, removed: out.removed, ok: true });
        }
        else {
            results.push({ id: list.id, added: 0, removed: 0, ok: false });
        }
    }
    return results;
}
