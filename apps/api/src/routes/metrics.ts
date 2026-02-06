import express from "express";
import { z } from "zod";
import { getMetricsOverview } from "../services/metrics";

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(["day", "week", "month"]).optional().default("day")
});

function defaultRange() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const metricsRouter = express.Router();

metricsRouter.get("/overview", async (req, res) => {
  const parsed = querySchema.safeParse(req.query ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_query", details: parsed.error.flatten() });

  const d = defaultRange();
  const from = parsed.data.from ? new Date(parsed.data.from) : d.from;
  const to = parsed.data.to ? new Date(parsed.data.to) : d.to;

  try {
    const data = await getMetricsOverview({ from, to, granularity: parsed.data.granularity });
    res.json(data);
  } catch (err: any) {
    res.status(400).json({ error: "invalid_range", message: err?.message ? String(err.message) : "invalid_range" });
  }
});

