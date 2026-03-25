import { SmartListRule } from "./smartList";

export type SystemSmartList = {
  id: string;
  name: string;
  category: string;
  description?: string;
  rules: SmartListRule;
};

export const SYSTEM_SMART_LISTS: SystemSmartList[] = [];

export function getSystemSmartList(id: string) {
  return SYSTEM_SMART_LISTS.find((list) => list.id === id) || null;
}

export function getSystemSmartLists() {
  return SYSTEM_SMART_LISTS.slice();
}
