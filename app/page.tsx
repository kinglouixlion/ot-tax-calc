"use client";
import { useState, useCallback, useRef, useEffect } from "react";

const FILING_CAPS: Record<string, number> = {
  single: 12500,
  married: 25000,
};

const PHASE_OUT: Record<string, number> = {
  single: 100000,
  married: 150000,
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

function fmt(n: number) {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

// PDF generation using jsPDF loaded from CDN
async function generatePDF(
  parsedData: ParsedEntry[],
  filingStatus: string,
  employeeName: string,
  magi: number
) {
  // Dynamically load jsPDF
  if (!(window as any).jspdf) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load jsPDF"));
      document.head.appendChild(script);
    });
    // Also load autotable plugin
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load autoTable"));
      document.head.appendChild(script);
    });
  }

  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let y = 20;

  // Colors
  const darkGreen = [0, 100, 60];
  const black = [30, 30, 30];
  const gray = [120, 120, 120];
  const lightGray = [220, 220, 220];

  // Calculations
  const totalOTHours = parsedData.reduce((s, d) => s + d.overtimeHours, 0);
  const totalOTEarnings = parsedData.reduce((s, d) => s + d.overtimeAmount, 0);

  // Correct premium: use actual rates when available
  let totalPremium = 0;
  parsedData.forEach((d) => {
    if (d.hourlyRate > 0 && d.overtimeHours > 0) {
      totalPremium += d.overtimeHours * (d.otRate - d.hourlyRate);
    } else {
      totalPremium += d.overtimeAmount / 3;
    }
  });

  const cap = FILING_CAPS[filingStatus];
  const phaseOutStart = PHASE_OUT[filingStatus];
  let deductible = Math.min(totalPremium, cap);
  let phaseOutApplied = false;
  if (magi > phaseOutStart) {
    const reduction = Math.min(1, (magi - phaseOutStart) / 50000);
    deductible = deductible * (1 - reduction);
    phaseOutApplied = true;
  }

  // Estimated tax savings (rough: 22% federal bracket)
  const estimatedSavings = deductible * 0.22;

  // === HEADER BAR ===
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 38, "F");
  doc.setFillColor(0, 180, 100);
  doc.rect(0, 38, pageWidth, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("OVERTIME TAX DEDUCTION SUMMARY", margin, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(180, 200, 190);
  doc.text("One Big Beautiful Bill Act — Tax Year 2025", margin, 28);

  doc.setTextColor(180, 200, 190);
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.text(`Generated: ${dateStr}`, pageWidth - margin - doc.getTextWidth(`Generated: ${dateStr}`), 28);

  y = 50;

  // === EMPLOYEE INFO ===
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.setFont("helvetica", "bold");
  doc.text("EMPLOYEE INFORMATION", margin, y);
  y += 8;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 30, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...black);

  const col1 = margin + 6;
  const col2 = pageWidth / 2 + 10;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...gray);
  doc.setFontSize(8);
  doc.text("Name", col1, y + 4);
  doc.text("Filing Status", col2, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...black);
  doc.text(employeeName || "Not Provided", col1, y + 12);
  doc.text(filingStatus === "single" ? "Single" : "Married Filing Jointly", col2, y + 12);

  if (parsedData[0]?.grade) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...gray);
    doc.setFontSize(8);
    doc.text("Pay Grade", col1, y + 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...black);
    doc.text(parsedData[0].grade, col1, y + 28);
    y += 8;
  }

  y += 36;

  // === SUMMARY BOXES ===
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.setFont("helvetica", "bold");
  doc.text("DEDUCTION SUMMARY", margin, y);
  y += 8;

  const boxW = (pageWidth - margin * 2 - 12) / 3;
  const boxes = [
    { label: "Total OT Hours", value: totalOTHours.toFixed(1), sub: "" },
    { label: "Total OT Earnings", value: `$${fmt(totalOTEarnings)}`, sub: "" },
    { label: "Deductible Amount", value: `$${fmt(deductible)}`, sub: phaseOutApplied ? "(phase-out applied)" : "", highlight: true },
  ];

  boxes.forEach((box, i) => {
    const x = margin + i * (boxW + 6);
    if (box.highlight) {
      doc.setFillColor(240, 253, 244);
      doc.setDrawColor(0, 180, 100);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(230, 230, 230);
    }
    doc.roundedRect(x, y, boxW, 32, 3, 3, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...gray);
    doc.text(box.label, x + boxW / 2, y + 10, { align: "center" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(box.highlight ? 0 : 30, box.highlight ? 120 : 30, box.highlight ? 70 : 30);
    doc.text(box.value, x + boxW / 2, y + 22, { align: "center" });

    if (box.sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...gray);
      doc.text(box.sub, x + boxW / 2, y + 28, { align: "center" });
    }
  });

  y += 42;

  // === CALCULATION DETAIL ===
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.setFont("helvetica", "bold");
  doc.text("CALCULATION DETAIL", margin, y);
  y += 8;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y - 4, pageWidth - margin * 2, 52, 3, 3, "F");

  const details = [
    ["Total Overtime Earnings (1.5x rate)", `$${fmt(totalOTEarnings)}`],
    ["Premium Portion (0.5x — deductible under FLSA)", `$${fmt(totalPremium)}`],
    [`Deduction Cap (${filingStatus === "single" ? "Single" : "MFJ"})`, `$${cap.toLocaleString()}`],
    ...(phaseOutApplied ? [[`MAGI Phase-Out Reduction (MAGI: $${fmt(magi)})`, "Applied"]] : []),
    ["Final Deductible Amount", `$${fmt(deductible)}`],
    ["Estimated Federal Tax Savings (est. 22% bracket)", `$${fmt(estimatedSavings)}`],
  ];

  doc.setFontSize(9);
  details.forEach((row, i) => {
    const rowY = y + 4 + i * 8;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...black);
    doc.text(row[0], col1, rowY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(i === details.length - 2 ? 0 : 30, i === details.length - 2 ? 120 : 30, i === details.length - 2 ? 70 : 30);
    doc.text(row[1], pageWidth - margin - 6, rowY, { align: "right" });
  });

  y += 58;

  // === PAY PERIOD TABLE ===
  doc.setFontSize(9);
  doc.setTextColor(...gray);
  doc.setFont("helvetica", "bold");
  doc.text("PAY PERIOD BREAKDOWN", margin, y);
  y += 4;

  const tableData = parsedData.map((d, i) => [
    (i + 1).toString(),
    d.payPeriodEnd || d.fileName,
    d.overtimeHours.toFixed(1),
    d.otRate > 0 ? `$${d.otRate.toFixed(2)}` : "—",
    d.hourlyRate > 0 ? `$${d.hourlyRate.toFixed(2)}` : "—",
    `$${fmt(d.overtimeAmount)}`,
    d.hourlyRate > 0 ? `$${fmt(d.overtimeHours * (d.otRate - d.hourlyRate))}` : `$${fmt(d.overtimeAmount / 3)}`,
  ]);

  (doc as any).autoTable({
    startY: y,
    head: [["#", "Pay Period", "OT Hrs", "OT Rate", "Base Rate", "OT Earnings", "Premium"]],
    body: tableData,
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      textColor: [30, 30, 30],
      lineColor: [230, 230, 230],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 7,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    foot: [["", "TOTALS", totalOTHours.toFixed(1), "", "", `$${fmt(totalOTEarnings)}`, `$${fmt(totalPremium)}`]],
    footStyles: {
      fillColor: [240, 253, 244],
      textColor: [0, 100, 60],
      fontStyle: "bold",
      fontSize: 8,
    },
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  // Check if we need a new page for disclaimer
  if (y > 250) {
    doc.addPage();
    y = 20;
  }

  // === DISCLAIMER ===
  doc.setFillColor(255, 251, 235);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 28, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(120, 100, 30);
  doc.text("IMPORTANT DISCLAIMER", margin + 6, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(100, 90, 50);
  const disclaimer = "This document is for informational purposes only and does not constitute tax advice. The overtime tax deduction under the One Big Beautiful Bill Act applies to the FLSA premium portion of overtime pay for tax years 2025-2028. Income phase-out thresholds and eligibility requirements apply. Consult a qualified tax professional before filing. Only FLSA non-exempt employees are eligible for this deduction.";
  const splitDisclaimer = doc.splitTextToSize(disclaimer, pageWidth - margin * 2 - 12);
  doc.text(splitDisclaimer, margin + 6, y + 14);

  y += 36;

  // === FOOTER ===
  doc.setDrawColor(0, 180, 100);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...gray);
  doc.text("Powered by OT Tax Calc", margin, y);
  doc.text("www.ottaxcalc.com", pageWidth - margin - doc.getTextWidth("www.ottaxcalc.com"), y);

  // Save
  const fileName = employeeName
    ? `OT_Tax_Summary_${employeeName.replace(/\s+/g, "_")}_2025.pdf`
    : "OT_Tax_Deduction_Summary_2025.pdf";
  doc.save(fileName);
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
  const [employeeName, setEmployeeName] = useState("");
  const [magi, setMagi] = useState("");
  const [generating, setGenerating] = useState(false);
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
          reader.onerror = () => reject(new Error("Failed"));
          reader.readAsText(file);
        });
        const parsed = parseLESText(text);
        parsed.fileName = file.name;
        if (parsed.name && !employeeName) setEmployeeName(parsed.name);
        newParsed.push(parsed);
      } catch {
        try {
          const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
            reader.onerror = () => reject(new Error("Failed"));
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
          if (parsed.name && !employeeName) setEmployeeName(parsed.name);
          newParsed.push(parsed);
        } catch {
          setError(`Could not read ${file.name}. Try manual entry.`);
        }
      }
    }
    setParsedData((prev) => [...prev, ...newParsed]);
    setProcessing(false);
    if (newParsed.length > 0) setView("results");
  }, [employeeName]);

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
        fileName: "Manual Entry", name: "Manual", payPeriodEnd: e.payPeriodEnd, grade: "",
        hourlyRate: 0, otRate: parseFloat(e.otRate) || 0, regularHours: 0, regularAmount: 0,
        overtimeHours: parseFloat(e.overtimeHours) || 0, overtimeAmount: parseFloat(e.overtimeAmount) || 0, grossPay: 0,
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

  const handleGeneratePDF = async () => {
    setGenerating(true);
    try {
      await generatePDF(parsedData, filingStatus, employeeName, parseFloat(magi) || 0);
    } catch (err) {
      setError("Failed to generate PDF. Please try again.");
    }
    setGenerating(false);
  };

  const totalOTHours = parsedData.reduce((sum, d) => sum + d.overtimeHours, 0);
  const totalOTEarnings = parsedData.reduce((sum, d) => sum + d.overtimeAmount, 0);
  let totalPremium = 0;
  parsedData.forEach((d) => {
    if (d.hourlyRate > 0 && d.overtimeHours > 0) {
      totalPremium += d.overtimeHours * (d.otRate - d.hourlyRate);
    } else {
      totalPremium += d.overtimeAmount / 3;
    }
  });
  const cap = FILING_CAPS[filingStatus];
  let deductible = Math.min(totalPremium, cap);
  const magiNum = parseFloat(magi) || 0;
  let phaseOutApplied = false;
  if (magiNum > PHASE_OUT[filingStatus]) {
    const reduction = Math.min(1, (magiNum - PHASE_OUT[filingStatus]) / 50000);
    deductible = deductible * (1 - reduction);
    phaseOutApplied = true;
  }
  const estimatedSavings = deductible * 0.22;

  const resetAll = () => {
    setParsedData([]); setError(""); setView("upload");
    setManualEntries([]); setShowManual(false);
    setEmployeeName(""); setMagi("");
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

  const inputStyle = {
    width: "100%", padding: "10px 12px", background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
    color: "#c8d6e5", fontSize: 13, fontFamily: "inherit" as const, boxSizing: "border-box" as const,
  };

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
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48, animation: "fadeIn 0.6s ease-out" }}>
          <div style={{ display: "inline-block", padding: "6px 16px", border: "1px solid rgba(0,255,136,0.3)", borderRadius: 4, fontSize: 11, letterSpacing: 4, color: "#00ff88", marginBottom: 16, textTransform: "uppercase" }}>Tax Year 2025–2028</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "#00ff88", margin: "12px 0", letterSpacing: 2, animation: "glow 4s ease-in-out infinite", fontFamily: "'Courier New', monospace" }}>OT TAX DEDUCTION CALCULATOR</h1>
          <p style={{ fontSize: 13, color: "#5a6c7d", maxWidth: 540, margin: "0 auto", lineHeight: 1.6 }}>Upload your DFAS Civilian Leave & Earnings Statements to calculate your overtime tax deduction under the One Big Beautiful Bill Act</p>
        </div>

        {/* Employee Info + Filing Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24, animation: "fadeIn 0.6s ease-out 0.1s both" }}>
          <div>
            <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 6, letterSpacing: 1 }}>EMPLOYEE NAME</div>
            <input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="Full Name" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 6, letterSpacing: 1 }}>MAGI (OPTIONAL)</div>
            <input value={magi} onChange={(e) => setMagi(e.target.value)} placeholder="Adjusted Gross Income" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 6, letterSpacing: 1 }}>FILING STATUS</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{ key: "single", label: "Single" }, { key: "married", label: "MFJ" }].map((opt) => (
                <button key={opt.key} onClick={() => setFilingStatus(opt.key)} style={{
                  flex: 1, padding: "10px 8px",
                  background: filingStatus === opt.key ? "rgba(0,255,136,0.1)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${filingStatus === opt.key ? "#00ff88" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 6, color: filingStatus === opt.key ? "#00ff88" : "#5a6c7d",
                  cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit",
                }}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Upload Area */}
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
                        <input value={entry[field as keyof ManualEntry]} onChange={(e) => updateManualEntry(entry.id, field, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, padding: "8px 10px" }} />
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

        {/* Results */}
        {view === "results" && parsedData.length > 0 && (
          <div style={{ animation: "fadeIn 0.6s ease-out" }}>
            {/* Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
              {[
                { label: "TOTAL OT HOURS", value: totalOTHours, prefix: "", decimals: 1, color: "#c8d6e5" },
                { label: "TOTAL OT EARNINGS", value: totalOTEarnings, prefix: "$", decimals: 2, color: "#ffd93d" },
                { label: "DEDUCTIBLE AMOUNT", value: deductible, prefix: "$", decimals: 2, color: "#00ff88" },
                { label: "EST. TAX SAVINGS", value: estimatedSavings, prefix: "$", decimals: 2, color: "#4ecdc4" },
              ].map((card, i) => (
                <div key={i} style={{ padding: "20px 12px", background: "rgba(255,255,255,0.02)", border: `1px solid ${i === 2 ? "rgba(0,255,136,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, textAlign: "center", animation: `slideIn 0.4s ease-out ${i * 0.1}s both` }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: "#5a6c7d", marginBottom: 10 }}>{card.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: card.color }}><AnimatedNumber value={card.value} prefix={card.prefix} decimals={card.decimals} /></div>
                </div>
              ))}
            </div>

            {/* Premium + phase-out note */}
            <div style={{ padding: 16, background: "rgba(0,255,136,0.03)", border: "1px solid rgba(0,255,136,0.1)", borderRadius: 8, marginBottom: 24, fontSize: 12, color: "#7a8c9d", lineHeight: 1.7 }}>
              <span style={{ color: "#00ff88", fontWeight: 700 }}>NOTE:</span> Deduction applies to the <span style={{ color: "#c8d6e5" }}>premium portion</span> (0.5x) only. Premium: <span style={{ color: "#ffd93d" }}>${fmt(totalPremium)}</span> • Cap: <span style={{ color: "#c8d6e5" }}>${cap.toLocaleString()}</span>
              {phaseOutApplied && <span style={{ color: "#ff6b6b" }}> • ⚠ MAGI phase-out applied</span>}
            </div>

            {/* PDF EXPORT BUTTON */}
            <div style={{ marginBottom: 32, textAlign: "center" }}>
              <button onClick={handleGeneratePDF} disabled={generating} style={{
                padding: "16px 40px", background: generating ? "rgba(0,255,136,0.05)" : "linear-gradient(135deg, rgba(0,255,136,0.2), rgba(0,200,100,0.15))",
                border: "1px solid #00ff88", borderRadius: 8, color: "#00ff88", cursor: generating ? "wait" : "pointer",
                fontSize: 14, letterSpacing: 2, fontFamily: "inherit", fontWeight: 700, transition: "all 0.3s",
              }}>
                {generating ? "GENERATING PDF..." : "⬇ DOWNLOAD TAX SUMMARY PDF"}
              </button>
              <div style={{ fontSize: 11, color: "#5a6c7d", marginTop: 8 }}>Professional PDF ready for your CPA or tax filing</div>
            </div>

            {/* Monthly Chart */}
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

            {/* Pay Period Table */}
            <div style={{ marginBottom: 32, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: 11, letterSpacing: 2, color: "#5a6c7d" }}>PAY PERIOD DETAIL</span>
                <span style={{ float: "right", fontSize: 11, color: "#5a6c7d" }}>{parsedData.length} periods</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["Period End", "OT Hours", "OT Rate", "Base Rate", "OT Amount", "Premium", ""].map((h, i) => (
                        <th key={i} style={{ padding: "10px 14px", textAlign: i === 0 ? "left" : "right", color: "#5a6c7d", fontWeight: 400, fontSize: 10, letterSpacing: 1 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.map((d, i) => {
                      const premium = d.hourlyRate > 0 ? d.overtimeHours * (d.otRate - d.hourlyRate) : d.overtimeAmount / 3;
                      return (
                        <tr key={i} className="hover-row" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", animation: `slideIn 0.3s ease-out ${i * 0.03}s both` }}>
                          <td style={{ padding: "10px 14px", color: "#c8d6e5" }}>{d.payPeriodEnd || d.fileName}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right", color: d.overtimeHours > 0 ? "#c8d6e5" : "#3a4650" }}>{d.overtimeHours.toFixed(1)}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right", color: "#5a6c7d" }}>{d.otRate > 0 ? `$${d.otRate.toFixed(2)}` : "—"}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right", color: "#5a6c7d" }}>{d.hourlyRate > 0 ? `$${d.hourlyRate.toFixed(2)}` : "—"}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right", color: d.overtimeAmount > 0 ? "#ffd93d" : "#3a4650" }}>${fmt(d.overtimeAmount)}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: premium > 0 ? "#00ff88" : "#3a4650" }}>${fmt(premium)}</td>
                          <td style={{ padding: "10px 14px", textAlign: "right" }}>
                            <button onClick={() => removeEntry(i)} style={{ background: "none", border: "none", color: "#5a6c7d", cursor: "pointer", fontSize: 14, padding: 4 }}>×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={() => setView("upload")} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d6e5", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>+ ADD MORE LES</button>
              <button onClick={addManualEntry} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d6e5", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>+ MANUAL ENTRY</button>
              <button onClick={resetAll} style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)", color: "#ff6b6b", padding: "12px 24px", borderRadius: 6, cursor: "pointer", fontSize: 12, letterSpacing: 1, fontFamily: "inherit" }}>RESET ALL</button>
            </div>

            {/* Manual entry in results */}
            {showManual && manualEntries.length > 0 && (
              <div style={{ marginTop: 24, padding: 24, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8 }}>
                <div style={{ fontSize: 13, color: "#00ff88", marginBottom: 16, letterSpacing: 1 }}>MANUAL PAY PERIOD ENTRY</div>
                {manualEntries.map((entry) => (
                  <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                    {[{ field: "payPeriodEnd", placeholder: "MM/DD/YY", label: "Pay Period" }, { field: "overtimeHours", placeholder: "0", label: "OT Hours" }, { field: "otRate", placeholder: "0.00", label: "OT Rate" }, { field: "overtimeAmount", placeholder: "0.00", label: "OT Amount" }].map(({ field, placeholder, label }) => (
                      <div key={field}>
                        <div style={{ fontSize: 10, color: "#5a6c7d", marginBottom: 4, letterSpacing: 1 }}>{label}</div>
                        <input value={entry[field as keyof ManualEntry]} onChange={(e) => updateManualEntry(entry.id, field, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, padding: "8px 10px" }} />
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

            {/* Footer */}
            <div style={{ marginTop: 40, padding: 16, borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 10, color: "#3a4650", textAlign: "center", lineHeight: 1.7 }}>
              This tool provides estimates only and is not tax advice. The overtime tax deduction under the One Big Beautiful Bill Act applies to the FLSA premium portion of overtime pay for tax years 2025–2028. Only FLSA non-exempt employees are eligible. Income phase-out thresholds apply. Consult a qualified tax professional for filing guidance.
              <br />© 2026 Brownefield Holdings, LLC
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
