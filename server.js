import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

/* ─── Config (machine-specific paths) ───────────────────────────────────────── */
const cfg = JSON.parse(readFileSync(path.join(__dirname, "config.default.json"), "utf-8"));

const AQP_BIN = cfg.aqpBin;
const DATASETS = cfg.datasets;
const ENGINE_DB = cfg.engineDb;

/* Map frontend split names to CLI values */
const SPLIT_MAP = {
  "relation-center": "relationshipcenter",
  "entity-center": "entitycenter",
  "min-subquery": "minsubquery",
  "node-based": "nodebased",
};

/* ─── Output parser ─────────────────────────────────────────────────────────── */
function parseMiddlewareOutput(stdout) {
  const result = {
    originalSql: "",
    rounds: [],
    finalSql: "",
    output: { columns: [], rows: [] },
  };

  /* Original SQL */
  const origMatch = stdout.match(/Original SQL:\n([\s\S]*?)\n\n/);
  if (origMatch) result.originalSql = origMatch[1].trim();

  /* Iterations — extract sub-SQL, temp table name + cardinality */
  const iterRegex = /========== Iteration (\d+) ==========[\s\S]*?=== Sub-Query SQL ===\n([\s\S]*?)(?=Executing sub-query)/g;
  const tempRegex = /\[Iteration (\d+)\] Created temp table: (\w+) \(index=\d+, cardinality=(\d+)\)/g;
  const timeRegex = /Iteration (\d+) completed in ([\d.]+) ms/g;

  /* Collect sub-SQLs */
  const subSqls = {};
  let m;
  while ((m = iterRegex.exec(stdout)) !== null) {
    subSqls[m[1]] = m[2].trim();
  }

  /* Collect temp tables */
  const temps = {};
  while ((m = tempRegex.exec(stdout)) !== null) {
    temps[m[1]] = { name: m[2], rows: parseInt(m[3]) };
  }

  /* Collect timings */
  const times = {};
  while ((m = timeRegex.exec(stdout)) !== null) {
    times[m[1]] = parseFloat(m[2]);
  }

  /* Build rounds */
  const colors = ["#E53E3E", "#2B6CB0", "#38A169", "#D69E2E", "#9F46E4", "#DD6B20", "#00B5D8", "#E53E8C"];
  const iterNums = Object.keys(subSqls).sort((a, b) => a - b);
  for (const num of iterNums) {
    const idx = parseInt(num) - 1;
    const temp = temps[num] || { name: `temp${num}`, rows: 0 };
    if (times[num] != null) temp.time = times[num];
    const tableCountMatch = stdout.match(
      new RegExp(`\\[Iteration ${num}\\] Extracted subquery with (\\d+) table`)
    );
    const tableCount = tableCountMatch ? parseInt(tableCountMatch[1]) : 0;

    result.rounds.push({
      roundNum: parseInt(num),
      color: colors[idx % colors.length],
      irLabel: idx === 0 ? `IR — ${tableCount} tables` : `Remaining IR ${num}`,
      subIrLabel: `Sub-IR ${num}`,
      subSqlTitle: `Sub-SQL ${num}`,
      subSql: subSqls[num],
      temp,
    });
  }

  /* Final SQL — stop before the "=== Final Sub-Query Plan ===" block (emitted
     by --explain) so the plan text doesn't leak into the SQL shown in SQL mode. */
  const finalMatch = stdout.match(/=== Final Generated (?:Sub-)?SQL ===\n([\s\S]*?)(?=\n=== Final Sub-Query Plan ===|\[IRQuerySplitter\] =+)/);
  if (!finalMatch) {
    /* Fallback: grab everything between header and Query Results */
    const fallback = stdout.match(/=== Final Generated (?:Sub-)?SQL ===\n([\s\S]*?)(?=\n=== Final Sub-Query Plan ===|\n=== Query Results ===|\n={3,})/);
    if (fallback) result.finalSql = fallback[1].trim();
  } else {
    result.finalSql = finalMatch[1].trim();
  }

  /* Combined Sub-Plan SQL (when --combine-sub-plans is used) */
  const combinedMatch = stdout.match(/=== Combined Sub-Plan SQL ===\n([\s\S]*?)(?=\n\[IRQuerySplitter\]|\n=== Query Results ===|$)/);
  if (combinedMatch) {
    result.combinedSql = combinedMatch[1].trim();
    /* Strip combined SQL from finalSql if it got appended */
    if (result.finalSql) {
      const combIdx = result.finalSql.indexOf("=== Combined Sub-Plan SQL ===");
      if (combIdx !== -1) {
        result.finalSql = result.finalSql.substring(0, combIdx).trim();
      }
    }
  }

  /* Final round (the final remaining IR execution) */
  if (result.finalSql) {
    const finalIdx = result.rounds.length;
    /* Get final result row count from Query Results */
    const rowMatch = stdout.match(/Rows: (\d+), Columns: (\d+)/);
    result.rounds.push({
      roundNum: finalIdx + 1,
      color: colors[finalIdx % colors.length],
      irLabel: `Remaining IR ${finalIdx + 1}`,
      subIrLabel: "Final Sub-IR",
      subSqlTitle: "Final Sub-SQL",
      subSql: result.finalSql,
      temp: { name: "result", rows: rowMatch ? parseInt(rowMatch[1]) : 0 },
    });
  }

  /* Extract column aliases from original SQL SELECT clause */
  const selectMatch = result.originalSql.match(/SELECT\s+([\s\S]*?)\s+FROM\s/i);
  if (selectMatch) {
    result.output.columns = selectMatch[1].split(",").map((col) => {
      const asMatch = col.trim().match(/\bAS\s+(\w+)\s*$/i);
      return asMatch ? asMatch[1] : col.trim();
    });
  }

  /* Query results */
  const resMatch = stdout.match(/=== Query Results ===\nRows: (\d+), Columns: (\d+)\n([\s\S]*?)(?=\n={3,})/);
  if (resMatch) {
    const dataLines = resMatch[3].trim().split("\n").filter(Boolean);
    if (dataLines.length > 0) {
      /* Values are pipe-separated with trailing pipe */
      result.output.rows = dataLines.map((line) =>
        line.replace(/\|$/, "").split("|")
      );
    }
  }

  /* Sub-query plans (only present when run with --explain). One
     "=== Sub-Query Plan ===" block per iteration round (in order), plus one
     "=== Final Sub-Query Plan ===" block for the final round. Attach each
     plan to its round as `plan`; the frontend renders it in "Show Plan" mode. */
  const planRegex = /=== Sub-Query Plan ===\n([\s\S]*?)\n=== End Sub-Query Plan ===/g;
  const subPlans = [];
  let pm;
  while ((pm = planRegex.exec(stdout)) !== null) subPlans.push(pm[1].trim());
  subPlans.forEach((p, i) => { if (result.rounds[i]) result.rounds[i].plan = p; });
  const finalPlanMatch = stdout.match(
    /=== Final Sub-Query Plan ===\n([\s\S]*?)\n=== End Sub-Query Plan ===/
  );
  if (finalPlanMatch && result.rounds.length > 0) {
    result.rounds[result.rounds.length - 1].plan = finalPlanMatch[1].trim();
  }

  return result;
}

/* ─── Vanilla plan extractor ────────────────────────────────────────────────
   When we run "EXPLAIN ANALYZE <query>" through the middleware in --split=none
   (direct execution) mode, the plan comes back inside the "=== Query Results ==="
   block. Pull out that raw text and tidy the engine-specific framing:
     - DuckDB returns a 2-col row whose first cell is the literal "analyzed_plan"
       and whose last printed line is a lone "|" cell terminator.
     - Postgres-family engines return one plan line per row, each pipe-terminated. */
function extractPlanText(stdout) {
  const m = stdout.match(/=== Query Results ===\nRows: \d+, Columns: \d+\n([\s\S]*?)\n={20,}/);
  if (!m) return "";
  let text = m[1];
  text = text.replace(/^analyzed_plan\|/, "");   /* DuckDB column label */
  text = text.replace(/^QUERY PLAN\|/, "");        /* Postgres column label */
  /* Strip the ASCII pipe that terminates each printed cell/row. DuckDB's tree
     uses box-drawing chars (│), not ASCII |, so this only removes framing. */
  text = text.split("\n").map((l) => l.replace(/\|\s*$/, "")).join("\n");
  return text.replace(/\n+$/, "");
}

/* ─── Query file reader ────────────────────────────────────────────────────── */
app.get("/api/query/:name", (req, res) => {
  const queryFile = path.join(DATASETS.job.dir, "queries", `${req.params.name}.sql`);
  try {
    const sql = readFileSync(queryFile, "utf-8").trim();
    res.json({ sql });
  } catch {
    res.status(404).json({ error: "Query file not found" });
  }
});

/* ─── API endpoint ──────────────────────────────────────────────────────────── */
app.post("/api/run", (req, res) => {
  const { engine = "duckdb", split = "relation-center", query = "1a", customSql,
          cardinalityEstimator = true, mergeSubPlan = false, explain = false } = req.body;

  const splitArg = SPLIT_MAP[split] || "relationshipcenter";
  const dbArg = ENGINE_DB[engine] || ENGINE_DB.duckdb;

  /* If customSql is provided, write it to a temp file; otherwise use the query file */
  let queryFile;
  let tmpFile = null;
  if (customSql && customSql.trim()) {
    tmpFile = path.join(tmpdir(), `aqp_custom_${Date.now()}.sql`);
    writeFileSync(tmpFile, customSql);
    queryFile = tmpFile;
  } else {
    queryFile = path.join(DATASETS.job.dir, "queries", `${query}.sql`);
  }

  const args = [
    `--engine=${engine}`,
    `--db=${dbArg}`,
    `--schema=${DATASETS.job.schema}`,
    `--fkeys=${DATASETS.job.fkeys}`,
    `--split=${splitArg}`,
    "--debug",
    "--no-analyze",
    "--timing",
  ];

  /* Helper DB for planning: node-based split on non-DuckDB engines needs the
     DuckDB database; MariaDB with other splits uses PostgreSQL as estimator. */
  if (splitArg === "nodebased" && engine !== "duckdb") {
    args.push(`--helper-db-path=${ENGINE_DB.duckdb}`);
  } else if (engine === "mariadb") {
    args.push(`--helper-db-path=${ENGINE_DB.postgresql}`, "--estimator=postgres");
  }

  /* Cardinality Estimator: ON by default, add flag to disable */
  if (!cardinalityEstimator) args.push("--no-update-temp-card");

  /* Sub-SQL Combiner: OFF by default, add flag to enable */
  if (mergeSubPlan) args.push("--combine-sub-plans");

  /* Show Plan: OFF by default. Emits EXPLAIN ANALYZE per sub-SQL (extra
     execution), only requested when the UI is in "Show Plan" mode. */
  if (explain) args.push("--explain");

  args.push(queryFile);

  /* Delete old time_log.csv before each run (it appends, so stale data stays) */
  const csvPath = path.join(process.cwd(), "time_log.csv");
  try { unlinkSync(csvPath); } catch {}

  const startTime = Date.now();
  const execEnv = engine === "opengauss"
    ? { ...process.env, LD_LIBRARY_PATH: path.join(process.env.HOME, "gauss_compat_libs") + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") }
    : process.env;
  execFile(AQP_BIN, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, env: execEnv }, (err, stdout, stderr) => {
    const totalTime = Date.now() - startTime;
    if (tmpFile) try { unlinkSync(tmpFile); } catch {}
    console.log("[DEBUG] err:", err ? err.code : null, "stderr:", (stderr||"").substring(0,100), "stdout has Error:", (stdout||"").includes("Error:"));
    if (err) {
      const stderrMsg = (stderr || "").trim();
      const errDetail = stderrMsg || err.message;
      // Check stderr or stdout for error messages
      if (!stdout || stderrMsg.includes("Error") || stdout.includes("Error:") || !stdout.includes("Iteration")) {
        return res.status(500).json({ error: errDetail });
      }
    }

    try {
      const parsed = parseMiddlewareOutput(stdout);
      parsed.totalTime = totalTime;

      /* Read timing from time_log.csv (last line)
         Format: prepare_middleware, read_sql, parse_sql, preprocess,
                 convert_plan_to_ir (may be 0 for node-based),
                 [extract_next_sub-IR, generate_sub-SQL, execute_sub-SQL, extra_materialization, update_IR] x N iterations,
                 (optional extra extract_next_sub-IR),
                 generate_final_sub_sql, final_exe, show_output */
      try {
        const csvLines = readFileSync(csvPath, "utf-8").trim().split("\n");
        const lastLine = csvLines[csvLines.length - 1];
        const vals = lastLine.split(",").map(v => parseFloat(v.trim()));

        const total = vals.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);

        /* Fixed start: indices 0-4 */
        const prepareMiddleware = vals[0] || 0;
        const readSql = vals[1] || 0;
        const parseSql = vals[2] || 0;
        let preprocess = vals[3] || 0;
        let convertPlanToIR = vals[4] || 0;

        /* Node-based has no convert_plan_to_ir field; groups start at idx=4.
           For other strategies with duckdb, preprocess and convert_plan_to_IR
           are swapped in the CSV output. */
        let groupStart;
        if (splitArg === "nodebased") {
          convertPlanToIR = 0;
          groupStart = 4;
        } else {
          if (engine === "duckdb") {
            const tmp = preprocess;
            preprocess = convertPlanToIR;
            convertPlanToIR = tmp;
          }
          groupStart = 5;
        }

        /* Fixed end: last 3 values */
        const showOutput = vals[vals.length - 1] || 0;
        const finalExe = vals[vals.length - 2] || 0;
        const generateFinalSubSql = vals[vals.length - 3] || 0;

        /* Middle: repeating groups of 5 per iteration */
        const groupValues = vals.slice(groupStart, vals.length - 3);
        const groupCols = 5; /* extract, generate, execute, materialization, update */

        let sumExtract = 0, sumGenerate = 0, sumExecute = 0, sumMaterialize = 0, sumUpdate = 0;

        /* Handle possible extra extract_next_sub-IR at the end */
        let mainGroupVals = groupValues;
        if (groupValues.length % groupCols !== 0) {
          sumExtract += groupValues[groupValues.length - 1] || 0;
          mainGroupVals = groupValues.slice(0, groupValues.length - 1);
        }

        const numGroups = Math.floor(mainGroupVals.length / groupCols);
        for (let i = 0; i < numGroups; i++) {
          const base = i * groupCols;
          sumExtract += mainGroupVals[base] || 0;
          sumGenerate += mainGroupVals[base + 1] || 0;
          sumExecute += mainGroupVals[base + 2] || 0;
          sumMaterialize += mainGroupVals[base + 3] || 0;
          sumUpdate += mainGroupVals[base + 4] || 0;
        }

        /* Execution = DB work, Overhead = everything else.
           When --combine-sub-plans is used, only finalExe counts as execution. */
        const execution = mergeSubPlan
          ? finalExe
          : preprocess + sumExecute + sumMaterialize + finalExe;
        const overhead = total - execution;

        parsed.timing = { execution, overhead, total };
      } catch {}
      /* Read original SQL from file for display */
      if (!parsed.originalSql) {
        try {
          parsed.originalSql = readFileSync(queryFile, "utf-8").trim();
        } catch {}
      }
      res.json(parsed);
    } catch (parseErr) {
      res.status(500).json({ error: "Failed to parse output", raw: stdout });
    }
  });
});

/* ─── Vanilla query plan ──────────────────────────────────────────────────────
   Returns the EXPLAIN ANALYZE plan of the *whole* (un-split) query. We prepend
   "EXPLAIN ANALYZE" to the SQL and run it through the middleware in --split=none
   (direct execution) mode, then extract the plan text from the results block. */
app.post("/api/vanilla-plan", (req, res) => {
  const { engine = "duckdb", customSql, query = "1a" } = req.body;
  const dbArg = ENGINE_DB[engine] || ENGINE_DB.duckdb;

  /* Resolve the SQL: custom text if provided, otherwise the benchmark file. */
  let sqlText;
  if (customSql && customSql.trim()) {
    sqlText = customSql.trim();
  } else {
    try {
      sqlText = readFileSync(path.join(DATASETS.job.dir, "queries", `${query}.sql`), "utf-8").trim();
    } catch {
      return res.status(404).json({ error: "Query file not found" });
    }
  }
  sqlText = sqlText.replace(/;\s*$/, "");   /* drop trailing semicolon */

  const tmpFile = path.join(tmpdir(), `aqp_vanilla_${Date.now()}.sql`);
  writeFileSync(tmpFile, `EXPLAIN ANALYZE ${sqlText}`);

  const args = [
    `--engine=${engine}`,
    `--db=${dbArg}`,
    `--schema=${DATASETS.job.schema}`,
    `--fkeys=${DATASETS.job.fkeys}`,
    "--split=none",
    tmpFile,
  ];

  const execEnv = engine === "opengauss"
    ? { ...process.env, LD_LIBRARY_PATH: path.join(process.env.HOME, "gauss_compat_libs") + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") }
    : process.env;

  execFile(AQP_BIN, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, env: execEnv }, (err, stdout, stderr) => {
    try { unlinkSync(tmpFile); } catch {}
    if (err && (!stdout || !stdout.includes("=== Query Results ==="))) {
      return res.status(500).json({ error: (stderr || "").trim() || err.message });
    }
    const plan = extractPlanText(stdout || "");
    if (!plan) {
      return res.status(500).json({ error: "No plan returned for this query" });
    }
    res.json({ plan });
  });
});

/* ─── Start ─────────────────────────────────────────────────────────────────── */
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`AQP backend running on http://localhost:${PORT}`);
});
