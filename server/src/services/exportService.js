import JSZip from "jszip";
import { normalizeUnicode } from "../utils/unicode.js";
import { buildXlsxBuffer } from "./xlsxService.js";

const exportFormats = {
  xlsx: {
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    build: (rows) => buildXlsxBuffer(rows, "Simulacro"),
  },
  csv: {
    extension: "csv",
    contentType: "text/csv; charset=utf-8",
    build: (rows) => Buffer.from(buildCsv(rows), "utf8"),
  },
  docx: {
    extension: "docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    build: buildDocxBuffer,
  },
  pdf: {
    extension: "pdf",
    contentType: "application/pdf",
    build: buildPdfBuffer,
  },
  json: {
    extension: "json",
    contentType: "application/json; charset=utf-8",
    build: (rows) => Buffer.from(JSON.stringify(rows, null, 2), "utf8"),
  },
};

export function getExportFormat(format) {
  return exportFormats[format] || exportFormats.xlsx;
}

export function listExportFormats() {
  return Object.keys(exportFormats);
}

function buildCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  const lines = [
    headers.map(escapeCsv).join(";"),
    ...rows.map((row) => headers.map((key) => escapeCsv(row[key] ?? "")).join(";")),
  ];

  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function escapeCsv(value) {
  const text = normalizeUnicode(value).replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

async function buildDocxBuffer(rows) {
  const zip = new JSZip();

  zip.file("[Content_Types].xml", docxContentTypesXml());
  zip.folder("_rels").file(".rels", docxPackageRelsXml());
  zip.folder("word").file("document.xml", docxDocumentXml(rows));
  zip.folder("word").file("styles.xml", docxStylesXml());
  zip.folder("word").folder("_rels").file("document.xml.rels", docxDocumentRelsXml());

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

function docxDocumentXml(rows) {
  const body = [
    paragraphXml("Simulacro QTH", "Title"),
    ...rows.flatMap((row, index) => [
      paragraphXml(`${index + 1}. ${row.Pregunta}`, "Heading1"),
      paragraphXml(`A. ${row["Opcion A"]}`),
      paragraphXml(`B. ${row["Opcion B"]}`),
      paragraphXml(`C. ${row["Opcion C"]}`),
      paragraphXml(`D. ${row["Opcion D"]}`),
      paragraphXml(`Correcta: ${row.Correcta}`, "Strong"),
      paragraphXml(`Explicacion: ${row.Explicacion}`),
      paragraphXml(`Referencia: ${row.Referencia}`),
      paragraphXml(`Nivel: ${row.Nivel}`),
      paragraphXml(""),
    ]),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function paragraphXml(text, style = "Normal") {
  const styleXml = style === "Normal" ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function docxContentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
}

function docxPackageRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function docxDocumentRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function docxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Strong">
    <w:name w:val="Strong"/>
    <w:rPr><w:b/></w:rPr>
  </w:style>
</w:styles>`;
}

function buildPdfBuffer(rows) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 42;
  const lineHeight = 14;
  const maxChars = 95;
  const pages = [];
  let currentPage = [];
  let y = pageHeight - margin;

  const addLine = (line = "") => {
    if (y < margin) {
      pages.push(currentPage);
      currentPage = [];
      y = pageHeight - margin;
    }
    currentPage.push({ text: line, y });
    y -= lineHeight;
  };

  addLine("Simulacro QTH");
  addLine("");

  rows.forEach((row, index) => {
    const blocks = [
      `${index + 1}. ${row.Pregunta}`,
      `A. ${row["Opcion A"]}`,
      `B. ${row["Opcion B"]}`,
      `C. ${row["Opcion C"]}`,
      `D. ${row["Opcion D"]}`,
      `Correcta: ${row.Correcta}`,
      `Explicación: ${row.Explicacion}`,
      `Referencia: ${row.Referencia}`,
      `Nivel: ${row.Nivel}`,
      "",
    ];

    for (const block of blocks) {
      for (const line of wrapText(block, maxChars)) {
        addLine(line);
      }
    }
  });

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return createPdf(pages, { pageWidth, pageHeight, margin });
}

function wrapText(value, maxChars) {
  const text = normalizeUnicode(value);
  if (!text) return [""];

  const lines = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    const nextLine = line ? `${line} ${word}` : word;
    if (nextLine.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function createPdf(pages, { pageWidth, pageHeight, margin }) {
  const objects = [];
  const pageObjectIds = [];

  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject(null);
  const fontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );

  for (const page of pages) {
    const content = [
      "BT",
      "/F1 10 Tf",
      "1 0 0 1 42 800 Tm",
      ...page.map((line) => `1 0 0 1 ${margin} ${line.y} Tm (${escapePdfText(line.text)}) Tj`),
      "ET",
    ].join("\n");
    const contentId = addObject(
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    );
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageObjectIds.push(pageId);
  }

  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  const parts = ["%PDF-1.4\n"];
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  parts.push(`xref\n0 ${objects.length + 1}\n`);
  parts.push("0000000000 65535 f \n");
  for (const offset of offsets.slice(1)) {
    parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  parts.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return Buffer.from(parts.join(""), "latin1");
}

function escapePdfText(value) {
  return normalizeUnicode(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function escapeXml(value) {
  return normalizeUnicode(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
