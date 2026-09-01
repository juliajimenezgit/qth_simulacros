import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { normalizeUnicode } from "../utils/unicode.js";

const LINE_Y_TOLERANCE = 4;
const LINE_X_RESET_TOLERANCE = 18;
const MIN_CHUNK_CHARS = 120;
const MIN_CHUNK_WORDS = 25;

export async function extractPdfPages(filePath) {
  const buffer = await fs.readFile(filePath);
  const pages = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: true,
        disableCombineTextItems: false,
      });
      const text = cleanPageText(renderLines(content.items));
      pages.push(text);
      return text;
    },
  });

  return pages
    .map((text, index) => ({ page: index + 1, text }))
    .filter((page) => page.text.length > 0);
}

export function splitIntoChunks(pages, maxChars = 2200, overlap = 260) {
  const chunks = [];
  let currentSection = null;

  for (const page of pages) {
    const { blocks, section } = splitPageIntoSectionBlocks(
      page.text,
      currentSection,
    );
    currentSection = section;

    for (const block of blocks) {
      for (const text of splitBlockText(block.text, maxChars, overlap)) {
        if (!isUsefulChunk(text)) continue;
        chunks.push({
          page: page.page,
          section: block.section,
          text,
        });
      }
    }
  }

  return chunks;
}

export function extractDocumentDisplayTitle(pages, filename) {
  const firstPageLines = (pages[0]?.text || "")
    .split("\n")
    .map((line) => normalizeUnicode(line).trim())
    .filter(Boolean);
  const titleLines = [];

  for (const line of firstPageLines.slice(0, 12)) {
    if (/ceis\s+guadalajara|parte\s+\d+/i.test(line)) break;
    const letters = line.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
    const uppercase = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
    if (letters.length >= 3 && uppercase / letters.length >= 0.75 && line.length <= 80) {
      titleLines.push(line);
      if (titleLines.join(" ").length >= 12 && !/\b(DE|DEL|Y)$/i.test(line)) break;
    } else if (titleLines.length > 0) {
      break;
    }
  }

  const extracted = titleLines.join(" ").replace(/\s+/g, " ").trim();
  return toSpanishTitle(extracted || fallbackTitleFromFilename(filename));
}

function fallbackTitleFromFilename(filename) {
  const manualTitles = {
    M1: "Incendios",
    M2: "Rescate y salvamento",
    M3: "Riesgos tecnológicos y asistencias técnicas",
    M4: "Intervenciones sanitarias en emergencias",
    M5: "Acondicionamiento físico y socorrismo",
    M6: "Equipos operativos y herramientas de intervención",
    M7: "Formación del mando intermedio",
  };
  const manualCode = String(filename).match(/^(M\d+)/i)?.[1]?.toUpperCase();
  if (/-00-completo\.pdf$/i.test(filename) && manualTitles[manualCode]) {
    return manualTitles[manualCode];
  }
  return String(filename)
    .replace(/\.pdf$/i, "")
    .replace(/^.*-\d{2}-/, "")
    .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, "$1 $2")
    .replace(/[-_]+/g, " ");
}

function toSpanishTitle(value) {
  const lowercaseWords = new Set(["a", "de", "del", "el", "en", "la", "las", "los", "y"]);
  return value
    .toLocaleLowerCase("es-ES")
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && lowercaseWords.has(word)
        ? word
        : `${word.charAt(0).toLocaleUpperCase("es-ES")}${word.slice(1)}`,
    )
    .join(" ");
}

function renderLines(items) {
  const lines = [];
  let currentLine = null;

  for (const item of items) {
    const text = normalizeUnicode(item.str);
    if (!text) continue;

    const transform = item.transform || [];
    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);
    const width = Number(item.width || 0);
    const startsEarlier = currentLine
      ? x < currentLine.lastX - LINE_X_RESET_TOLERANCE
      : false;
    const startsNewLine =
      !currentLine || Math.abs(y - currentLine.y) > LINE_Y_TOLERANCE || startsEarlier;

    if (startsNewLine) {
      if (currentLine) lines.push(currentLine.text);
      currentLine = { text: "", y, lastX: x + width };
    }

    currentLine.text += text;
    currentLine.lastX = Math.max(currentLine.lastX, x + width);
  }

  if (currentLine) lines.push(currentLine.text);

  return lines.join("\n");
}

function cleanPageText(rawText) {
  let text = normalizeUnicode(rawText)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/([\p{L}])- *\n *([\p{Ll}])/gu, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");

  for (const pattern of boilerplatePatterns()) {
    text = text.replace(pattern, "\n");
  }

  const lines = text
    .split("\n")
    .map(cleanLine)
    .filter((line) => line.length > 0)
    .filter((line) => !isRepeatedManualFurniture(line));

  return lines.join("\n").trim();
}

function boilerplatePatterns() {
  return [
    /Este\s+documento\s+es\s+un\s+fragmento\s+del\s+original\.?\s+Acudir\s+al\s+documento\s+completo\s+para\s+consultar\s+[ií]ndice,\s+bibliograf[ií]a,\s+propiedad\s+de\s+las\s+im[aá]genes\s+y\s+dem[aá]s\.?/giu,
    /Documento\s+bajo\s+licencia\s+Creative\s+Commons\s+CC\s+BY-NC-SA\s+4\.0\s+elaborado\s+por\s+Grupo\s+Tragsa\s+y\s+CEIS\s+Guadalajara\.?\s+No\s+se\s+permite\s+un\s+uso\s+comercial\s+de\s+la\s+obra\s+original\s+ni\s+de\s+las\s+posibles\s+obras\s+derivadas,\s+la\s+distribuci[oó]n\s+de\s+las\s+cuales\s+se\s+debe\s+hacer\s+con\s+una\s+licencia\s+igual\s+a\s+la\s+que\s+regula\s+la\s+obra\s+original\.?\s+Asimismo,\s+no\s+se\s+podr[aá]n\s+distribuir\s+o\s+modificar\s+las\s+im[aá]genes\s+contenidas\s+en\s+este\s+manual\s+sin\s+la\s+autorizaci[oó]n\s+previa\s+de\s+los\s+autores\s+o\s+propietarios\s+originales\s+aqu[ií]\s+indicados\.?/giu,
  ];
}

function cleanLine(line) {
  return normalizeSmallCapsArtifacts(line)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?%])/g, "$1")
    .replace(/([¿¡(])\s+/g, "$1")
    .trim();
}

function normalizeSmallCapsArtifacts(text) {
  return text.replace(/\p{L}{3,}/gu, (word) => {
    const letters = [...word];
    const upperCount = letters.filter((char) => /\p{Lu}/u.test(char)).length;
    const hasInnerUppercase = letters
      .slice(1)
      .some((char) => /\p{Lu}/u.test(char));

    if (!hasInnerUppercase || upperCount === letters.length) return word;

    return letters
      .map((char, index) =>
        index === 0 ? char : char.toLocaleLowerCase("es-ES"),
      )
      .join("");
  });
}

function isRepeatedManualFurniture(line) {
  return [
    /^manualesbb@ceisguadalajara\.es$/i,
    /^www\.ceisguadalajara\.es$/i,
    /^Manual de incendios$/i,
    /^Parte \d+\./i,
    /^Edicion r\s*\d+/i,
    /^Coordinadores de la coleccion$/i,
    /^Tratamiento pedagogico, diseno y produccion$/i,
  ].some((pattern) => pattern.test(withoutDiacritics(line)));
}

function splitPageIntoSectionBlocks(text, inheritedSection) {
  const blocks = [];
  let section = inheritedSection;
  let buffer = [];
  const lines = text.split("\n");

  const flush = () => {
    const blockText = buffer.join("\n").trim();
    if (blockText) {
      blocks.push({
        section,
        text: blockText,
      });
    }
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    let detectedSection = detectHeadingLine(line);

    if (
      detectedSection &&
      lines[index + 1] &&
      shouldMergeHeadingContinuation(detectedSection, lines[index + 1])
    ) {
      const combinedSection = detectHeadingLine(`${line} ${lines[index + 1]}`);
      if (combinedSection) {
        detectedSection = combinedSection;
        index += 1;
      }
    }

    if (detectedSection) {
      flush();
      section = detectedSection;
      buffer.push(detectedSection);
      continue;
    }
    buffer.push(line);
  }

  flush();

  return { blocks, section };
}

function detectHeadingLine(line) {
  const normalized = cleanLine(line);
  const normalizedAscii = withoutDiacritics(normalized);

  const chapterMatch = normalizedAscii.match(
    /^(capitulo|tema|apartado|seccion)\s+[0-9ivx]+(?:[.\s:-]+.{3,100})?$/i,
  );
  if (chapterMatch) return normalized;

  const numberedMatch = normalized.match(
    /^(\d+(?:\.\d+)*\.)\s+([^\d\s].{2,110})$/u,
  );
  if (!numberedMatch) return null;

  const title = numberedMatch[2].trim();
  if (/[.!?]$/.test(title) || title.split(/\s+/).length > 14) return null;

  return `${numberedMatch[1]} ${capitalizeFirst(title)}`;
}

function shouldMergeHeadingContinuation(heading, nextLine) {
  const next = cleanLine(nextLine);
  if (!next || next.length > 70 || detectHeadingLine(next)) return false;
  if (/[.!?]$/.test(next)) return false;

  const headingAscii = withoutDiacritics(heading).toLowerCase();
  return /\b(a|al|con|de|del|e|en|la|las|los|o|para|por|sin|u|y|:)$/.test(
    headingAscii,
  );
}

function splitBlockText(text, maxChars, overlap) {
  const chunks = [];
  const lines = text.split("\n").filter(Boolean);
  let current = "";

  for (const line of lines) {
    if (!current) {
      current = line;
      continue;
    }

    if (current.length + line.length + 1 <= maxChars) {
      current = `${current}\n${line}`;
      continue;
    }

    chunks.push(current.trim());
    current = [getOverlapTail(current, overlap), line]
      .filter(Boolean)
      .join("\n");
  }

  if (current) chunks.push(current.trim());

  return chunks.flatMap((chunk) => splitOversizedChunk(chunk, maxChars, overlap));
}

function splitOversizedChunk(text, maxChars, overlap) {
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function getOverlapTail(text, overlap) {
  if (text.length <= overlap) return text;

  const preferredStart = text.lastIndexOf("\n", text.length - overlap);
  const start = preferredStart > 0 ? preferredStart + 1 : text.length - overlap;

  return text.slice(start).trim();
}

function isUsefulChunk(text) {
  if (text.length < MIN_CHUNK_CHARS) return false;

  const wordCount = (text.match(/\p{L}{2,}/gu) || []).length;
  return wordCount >= MIN_CHUNK_WORDS;
}

function capitalizeFirst(text) {
  return text.replace(/^(\p{Ll})/u, (char) => char.toLocaleUpperCase("es-ES"));
}

function withoutDiacritics(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}
