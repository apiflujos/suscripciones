import express from "express";
import { LogLevel, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";

const executeSqlSchema = z.object({
  sql: z.string().min(1).max(100_000)
});

function splitSqlStatements(input: string) {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1] || "";

    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === "-" && next === "-") {
      cur += ch + next;
      i += 1;
      inLineComment = true;
      continue;
    }
    if (!inSingle && !inDouble && ch === "/" && next === "*") {
      cur += ch + next;
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      cur += ch;
      if (inSingle && next === "'") {
        cur += next;
        i += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }
    if (ch === `"` && !inSingle) {
      inDouble = !inDouble;
      cur += ch;
      continue;
    }
    if (ch === ";" && !inSingle && !inDouble) {
      const stmt = cur.trim();
      if (stmt) out.push(stmt);
      cur = "";
      continue;
    }
    cur += ch;
  }

  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

function normalizeForCheck(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim()
    .toLowerCase();
}

function isReadOnlyStatement(sql: string) {
  const n = normalizeForCheck(sql);
  return (
    n.startsWith("select") ||
    n.startsWith("with") ||
    n.startsWith("show") ||
    n.startsWith("explain") ||
    n.startsWith("values")
  );
}

function isTxControlStatement(sql: string) {
  const n = normalizeForCheck(sql);
  return n === "begin" || n === "begin transaction" || n === "commit" || n === "rollback";
}

async function runStatement(
  client: Prisma.TransactionClient | typeof prisma,
  statement: string,
  maxRows: number
) {
  if (isReadOnlyStatement(statement)) {
    const rows = (await client.$queryRawUnsafe(statement)) as any;
    const arr = Array.isArray(rows) ? rows : [rows];
    return {
      type: "query" as const,
      rowCount: arr.length,
      rows: arr.slice(0, maxRows),
      truncated: arr.length > maxRows
    };
  }

  const affectedRows = Number(await client.$executeRawUnsafe(statement));
  return {
    type: "execute" as const,
    affectedRows: Number.isFinite(affectedRows) ? affectedRows : 0
  };
}

export const sqlConsoleRouter = express.Router();

sqlConsoleRouter.post("/execute", async (req, res) => {
  const parsed = executeSqlSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });

  const sql = String(parsed.data.sql || "").trim();
  const statements = splitSqlStatements(sql);
  if (!statements.length) return res.status(400).json({ error: "empty_sql" });
  if (statements.length > 30) return res.status(400).json({ error: "too_many_statements", max: 30 });

  const startedAt = Date.now();
  try {
    const results: any[] = [];
    const txControlsPresent = statements.some((s) => isTxControlStatement(s));
    const executable = statements.filter((s) => !isTxControlStatement(s));

    if (txControlsPresent) {
      await prisma.$transaction(async (tx) => {
        for (const statement of executable) {
          const out = await runStatement(tx, statement, 300);
          results.push({ statement, ...out });
        }
      });
    } else {
      for (const statement of executable) {
        const out = await runStatement(prisma, statement, 300);
        results.push({ statement, ...out });
      }
    }

    await systemLog(LogLevel.WARN, "sql.console", "SQL console execution", {
      statementCount: statements.length
    }).catch(() => {});

    return res.json({
      ok: true,
      statementCount: statements.length,
      durationMs: Date.now() - startedAt,
      results
    });
  } catch (err: any) {
    return res.status(400).json({
      error: "sql_execution_failed",
      message: String(err?.message || err),
      durationMs: Date.now() - startedAt
    });
  }
});
