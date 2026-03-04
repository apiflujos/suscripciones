import express from "express";
import { LogLevel, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { systemLog } from "../services/systemLog";

const executeSqlSchema = z.object({
  sql: z.string().min(1).max(100_000)
});

const SQL_FIRST_TOKENS = new Set([
  "select",
  "with",
  "show",
  "explain",
  "values",
  "update",
  "insert",
  "delete",
  "create",
  "alter",
  "drop",
  "truncate",
  "begin",
  "commit",
  "rollback",
  "do"
]);

function sanitizeSqlInput(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // Si el usuario pega markdown con ```sql ... ```, tomamos solo el contenido SQL.
  const fenced = raw.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return String(fenced[1]).trim();
  return raw;
}

function firstToken(sql: string) {
  const n = normalizeForCheck(sql);
  const m = n.match(/^([a-z_]+)/);
  return m ? m[1] : "";
}

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

function jsonSafeValue(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => jsonSafeValue(item));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafeValue(v);
    return out;
  }
  return value;
}

async function runStatement(
  client: Prisma.TransactionClient | typeof prisma,
  statement: string,
  maxRows: number
) {
  if (isReadOnlyStatement(statement)) {
    const rows = (await client.$queryRawUnsafe(statement)) as any;
    const arr = Array.isArray(rows) ? rows : [rows];
    const safeRows = jsonSafeValue(arr) as any[];
    return {
      type: "query" as const,
      rowCount: safeRows.length,
      rows: safeRows.slice(0, maxRows),
      truncated: safeRows.length > maxRows
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
  if (!parsed.success) return res.status(400).json({ error: "cuerpo_invalido", details: parsed.error.flatten() });

  const sql = sanitizeSqlInput(parsed.data.sql);
  const statements = splitSqlStatements(sql);
  if (!statements.length) return res.status(400).json({ error: "sql_vacio", message: "No se encontró SQL válido para ejecutar." });
  if (statements.length > 30) return res.status(400).json({ error: "demasiadas_sentencias", max: 30 });
  const invalid = statements.find((s) => !SQL_FIRST_TOKENS.has(firstToken(s)));
  if (invalid) {
    return res.status(400).json({
      error: "sentencia_no_sql",
      message: "Se detectó texto que no parece SQL. Pega solo sentencias SQL.",
      statement: invalid
    });
  }

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
