import { SmartListRule } from "./smartList";

export type SystemSmartList = {
  id: string;
  name: string;
  category: string;
  description?: string;
  rules: SmartListRule;
};

const gamificationLists: SystemSmartList[] = [
  {
    id: "system:tier:oro",
    name: "Gamificación: Oro",
    category: "Gamificación",
    description: ">= 6 pagos aprobados",
    rules: { field: "tier", op: "equals", value: "Oro" }
  },
  {
    id: "system:tier:plata",
    name: "Gamificación: Plata",
    category: "Gamificación",
    description: "3 a 5 pagos aprobados",
    rules: { field: "tier", op: "equals", value: "Plata" }
  },
  {
    id: "system:tier:bronce",
    name: "Gamificación: Bronce",
    category: "Gamificación",
    description: "1 a 2 pagos aprobados",
    rules: { field: "tier", op: "equals", value: "Bronce" }
  },
  {
    id: "system:tier:rookie",
    name: "Gamificación: Rookie",
    category: "Gamificación",
    description: "0 pagos aprobados",
    rules: { field: "tier", op: "equals", value: "Rookie" }
  }
];

const rankingLists: SystemSmartList[] = [
  {
    id: "system:ranking:top",
    name: "Ranking: Top",
    category: "Ranking",
    description: ">= 6 pagos aprobados",
    rules: { field: "approvedPaymentsCount", op: "gte", value: 6 }
  },
  {
    id: "system:ranking:recurrente",
    name: "Ranking: Recurrente",
    category: "Ranking",
    description: "3 a 5 pagos aprobados",
    rules: {
      op: "and",
      rules: [
        { field: "approvedPaymentsCount", op: "gte", value: 3 },
        { field: "approvedPaymentsCount", op: "lt", value: 6 }
      ]
    }
  },
  {
    id: "system:ranking:nuevo",
    name: "Ranking: Nuevo",
    category: "Ranking",
    description: "0 a 2 pagos aprobados",
    rules: { field: "approvedPaymentsCount", op: "lt", value: 3 }
  }
];

const statusLists: SystemSmartList[] = [
  {
    id: "system:status:en-mora",
    name: "Estado: En mora",
    category: "Estado",
    description: "Suscripción en mora o vencida",
    rules: { field: "inMora", op: "equals", value: true }
  },
  {
    id: "system:status:con-suscripcion",
    name: "Estado: Con suscripción",
    category: "Estado",
    description: "Tiene una suscripción activa",
    rules: { field: "hasSubscription", op: "equals", value: true }
  },
  {
    id: "system:status:sin-suscripcion",
    name: "Estado: Sin suscripción",
    category: "Estado",
    description: "No tiene suscripción",
    rules: { field: "hasSubscription", op: "equals", value: false }
  }
];

export const SYSTEM_SMART_LISTS: SystemSmartList[] = [
  ...gamificationLists,
  ...rankingLists,
  ...statusLists
];

export function getSystemSmartList(id: string) {
  return SYSTEM_SMART_LISTS.find((list) => list.id === id) || null;
}

export function getSystemSmartLists() {
  return SYSTEM_SMART_LISTS.slice();
}

