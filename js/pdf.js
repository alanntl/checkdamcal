// A small PDF writer for the report: A4 pages, the two built-in Helvetica
// faces, lines, rectangles, paths and text. No dependencies, so the report
// comes out the same in any browser, inside the OurWater app, and in the
// node tests.
//
// Coordinates are points (1/72 in) from the TOP-left of the page, y down, as
// on screen; they are flipped to PDF's bottom-left origin when written.
// Text uses WinAnsi (Windows-1252): Latin letters, digits and the symbols the
// report needs (² ³ × ÷ · – —). Anything else is replaced by the nearest
// ASCII ("−" -> "-", "₁" -> "1") or "?", so a PDF never carries garbage bytes.

// Helvetica and Helvetica-Bold advance widths (1/1000 em), codes 32–126,
// from the Adobe Core 14 AFM files.
const W_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
];
const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];
// WinAnsi codes above 126 that the report uses: [regular, bold] widths.
const W_EXT = {
  0x85: [1000, 1000], // …
  0x91: [222, 278], // ‘
  0x92: [222, 278], // ’
  0x93: [333, 500], // “
  0x94: [333, 500], // ”
  0x95: [350, 350], // •
  0x96: [556, 556], // –
  0x97: [1000, 1000], // —
  0xa0: [278, 278], // no-break space
  0xb0: [400, 400], // °
  0xb1: [584, 584], // ±
  0xb2: [333, 333], // ²
  0xb3: [333, 333], // ³
  0xb5: [556, 611], // µ
  0xb7: [278, 278], // ·
  0xbd: [834, 834], // ½
  0xd7: [584, 584], // ×
  0xe9: [556, 556], // é
  0xf7: [584, 584], // ÷
};
// Unicode -> WinAnsi byte for the 0x80–0x9F block (the rest of Latin-1 maps 1:1).
const CP1252 = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// Characters with no WinAnsi code, spelled the nearest readable way.
const FALLBACK = {
  "−": "-", // minus sign
  "‑": "-", // non-breaking hyphen
  " ": " ", // narrow no-break space
  " ": " ", // thin space
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
  "₋": "-", // subscript minus
  "≤": "<=", "≥": ">=", "≈": "~", "→": "->", "←": "<-",
  "Δ": "d", // Δ
  "✓": "ok", // ✓
};

/** One string -> an array of WinAnsi byte codes. */
export function winAnsi(str) {
  const out = [];
  for (const ch of String(str ?? "")) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else if (FALLBACK[ch] != null) for (const c of FALLBACK[ch]) out.push(c.charCodeAt(0));
    else if (cp === 9 || cp === 10 || cp === 13) out.push(32);
    else out.push(63); // "?"
  }
  return out;
}

function charWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REG)[code - 32];
  const e = W_EXT[code];
  return e ? e[bold ? 1 : 0] : 556;
}

/** "#18776f" -> "0.094 0.467 0.435" */
function rgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return "0 0 0";
  return [m[1], m[2], m[3]].map((x) => (parseInt(x, 16) / 255).toFixed(3)).join(" ");
}

const n = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/** PDF literal string from WinAnsi codes: ASCII as is, the rest as octal escapes. */
function pdfString(codes) {
  let s = "(";
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += "\\" + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0");
    else s += String.fromCharCode(c);
  }
  return s + ")";
}

export const A4 = { width: 595.28, height: 841.89 };

export class PdfDoc {
  constructor({ width = A4.width, height = A4.height, title = "", subject = "", creationDate = new Date() } = {}) {
    this.W = width;
    this.H = height;
    this.title = title;
    this.subject = subject;
    this.creationDate = creationDate;
    this.pages = [];
    this.ops = null;
  }

  get pageCount() {
    return this.pages.length;
  }

  /** Start a new page; drawing goes to it until the next call. */
  page() {
    this.ops = [];
    this.pages.push(this.ops);
    return this;
  }

  /** Draw on an earlier page again (0-based), e.g. footers once the page count is known. */
  goTo(index) {
    this.ops = this.pages[index];
    return this;
  }

  /** Text width in points. */
  width(str, size = 10, bold = false) {
    let w = 0;
    for (const c of winAnsi(str)) w += charWidth(c, bold);
    return (w * size) / 1000;
  }

  /** Draw text with its baseline at y. align: left | right | center. */
  text(str, x, y, { size = 10, bold = false, color = "#000000", align = "left" } = {}) {
    const codes = winAnsi(str);
    if (!codes.length) return this;
    const w = this.width(str, size, bold);
    const x0 = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${rgb(color)} rg ${n(x0)} ${n(this.H - y)} Td ${pdfString(codes)} Tj ET`);
    return this;
  }

  /** Break text into lines no wider than maxWidth (words longer than a line are kept whole). */
  wrap(str, maxWidth, size = 10, bold = false) {
    const lines = [];
    for (const para of String(str ?? "").split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && this.width(next, size, bold) > maxWidth) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  /** Wrapped text from the top-left; returns the y below the last line. */
  paragraph(str, x, y, maxWidth, { size = 10, bold = false, color = "#000000", lineHeight = 1.4 } = {}) {
    const lh = size * lineHeight;
    const lines = this.wrap(str, maxWidth, size, bold);
    lines.forEach((line, i) => this.text(line, x, y + size + i * lh, { size, bold, color }));
    return y + lines.length * lh + (lh - size) / 2;
  }

  line(x1, y1, x2, y2, { color = "#000000", width = 0.5, dash = null } = {}) {
    this.ops.push(
      `q ${rgb(color)} RG ${n(width)} w ${dash ? `[${dash.map(n).join(" ")}] 0 d ` : ""}${n(x1)} ${n(this.H - y1)} m ${n(x2)} ${n(this.H - y2)} l S Q`,
    );
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.5 } = {}) {
    if (!fill && !stroke) return this;
    const op = fill && stroke ? "B" : fill ? "f" : "S";
    this.ops.push(
      `q ${fill ? `${rgb(fill)} rg ` : ""}${stroke ? `${rgb(stroke)} RG ${n(width)} w ` : ""}${n(x)} ${n(this.H - y - h)} ${n(w)} ${n(h)} re ${op} Q`,
    );
    return this;
  }

  /** A polyline through [[x, y], …]; `close` + `fill` make an area. */
  path(points, { stroke = null, fill = null, width = 1, close = false, dash = null } = {}) {
    if (points.length < 2 || (!stroke && !fill)) return this;
    const [p0, ...rest] = points;
    let d = `${n(p0[0])} ${n(this.H - p0[1])} m`;
    for (const p of rest) d += ` ${n(p[0])} ${n(this.H - p[1])} l`;
    if (close) d += " h";
    const op = fill && stroke ? "B" : fill ? "f" : "S";
    this.ops.push(
      `q ${fill ? `${rgb(fill)} rg ` : ""}${stroke ? `${rgb(stroke)} RG ${n(width)} w 1 j 1 J ` : ""}${dash ? `[${dash.map(n).join(" ")}] 0 d ` : ""}${d} ${op} Q`,
    );
    return this;
  }

  /** A filled circle (four Bézier quarters). */
  circle(cx, cy, r, { fill = "#000000" } = {}) {
    const k = 0.5523 * r;
    const y = this.H - cy;
    this.ops.push(
      `q ${rgb(fill)} rg ${n(cx + r)} ${n(y)} m ` +
        `${n(cx + r)} ${n(y + k)} ${n(cx + k)} ${n(y + r)} ${n(cx)} ${n(y + r)} c ` +
        `${n(cx - k)} ${n(y + r)} ${n(cx - r)} ${n(y + k)} ${n(cx - r)} ${n(y)} c ` +
        `${n(cx - r)} ${n(y - k)} ${n(cx - k)} ${n(y - r)} ${n(cx)} ${n(y - r)} c ` +
        `${n(cx + k)} ${n(y - r)} ${n(cx + r)} ${n(y - k)} ${n(cx + r)} ${n(y)} c f Q`,
    );
    return this;
  }

  /** The finished file as bytes. */
  save() {
    const objects = []; // index i -> object i + 1
    const add = (body) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add(null); // filled in below
    const pagesObj = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const d = this.creationDate;
    const pad = (v) => String(v).padStart(2, "0");
    const stamp = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    const info = add(
      `<< /Title ${pdfString(winAnsi(this.title))} /Subject ${pdfString(winAnsi(this.subject))} /Producer (CheckDamCal) /CreationDate (${stamp}) >>`,
    );
    const kids = [];
    for (const ops of this.pages) {
      const content = ops.join("\n");
      const contentObj = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(this.W)} ${n(this.H)}] ` +
            `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentObj} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    // Every character written is ASCII (text bytes above 126 are octal
    // escapes), so string length = byte length and offsets are exact.
    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
