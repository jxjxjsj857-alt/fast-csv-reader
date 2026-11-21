// A faster drop-in for make.fun's csv-reader 1.0.0: returns exactly csv-reader's
// {columns, rows, errors} for every {text, header}, but reads with native scans
// (indexOf / slice / split) instead of one character at a time.
//
// Same reading policy as csv-reader 1.0.0 (see the kit's RULES.txt):
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote and each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it, each padded with "" (short_row, with fields: its count)
//     or cut (long_row, with extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, line the 1-based line
//     its record starts on, row its record's index in rows, null for the header.
//
// Speed comes from two paths. Most records hold no quote and no stray CR, so
// they are split with one native split(',') on the slice up to the next LF
// (a trailing CR of a CRLF ending is stripped first). Any record that holds a
// quote or a stray CR falls back to the chunk parser below, which finds each
// field's end with one native regex scan and slices whole fields at once, and
// finds each quoted field's closing quote with indexOf, slicing whole chunks
// (normalising CR/LF inside a chunk only when the chunk holds one).
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next. Dependency-free ES module.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  // The next character to read; a U+FEFF at the very start is dropped.
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // The line that character is on.
  let line = 1;
  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The next comma, CR or LF at or after lastIndex, native-scanned.
  const DELIM = /[,\r\n]/g;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        if (pos < n) {
          value += text.slice(pos);
          added += n - pos;
          pos = n;
        }
        return { value, ended: END, added };
      }
      const i = m.index;
      const c = m[0];
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
      }
      if (c === ',') {
        pos = i + 1;
        return { value, ended: COMMA, added };
      }
      if (c === '\n') {
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      // A CR: CRLF ends the line, a lone CR is dropped (stray_cr).
      if (text.charCodeAt(i + 1) === 10) {
        pos = i + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      error('stray_cr');
      pos = i + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (q > pos) {
        const chunk = text.slice(pos, q);
        if (chunk.indexOf('\r') === -1 && chunk.indexOf('\n') === -1) {
          value += chunk;
        } else {
          // CRLF and a lone CR inside quotes are each one LF; count the
          // line breaks the chunk holds (a CRLF counts once).
          let breaks = 0;
          for (let j = 0; j < chunk.length; j++) {
            const ch = chunk.charCodeAt(j);
            if (ch === 10) breaks += 1;
            else if (ch === 13) {
              breaks += 1;
              if (chunk.charCodeAt(j + 1) === 10) j += 1;
            }
          }
          line += breaks;
          value += chunk.replace(/\r\n?/g, '\n');
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one literal quote.
        value += '"';
        pos = q + 2;
        continue;
      }
      pos = q + 1;
      break;
    }
    if (pos >= n) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  // Takes a record's fields: drops it when it held only stray CRs, else the
  // header, or a row padded or cut to the first record's width.
  function finishRecord(fields, quoted) {
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < n) {
    // The record's first line ends at the next LF (or the end of the text).
    // Any quoted field of the record opens on this line: an unquoted field
    // cannot span lines, so a record holding a quote shows one here.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? n : nl;
    // A line left with no characters is no record.
    if (segEnd === pos) {
      if (nl === -1) break;
      pos = nl + 1;
      line += 1;
      continue;
    }
    const qi = text.indexOf('"', pos);
    const ri = text.indexOf('\r', pos);
    const hasQuote = qi !== -1 && qi < segEnd;
    // A CR is harmless here only as the last character of a CRLF ending.
    const crlf = ri !== -1 && ri < segEnd && ri === segEnd - 1 && nl !== -1;
    const hasStrayCr = ri !== -1 && ri < segEnd && !crlf;

    if (!hasQuote && !hasStrayCr) {
      // Fast path: no quote, no stray CR. A blank CRLF line is no record.
      if (crlf && segEnd - pos === 1) {
        pos = nl + 1;
        line += 1;
        continue;
      }
      const end = crlf ? segEnd - 1 : segEnd;
      const fields = text.slice(pos, end).split(',');
      recordLine = line;
      recordRow = header && columns === null ? null : rows.length;
      if (nl === -1) pos = n;
      else {
        pos = nl + 1;
        line += 1;
      }
      finishRecord(fields, false);
      continue;
    }

    // Slow path: the record holds a quote or a stray CR; parse it field by
    // field, as csv-reader does.
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    finishRecord(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
