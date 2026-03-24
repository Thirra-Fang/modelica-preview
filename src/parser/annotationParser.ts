/**
 * Recursive descent parser for Modelica annotation expression content.
 * Handles the subset of Modelica expressions used in annotation blocks:
 *   - Record constructor calls:  Name(arg1=val1, arg2=val2)
 *   - Array literals:            {val1, val2, val3}
 *   - Number literals:           -100, 3.14, 1e-3
 *   - String literals:           "text with \"escapes\""
 *   - Identifier paths:          LinePattern.Solid
 */

export type AnnotationValue =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ident'; value: string }
  | { kind: 'array'; items: AnnotationValue[] }
  | { kind: 'record'; name: string; args: Record<string, AnnotationValue> };

interface Cursor {
  src: string;
  pos: number;
}

// ── Lexer helpers ──────────────────────────────────────────────────────────

function skip(c: Cursor): void {
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      c.pos++;
    } else if (c.src[c.pos] === '/' && c.src[c.pos + 1] === '/') {
      while (c.pos < c.src.length && c.src[c.pos] !== '\n') c.pos++;
    } else if (c.src[c.pos] === '/' && c.src[c.pos + 1] === '*') {
      c.pos += 2;
      const end = c.src.indexOf('*/', c.pos);
      c.pos = end === -1 ? c.src.length : end + 2;
    } else {
      break;
    }
  }
}

function isAlpha(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}
function isAlphaNum(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch);
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function readIdent(c: Cursor): string {
  let s = '';
  while (c.pos < c.src.length && isAlphaNum(c.src[c.pos])) {
    s += c.src[c.pos++];
  }
  return s;
}

function readIdentPath(c: Cursor): string {
  let path = readIdent(c);
  while (c.pos < c.src.length && c.src[c.pos] === '.' && c.pos + 1 < c.src.length && isAlpha(c.src[c.pos + 1])) {
    c.pos++; // consume '.'
    path += '.' + readIdent(c);
  }
  return path;
}

function readNumber(c: Cursor): number {
  let s = '';
  while (c.pos < c.src.length && isDigit(c.src[c.pos])) s += c.src[c.pos++];
  if (c.pos < c.src.length && c.src[c.pos] === '.') {
    s += c.src[c.pos++];
    while (c.pos < c.src.length && isDigit(c.src[c.pos])) s += c.src[c.pos++];
  }
  if (c.pos < c.src.length && (c.src[c.pos] === 'e' || c.src[c.pos] === 'E')) {
    s += c.src[c.pos++];
    if (c.pos < c.src.length && (c.src[c.pos] === '+' || c.src[c.pos] === '-')) {
      s += c.src[c.pos++];
    }
    while (c.pos < c.src.length && isDigit(c.src[c.pos])) s += c.src[c.pos++];
  }
  return parseFloat(s);
}

function readString(c: Cursor): string {
  c.pos++; // skip opening "
  let s = '';
  while (c.pos < c.src.length && c.src[c.pos] !== '"') {
    if (c.src[c.pos] === '\\' && c.pos + 1 < c.src.length) {
      c.pos++;
      const esc = c.src[c.pos++];
      switch (esc) {
        case 'n': s += '\n'; break;
        case 't': s += '\t'; break;
        case '"': s += '"'; break;
        case '\\': s += '\\'; break;
        default: s += esc;
      }
    } else {
      s += c.src[c.pos++];
    }
  }
  if (c.pos < c.src.length) c.pos++; // skip closing "
  return s;
}

// ── Parser ─────────────────────────────────────────────────────────────────

function parseExpr(c: Cursor): AnnotationValue {
  skip(c);
  if (c.pos >= c.src.length) return { kind: 'ident', value: '' };

  const ch = c.src[c.pos];

  // Unary minus: - expr
  if (ch === '-') {
    c.pos++;
    const inner = parseExpr(c);
    if (inner.kind === 'number') return { kind: 'number', value: -inner.value };
    return { kind: 'number', value: 0 };
  }

  // Array: { items... }
  if (ch === '{') {
    c.pos++;
    const items: AnnotationValue[] = [];
    skip(c);
    while (c.pos < c.src.length && c.src[c.pos] !== '}') {
      items.push(parseExpr(c));
      skip(c);
      if (c.pos < c.src.length && c.src[c.pos] === ',') c.pos++;
      skip(c);
    }
    if (c.pos < c.src.length) c.pos++; // consume '}'
    return { kind: 'array', items };
  }

  // String: "..."
  if (ch === '"') return { kind: 'string', value: readString(c) };

  // Number: digits
  if (isDigit(ch)) return { kind: 'number', value: readNumber(c) };

  // Identifier or record call
  if (isAlpha(ch)) {
    const name = readIdentPath(c);
    skip(c);
    if (c.pos < c.src.length && c.src[c.pos] === '(') {
      c.pos++; // consume '('
      const args = parseArgList(c, ')');
      if (c.pos < c.src.length && c.src[c.pos] === ')') c.pos++;
      return { kind: 'record', name, args };
    }
    return { kind: 'ident', value: name };
  }

  // Skip unrecognised character
  c.pos++;
  return { kind: 'ident', value: '' };
}

/**
 * Parse a comma-separated list of arguments until `terminator` char.
 * Named args:     IDENT '=' expr   → stored by name
 * Record args:    IDENT '(' ...    → stored by record name (Modelica modification style)
 * Other positional args            → stored by numeric string index
 */
function parseArgList(c: Cursor, terminator: string): Record<string, AnnotationValue> {
  const args: Record<string, AnnotationValue> = {};
  let idx = 0;

  skip(c);
  while (c.pos < c.src.length && c.src[c.pos] !== terminator) {
    skip(c);
    if (c.pos >= c.src.length || c.src[c.pos] === terminator) break;

    const savedPos = c.pos;

    if (isAlpha(c.src[c.pos])) {
      const name = readIdent(c);
      skip(c);

      if (c.pos < c.src.length && c.src[c.pos] === '=') {
        // Named argument: name = expr
        c.pos++; // consume '='
        skip(c);
        args[name] = parseExpr(c);
      } else if (c.pos < c.src.length && c.src[c.pos] === '(') {
        // Record call without leading '=': e.g. coordinateSystem(...)
        // Backtrack so parseExpr sees the full name
        c.pos = savedPos;
        const val = parseExpr(c);
        if (val.kind === 'record') {
          // Use record name (last segment) as key
          const key = val.name.includes('.') ? val.name.split('.').pop()! : val.name;
          args[key] = val;
        } else {
          args[String(idx++)] = val;
        }
      } else {
        // Plain identifier value (enum, etc.)
        // Re-use the already-read name; check for dotted path
        c.pos = savedPos;
        const val = parseExpr(c);
        args[String(idx++)] = val;
      }
    } else {
      const val = parseExpr(c);
      if (val.kind === 'record') {
        const key = val.name.includes('.') ? val.name.split('.').pop()! : val.name;
        args[key] = val;
      } else {
        args[String(idx++)] = val;
      }
    }

    skip(c);
    if (c.pos < c.src.length && c.src[c.pos] === ',') c.pos++;
    skip(c);
  }

  return args;
}

/**
 * Parse the text content inside `annotation(...)` — the outer parens must
 * already be stripped. Returns a map from top-level annotation names to values.
 *
 * Example input:  `Diagram(...), Icon(...)`
 * Example input:  `Placement(transformation(...))`
 * Example input:  `Line(points={{...}}, color={0,0,0})`
 */
export function parseAnnotationContent(src: string): Record<string, AnnotationValue> {
  const c: Cursor = { src, pos: 0 };
  return parseArgList(c, '\0'); // '\0' won't appear → parse until EOF
}

// ── Value extraction helpers ───────────────────────────────────────────────

export function getNum(v: AnnotationValue | undefined, def = 0): number {
  if (!v) return def;
  if (v.kind === 'number') return v.value;
  return def;
}

export function getStr(v: AnnotationValue | undefined, def = ''): string {
  if (!v) return def;
  if (v.kind === 'string') return v.value;
  if (v.kind === 'ident') return v.value;
  return def;
}

export function getBool(v: AnnotationValue | undefined, def = true): boolean {
  if (!v) return def;
  if (v.kind === 'ident') return v.value !== 'false';
  return def;
}

/** Returns the last segment of a dotted enum value, e.g. "FillPattern.Solid" → "Solid" */
export function getEnumSuffix(v: AnnotationValue | undefined, def = ''): string {
  const s = getStr(v, def);
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1) : s || def;
}

export function getPoint(v: AnnotationValue | undefined): [number, number] {
  if (!v) return [0, 0];
  if (v.kind === 'array' && v.items.length >= 2) {
    return [getNum(v.items[0]), getNum(v.items[1])];
  }
  return [0, 0];
}

export function getExtent(v: AnnotationValue | undefined): [[number, number], [number, number]] {
  if (!v) return [[-100, -100], [100, 100]];
  if (v.kind === 'array' && v.items.length >= 2) {
    return [getPoint(v.items[0]), getPoint(v.items[1])];
  }
  return [[-100, -100], [100, 100]];
}

export function getColor(v: AnnotationValue | undefined): [number, number, number] {
  if (!v) return [0, 0, 0];
  if (v.kind === 'array' && v.items.length >= 3) {
    return [getNum(v.items[0]), getNum(v.items[1]), getNum(v.items[2])];
  }
  return [0, 0, 0];
}

export function getArrow(v: AnnotationValue | undefined): [string, string] {
  if (!v) return ['None', 'None'];
  if (v.kind === 'array' && v.items.length >= 2) {
    return [getEnumSuffix(v.items[0], 'None'), getEnumSuffix(v.items[1], 'None')];
  }
  return ['None', 'None'];
}

export function getRecordArgs(v: AnnotationValue | undefined): Record<string, AnnotationValue> {
  if (!v || v.kind !== 'record') return {};
  return v.args;
}
