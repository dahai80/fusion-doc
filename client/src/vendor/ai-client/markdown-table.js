// Parser for markdown tables in model replies. A small model often answers
// "make me a table of X" in prose with a markdown table instead of calling
// the insert tool; the apps offer an "insert" button built from these rows.
// Ported from the documents assistant's legacy table reader so every app
// agrees on what counts as a table.

const MAX_ROWS = 500;
const MAX_COLS = 32;

const SEPARATOR_CELL = /^:?-+:?$/;

function cleanText(text) {
    let lines = String(text ?? '').split(/\r?\n/);
    // Replies are often wrapped in a code fence; a fence is not table data.
    while (lines.length && /^\s*```/.test(lines[0])) lines = lines.slice(1);
    while (lines.length && /^\s*```/.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
    return lines;
}

function stripCellMarks(cell) {
    return String(cell).replace(/^\s*\*\*([^*]+)\*\*\s*$/, '$1').replace(/^\s*\*([^*]+)\*\s*$/, '$1').replace(/^\s*`([^`]*)`\s*$/, '$1').trim();
}

function splitRow(line) {
    const cells = line.includes('|') || line.includes('\t')
        ? line.split(line.includes('\t') && !line.includes('|') ? '\t' : '|')
        : [];
    // Drop the empty cell each edge pipe produces, not empty cells the writer meant.
    if (cells.length && !String(cells[0]).trim()) cells.shift();
    if (cells.length && !String(cells[cells.length - 1]).trim()) cells.pop();
    return cells.map(stripCellMarks);
}

function isSeparatorRow(cells) {
    return cells.length > 0 && cells.every(cell => SEPARATOR_CELL.test(cell));
}

/**
 * Reads the first markdown table in `text`. Returns `{ rows, hasHeader }` —
 * rows of cell strings (no separator row, no edge pipes, no bold or code
 * marks; the header row, when the reply drew one, is rows[0]), or null when
 * the text holds no table with at least two rows of two columns.
 */
export function parseMarkdownTableParts(text) {
    const lines = cleanText(text);
    for (let start = 0; start < lines.length; start += 1) {
        if (!/^(?:.*\||.*\t)/.test(lines[start])) continue;
        const block = [];
        let hasHeader = false;
        let i = start;
        for (; i < lines.length; i += 1) {
            if (!/^(?:.*\||.*\t)/.test(lines[i])) break;
            const cells = splitRow(lines[i]);
            if (isSeparatorRow(cells)) { hasHeader = block.length === 1; continue; }
            block.push(cells);
        }
        if (block.length >= 2 && block.every(cells => cells.length >= 2)) {
            if (block.length > MAX_ROWS) throw new Error(`The table has more than ${MAX_ROWS} rows. Ask for less at a time.`);
            if (block.some(cells => cells.length > MAX_COLS)) throw new Error(`The table has more than ${MAX_COLS} columns.`);
            return { rows: block, hasHeader };
        }
        start = i - 1;
    }
    return null;
}

/** The rows only, header included; null when there is no table. */
export function parseMarkdownTable(text) {
    const parts = parseMarkdownTableParts(text);
    return parts ? parts.rows : null;
}
