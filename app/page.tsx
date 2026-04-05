"use client";
import { useState, useCallback, useRef, useEffect } from "react";

const FILING_CAPS: Record<string, number> = {
  single: 12500,
  married: 25000,
};

function parseLESText(text: string) {
  const result = {
    name: "",
    payPeriodEnd: "",
    grade: "",
    hourlyRate: 0,
    otRate: 0,
    regularHours: 0,
    regularAmount: 0,
    overtimeHours: 0,
    overtimeAmount: 0,
    grossPay: 0,
    fileName: "",
  };

  const namePatterns = [
    /(?:3\.\s*Name\s*)([\w\s,]+?)(?=\s*(?:\d|GS|WM|WG|WL|WS))/i,
    /(?:Name\s*)([\w\s,]+?)(?=\s*(?:Pay Plan|GS|WM|WG))/i,
  ];
  for (const pat of namePatterns) {
    const m = text.match(pat);
    if (m) { result.name = m[1].trim(); break; }
  }

  const ppMatch = text.match(/(?:Pay\s*Period\s*End|1\.\s*Pay\s*Period)\s*[\n\r]*\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (ppMatch) result.payPeriodEnd = ppMatch[1];

  const gradeMatch = text.match(/(GS|WM|WG|WL|WS)\s*[-\s]*(\d{1,2})\s*[-\s]*(\d{1,2})/i);
  if (gradeMatch) result.grade = `${gradeMatch[1].toUpperCase()}-${gradeMatch[2]}/${gradeMatch[3]}`;

  const hourlyPatterns = [
    /(?:Hourly\/Daily\s*Rate|5\.\s*Hourly)\s*[\n\r]*\s*(\d+\.\d{2})/i,
  ];
  for (const pat of hourlyPatterns) {
    const m = text.match(pat);
    if (m) { result.hourlyRate = parseFloat(m[1]); break; }
  }

  const otRatePatterns = [
    /(?:Basic\s*OT\s*Rate|OT\s*Rate|6\.\s*Basic\s*OT)\s*[\n\r]*\s*(\d+\.\d{2})/i,
  ];
  for (const pat of otRatePatterns) {
    const m = text.match(pat);
    if (m) { result.otRate = parseFloat(m[1]); break; }
  }

  const regMatch = text.match(/REGULAR\s*PAY\s+(\d+\.?\d*)\s+([\d,]+\.\d{2})/i);
  if (regMatch) {
    result.regularHours = parseFloat(regMatch[1]);
    result.regularAmount = parseFloat(regMatch[2].replace(/,/g, ""));
  }

  const otPatterns = [
    /OVERTIME\s+(\d+\.?\d*)\s+([\d,]+\.\d{2})/i,
    /OT\s+(\d+\.?\d*)\s+([\d,]+\.\d{2})/i,
  ];
  for (const pat of otPatterns) {
    const m = text.match(pat);
    if (m) {
      result.overtimeHours = parseFloat(m[1]);
      result.overtimeAmount = parseFloat(m[2].replace(/,/g, ""));
      break;
    }
  }

  const grossMatch = text.match(/GROSS\s*PAY\s+([\d,]+\.\d{2})/i);
  if (grossMatch) result.grossPay = parseFloat(grossMatch[1].replace(/,/g, ""));

  return result;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMonthFromDate(dateStr: string) {
  if (!dateStr) return "Unknown";
  const parts = dateStr.split("/");
  if (parts.length >= 2) {
    const monthIdx = parseInt(parts[0], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) return MONTHS[monthIdx];
  }
  return "Unknown";
}

function AnimatedNumber({ value, prefix = "$", decimals = 2 }: { value: number; prefix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const start = display;
    const end = value;
    const duration = 800;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) ref.current = requestAnimationFrame(animate);
    }
    ref.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(ref.current);
  }, [value]);

  return <span>{prefix}{display.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}</span>;
}

interface ParsedEntry {
  name: string;
  payPeriodEnd: string;
  grade: string;
  hourlyRate: number;
  otRate: number;
  regularHours: number;
  regularAmount: number;
  overtimeHours: number;
  overtimeAmount: number;
  grossPay: number;
  fileName: string;
}

interface ManualEntry {
  payPeriodEnd: string;
  overtimeHours: string;
  overtimeAmount: string;
  otRate: string;
  id: number;
}

export default function OTTaxCalc() {
  const [parsedData, setParsedData] = useState<ParsedEntry[]>([]);
  const [filingStatus, setFilingStatus] = useState("single");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("upload");
  const [dragOver, setDragOver] = useState(false);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [showManual, setShowManual] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (newFiles: FileList) => {
    setProcessing(true);
    setError("");
    const fileArray = Array.from(newFiles);
    const newParsed: ParsedEntry[] = [];

    for (const file of fileArray) {
      try {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsText(file);
        });
        const parsed = parseLESText(text);
        parsed.fileName = file.name;
        newParsed.push(parsed);
      } catch {
        try {
          const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
            reader.onerror = () => reject(new Error("Read failed"));
            reader.readAsArrayBuffer(file);
          });
          const bytes = new Uint8Array(buffer);
          let text = "";
          for (let i = 0; i < bytes.length; i++) {
            const c = bytes[i];
            if (c >= 32 && c < 127) text += String.fromCharCode(c);
            else if (c === 10 || c === 13) text += "\n";
            else text += " ";
          }
          const parsed = parseLESText(text);
          parsed.fileName = file.name;
          newParsed.push(parsed);
        } catch {
          setError(`Could not read ${file.name}. Try manual entry.`);
        }
      }
    }

    setParsedData((prev) => [...prev, ...newParsed]);
    setProcessing(false);
    if (newParsed.length > 0) setView("results");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const addManualEntry = () => {
    setManualEntries((prev) => [...prev, { payPeriodEnd: "", overtimeHours: "", overtimeAmount: "", otRate: "", id: Date.now() }]);
    setShowManual(true);
  };

  const updateManualEntry = (id: number, field: string, value: string) => {
    setManualEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const submitManualEntries = () => {
    const newParsed: ParsedEntry[] = manualEntries
      .filter((e) => e.overtimeAmount || e.overtimeHours)
      .map((e) => ({
        fileName: "Manual Entry",
        name: "Manual",
        payPeriodEnd: e.payPeriodEnd,
        grade: "",
        hourlyRate: 0,
        otRate: parseFloat(e.otRate) || 0,
        regularHours: 0,
        regularAmount: 0,
        overtimeHours: parseFloat(e.overtimeHours) || 0,
        overtimeAmount: parseFloat(e.overtimeAmount) || 0,
        grossPay: 0,
      }));
    if (newParsed.length > 0) {
      setParsedData((prev) => [...prev, ...newParsed]);
      setManualEntries([]);
      setShowManual(false);
      setView("results");
    }
  };

  const removeEntry = (index: number) => {
    setParsedData((prev) => prev.filter((_, i) => i !== index));
    if (parsedData.length <= 1) setView("upload");
  };

  const totalOTHours = parsedData.reduce((sum, d) => sum + d.overtimeHours, 0);
  const totalOTEarnings = parsedData.reduce((sum, d) => sum + d.overtimeAmount, 0);
  const totalOTPremium = totalOTEarnings / 3;
  const cap = FILING_CAPS[filingStatus];
  const deductibleAmount = Math.min(totalOTPremium, cap);

  const resetAll = () => {
    setParsedData([]);
    setError("");
    setView("upload");
    setManualEntries([]);
    setShowManual(false);
  };

  const monthlyData: Record<string, { hours: number; earnings: number; count: number }> = {};
  parsedData.forEach((d) => {
    const month = getMonthFromDate(d.payPeriodEnd);
    if (!monthlyData[month]) monthlyData[month] = { hours: 0, earnings: 0, count: 0 };
    monthlyData[month].hours += d.overtimeHours;
    monthlyData[month].earnings += d.overtimeAmount;
    monthlyData[month].count += 1;
  });
  const maxEarning = Math.max(...Object.values(monthlyData).map((m) => m.earnings), 1);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", fontFamily: "'Courier New', 'SF Mono', monospace", color: "#c8d6e5", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", inset: 0, opacity: 0.03, backgroundImage: "linear-gradient(rgba(0,255,136,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,0.3) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes glow { 0%, 100% { text-shadow: 0 0 20px rgba(0,255,136,0.3); } 50% { text-shadow: 0 0 40px rgba(0,255,136,0.6), 0 0 80px rgba(0,255,136,0.2); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes barGrow { from { width: 0; } }
        input:focus, select:focus { outline: none; border-color: #00ff88 !important; box-shadow: 0 0 20px rgba(0,255,136,0.2); }
        .hover-row:hover { background: rgba(0,255,136,0.05) !important; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 20px", position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", marginBottom: 48, animation: "fadeIn 0.6s ease-out" }}>
          <div style={{ display: "inline-block", padding: "6px 16px", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 4, fontSize: 11, letterSpacing: 4, color: "#00ff88", marginBottom: 16, textTransform: "uppercase" }}>Tax Year 2025–2028</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "#00ff88", margin: "12px 0", letterSpacing: 2, animation: "glow 4s ease-in-out infinite", fontFamily: "'Courier New', monospace" }}>OT TAX DEDUCTION CALCULATOR</h1>
          <p style={{ fontSize: 13, color: "#5a6c7d", maxWidth: 500, margin: "0 auto", lineHeight: 1.6 }}>Upload your DFAS Civilian Leave & Earnings Statements (LES)<br />to calculate your overtime tax deduction under the One Big Beautiful Bill</p>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 36, animation: "fadeIn 0.6s ease-out 0.1s both" }}>
          {[{ key: "single", label: "SINGLE", cap: "$12,500" }, { key: "married", label: "MARRIED JOINT", cap: "$25,000" }].map((opt) => (
            <button key={opt.key} onClick={() => setFilingStatus(opt.key)} style={{ padding: "12px 24px", background: filingStatus === opt.key ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${filingStatus === opt.key ? "#00ff88" : "rgba(255,255,255,0.08)"}`, borderRadius: 6, color: filingStatus === opt.key ? "#00ff88" : "#5a6c7d", cursor: "pointer", fontSize: 12, letterSpacing: 2, fontFamily: "inherit", transition: "all 0.3s" }}>
              {opt.label}
              <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>Cap: {opt.cap}</div>
            </button>
          ))}
        </div>

        {view === "upload" && (
          <div style={{ animation: "fadeIn 0.6s ease-out 0.2s both" }}>
            <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()} style={{ border: `2px dashed ${dragOver ? "#00ff88" : "rgba(255,255,255,0.1)"}`, borderRadius: 12, padding: "60px 40px", textAlign: "center", cursor: "pointer", background: dragOver ? "rgba(0,255,136,0.05)" : "rgba(255,255,255,0.01)", transition: "all 0.4s", marginBottom: 24 }}>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.txt,.csv" onChange={(e) => e.target.files && handleFiles(e.target.files)} style={{ display: "none" }} />
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>⬆</div>
              <div style={{ fontSize: 16, color: "#c8d6e5", marginBottom: 8 }}>Drop LES files here or tap to browse</div>
              <div style={{ fontSize: 12, color: "#5a6c7d" }}>Accepts PDF and text formats • Upload all 26 pay periods</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <button onClick={addManualEntry} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#5a6c7d", padding: "10px 20px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>+ MANUAL ENTRY</button>
            </div>

            {showManual && (
              <div style={{ marginTop: 24, padding: 24, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: "#00ff88", marginBottom: 16, letterSpacing: 1 }}>MANUAL PAY PERIOD ENTRY</div>
                {manualEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                    {[{ field: "payPeriodEnd", placeholder: "MM/DD/YY", label: "Pay Period" }, { field: "overtimeHours", placeholder: "0", label: "OT Hours" }, { field: "otRate", placeholder: "0.00", label: "OT Rate" }, { field: "overtimeAmount", placeholder: "0.00", label: "OT Amount" }].map(({ field, placeholder, label }) => (
                      <div key={field}>
                        <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 4, letterSpacing: 1 }}>{label}</div>
                        <input value={entry[field as keyof ManualEntry]} onChange={(e) => updateManualEntry(entry.id, field, e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#c8d6e5", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                  <button onClick={addManualEntry} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#5a6c7d", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>+ ADD PERIOD</button>
                  <button onClick={submitManualEntries} style={{ background: "rgba(0,255,136,0.15)", border: "1px solid #00ff88", color: "#00ff88", padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>CALCULATE →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {processing && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ color: "#00ff88", animation: "pulse 1s infinite", fontSize: 14, letterSpacing: 2 }}>PROCESSING LES DATA...</div>
          </div>
        )}

        {error && (
          <div style={{ padding: 16, background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 8, color: "#ff6b6b", fontSize: 13, marginBottom: 24, textAlign: "center" }}>{error}</div>
        )}

        {view === "results" && parsedData.length > 0 && (
          <div style={{ animation: "fadeIn 0.6s ease-out" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 32 }}>
              {[{ label: "TOTAL OT HOURS", value: totalOTHours, prefix: "", decimals: 1, color: "#c8d6e5" }, { label: "TOTAL OT EARNINGS", value: totalOTEarnings, prefix: "$", decimals: 2, color: "#ffd93d" }, { label: "DEDUCTIBLE AMOUNT", value: deductibleAmount, prefix: "$", decimals: 2, color: "#00ff88" }].map((card, i) => (
                <div key={i} style={{ padding: "24px 16px", background: "rgba(255,255,255,0.02)", border: `1px solid ${i === 2 ? "rgba(0,255,136,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, textAlign: "center", animation: `slideIn 0.4s ease-out ${i * 0.1}s both` }}>
                  <div style={{ fontSize: 10, letterSpacing: 2, color: "#5a6c7d", marginBottom: 12 }}>{card.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: card.color }}><AnimatedNumber value={card.value} prefix={card.prefix} decimals={card.decimals} /></div>
                </div>
              ))}
            </div>

            <div style={{ padding: 16, background: "rgba(0,255,136,0.03)", border: "1px solid rgba(0,255,136,0.1)", borderRadius: 8, marginBottom: 32, fontSize: 12, color: "#7a8c9d", lineHeight: 1.7 }}>
              <span style={{ color: "#00ff88", fontWeight: 700 }}>NOTE:</span> The deduction applies only to the <span style={{ color: "#c8d6e5" }}>premium portion</span> of overtime (the extra 0.5x above regular rate under FLSA). Total OT premium: <span style={{ color: "#ffd93d" }}>${totalOTPremium.toFixed(2)}</span> • Cap ({filingStatus === "single" ? "Single" : "MFJ"}): <span style={{ color: "#c8d6e5" }}>${cap.toLocaleString()}</span>
              {totalOTPremium > cap && <span style={{ color: "#ff6b6b" }}> • ⚠ Premium exceeds cap — deduction limited to ${cap.toLocaleString()}</span>}
            </div>

            {Object.keys(monthlyData).length > 0 && (
              <div style={{ marginBottom: 32, padding: 24, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#5a6c7d", marginBottom: 20 }}>MONTHLY BREAKDOWN</div>
                {MONTHS.map((month, i) => {
                  const data = monthlyData[month];
                  if (!data) return null;
                  return (
                    <div key={month} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, animation: `slideIn 0.3s ease-out ${i * 0.05}s both` }}>
                      <div style={{ width: 36, fontSize: 11, color: "#5a6c7d", textAlign: "right" }}>{month}</div>
                      <div style={{ flex: 1, height: 24, background: "rgba(0,0,0,0.3)", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(data.earnings / maxEarning) * 100}%`, background: "linear-gradient(90deg, rgba(0,255,136,0.3), rgba(0,255,136,0.6))", borderRadius: 3, animation: "barGrow 0.8s ease-out", display: "flex", alignItems: "center", paddingLeft: 8 }}>
                          {data.earnings > 0 && <span style={{ fontSize: 10, color: "#00ff88", whiteSpace: "nowrap" }}>{data.hours}h • ${data.earnings.toFixed(0)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginBottom: 32, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, letterSpacing: 2, color: "#5a6c7d" }}>PAY PERIOD DETAIL</span>
                <span style={{ float: "right", fontSize: 11, color: "#5a6c7d" }}>{parsedData.length} periods loaded</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["Period End", "OT Hours", "OT Rate", "OT Amount", ""].map((h, i) => (
                        <th key={i} style={{ padding: "10px 16px", textAlign: i === 0 ? "left" : "right", color: "#5a6c7d", fontWeight: 400, fontSize: 10, letterSpacing: 1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((d, i) => (
                      <tr key={i} className="hover-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", animation: `slideIn 0.3s ease-out ${i * 0.03}s both` }}>
                        <td style={{ padding: "10px 16px", color: "#c8d6e5" }}>{d.payPeriodEnd || d.fileName}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", color: d.overtimeHours > 0 ? "#c8d6e5" : "#3a4650" }}>{d.overtimeHours.toFixed(1)}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", color: "#5a6c7d" }}>{d.otRate > 0 ? `$${d.otRate.toFixed(2)}` : "—"}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: d.overtimeAmount > 0 ? "#00ff88" : "#3a4650" }}>${d.overtimeAmount.toFixed(2)}</td>
                        <td style={{ padding: "10px 16px", textAlign: "right" }}>
                          <button onClick={() => removeEntry(i)} style={{ background: "none", border: "none", color: "#5a6c7d", cursor: "pointer", fontSize: 14, padding: 4 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => setView("upload")} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d6e5", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>+ ADD MORE LES</button>
              <button onClick={addManualEntry} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d6e5", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>+ MANUAL ENTRY</button>
              <button onClick={resetAll} style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff6b6b", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>RESET ALL</button>
            </div>

            {showManual && manualEntries.length > 0 && (
              <div style={{ marginTop: 24, padding: 24, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: "#00ff88", marginBottom: 16, letterSpacing: 1 }}>MANUAL PAY PERIOD ENTRY</div>
                {manualEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                    {[{ field: "payPeriodEnd", placeholder: "MM/DD/YY", label: "Pay Period" }, { field: "overtimeHours", placeholder: "0", label: "OT Hours" }, { field: "otRate", placeholder: "0.00", label: "OT Rate" }, { field: "overtimeAmount", placeholder: "0.00", label: "OT Amount" }].map(({ field, placeholder, label }) => (
                      <div key={field}>
                        <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 4, letterSpacing: 1 }}>{label}</div>
                        <input value={entry[field as keyof ManualEntry]} onChange={(e) => updateManualEntry(entry.id, field, e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 10px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#c8d6e5", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }} />
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                  <button onClick={addManualEntry} style={{ background: "none", border: "1px solid rgba(255,255,255,0.1)", color: "#5a6c7d", padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>+ ADD PERIOD</button>
                  <button onClick={submitManualEntries} style={{ background: "rgba(0,255,136,0.15)", border: "1px solid #00ff88", color: "#00ff88", padding: "8px 20px", borderRadius: 4, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit" }}>CALCULATE →</button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 40, padding: 16, borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 10, color: "#3a4650", textAlign: "center", lineHeight: 1.7 }}>
              This tool provides estimates only and is not tax advice. The overtime tax deduction under the One Big Beautiful Bill applies to the FLSA premium portion of overtime pay for tax years 2025–2028. Consult a qualified tax professional for filing guidance.<br />© 2026 Brownefield Holdings, LLC
            </div>
          </div>
        )}
      </div>
    </div>
  );
}