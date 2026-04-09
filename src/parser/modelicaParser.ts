/**
 * Scans a Modelica .mo source file and extracts the diagram model:
 *   - class/model name
 *   - component declarations with Placement annotations
 *   - connect() statements with Line annotations
 *   - class-level Diagram / Icon annotations
 *
 * Uses a custom annotation parser (no WASM/native dependency).
 */

import * as model from '../model/diagramModel';
import {
  parseAnnotationContent,
  AnnotationValue,
  getNum, getStr, getBool, getEnumSuffix,
  getPoint, getExtent, getColor, getArrow, getRecordArgs,
} from './annotationParser';

// ── File-level scanner ─────────────────────────────────────────────────────

interface RawAnnotation {
  /** Content between annotation( and matching ) */
  content: string;
  /** Offset of the opening '(' in the source */
  openParen: number;
  /** Text on the current statement before 'annotation' keyword */
  statementPrefix: string;
  /** Approximate source line number */
  line: number;
}

/** Returns position AFTER the closing ')' of a balanced-paren block starting at `open`. */
function findBalancedClose(src: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++; // closing "
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      const end = src.indexOf('*/', i);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (depth > 0) i++;
    else break;
  }
  return i; // points to closing ')'
}

/** Return the line number (1-based) of a position in src. */
function lineAt(src: string, pos: number): number {
  let n = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') n++;
  }
  return n;
}

/**
 * Find all `annotation(...)` blocks in the file and capture preceding text
 * on the current logical statement (up to the previous ';' or '{' or keyword).
 */
function findAnnotations(src: string): RawAnnotation[] {
  const results: RawAnnotation[] = [];
  const re = /\bannotation\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1; // index of '('
    const closePos = findBalancedClose(src, openParen);
    const content = src.slice(openParen + 1, closePos);

    // Grab preceding text for current statement context: back to last ';'.
    // Do not stop at '{' / '}' because Modelica modification records frequently
    // contain braces (e.g. table={{...}}), which would truncate component prefixes.
    let prefixStart = openParen;
    while (prefixStart > 0 && src[prefixStart - 1] !== ';') {
      prefixStart--;
    }
    const statementPrefix = src.slice(prefixStart, m.index).trim();

    results.push({
      content,
      openParen,
      statementPrefix,
      line: lineAt(src, m.index),
    });

    // Advance past the closing paren to avoid re-matching
    re.lastIndex = closePos + 1;
  }

  return results;
}

/** Find `connect(a, b)` or `connect(a.x, b.y)` calls (with optional annotation). */
interface RawConnect {
  from: string;
  to: string;
  annotationContent?: string;
  line: number;
}

function findConnects(src: string): RawConnect[] {
  const results: RawConnect[] = [];
  const re = /\bconnect\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closePos = findBalancedClose(src, openParen);
    const inner = src.slice(openParen + 1, closePos).trim();

    // Split by first comma at depth 0
    let depth = 0;
    let splitAt = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') depth++;
      else if (inner[i] === ')') depth--;
      else if (inner[i] === ',' && depth === 0) { splitAt = i; break; }
    }

    if (splitAt < 0) { re.lastIndex = closePos + 1; continue; }

    const from = inner.slice(0, splitAt).trim();
    const to = inner.slice(splitAt + 1).trim();

    // Look for annotation after the connect statement (before ';')
    let annotContent: string | undefined;
    const after = src.slice(closePos + 1, src.indexOf(';', closePos + 1));
    const annMatch = /\bannotation\s*\(/.exec(after);
    if (annMatch) {
      const annOpen = closePos + 1 + annMatch.index + annMatch[0].length - 1;
      const annClose = findBalancedClose(src, annOpen);
      annotContent = src.slice(annOpen + 1, annClose);
    }

    results.push({ from, to, annotationContent: annotContent, line: lineAt(src, m.index) });
    re.lastIndex = closePos + 1;
  }

  return results;
}

/** Extract the primary class/model name from the file. */
function findClassName(src: string): string {
  const re = /\b(model|class|block|connector|record|package)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const m = re.exec(src);
  return m ? m[2] : 'Unknown';
}

// ── Annotation → DiagramModel conversion ──────────────────────────────────

function makeDefaultGraphicBase(): { visible: boolean; origin: model.Point; rotation: number } {
  return { visible: true, origin: [0, 0], rotation: 0 };
}

function makeFilledShapeBase(): {
  visible: boolean; origin: model.Point; rotation: number;
  lineColor: model.Color; fillColor: model.Color;
  pattern: model.LinePattern; fillPattern: model.FillPattern; lineThickness: number;
} {
  return {
    ...makeDefaultGraphicBase(),
    lineColor: [0, 0, 0],
    fillColor: [0, 0, 0],
    pattern: 'Solid',
    fillPattern: 'None',
    lineThickness: 0.25,
  };
}

function extractGraphicBase(args: Record<string, AnnotationValue>): { visible: boolean; origin: model.Point; rotation: number } {
  return {
    visible: getBool(args['visible'], true),
    origin: getPoint(args['origin']),
    rotation: getNum(args['rotation'], 0),
  };
}

function extractFilledShape(args: Record<string, AnnotationValue>) {
  return {
    ...extractGraphicBase(args),
    lineColor: getColor(args['lineColor']),
    fillColor: getColor(args['fillColor']),
    pattern: (getEnumSuffix(args['pattern'], 'Solid') || 'Solid') as model.LinePattern,
    fillPattern: (getEnumSuffix(args['fillPattern'], 'None') || 'None') as model.FillPattern,
    lineThickness: getNum(args['lineThickness'], 0.25),
  };
}

function extractLineGraphic(args: Record<string, AnnotationValue>): model.LineGraphic {
  const pointsVal = args['points'];
  const points: model.Point[] = [];
  if (pointsVal?.kind === 'array') {
    for (const item of pointsVal.items) {
      points.push(getPoint(item));
    }
  }
  const arrowVal = getArrow(args['arrow']);
  return {
    ...extractGraphicBase(args),
    type: 'Line',
    points,
    color: getColor(args['color']),
    pattern: (getEnumSuffix(args['pattern'], 'Solid') || 'Solid') as model.LinePattern,
    thickness: getNum(args['thickness'], 0.25),
    arrow: [arrowVal[0] as model.ArrowType, arrowVal[1] as model.ArrowType],
    arrowSize: getNum(args['arrowSize'], 3),
    smooth: (getEnumSuffix(args['smooth'], 'None') || 'None') as model.Smooth,
  };
}

function extractRectangleGraphic(args: Record<string, AnnotationValue>): model.RectangleGraphic {
  return {
    ...extractFilledShape(args),
    type: 'Rectangle',
    extent: getExtent(args['extent']),
    radius: getNum(args['radius'], 0),
  };
}

function extractEllipseGraphic(args: Record<string, AnnotationValue>): model.EllipseGraphic {
  return {
    ...extractFilledShape(args),
    type: 'Ellipse',
    extent: getExtent(args['extent']),
    startAngle: getNum(args['startAngle'], 0),
    endAngle: getNum(args['endAngle'], 360),
  };
}

function extractPolygonGraphic(args: Record<string, AnnotationValue>): model.PolygonGraphic {
  const pointsVal = args['points'];
  const points: model.Point[] = [];
  if (pointsVal?.kind === 'array') {
    for (const item of pointsVal.items) points.push(getPoint(item));
  }
  return {
    ...extractFilledShape(args),
    type: 'Polygon',
    points,
    smooth: (getEnumSuffix(args['smooth'], 'None') || 'None') as model.Smooth,
  };
}

function extractTextGraphic(args: Record<string, AnnotationValue>): model.TextGraphic {
  const stylesVal = args['textStyle'];
  const textStyle: model.TextStyle[] = [];
  if (stylesVal?.kind === 'array') {
    for (const item of stylesVal.items) {
      const s = getEnumSuffix(item, '');
      if (s === 'Bold' || s === 'Italic' || s === 'UnderLine') textStyle.push(s);
    }
  }
  return {
    ...extractGraphicBase(args),
    type: 'Text',
    extent: getExtent(args['extent']),
    textString: getStr(args['textString'], ''),
    fontSize: getNum(args['fontSize'], 0),
    textColor: getColor(args['textColor']),
    horizontalAlignment: (getEnumSuffix(args['horizontalAlignment'], 'Center') || 'Center') as model.TextAlignment,
    textStyle,
  };
}

function extractBitmapGraphic(args: Record<string, AnnotationValue>): model.BitmapGraphic {
  return {
    ...extractGraphicBase(args),
    type: 'Bitmap',
    extent: getExtent(args['extent']),
    fileName: getStr(args['fileName'], ''),
    imageSource: getStr(args['imageSource'], ''),
  };
}

function extractGraphic(name: string, args: Record<string, AnnotationValue>): model.Graphic | null {
  switch (name) {
    case 'Line': return extractLineGraphic(args);
    case 'Rectangle': return extractRectangleGraphic(args);
    case 'Ellipse': return extractEllipseGraphic(args);
    case 'Polygon': return extractPolygonGraphic(args);
    case 'Text': return extractTextGraphic(args);
    case 'Bitmap': return extractBitmapGraphic(args);
    default: return null;
  }
}

function extractGraphicsList(v: AnnotationValue | undefined): model.Graphic[] {
  if (!v || v.kind !== 'array') return [];
  const graphics: model.Graphic[] = [];
  for (const item of v.items) {
    if (item.kind === 'record') {
      const g = extractGraphic(item.name, item.args);
      if (g) graphics.push(g);
    }
  }
  return graphics;
}

function extractCoordinateSystem(v: AnnotationValue | undefined): model.CoordinateSystem {
  if (!v) return model.DEFAULT_COORDINATE_SYSTEM;
  const args = getRecordArgs(v);
  return {
    extent: getExtent(args['extent']),
    preserveAspectRatio: getBool(args['preserveAspectRatio'], true),
  };
}

function extractLayerAnnotation(args: Record<string, AnnotationValue>): model.LayerAnnotation {
  return {
    coordinateSystem: extractCoordinateSystem(args['coordinateSystem']),
    graphics: extractGraphicsList(args['graphics']),
  };
}

function extractTransformation(v: AnnotationValue | undefined): model.Transformation {
  if (!v || v.kind !== 'record') {
    return { extent: [[-10, -10], [10, 10]], rotation: 0, origin: [0, 0] };
  }
  const args = v.args;
  return {
    extent: getExtent(args['extent']),
    rotation: getNum(args['rotation'], 0),
    origin: getPoint(args['origin']),
  };
}

/**
 * Attempt to infer the component type and name from the text preceding
 * `annotation(Placement(...)`. Typical form:
 *   `  TypePath instanceName`
 *   `  TypePath instanceName(modifications)`
 */
function inferComponentFromPrefix(prefix: string): { typeName: string; name: string } | null {
  function stripTrailingModificationList(input: string): string {
    const s = input.trim();
    if (!s.endsWith(')')) return s;
    let depth = 0;
    let inString = false;
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (inString) {
        if (ch === '"' && s[i - 1] !== '\\') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === ')') {
        depth++;
        continue;
      }
      if (ch === '(') {
        depth--;
        if (depth === 0) {
          return s.slice(0, i).trim();
        }
      }
    }
    return s;
  }
  function stripTrailingDescriptionString(input: string): string {
    const s = input.trim();
    if (!s.endsWith('"')) return s;
    let i = s.length - 2;
    while (i >= 0) {
      if (s[i] === '"' && s[i - 1] !== '\\') {
        return s.slice(0, i).trim();
      }
      i--;
    }
    return s;
  }

  // Normalise whitespace
  const clean = stripTrailingDescriptionString(prefix.replace(/\s+/g, ' ').trim());
  // Strip trailing modification list, including nested parentheses in modifications.
  const noMod = stripTrailingModificationList(clean);
  // Split by whitespace — last token is the instance name, second-to-last is the type (or dotted type)
  const parts = noMod.split(/\s+/);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  const typeName = parts[parts.length - 2];
  // Sanity check: instance name must be a plain identifier
  const nameOk = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]+\])*$/.test(name);
  if (!nameOk) return null;
  // Type name may start with '.' for absolute Modelica package paths (e.g. .IBT.Foo.Bar)
  const typeOk = /^\.?[A-Za-z_][A-Za-z0-9_.]*$/.test(typeName);
  if (!typeOk) return null;
  return { typeName, name };
}

// ── Main entry point ───────────────────────────────────────────────────────

export function parseModelicaFile(content: string, filePath: string): model.DiagramModel {
  const className = findClassName(content);
  const components: model.DiagramComponent[] = [];
  const connections: model.DiagramConnection[] = [];

  let diagram: model.LayerAnnotation = {
    coordinateSystem: model.DEFAULT_COORDINATE_SYSTEM,
    graphics: [],
  };
  let icon: model.LayerAnnotation | undefined;

  // ── Extract class-level Diagram/Icon annotations ──

  const annotations = findAnnotations(content);
  for (const raw of annotations) {
    const parsed = parseAnnotationContent(raw.content);

    if (parsed['Diagram']) {
      const diagramArgs = getRecordArgs(parsed['Diagram']);
      diagram = extractLayerAnnotation(diagramArgs);
    }
    if (parsed['Icon']) {
      const iconArgs = getRecordArgs(parsed['Icon']);
      icon = extractLayerAnnotation(iconArgs);
    }

    if (parsed['Placement']) {
      const placementArgs = getRecordArgs(parsed['Placement']);
      const transformation = extractTransformation(placementArgs['transformation']);
      const visible = getBool(placementArgs['visible'], true);

      const info = inferComponentFromPrefix(raw.statementPrefix);
      if (info) {
        components.push({
          name: info.name,
          typeName: info.typeName,
          transformation,
          visible,
          sourceLine: raw.line,
        });
      }
    }
  }

  // ── Extract connect() statements ──

  const connects = findConnects(content);
  for (const raw of connects) {
    let line: model.LineGraphic = {
      ...makeDefaultGraphicBase(),
      type: 'Line',
      points: [],
      color: [0, 0, 0],
      pattern: 'Solid',
      thickness: 0.25,
      arrow: ['None', 'None'],
      arrowSize: 3,
      smooth: 'None',
    };

    if (raw.annotationContent) {
      const annArgs = parseAnnotationContent(raw.annotationContent);
      if (annArgs['Line'] && annArgs['Line'].kind === 'record') {
        line = extractLineGraphic(annArgs['Line'].args);
      }
    }

    connections.push({ from: raw.from, to: raw.to, line });
  }

  return { className, filePath, diagram, icon, components, connections };
}
