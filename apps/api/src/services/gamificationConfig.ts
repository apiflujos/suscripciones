export const GAMIFICATION_LEVEL_NAMES = [
  "Rookie",
  "Aprendiz",
  "Bronce I",
  "Bronce II",
  "Plata I",
  "Plata II",
  "Oro I",
  "Oro II",
  "Platino I",
  "Platino II",
  "Diamante I",
  "Diamante II",
  "Elite I",
  "Elite II",
  "Maestro I",
  "Maestro II",
  "Legendario I",
  "Legendario II",
  "Icono",
  "Icono Supremo"
];

const LEVEL_BASE = 250;
const LEVEL_GROWTH = 1.35;

export const GAMIFICATION_LEVEL_THRESHOLDS = Array.from({ length: GAMIFICATION_LEVEL_NAMES.length }, (_, idx) => {
  if (idx === 0) return 0;
  return Math.round(LEVEL_BASE * Math.pow(LEVEL_GROWTH, idx));
});

export function levelForScore(score: number) {
  const safe = Math.max(0, Math.round(score || 0));
  let level = 1;
  for (let i = 0; i < GAMIFICATION_LEVEL_THRESHOLDS.length; i += 1) {
    if (safe >= GAMIFICATION_LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const name = GAMIFICATION_LEVEL_NAMES[level - 1] || GAMIFICATION_LEVEL_NAMES[0];
  const nextAt = GAMIFICATION_LEVEL_THRESHOLDS[level] ?? null;
  return { level, name, nextAt };
}

export function moneyToPoints(amountInCents?: number | null, scale = 10000) {
  const amount = Number(amountInCents || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(1, Math.round(amount / scale));
}

export const GAMIFICATION_WEIGHTS = {
  paymentApproved: { status: 120, lifetime: 100, reward: 40, moneyScale: 10000 },
  paymentFailed: { status: -60, lifetime: 0, reward: 0 },
  subscriptionStarted: { status: 60, lifetime: 40, reward: 10 },
  subscriptionRenewed: { status: 70, lifetime: 50, reward: 15 },
  subscriptionCanceled: { status: -120, lifetime: 0, reward: 0 },
  subscriptionPastDue: { status: -80, lifetime: 0, reward: 0 },
  chatwootMessageIn: { status: 12, lifetime: 6, reward: 2 },
  dataEmailAdded: { status: 10, lifetime: 10, reward: 0 },
  dataPhoneAdded: { status: 10, lifetime: 10, reward: 0 },
  dataIdAdded: { status: 15, lifetime: 15, reward: 0 }
};

export const GAMIFICATION_RECENCY = {
  payment24h: 30,
  payment7d: 18,
  payment30d: 8,
  activity24h: 18,
  activity7d: 10,
  activity30d: 4
};

export const GAMIFICATION_PENALTIES = {
  pastDue: 90,
  canceled: 120,
  noResponse: 25
};

export const GAMIFICATION_CONSISTENCY = {
  perPayment: 8,
  maxMonths: 24
};

export const GAMIFICATION_DECAY = {
  inactivityDays: 30,
  perDay: 2,
  maxPenalty: 180
};

export const GAMIFICATION_DATA_QUALITY = {
  email: 12,
  phone: 12,
  id: 15,
  address: 8
};

export const GAMIFICATION_FACTORS_DEFAULT = {
  factor: 1,
  bonus: 0
};
