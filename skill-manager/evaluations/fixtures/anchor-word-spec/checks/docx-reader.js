// Reads a .docx without a library: a .docx is a zip whose word/document.xml
// holds the text. Only the parts the checks need are parsed.
const fs = require("fs");
const zlib = require("zlib");

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

function centralDirectory(buffer) {
  const lowest = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      return { count: buffer.readUInt16LE(offset + 10), offset: buffer.readUInt32LE(offset + 16) };
    }
  }
  throw new Error("not a zip archive: no end-of-central-directory record");
}

function zipEntries(buffer) {
  const directory = centralDirectory(buffer);
  const entries = new Map();
  let position = directory.offset;
  for (let index = 0; index < directory.count; index += 1) {
    if (buffer.readUInt32LE(position) !== CENTRAL_FILE_HEADER) {
      throw new Error("corrupt zip archive: bad central directory entry");
    }
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const name = buffer.toString("utf8", position + 46, position + 46 + nameLength);
    entries.set(name, {
      method: buffer.readUInt16LE(position + 10),
      compressedSize: buffer.readUInt32LE(position + 20),
      localOffset: buffer.readUInt32LE(position + 42),
    });
    position += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function entryBytes(buffer, entry) {
  const position = entry.localOffset;
  if (buffer.readUInt32LE(position) !== LOCAL_FILE_HEADER) {
    throw new Error("corrupt zip archive: bad local file header");
  }
  const nameLength = buffer.readUInt16LE(position + 26);
  const extraLength = buffer.readUInt16LE(position + 28);
  const start = position + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    return data;
  }
  if (entry.method === 8) {
    return zlib.inflateRawSync(data);
  }
  throw new Error(`unsupported zip compression method ${entry.method}`);
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

// String.raw keeps the regex escapes readable: a plain template literal would
// need every backslash doubled.
function attribute(tag, name) {
  const match = new RegExp(String.raw`\s${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

function allTags(xml, localName) {
  return xml.match(new RegExp(String.raw`<w:${localName}(?:\s[^>]*)?/?>`, "g")) || [];
}

// Paragraph text is the concatenation of its <w:t> runs; tabs and breaks
// count as whitespace so word splitting treats them as separators.
function paragraphText(paragraphXml) {
  const pieces = [];
  const tokenPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)(?:\s[^>]*)?\/>/g;
  let match = tokenPattern.exec(paragraphXml);
  while (match) {
    pieces.push(match[1] === undefined ? " " : decodeEntities(match[1]));
    match = tokenPattern.exec(paragraphXml);
  }
  return pieces.join("");
}

function paragraphs(documentXml) {
  const found = [];
  const pattern = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  let match = pattern.exec(documentXml);
  while (match) {
    found.push(match[0]);
    match = pattern.exec(documentXml);
  }
  return found;
}

function words(text) {
  return text.split(/[\s​]+/).filter((word) => word !== "");
}

class DocxDocument {
  constructor(filePath) {
    const buffer = fs.readFileSync(filePath);
    const entries = zipEntries(buffer);
    const documentEntry = entries.get("word/document.xml");
    if (!documentEntry) {
      throw new Error("zip archive has no word/document.xml, so it is not a Word document");
    }
    this.documentXml = entryBytes(buffer, documentEntry).toString("utf8");
    const stylesEntry = entries.get("word/styles.xml");
    this.stylesXml = stylesEntry ? entryBytes(buffer, stylesEntry).toString("utf8") : "";
  }

  paragraphTexts() {
    return paragraphs(this.documentXml).map(paragraphText);
  }

  textParagraphs() {
    return this.paragraphTexts().filter((text) => words(text).length > 0);
  }

  allWords() {
    return this.paragraphTexts().flatMap(words);
  }

  pageSize() {
    const tag = allTags(this.documentXml, "pgSz")[0];
    return tag ? { width: Number(attribute(tag, "w:w")), height: Number(attribute(tag, "w:h")) } : null;
  }

  pageMargins() {
    const tag = allTags(this.documentXml, "pgMar")[0];
    if (!tag) {
      return null;
    }
    return {
      top: Number(attribute(tag, "w:top")),
      right: Number(attribute(tag, "w:right")),
      bottom: Number(attribute(tag, "w:bottom")),
      left: Number(attribute(tag, "w:left")),
    };
  }

  // Font families named anywhere a run could get one: explicit run properties
  // in the document, or the document defaults in styles.xml when the document
  // names none itself.
  fontFamilies() {
    const inDocument = allTags(this.documentXml, "rFonts").map((tag) => attribute(tag, "w:ascii")).filter(Boolean);
    if (inDocument.length > 0) {
      return [...new Set(inDocument)];
    }
    return [...new Set(allTags(this.stylesXml, "rFonts").map((tag) => attribute(tag, "w:ascii")).filter(Boolean))];
  }

  // Sizes in half-points, as the format stores them.
  fontSizes() {
    const inDocument = allTags(this.documentXml, "sz").map((tag) => Number(attribute(tag, "w:val"))).filter(Number.isFinite);
    if (inDocument.length > 0) {
      return [...new Set(inDocument)];
    }
    return [...new Set(allTags(this.stylesXml, "sz").map((tag) => Number(attribute(tag, "w:val"))).filter(Number.isFinite))];
  }
}

module.exports = { DocxDocument, words };
