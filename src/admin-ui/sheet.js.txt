// Read a spreadsheet the team picks (Excel .xlsx, or .csv / .tsv, or cells pasted from Excel / Google Sheets)
// into rows of text, right in the browser. No library: .xlsx is a zip of XML files, unzipped with DecompressionStream.

/** → [{ name, rows: string[][] }] */
export async function readSheetFile(file) {
  const name = file.name || "";
  if (/\.xlsx$/i.test(name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return readXlsx(await file.arrayBuffer());
  if (/\.(xls|numbers|ods)$/i.test(name)) throw new Error("Save the file as .xlsx or .csv first (File > Save as / Download as).");
  return [{ name: name.replace(/\.\w+$/, "") || "Sheet", rows: parseDelimited(await file.text()) }];
}

/* --------------------------------- CSV / TSV --------------------------------- */

/** CSV or tab-separated text (what Excel and Google Sheets put on the clipboard). Quoted cells may contain line breaks. */
export function parseDelimited(text) {
  text = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = text.split("\n", 1)[0];
  const count = (c) => first.split(c).length - 1;
  const d = count("\t") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === d) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

/* ----------------------------------- XLSX ----------------------------------- */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Files inside a zip → { path: () => Promise<string> } (read on demand) */
function unzip(buf) {
  const b = new Uint8Array(buf);
  let e = b.length - 22;
  while (e >= 0 && u32(b, e) !== 0x06054b50) e--; // end of central directory
  if (e < 0) throw new Error("This isn't an .xlsx file");
  const total = u16(b, e + 10);
  let p = u32(b, e + 16);
  const files = {};
  for (let i = 0; i < total && u32(b, p) === 0x02014b50; i++) {
    const method = u16(b, p + 10), size = u32(b, p + 20), nameLen = u16(b, p + 28), extra = u16(b, p + 30), comment = u16(b, p + 32), local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const raw = b.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(raw);
      if (method !== 8) throw new Error("Unsupported .xlsx compression");
      const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(out).text();
    };
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, k) => (k[0] === "#" ? String.fromCodePoint(k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : +k.slice(1)) : XML_ENT[k] ?? m));
const attrOf = (tag, a) => tag.match(new RegExp(`\\s${a}="([^"]*)"`))?.[1];
// All <t> texts inside an element (a shared string or an inline string may be split in several runs)
const texts = (xml) => [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t\s*\/>/g)].map((m) => unxml(m[1] || "")).join("");
const colIndex = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(buf) {
  const z = unzip(buf);
  const read = async (path) => (z[path] ? z[path]() : "");
  const wb = await read("xl/workbook.xml");
  if (!wb) throw new Error("This isn't an Excel workbook (.xlsx)");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const t = attrOf(m[0], "Target") || "";
    target[attrOf(m[0], "Id")] = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
  }
  const shared = [...(await read("xl/sharedStrings.xml")).matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1]));
  const sheets = [];
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = unxml(attrOf(m[0], "name") || "Sheet");
    const xml = await read(target[attrOf(m[0], "r:id")] || "");
    const rows = [];
    for (const r of xml.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
      const row = [];
      for (const c of (r[1] || "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const ref = attrOf(c[1], "r"), t = attrOf(c[1], "t"), inner = c[2] || "";
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        const val = t === "s" ? shared[+v] ?? "" : t === "inlineStr" ? texts(inner) : unxml(v ?? "");
        row[ref ? colIndex(ref) : row.length] = val.trim();
      }
      if (row.some(Boolean)) rows.push(Array.from(row, (x) => x ?? ""));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

/* ----------------------------- Columns and rows ----------------------------- */

const HEAD = {
  group: /^(nh[oó]m|group|category|topic|ch[uủ] [dđ][eề]|lo[aạ]i)/i,
  situation: /^(t[iì]nh hu[oố]ng|situation|case|scenario|title|use case|ti[eê]u [dđ][eề]|khi n[aà]o)/i,
  text: /^(n[oộ]i dung|content|reply|answer|response|text|message|template|m[aẫ]u|c[aâ]u tr[aả] l[oờ]i)/i,
};

/** Guess the header row and which column is the group, the situation and the reply */
export function guessColumns(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let h = 0; h < Math.min(rows.length, 5); h++) {
    const cols = {};
    rows[h].forEach((cell, i) => {
      for (const [k, re] of Object.entries(HEAD)) if (cols[k] == null && re.test(String(cell).trim())) cols[k] = i;
    });
    if (cols.text != null) return { header: h, group: cols.group ?? -1, situation: cols.situation ?? -1, text: cols.text };
  }
  // No header: the reply is the column with the longest text on average
  const avg = Array.from({ length: width }, (_, i) => rows.reduce((n, r) => n + String(r[i] || "").length, 0) / (rows.length || 1));
  const text = avg.indexOf(Math.max(...avg, 0));
  const others = avg.map((_, i) => i).filter((i) => i !== text && avg[i] > 0);
  return { header: -1, group: others.length >= 2 ? others[0] : -1, situation: others.length >= 2 ? others[1] : others[0] ?? -1, text: Math.max(text, 0) };
}

/** Rows → items to import. Short notes and bare links start unticked: they are rarely replies. */
export function toItems(rows, cols) {
  return rows
    .map((r, i) => ({ i, group: cols.group >= 0 ? r[cols.group] || "" : "", situation: cols.situation >= 0 ? r[cols.situation] || "" : "", text: r[cols.text] || "" }))
    .filter((x) => x.i !== cols.header && x.text.trim())
    .map((x) => ({ ...x, on: x.text.trim().length >= 40 && !/^\S+$/.test(x.text.trim()) && !/n[oộ]i b[oộ]|internal/i.test(`${x.group} ${x.situation}`) }));
}

export const colName = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
