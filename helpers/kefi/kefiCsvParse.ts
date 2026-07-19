/**
 * A strict RFC-4180 CSV reader used ONLY by the Kefi attendee-export spec.
 *
 * Why not split on commas: the whole point of the export spec is to prove the
 * server escapes correctly. A naive `line.split(',')` would pass on a BROKEN
 * export (it would simply produce the wrong number of fields and the spec would
 * assert against its own bug) and would mis-handle the free-text `note` column,
 * which routinely carries commas, quotes and newlines. An independent parser is
 * the only assertion that actually tests the writer.
 *
 * Deliberately independent of the writer's implementation — this is a reader
 * written from the RFC, not a mirror of `AttendeeLedgerCsvWriter`.
 */

/** The parsed export: a header row plus the data rows, each as raw field values. */
export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

const QUOTE = '"';
const COMMA = ',';
const CR = '\r';
const LF = '\n';

/**
 * Parse an RFC-4180 document into records. Handles quoted fields containing
 * commas, doubled quotes (`""` → `"`) and embedded CRLF/LF line breaks.
 * Accepts both CRLF and bare LF terminators so the parser itself is not the
 * thing under test.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let index = 0;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < text.length) {
    const char = text[index];

    if (inQuotes) {
      if (char === QUOTE) {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[index + 1] === QUOTE) {
          field += QUOTE;
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === QUOTE) {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === COMMA) {
      endField();
      index += 1;
      continue;
    }
    if (char === CR || char === LF) {
      endRecord();
      // Consume a CRLF pair as ONE terminator.
      index += char === CR && text[index + 1] === LF ? 2 : 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A document not ending in a newline still has a final record to flush.
  if (field.length > 0 || record.length > 0) endRecord();

  const header = records.shift() ?? [];
  return { header, rows: records };
}

/**
 * Read one field of a parsed row by header name. Returns `null` when the column
 * is absent, so a spec assertion names the missing column rather than throwing
 * an index error.
 */
export function fieldByName(
  parsed: ParsedCsv,
  row: string[],
  column: string,
): string | null {
  const index = parsed.header.indexOf(column);
  if (index < 0) return null;
  return row[index] ?? null;
}

/** Find the single row whose `column` equals `value`, or null when absent. */
export function findRowByField(
  parsed: ParsedCsv,
  column: string,
  value: string,
): string[] | null {
  const index = parsed.header.indexOf(column);
  if (index < 0) return null;
  return parsed.rows.find((row) => row[index] === value) ?? null;
}
