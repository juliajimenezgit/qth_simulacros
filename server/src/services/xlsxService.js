import JSZip from "jszip";
import { normalizeUnicode } from "../utils/unicode.js";

export async function buildXlsxBuffer(rows, sheetName = "Simulacro") {
  const headers = Object.keys(rows[0] || {});
  const sheetXml = buildSheetXml(headers, rows);
  const zip = new JSZip();

  zip.file("[Content_Types].xml", contentTypesXml());
  zip.folder("_rels").file(".rels", packageRelsXml());
  zip.file("xl/workbook.xml", workbookXml(sheetName));
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", workbookRelsXml());
  zip.folder("xl").folder("worksheets").file("sheet1.xml", sheetXml);
  zip.file("xl/styles.xml", stylesXml());

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}

function buildSheetXml(headers, rows) {
  const allRows = [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))];
  const xmlRows = allRows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const xmlCells = cells
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(String(value))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${xmlCells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${xmlRows}</sheetData>
</worksheet>`;
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return normalizeUnicode(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

function packageRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Inter"/></font>
    <font><b/><sz val="11"/><name val="Inter"/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;
}
