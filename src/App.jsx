import { useState, useEffect } from "react";
import "./App.css";


/* ─── SQL Formatter ─────────────────────────────────────────────────────── */
function formatSql(raw) {
  /* Collapse all whitespace to single spaces first */
  let sql = raw.replace(/\s+/g, ' ').trim();
  /* Put major keywords on their own line (no indent) */
  sql = sql.replace(/ (FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION|INTERSECT|EXCEPT) /gi,
    (_, kw) => '\n' + kw.toUpperCase() + ' ');
  /* Put AND / OR on their own line with minimal indent */
  sql = sql.replace(/ (AND|OR) /gi,
    (_, kw) => '\n ' + kw.toUpperCase() + ' ');
  /* Put JOIN variants on their own line */
  sql = sql.replace(/ ((INNER |LEFT |RIGHT |FULL |CROSS )?JOIN) /gi,
    (_, kw) => '\n ' + kw.toUpperCase() + ' ');
  /* Indent select items after first: put each comma-separated item on new line */
  const selectMatch = sql.match(/^SELECT (.*?)(?=\nFROM )/s);
  if (selectMatch) {
    const items = selectMatch[1].split(',').map(s => s.trim());
    const formatted = items.length > 1
      ? items[0] + ',\n' + items.slice(1).map(it => '  ' + it).join(',\n')
      : items[0];
    sql = 'SELECT ' + formatted + sql.slice(selectMatch[0].length);
  }
  return sql;
}

/* ─── SQL Syntax Highlighter ─────────────────────────────────────────────── */
const SQL_KW = new Set([
  "SELECT","FROM","WHERE","AND","OR","AS","MIN","MAX","COUNT","SUM","AVG",
  "NOT","LIKE","IN","JOIN","INNER","LEFT","RIGHT","ON","GROUP","BY","ORDER",
  "HAVING","LIMIT","INSERT","UPDATE","DELETE","CREATE","DROP","ALTER","TABLE",
  "SET","INTO","VALUES","NULL","IS","BETWEEN","EXISTS","DISTINCT","UNION",
  "ALL","CASE","WHEN","THEN","ELSE","END","CAST","WITH","FETCH","OFFSET",
]);

const TEMP_TABLE_RE = /^temp\d+/i;

function SqlBlock({ sql, fontSize = 10.5, tempColors = {} }) {
  if (!sql) return null;
  const tokens = sql.split(/(\b\w+\b|'[^']*'|[^\w\s']+|\s+)/g).filter(Boolean);
  return (
    <pre className="sql-block" style={{ fontSize }}>
      <code>
        {tokens.map((tok, i) => {
          if (SQL_KW.has(tok.toUpperCase()))
            return <span key={i} className="sql-kw">{tok}</span>;
          if (/^temp\d+(_\d+)?$/i.test(tok)) {
            const baseTemp = tok.match(/^(temp\d+)/i)[1].toLowerCase();
            const color = tempColors[baseTemp];
            return <span key={i} className="sql-temp" style={color ? { color } : {}}>{tok}</span>;
          }
          if (tok.startsWith("'"))
            return <span key={i} className="sql-str">{tok}</span>;
          return <span key={i}>{tok}</span>;
        })}
      </code>
    </pre>
  );
}

/* ─── Arrow components ───────────────────────────────────────────────────── */
function ArrowRight({ color = "#94A3B8", dashed = false, width = 45 }) {
  return (
    <svg width={width} height="20" viewBox={`0 0 ${width} 20`} className="arrow-h">
      <line x1="0" y1="10" x2={width - 8} y2="10"
        stroke={color} strokeWidth="1.5"
        strokeDasharray={dashed ? "5,3" : "none"} />
      <polygon points={`${width - 7},5.5 ${width},10 ${width - 7},14.5`} fill={color} />
    </svg>
  );
}

function ArrowDown({ color = "#94A3B8", dashed = false, height = 28 }) {
  return (
    <div className="arrow-down-wrap">
      <svg width="20" height={height} viewBox={`0 0 20 ${height}`}>
        <line x1="10" y1="0" x2="10" y2={height - 7}
          stroke={color} strokeWidth="1.5"
          strokeDasharray={dashed ? "5,3" : "none"} />
        <polygon points={`5.5,${height - 7} 10,${height} 14.5,${height - 7}`} fill={color} />
      </svg>
    </div>
  );
}

/* ─── Pipeline Node (clickable) ──────────────────────────────────────────── */
function PipelineNode({ round, isActive, onClick }) {
  return (
    <button
      className={`pipeline-node ${isActive ? "pipeline-node-active" : ""}`}
      style={{
        borderColor: round.color,
        backgroundColor: isActive ? `${round.color}14` : "#fff",
        "--node-color": round.color,
      }}
      onClick={onClick}
    >
      <div className="node-title" style={{ color: round.color }}>{round.subSqlTitle}</div>
      <div className="node-meta">{round.temp.name} &middot; {round.temp.rows.toLocaleString()} rows</div>
      {round.temp.time != null && (
        <div className="node-meta">{round.temp.time.toFixed(1)} ms</div>
      )}
    </button>
  );
}

/* ─── Combined SQL Box (top-right corner, expandable) ───────────────────── */
function CombinedSqlBox({ sql, tempColors }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ position: "absolute", top: "10px", right: "10px", zIndex: 20 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "8px 20px", fontSize: "12px", fontWeight: 800,
          fontFamily: "var(--font-body)", border: "2px solid var(--accent-violet)",
          borderRadius: "var(--radius-md)", cursor: "pointer",
          background: expanded ? "var(--accent-violet)" : "var(--surface)",
          color: expanded ? "#fff" : "var(--accent-violet)",
          transition: "all 0.15s",
          boxShadow: "0 2px 8px rgba(124, 58, 237, 0.2)",
        }}
      >Combined SQL {expanded ? "▲" : "▼"}</button>
      {expanded && (
        <div style={{
          marginTop: "8px", width: "560px", maxHeight: "500px", overflowY: "auto",
          border: "2px solid var(--accent-violet)", borderRadius: "var(--radius-lg)",
          background: "var(--surface)", padding: "14px 18px",
          boxShadow: "0 8px 24px rgba(124, 58, 237, 0.15), 0 2px 6px rgba(0,0,0,0.08)",
        }}>
          <SqlBlock sql={sql} fontSize={11} tempColors={tempColors} />
        </div>
      )}
    </div>
  );
}

/* ─── Scenario Pipeline View ─────────────────────────────────────────────── */
function ScenarioPipeline({ data, activeNode, setActiveNode, useCombineArrow = false, hideResult = false, hideTiming = false }) {
  if (!data) return null;
  if (data.error) return <div className="run-error">{data.error}</div>;
  if (!data.rounds || data.rounds.length === 0) return <div className="run-error">No pipeline data returned</div>;

  const tempColors = {};
  data.rounds.forEach(r => {
    if (r.temp.name && r.temp.name !== "result") {
      tempColors[r.temp.name.toLowerCase()] = r.color;
    }
  });

  return (
    <div className="pipeline-content">
      <div className="pipeline-chain">
        {data.rounds.map((round, idx) => (
          <div key={round.roundNum} className="pipeline-chain-item">
            <PipelineNode
              round={round}
              isActive={activeNode === round.roundNum}
              onClick={() => setActiveNode(activeNode === round.roundNum ? null : round.roundNum)}
            />
            {idx < data.rounds.length - 1 && (
              useCombineArrow
                ? <span style={{ padding: "0 6px", fontWeight: 800, color: "#94A3B8", fontSize: "16px" }}>+</span>
                : <ArrowRight color="#94A3B8" width={32} />
            )}
          </div>
        ))}
        {useCombineArrow && data.combinedSql && (
          <div className="pipeline-chain-item">
            <span style={{ padding: "0 6px", fontWeight: 800, color: "#94A3B8", fontSize: "16px" }}>=</span>
            <button
              className={`pipeline-node ${activeNode === "combined" ? "pipeline-node-active" : ""}`}
              style={{
                borderColor: "var(--accent-violet)",
                backgroundColor: activeNode === "combined" ? "rgba(124,58,237,0.08)" : "#fff",
                "--node-color": "var(--accent-violet)",
              }}
              onClick={() => setActiveNode(activeNode === "combined" ? null : "combined")}
            >
              <div className="node-title" style={{ color: "var(--accent-violet)" }}>Combined SQL</div>
            </button>
          </div>
        )}
      </div>

      {activeNode != null && (() => {
        const round = data.rounds.find(r => r.roundNum === activeNode);
        if (!round) return null;
        return (
          <div className="node-detail" style={{ borderColor: round.color, backgroundColor: `${round.color}10` }}>
            <SqlBlock sql={round.subSql} fontSize={11} tempColors={tempColors} />
          </div>
        );
      })()}

      {activeNode === "combined" && data.combinedSql && (
        <div className="node-detail" style={{ borderColor: "var(--accent-violet)", backgroundColor: "rgba(139, 92, 246, 0.06)" }}>
          <div className="node-detail-header">
            <span className="node-detail-title" style={{ color: "var(--accent-violet)" }}>Combined SQL</span>
          </div>
          <SqlBlock sql={data.combinedSql} fontSize={11} tempColors={tempColors} />
        </div>
      )}


      {!hideTiming && (
        <div className="perf-section">
          <div className="perf-box">
            {!hideResult && data.output.rows.length > 0 && (
              <div className="perf-result-box">
                <div className="perf-label">Query Result:</div>
                <div className="perf-table-wrap">
                  <table className="perf-table">
                    <thead>
                      <tr>
                        {data.output.columns.length > 0
                          ? data.output.columns.map((c, i) => <th key={i}>{c}</th>)
                          : data.output.rows[0].map((_, i) => <th key={i}>col {i + 1}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.output.rows.slice(0, 5).map((row, i) => (
                        <tr key={i}>{row.map((val, j) => <td key={j}>{val}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {data.timing && (
              <div>
                <div className="perf-label">Timing Breakdown:</div>
                <div className="perf-timing-grid">
                  <span>Execution</span><span>{data.timing.execution?.toFixed(2)} ms</span>
                  <span>Middleware Overhead</span><span>{data.timing.overhead?.toFixed(2)} ms</span>
                  <span className="perf-timing-total">Total</span>
                  <span className="perf-timing-total">{data.timing.total?.toFixed(2)} ms</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const QUERY_LISTS = {
  job: ["1a","1b","1c","1d","2a","2b","2c","2d","3a","3b","3c",
    "4a","4b","4c","5a","5b","5c","6a","6b","6c","6d","6e","6f",
    "7a","7b","7c","8a","8b","8c","8d","9a","9b","9c","9d",
    "10a","10b","10c","11a","11b","11c","11d","12a","12b","12c",
    "13a","13b","13c","13d","14a","14b","14c","15a","15b","15c","15d",
    "16a","16b","16c","16d","17a","17b","17c","17d","17e","17f",
    "18a","18b","18c","19a","19b","19c","19d","20a","20b","20c",
    "21a","21b","21c","22a","22b","22c","22d","23a","23b","23c",
    "24a","24b","25a","25b","25c","26a","26b","26c",
    "27a","27b","27c","28a","28b","28c","29a","29b","29c",
    "30a","30b","30c","31a","31b","31c","32a","32b",
    "33a","33b","33c"],
  dsb: [],
};

/* ─── Main App ───────────────────────────────────────────────────────────── */
export default function App() {
  const [dataset, setDataset] = useState("job");
  const [selectedQuery, setSelectedQuery] = useState("1a");
  const [customSql, setCustomSql] = useState("");
  const [engine, setEngine] = useState("duckdb");
  const [splitStrategy, setSplitStrategy] = useState("relation-center");
  const [cardinalityEstimator, setCardinalityEstimator] = useState(true);
  const [mergeSubPlan, setMergeSubPlan] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeNode, setActiveNode] = useState(null);
  const [activeTab, setActiveTab] = useState("Home");
  const [activeEngine, setActiveEngine] = useState("DuckDB");
  const [activeStrategy, setActiveStrategy] = useState("FK-Center");
  const [activeOption, setActiveOption] = useState("CU On | Combiner On");
  const [scenarioData, setScenarioData] = useState({});
  const [scenarioNode, setScenarioNode] = useState(null);
  const [compDim, setCompDim] = useState("engines"); // what to compare: engines, strategies, integration
  const [compEngineA, setCompEngineA] = useState("duckdb");
  const [compEngineB, setCompEngineB] = useState("umbra");
  const [compStrategy, setCompStrategy] = useState("relation-center");  // shared when not comparing strategies
  const [compStrategyA, setCompStrategyA] = useState("relation-center");
  const [compStrategyB, setCompStrategyB] = useState("entity-center");
  const [compEngine, setCompEngine] = useState("duckdb");  // shared when not comparing engines
  const [compIntegration, setCompIntegration] = useState({ ce: true, comb: false }); // shared
  const [compIntegrationA, setCompIntegrationA] = useState({ ce: true, comb: false });
  const [compIntegrationB, setCompIntegrationB] = useState({ ce: false, comb: false });
  const [compDataA, setCompDataA] = useState(null);
  const [compDataB, setCompDataB] = useState(null);
  const [eng2Tab, setEng2Tab] = useState("engines");
  const [eng2Engine, setEng2Engine] = useState("duckdb");
  const [eng2Strategy, setEng2Strategy] = useState("relation-center");
  const [eng2Integration, setEng2Integration] = useState({ ce: true, comb: false });
  const [eng2Data, setEng2Data] = useState(null);

  /* Load query SQL when selection changes */
  useEffect(() => {
    fetch(`/api/query/${selectedQuery}`)
      .then(r => r.json())
      .then(j => { if (j.sql) setCustomSql(formatSql(j.sql)); })
      .catch(() => {});
  }, [selectedQuery]);

  /* Helper: run a single query and return parsed data */
  const runOne = async (eng, split, ce = cardinalityEstimator, comb = mergeSubPlan) => {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: eng, split, query: selectedQuery, customSql, cardinalityEstimator: ce, mergeSubPlan: comb }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Server error");
    const outputText = json.output.rows.length > 0
      ? `Output: ${json.output.rows.length} row(s) | ${json.output.rows[0].join(" | ")}`
      : "No results";
    return {
      sql: json.originalSql,
      rounds: json.rounds,
      output: { text: outputText, columns: json.output.columns || [], rows: json.output.rows || [] },
      timing: json.timing || null,
      totalTime: json.totalTime || null,
      combinedSql: json.combinedSql || null,
    };
  };

  const handleRun = async () => {
    setIsRunning(true);
    setHasRun(false);
    setError(null);
    setScenarioData({});
    setScenarioNode(null);
    try {
      if (activeTab === "Engines") {
        const engines = [["duckdb","DuckDB"],["postgresql","PostgreSQL"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]];
        const results = {};
        for (const [eng, label] of engines) {
          try { results[label] = await runOne(eng, splitStrategy); }
          catch (e) { results[label] = { error: e.message }; }
        }
        setScenarioData(results);
        setHasRun(true);
      } else if (activeTab === "Strategies") {
        const strategies = [["relation-center","FK-Center"],["entity-center","PK-Center"],
          ["min-subquery","Min-Subquery"],["node-based","Node-Based"]];
        const results = {};
        for (const [split, label] of strategies) {
          try { results[label] = await runOne(engine, split); }
          catch (e) { results[label] = { error: e.message }; }
        }
        setScenarioData(results);
        setHasRun(true);
      } else if (activeTab === "Options") {
        const combos = [
          ["CU On | Combiner On", true, true],
          ["CU On | Combiner Off", true, false],
          ["CU Off | Combiner On", false, true],
          ["CU Off | Combiner Off", false, false],
        ];
        const results = {};
        for (const [label, ce, comb] of combos) {
          try { results[label] = await runOne(engine, splitStrategy, ce, comb); }
          catch (e) { results[label] = { error: e.message }; }
        }
        setScenarioData(results);
        setHasRun(true);
      } else if (activeTab === "Engine2") {
        try {
          setEng2Data(await runOne(eng2Engine, eng2Strategy, eng2Integration.ce, eng2Integration.comb));
        } catch (e) { setEng2Data({ error: e.message }); }
        setActiveNode(null);
        setHasRun(true);
      } else if (activeTab === "Demo Scenarios") {
        const getCompParams = (side) => {
          const eng = compDim === "engines" ? (side === "A" ? compEngineA : compEngineB) : compEngine;
          const strat = compDim === "strategies" ? (side === "A" ? compStrategyA : compStrategyB) : compStrategy;
          const integ = compDim === "integration" ? (side === "A" ? compIntegrationA : compIntegrationB) : compIntegration;
          return { eng, strat, ce: integ.ce, comb: integ.comb };
        };
        const pA = getCompParams("A");
        const pB = getCompParams("B");
        try { setCompDataA(await runOne(pA.eng, pA.strat, pA.ce, pA.comb)); }
        catch (e) { setCompDataA({ error: e.message }); }
        try { setCompDataB(await runOne(pB.eng, pB.strat, pB.ce, pB.comb)); }
        catch (e) { setCompDataB({ error: e.message }); }
        setActiveNode(null);
        setHasRun(true);
      } else {
        const result = await runOne(engine, splitStrategy);
        setData(result);
        setActiveNode(null);
        setHasRun(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <h1 className="header-title" style={{ cursor: activeTab !== "Home" ? "pointer" : "default" }} onClick={() => { if (activeTab !== "Home") setActiveTab("Home"); }}>AQPHub</h1>
        <div className="header-url">localhost:5173/aqp-middleware-demo</div>
      </header>

      {/* ── Body ── */}
      <div className="body-layout">
        {/* ── Left: Config ── */}
        {activeTab !== "Home" && <aside className="config-panel">
          <div className="config-box">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <h2 className="config-box-title" style={{ marginBottom: 0 }}>Configuration</h2>
              {activeTab !== "Demo Scenarios" && activeTab !== "Engine2" && (
                <button className="run-btn" onClick={handleRun} disabled={isRunning}
                  style={{ marginTop: 0, width: "auto", padding: "5px 40px", fontSize: "10px" }}>
                  {isRunning ? "Running..." : "Run Query"}
                </button>
              )}
            </div>

            <div className="select-row">
              <div className="select-col" style={{ flex: "0 0 130px" }}>
                <label className="field-label">Dataset</label>
                <select className="field-select" value={dataset}
                  onChange={(e) => {
                    const ds = e.target.value;
                    setDataset(ds);
                    const queries = QUERY_LISTS[ds] || [];
                    setSelectedQuery(queries[0] || "");
                    setCustomSql("");
                    setHasRun(false);
                  }}>
                  <option value="job">JOB</option>
                  <option value="dsb">DSB</option>
                </select>
              </div>
              <div className="select-col" style={{ flex: "0 0 130px" }}>
                <label className="field-label">Query</label>
                <select className="field-select" value={selectedQuery}
                  onChange={(e) => { setSelectedQuery(e.target.value); setHasRun(false); }}>
                  {(QUERY_LISTS[dataset] || []).map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
              {activeTab !== "Demo Scenarios" && activeTab !== "Engine2" && (
                <div className="select-col" style={{ flex: 1 }}>
                  <label className="field-label">Scenario</label>
                  <select className="field-select" value={activeTab}
                    onChange={(e) => {
                      const tab = e.target.value;
                      setActiveTab(tab);
                      if (tab === "Engines") setSplitStrategy("relation-center");
                      if (tab === "Strategies") setEngine("duckdb");
                      setHasRun(false);
                    }}>
                    <option value="Pipeline">Pipeline</option>
                    <option value="Engines">Diff Engines</option>
                    <option value="Strategies">Diff AQP Strategies</option>
                    <option value="Options">Integration Levels</option>
                  </select>
                </div>
              )}
            </div>

            <label className="field-label">Vanilla SQL</label>
            <textarea className="field-textarea" rows={activeTab === "Pipeline" ? 18 : 20}
              placeholder="Enter your custom query here..."
              value={customSql}
              onChange={(e) => setCustomSql(e.target.value)} />

            {(activeTab === "Demo Scenarios" || activeTab === "Engine2") && (
              <button className="run-btn" onClick={handleRun} disabled={isRunning}
                style={{ marginTop: "2px" }}>
                {isRunning ? "Running..." : "Run Query"}
              </button>
            )}

            {activeTab !== "Demo Scenarios" && activeTab !== "Engine2" && (
              <div className="select-row">
                {/* Engine — show on Pipeline, Strategies, Options */}
                {activeTab !== "Engines" && (
                  <div className="select-col">
                    <select className="field-select" value={engine}
                      onChange={(e) => { setEngine(e.target.value); setHasRun(false); }}>
                      {[["postgresql","PostgreSQL"],["duckdb","DuckDB"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]].map(([v,l])=>(
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* AQP Strategy — show on Pipeline, Engines, Options */}
                {activeTab !== "Strategies" && (
                  <div className="select-col">
                    <select className="field-select" value={splitStrategy}
                      onChange={(e) => { setSplitStrategy(e.target.value); setHasRun(false); }}>
                      {[["relation-center","FK-Center"],["entity-center","PK-Center"],
                        ["min-subquery","Min-Subquery"],["node-based","Node-Based"]].map(([v,l])=>(
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Options — hide on Options, Comparison, and Engine2 tabs */}
            {activeTab !== "Options" && activeTab !== "Demo Scenarios" && activeTab !== "Engine2" && (
              <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                <button
                  type="button"
                  style={{
                    flex: 1, padding: "5px 8px", fontSize: "10px", fontWeight: 600,
                    fontFamily: "var(--font-body)", border: "none", borderRadius: "var(--radius-sm)",
                    cursor: "pointer", transition: "all 0.15s",
                    background: cardinalityEstimator ? "#1B9C5A" : "#D8DEE8",
                    color: cardinalityEstimator ? "#fff" : "#697386",
                  }}
                  onClick={() => { setCardinalityEstimator(!cardinalityEstimator); setHasRun(false); }}
                >Cardinality Updater</button>
                <button
                  type="button"
                  style={{
                    flex: 1, padding: "5px 8px", fontSize: "10px", fontWeight: 600,
                    fontFamily: "var(--font-body)", border: "none", borderRadius: "var(--radius-sm)",
                    cursor: "pointer", transition: "all 0.15s",
                    background: mergeSubPlan ? "#1B9C5A" : "#D8DEE8",
                    color: mergeSubPlan ? "#fff" : "#697386",
                  }}
                  onClick={() => { setMergeSubPlan(!mergeSubPlan); setHasRun(false); }}
                >Sub-SQL Combiner</button>
              </div>
            )}

          </div>


          {error && (
            <div className="run-error">{error}</div>
          )}

        </aside>}

        {/* ── Right panel ── */}
        <main className="pipeline-panel">
          {activeTab === "Engines" ? (
            <div className="scenario-view">
              <div className="scenario-label">Same AQP strategy ({{"relation-center":"FK-Center","entity-center":"PK-Center","min-subquery":"Min-Subquery","node-based":"Node-Based"}[splitStrategy]}) across different engines</div>
              <div className="scenario-box">
                <div className="scenario-tabs">
                  {["DuckDB","PostgreSQL","Umbra","MariaDB","OpenGauss"].map(eng => (
                    <button key={eng}
                      className={`scenario-tab ${activeEngine === eng ? "scenario-tab-active" : ""}`}
                      onClick={() => { setActiveEngine(eng); setScenarioNode(null); }}>
                      {eng}
                    </button>
                  ))}
                </div>
                <div className="scenario-content">
                  {isRunning ? (
                    <div className="empty-state">
                      <div className="empty-icon spin">&#9881;</div>
                      <div className="empty-title">Processing query...</div>
                    </div>
                  ) : hasRun && scenarioData[activeEngine] ? (
                    <ScenarioPipeline data={scenarioData[activeEngine]} activeNode={scenarioNode} setActiveNode={setScenarioNode} />
                  ) : (
                    <div className="empty-state">
                      <div className="empty-text">Click <strong>Run Query</strong> to compare engines</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "Strategies" ? (
            <div className="scenario-view">
              <div className="scenario-label">Same engine ({{"postgresql":"PostgreSQL","duckdb":"DuckDB","umbra":"Umbra","mariadb":"MariaDB","opengauss":"OpenGauss"}[engine]}) across different AQP strategies</div>
              <div className="scenario-box">
                <div className="scenario-tabs">
                  {["FK-Center","PK-Center","Min-Subquery","Node-Based"].map(s => (
                    <button key={s}
                      className={`scenario-tab ${activeStrategy === s ? "scenario-tab-active" : ""}`}
                      onClick={() => { setActiveStrategy(s); setScenarioNode(null); }}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="scenario-content">
                  {isRunning ? (
                    <div className="empty-state">
                      <div className="empty-icon spin">&#9881;</div>
                      <div className="empty-title">Processing query...</div>
                    </div>
                  ) : hasRun && scenarioData[activeStrategy] ? (
                    <ScenarioPipeline data={scenarioData[activeStrategy]} activeNode={scenarioNode} setActiveNode={setScenarioNode} />
                  ) : (
                    <div className="empty-state">
                      <div className="empty-text">Click <strong>Run Query</strong> to compare strategies</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "Options" ? (
            <div className="scenario-view">
              <div className="scenario-label">Same engine ({{"postgresql":"PostgreSQL","duckdb":"DuckDB","umbra":"Umbra","mariadb":"MariaDB","opengauss":"OpenGauss"}[engine]}) &amp; strategy ({{"relation-center":"FK-Center","entity-center":"PK-Center","min-subquery":"Min-Subquery","node-based":"Node-Based"}[splitStrategy]}) with different options</div>
              <div className="scenario-box">
                <div className="scenario-tabs">
                  {["CU On | Combiner On","CU On | Combiner Off","CU Off | Combiner On","CU Off | Combiner Off"].map(opt => (
                    <button key={opt}
                      className={`scenario-tab ${activeOption === opt ? "scenario-tab-active" : ""}`}
                      onClick={() => { setActiveOption(opt); setScenarioNode(null); }}>
                      {opt}
                    </button>
                  ))}
                </div>
                <div className="scenario-content">
                  {isRunning ? (
                    <div className="empty-state">
                      <div className="empty-icon spin">&#9881;</div>
                      <div className="empty-title">Processing query...</div>
                    </div>
                  ) : hasRun && scenarioData[activeOption] ? (
                    <ScenarioPipeline data={scenarioData[activeOption]} activeNode={scenarioNode} setActiveNode={setScenarioNode} useCombineArrow={activeOption.includes("Combiner On")} />
                  ) : (
                    <div className="empty-state">
                      <div className="empty-text">Click <strong>Run Query</strong> to compare options</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === "Engine2" ? (
            <div className="comparison-layout">
              {/* 3-column tab buttons */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0", marginBottom: "4px" }}>
                {[["engines","DB Systems"],["strategies","AQP Strategies"],["integration","Integration Levels"]].map(([key,label]) => (
                  <button key={key} onClick={() => { setEng2Tab(key); setHasRun(false); }}
                    style={{
                      padding: "4px 8px", fontSize: "10px", fontWeight: 700, cursor: "pointer",
                      border: "1px solid var(--border)",
                      borderBottom: eng2Tab === key ? "4px solid #0A7B71" : "1px solid var(--border)",
                      background: eng2Tab === key ? "#0D9488" : "var(--surface-sunken)",
                      color: eng2Tab === key ? "#fff" : "var(--ink-secondary)",
                      transition: "all 0.15s",
                    }}>{label}</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: eng2Tab === "integration" ? "1fr 1fr 2fr" : eng2Tab === "engines" ? "2fr 1fr 1fr" : "1fr 2fr 1fr", gap: "4px", fontSize: "11px" }}>
                <select className="field-select" value={eng2Engine}
                  style={{ opacity: eng2Tab === "engines" ? 1 : 0.6 }}
                  onChange={(e) => { setEng2Engine(e.target.value); setHasRun(false); }}>
                  {[["duckdb","DuckDB"],["postgresql","PostgreSQL"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]].map(([v,l]) => (
                    <option key={v} value={v}>{l}</option>))}
                </select>
                <select className="field-select" value={eng2Strategy}
                  style={{ opacity: eng2Tab === "strategies" ? 1 : 0.6 }}
                  onChange={(e) => { setEng2Strategy(e.target.value); setHasRun(false); }}>
                  {[["relation-center","FK-Center"],["entity-center","PK-Center"],["min-subquery","Min-Subquery"],["node-based","Node-Based"]].map(([v,l]) => (
                    <option key={v} value={v}>{l}</option>))}
                </select>
                <select className="field-select" value={`${eng2Integration.ce},${eng2Integration.comb}`}
                  style={{ opacity: eng2Tab === "integration" ? 1 : 0.6 }}
                  onChange={(e) => { const [ce,comb] = e.target.value.split(",").map(v=>v==="true"); setEng2Integration({ce,comb}); setHasRun(false); }}>
                  <option value="true,false">CU On · Combiner Off</option>
                  <option value="true,true">CU On · Combiner On</option>
                  <option value="false,false">CU Off · Combiner Off</option>
                  <option value="false,true">CU Off · Combiner On</option>
                </select>
              </div>

              {/* Single pipeline result */}
              <div className="comparison-content">
                {isRunning ? (
                  <div className="empty-state">
                    <div className="empty-icon spin">&#9881;</div>
                    <div className="empty-title">Processing query...</div>
                  </div>
                ) : hasRun && eng2Data ? (
                  <>
                    {eng2Data.error ? (
                      <div className="run-error">{eng2Data.error}</div>
                    ) : (
                      <>
                        <ScenarioPipeline data={eng2Data} activeNode={activeNode} setActiveNode={setActiveNode}
                          useCombineArrow={eng2Integration.comb} hideResult hideTiming />
                        <div className="comp-bottom-row">
                          {eng2Data.output.rows.length > 0 && (
                            <div className="comp-shared-result">
                              <div className="perf-label">Query Result:</div>
                              <div className="perf-table-wrap">
                                <table className="perf-table">
                                  <thead><tr>
                                    {eng2Data.output.columns.length > 0
                                      ? eng2Data.output.columns.map((c, i) => <th key={i}>{c}</th>)
                                      : eng2Data.output.rows[0].map((_, i) => <th key={i}>col {i + 1}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {eng2Data.output.rows.slice(0, 5).map((row, i) => (
                                      <tr key={i}>{row.map((val, j) => <td key={j}>{val}</td>)}</tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          {eng2Data.timing && (
                            <div className="comp-shared-result">
                              <div className="perf-label">Timing Breakdown:</div>
                              <div className="perf-table-wrap">
                                <table className="perf-table">
                                  <thead><tr>
                                    {["Execution", "Middleware Overhead", "Total"].map((c,i) => (
                                      <th key={i} style={c === "Total" ? { fontWeight: 700 } : {}}>{c}</th>
                                    ))}
                                  </tr></thead>
                                  <tbody>
                                    <tr>
                                      {[eng2Data.timing.execution, eng2Data.timing.overhead, eng2Data.timing.total].map((v,i) => (
                                        <td key={i} style={i === 2 ? { fontWeight: 700 } : {}}>{v != null ? `${v.toFixed(2)} ms` : "—"}</td>
                                      ))}
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-text">Select options and click <strong>Run Query</strong></div>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "Demo Scenarios" ? (() => {
            const ENGINE_LABELS = {"duckdb":"DuckDB","postgresql":"PostgreSQL","umbra":"Umbra","mariadb":"MariaDB","opengauss":"OpenGauss"};
            const STRAT_LABELS = {"relation-center":"FK-Center","entity-center":"PK-Center","min-subquery":"Min-Subquery","node-based":"Node-Based"};
            const INTEG_LABEL = (i) => `CU ${i.ce ? "On" : "Off"} · ${i.comb ? "Combined" : "Splitted"}`;
            const labelA = compDim === "engines" ? ENGINE_LABELS[compEngineA]
              : compDim === "strategies" ? STRAT_LABELS[compStrategyA] : INTEG_LABEL(compIntegrationA);
            const labelB = compDim === "engines" ? ENGINE_LABELS[compEngineB]
              : compDim === "strategies" ? STRAT_LABELS[compStrategyB] : INTEG_LABEL(compIntegrationB);
            const combA = compDim === "integration" ? compIntegrationA.comb : compIntegration.comb;
            const combB = compDim === "integration" ? compIntegrationB.comb : compIntegration.comb;
            return (
            <div className="comparison-layout">
              {/* 3-column grid: tabs on top, dropdowns below aligned */}
              <div style={{ display: "grid", gridTemplateColumns: compDim === "integration" ? "1fr 1fr 2fr" : compDim === "engines" ? "2fr 1fr 1fr" : "1fr 2fr 1fr", gap: "0", marginBottom: "4px" }}>
                {[["engines","DB Systems"],["strategies","AQP Strategies"],["integration","Integration Levels"]].map(([key,label]) => (
                  <button key={key} onClick={() => { setCompDim(key); setHasRun(false); }}
                    style={{
                      padding: "4px 8px", fontSize: "10px", fontWeight: 700, cursor: "pointer",
                      border: "1px solid var(--border)",
                      borderBottom: compDim === key ? "4px solid #0A7B71" : "1px solid var(--border)",
                      background: compDim === key ? "#0D9488" : "var(--surface-sunken)",
                      color: compDim === key ? "#fff" : "var(--ink-secondary)",
                      transition: "all 0.15s",
                    }}>{label}</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: compDim === "integration" ? "1fr 1fr 2fr" : compDim === "engines" ? "2fr 1fr 1fr" : "1fr 2fr 1fr", gap: "4px", fontSize: "11px" }}>
                {/* DB Systems column */}
                {compDim === "engines" ? (
                  <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                    <select className="field-select" value={compEngineA} style={{ flex: 1 }}
                      onChange={(e) => { setCompEngineA(e.target.value); setHasRun(false); }}>
                      {[["duckdb","DuckDB"],["postgresql","PostgreSQL"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]].map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>))}
                    </select>
                    <span style={{ color: "var(--ink-muted)", fontSize: "9px" }}>vs</span>
                    <select className="field-select" value={compEngineB} style={{ flex: 1 }}
                      onChange={(e) => { setCompEngineB(e.target.value); setHasRun(false); }}>
                      {[["duckdb","DuckDB"],["postgresql","PostgreSQL"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]].map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>))}
                    </select>
                  </div>
                ) : (
                  <select className="field-select" value={compEngine} style={{ opacity: 0.6 }}
                    onChange={(e) => { setCompEngine(e.target.value); setHasRun(false); }}>
                    {[["duckdb","DuckDB"],["postgresql","PostgreSQL"],["umbra","Umbra"],["mariadb","MariaDB"],["opengauss","OpenGauss"]].map(([v,l]) => (
                      <option key={v} value={v}>{l}</option>))}
                  </select>
                )}
                {/* AQP Strategies column */}
                {compDim === "strategies" ? (
                  <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                    <select className="field-select" value={compStrategyA} style={{ flex: 1 }}
                      onChange={(e) => { setCompStrategyA(e.target.value); setHasRun(false); }}>
                      {[["relation-center","FK-Center"],["entity-center","PK-Center"],["min-subquery","Min-Subquery"],["node-based","Node-Based"]].map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>))}
                    </select>
                    <span style={{ color: "var(--ink-muted)", fontSize: "9px" }}>vs</span>
                    <select className="field-select" value={compStrategyB} style={{ flex: 1 }}
                      onChange={(e) => { setCompStrategyB(e.target.value); setHasRun(false); }}>
                      {[["relation-center","FK-Center"],["entity-center","PK-Center"],["min-subquery","Min-Subquery"],["node-based","Node-Based"]].map(([v,l]) => (
                        <option key={v} value={v}>{l}</option>))}
                    </select>
                  </div>
                ) : (
                  <select className="field-select" value={compStrategy} style={{ opacity: 0.6 }}
                    onChange={(e) => { setCompStrategy(e.target.value); setHasRun(false); }}>
                    {[["relation-center","FK-Center"],["entity-center","PK-Center"],["min-subquery","Min-Subquery"],["node-based","Node-Based"]].map(([v,l]) => (
                      <option key={v} value={v}>{l}</option>))}
                  </select>
                )}
                {/* Integration Level column */}
                {compDim === "integration" ? (
                  <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                    <select className="field-select" value={`${compIntegrationA.ce},${compIntegrationA.comb}`} style={{ flex: 1 }}
                      onChange={(e) => { const [ce,comb] = e.target.value.split(",").map(v=>v==="true"); setCompIntegrationA({ce,comb}); setHasRun(false); }}>
                      <option value="true,false">CU On · Splitted</option>
                      <option value="true,true">CU On · Combined</option>
                      <option value="false,false">CU Off · Splitted</option>
                      <option value="false,true">CU Off · Combined</option>
                    </select>
                    <span style={{ color: "var(--ink-muted)", fontSize: "9px" }}>vs</span>
                    <select className="field-select" value={`${compIntegrationB.ce},${compIntegrationB.comb}`} style={{ flex: 1 }}
                      onChange={(e) => { const [ce,comb] = e.target.value.split(",").map(v=>v==="true"); setCompIntegrationB({ce,comb}); setHasRun(false); }}>
                      <option value="true,false">CU On · Splitted</option>
                      <option value="true,true">CU On · Combined</option>
                      <option value="false,false">CU Off · Splitted</option>
                      <option value="false,true">CU Off · Combined</option>
                    </select>
                  </div>
                ) : (
                  <select className="field-select" value={`${compIntegration.ce},${compIntegration.comb}`} style={{ opacity: 0.6 }}
                    onChange={(e) => { const [ce,comb] = e.target.value.split(",").map(v=>v==="true"); setCompIntegration({ce,comb}); setHasRun(false); }}>
                    <option value="true,false">CU On · Splitted</option>
                    <option value="true,true">CU On · Combined</option>
                    <option value="false,false">CU Off · Splitted</option>
                    <option value="false,true">CU Off · Combined</option>
                  </select>
                )}
              </div>

              {/* A/B comparison content */}
              <div className="comparison-content">
                {isRunning ? (
                  <div className="empty-state">
                    <div className="empty-icon spin">&#9881;</div>
                    <div className="empty-title">Processing query...</div>
                  </div>
                ) : hasRun && (compDataA || compDataB) ? (
                  <>
                    <div className="comp-ab">
                      {[compDataA, compDataB].map((d, idx) => {
                        const isCombOn = compDim === "integration" && (idx === 0 ? compIntegrationA.comb : compIntegrationB.comb);
                        const tempColors = {};
                        if (d && !d.error && d.rounds) {
                          d.rounds.forEach(r => { if (r.temp.name && r.temp.name !== "result") tempColors[r.temp.name.toLowerCase()] = r.color; });
                        }
                        return (
                        <div key={idx} className="comp-ab-col">
                          <div className="comp-ab-label">{idx === 0 ? labelA : labelB}</div>
                          <div style={{ padding: "4px 6px" }}>
                            {d ? (
                              d.error ? <div className="run-error">{d.error}</div>
                              : compDim === "integration" ? (
                                isCombOn && d.combinedSql ? (
                                  <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                                    <ScenarioPipeline data={d} activeNode={scenarioNode} setActiveNode={setScenarioNode}
                                      useCombineArrow={true}
                                      hideResult hideTiming />
                                    <div className="node-detail" style={{ borderColor: "var(--accent-violet)", backgroundColor: "rgba(139, 92, 246, 0.06)", marginTop: "4px" }}>
                                      <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--accent-violet)", marginBottom: "2px" }}>Combined SQL</div>
                                      <SqlBlock sql={d.combinedSql} fontSize={10} tempColors={tempColors} />
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ maxHeight: "250px", overflowY: "auto" }}>
                                    <ScenarioPipeline data={d} activeNode={scenarioNode} setActiveNode={setScenarioNode}
                                      useCombineArrow={false}
                                      hideResult hideTiming />
                                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
                                      {d.rounds.map((round) => (
                                        <div key={round.roundNum} className="node-detail"
                                          style={{ borderColor: round.color, backgroundColor: `${round.color}10` }}>
                                          <div style={{ fontSize: "9px", fontWeight: 700, color: round.color, marginBottom: "2px" }}>{round.subSqlTitle}</div>
                                          <SqlBlock sql={round.subSql} fontSize={10} tempColors={tempColors} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              ) : (
                                <ScenarioPipeline data={d} activeNode={scenarioNode} setActiveNode={setScenarioNode}
                                  useCombineArrow={false}
                                  hideResult hideTiming />
                              )
                            ) : null}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <div className="comp-bottom-row">
                      {compDataA && !compDataA.error && compDataA.output.rows.length > 0 && (
                        <div className="comp-shared-result">
                          <div className="perf-label">Query Result:</div>
                          <div className="perf-table-wrap">
                            <table className="perf-table">
                              <thead><tr>
                                {compDataA.output.columns.length > 0
                                  ? compDataA.output.columns.map((c, i) => <th key={i}>{c}</th>)
                                  : compDataA.output.rows[0].map((_, i) => <th key={i}>col {i + 1}</th>)}
                              </tr></thead>
                              <tbody>
                                {compDataA.output.rows.slice(0, 5).map((row, i) => (
                                  <tr key={i}>{row.map((val, j) => <td key={j}>{val}</td>)}</tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      {(() => {
                        const tA = compDataA?.timing;
                        const tB = compDataB?.timing;
                        const cols = ["Execution", "Middleware Overhead", "Total"];
                        const valsA = [tA?.execution, tA?.overhead, tA?.total];
                        const valsB = [tB?.execution, tB?.overhead, tB?.total];
                        return (tA || tB) ? (
                          <div className="comp-shared-result">
                            <div className="perf-label">Timing Breakdown:</div>
                            <div className="perf-table-wrap">
                              <table className="perf-table">
                                <thead><tr><th></th>{cols.map((c,i) => <th key={i} style={c === "Total" ? { fontWeight: 700 } : {}}>{c}</th>)}</tr></thead>
                                <tbody>
                                  <tr><td>{labelA}</td>{valsA.map((v,i) => <td key={i} style={i === 2 ? { fontWeight: 700 } : {}}>{v != null ? `${v.toFixed(2)} ms` : "—"}</td>)}</tr>
                                  <tr><td>{labelB}</td>{valsB.map((v,i) => <td key={i} style={i === 2 ? { fontWeight: 700 } : {}}>{v != null ? `${v.toFixed(2)} ms` : "—"}</td>)}</tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-text">Select A and B, then click <strong>Run Query</strong></div>
                  </div>
                )}
              </div>
            </div>
            );
          })() : hasRun && data ? (() => {
            /* Build temp table → color map: each temp gets the color of the round that created it */
            const tempColors = {};
            data.rounds.forEach(r => {
              if (r.temp.name && r.temp.name !== "result") {
                tempColors[r.temp.name.toLowerCase()] = r.color;
              }
            });
            return (
            <div className="pipeline-content">
              {/* Horizontal pipeline chain */}
              <div className="pipeline-chain">
                {data.rounds.map((round, idx) => (
                  <div key={round.roundNum} className="pipeline-chain-item">
                    <PipelineNode
                      round={round}
                      isActive={activeNode === round.roundNum}
                      onClick={() => setActiveNode(activeNode === round.roundNum ? null : round.roundNum)}
                    />
                    {idx < data.rounds.length - 1 && (
                      <ArrowRight color="#94A3B8" width={32} />
                    )}
                  </div>
                ))}
              </div>

              {/* Expanded SQL detail */}
              {activeNode != null && (() => {
                const round = data.rounds.find(r => r.roundNum === activeNode);
                if (!round) return null;
                return (
                  <div className="node-detail" style={{ borderColor: round.color, backgroundColor: `${round.color}10` }}>
                    <SqlBlock sql={round.subSql} fontSize={11} tempColors={tempColors} />
                  </div>
                );
              })()}


              {/* Performance section */}
              <div className="perf-section">
                <div className="perf-box">
                  {data.output.rows.length > 0 && (
                    <div className="perf-result-box">
                      <div className="perf-label">Query Result:</div>
                      <div className="perf-table-wrap">
                        <table className="perf-table">
                          <thead>
                            <tr>
                              {data.output.columns.length > 0
                                ? data.output.columns.map((c, i) => <th key={i}>{c}</th>)
                                : data.output.rows[0].map((_, i) => <th key={i}>col {i + 1}</th>)
                              }
                            </tr>
                          </thead>
                          <tbody>
                            {data.output.rows.slice(0, 5).map((row, i) => (
                              <tr key={i}>
                                {row.map((val, j) => <td key={j}>{val}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {data.timing && (
                    <div>
                      <div className="perf-label">Timing Breakdown:</div>
                      <div className="perf-timing-grid">
                        <span>Execution</span><span>{data.timing.execution?.toFixed(2)} ms</span>
                        <span>Middleware Overhead</span><span>{data.timing.overhead?.toFixed(2)} ms</span>
                        <span className="perf-timing-total">Total</span>
                        <span className="perf-timing-total">{data.timing.total?.toFixed(2)} ms</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
            );
          })() : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", height: "100%", paddingTop: "20px", background: "#fff" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800, marginBottom: "12px", color: "var(--ink)" }}>A Portable Middleware for Plan-Based Adaptive Query Processing</h2>
              <img src="/architecture.png" alt="A Portable Middleware for Plan-Based Adaptive Query Processing" style={{ maxWidth: "90%", maxHeight: "calc(100vh - 200px)", objectFit: "contain" }} />
              <button className="run-btn" style={{ marginTop: "20px" }} onClick={() => setActiveTab("Demo Scenarios")}>Demo Scenarios</button>
            </div>
          )}
        </main>
      </div>

    </div>
  );
}
