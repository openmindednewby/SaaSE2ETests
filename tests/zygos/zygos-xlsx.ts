// A dependency-free, minimal `.xlsx` builder for the P-07 import specs (FINREG console E2E).
//
// 🔴 WHY THIS EXISTS RATHER THAN A LIBRARY. `POST /payment-imports` takes a real multipart .xlsx
// upload; the backend reads it with its own `XlsxTextReader` straight off the OpenXML parts (no
// Excel library, by design — see the reader's remarks). E2ETests has no jszip / exceljs / xlsx on
// disk, and pulling one in for two fixtures would be the wrong trade. An .xlsx is just a ZIP of
// XML parts, so this file writes exactly the parts the reader reads, in a STORE-method zip it can
// open — mirroring the backend's own `XlsxTestWorkbook` / `PaymentImportTests.Workbook` all-text
// layout so the bytes the reader sees here are the bytes it is tested against there.
//
// ALL cells are shared strings (text). That is deliberate and sufficient: every column the import
// cares about (name, iban, amount, currency) is legitimately text, and the amount is parsed from
// its text form. Numeric-cell corruption is the backend unit tests' concern, not this suite's.

/** The four OpenXML parts the backend's `XlsxTextReader` actually reads, plus the container files. */
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** `A`, `B`, … `Z` — enough columns for any import fixture (the schema has six headers). */
function columnLetter(zeroBased: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + zeroBased);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the four spreadsheet XML parts from a header row + data rows, deduping shared strings. */
function buildParts(headers: readonly string[], rows: readonly (readonly string[])[]): Map<string, string> {
  const strings: string[] = [];
  const indexByString = new Map<string, number>();

  const intern = (value: string): number => {
    const existing = indexByString.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    indexByString.set(value, index);
    return index;
  };

  const allRows: readonly (readonly string[])[] = [headers, ...rows];
  const rowXml = allRows
    .map((cells, rowIdx) => {
      const rowNumber = rowIdx + 1;
      const cellXml = cells
        .map((value, colIdx) => {
          const ref = `${columnLetter(colIdx)}${String(rowNumber)}`;
          return `<c r="${ref}" t="s"><v>${String(intern(value))}</v></c>`;
        })
        .join('');
      return `<row r="${String(rowNumber)}">${cellXml}</row>`;
    })
    .join('');

  const sst = strings.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('');

  const parts = new Map<string, string>();
  parts.set(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="${CT_NS}">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `</Types>`,
  );
  parts.set(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  parts.set(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
      `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
  );
  parts.set(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="${PKG_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
      `</Relationships>`,
  );
  parts.set(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="${MAIN_NS}"><sheetData>${rowXml}</sheetData></worksheet>`,
  );
  parts.set(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="${MAIN_NS}" count="${String(strings.length)}" uniqueCount="${String(strings.length)}">${sst}</sst>`,
  );
  return parts;
}

// ---- a minimal STORE-method ZIP writer (no compression), enough for ZipArchive to read ----

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  const polynomial = 0xedb88320;
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? polynomial ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly crc: number;
  readonly offset: number;
}

function localHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // method = store
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0x21, 12); // mod date (arbitrary, valid)
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.data.length, 18); // compressed size
  header.writeUInt32LE(entry.data.length, 22); // uncompressed size
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([header, name]);
}

function centralHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf-8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // central directory signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(0, 10); // method = store
  header.writeUInt16LE(0, 12); // mod time
  header.writeUInt16LE(0x21, 14); // mod date
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal attrs
  header.writeUInt32LE(0, 38); // external attrs
  header.writeUInt32LE(entry.offset, 42); // local header offset
  return Buffer.concat([header, name]);
}

function zip(parts: Map<string, string>): Buffer {
  const entries: ZipEntry[] = [];
  const localChunks: Buffer[] = [];
  let offset = 0;

  for (const [name, xml] of parts) {
    const data = Buffer.from(xml, 'utf-8');
    const entry: ZipEntry = { name, data, crc: crc32(data), offset };
    const local = Buffer.concat([localHeader(entry), data]);
    localChunks.push(local);
    entries.push(entry);
    offset += local.length;
  }

  const centralChunks = entries.map(centralHeader);
  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0);
  const centralOffset = offset;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

/**
 * A real `.xlsx` byte payload whose first row is `headers` and whose remaining rows are `rows`,
 * every cell stored as text — exactly what the backend's all-text `XlsxTestWorkbook` produces.
 */
export function buildXlsx(headers: readonly string[], rows: readonly (readonly string[])[]): Buffer {
  return zip(buildParts(headers, rows));
}

/** The importer's canonical header row (`ImportColumns`): name, iban, amount, currency. */
export const IMPORT_HEADERS: readonly string[] = ['name', 'iban', 'amount', 'currency'];
