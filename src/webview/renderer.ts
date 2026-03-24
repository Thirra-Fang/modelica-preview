/**
 * Modelica Diagram SVG Renderer — runs inside the VSCode WebView.
 *
 * Receives a DiagramModel via postMessage and renders an interactive SVG:
 *   - All Modelica graphical primitives (Line, Rectangle, Ellipse, Polygon, Text, Bitmap)
 *   - Component placeholders with type labels
 *   - Connection polylines
 *   - Zoom & pan via mouse wheel + drag
 *   - Click-to-navigate: sends componentName back to extension host
 */

import type {
  DiagramModel, LayerAnnotation, CoordinateSystem,
  Graphic, LineGraphic, RectangleGraphic, EllipseGraphic,
  PolygonGraphic, TextGraphic, BitmapGraphic,
  DiagramComponent, DiagramConnection,
  Color, Extent, Point, FillPattern, LinePattern, ArrowType,
} from '../model/diagramModel';

// ── VSCode WebView API ─────────────────────────────────────────────────────

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────

let currentModel: DiagramModel | null = null;

// Fixed internal coordinate space for the SVG.
// All diagram coordinates are rendered into this space; the SVG element fills
// the container via CSS and the viewBox attribute handles uniform scaling.
// This prevents the diagram layout from changing when the window is resized.
const DIAGRAM_W = 800;
const DIAGRAM_H = 600;

// Pan/zoom state (in SVG viewBox coordinates, not screen pixels)
let panX = 0;
let panY = 0;
let zoom = 1;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

// ── Coordinate system ──────────────────────────────────────────────────────

interface ViewBox {
  x1: number; y1: number; x2: number; y2: number;
  width: number; height: number;
}

function makeViewBox(cs: CoordinateSystem): ViewBox {
  const [[x1, y1], [x2, y2]] = cs.extent;
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

/** Convert Modelica coordinates to SVG coordinates (Y-flipped). */
function mo2svg(mx: number, my: number, vb: ViewBox, svgW: number, svgH: number): [number, number] {
  const sx = (mx - vb.x1) / vb.width * svgW;
  const sy = svgH - (my - vb.y1) / vb.height * svgH; // Y-flip
  return [sx, sy];
}

function mo2svgScale(mv: number, vb: ViewBox, svgW: number, svgH: number): [number, number] {
  const sx = mv / vb.width * svgW;
  const sy = mv / vb.height * svgH;
  return [sx, sy];
}

/**
 * Transform a LOCAL coordinate point to an ABSOLUTE diagram coordinate,
 * by applying the GraphicItem's origin translation and CCW rotation.
 *
 * Modelica GraphicItem transform order: rotate around {0,0} then translate by origin.
 */
function localToAbsolute(p: Point, origin: Point, rotDeg: number): Point {
  if (rotDeg === 0) return [p[0] + origin[0], p[1] + origin[1]];
  const r = rotDeg * Math.PI / 180;
  const cosR = Math.cos(r);
  const sinR = Math.sin(r);
  return [
    origin[0] + p[0] * cosR - p[1] * sinR,
    origin[1] + p[0] * sinR + p[1] * cosR,
  ];
}

/**
 * Compute the actual bounding box of all components and connection points,
 * in Modelica diagram coordinates. Used to auto-fit the viewbox.
 */
function computeActualBounds(m: DiagramModel): { x1: number; y1: number; x2: number; y2: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };

  for (const comp of m.components) {
    const { transformation: t } = comp;
    const [[ex1, ey1], [ex2, ey2]] = t.extent;
    const corners: Point[] = [[ex1, ey1], [ex2, ey1], [ex2, ey2], [ex1, ey2]];
    for (const c of corners) {
      const [ax, ay] = localToAbsolute(c, t.origin, t.rotation);
      expand(ax, ay);
    }
  }

  for (const conn of m.connections) {
    for (const p of conn.line.points) {
      const [ax, ay] = localToAbsolute(p, conn.line.origin, conn.line.rotation);
      expand(ax, ay);
    }
  }

  for (const g of m.diagram.graphics) {
    if (g.type === 'Line' || g.type === 'Polygon') {
      for (const p of g.points) {
        const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
        expand(ax, ay);
      }
    } else if (g.type !== 'Bitmap') {
      for (const p of g.extent) {
        const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
        expand(ax, ay);
      }
    }
  }

  if (!isFinite(minX)) return null;
  return { x1: minX, y1: minY, x2: maxX, y2: maxY };
}

// ── Colour helpers ─────────────────────────────────────────────────────────

function rgb(c: Color): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function svgLinePattern(pattern: LinePattern): string {
  switch (pattern) {
    case 'Dash': return '6 4';
    case 'Dot': return '2 4';
    case 'DashDot': return '6 4 2 4';
    case 'DashDotDot': return '6 4 2 4 2 4';
    default: return 'none';
  }
}

function fillStyle(fp: FillPattern, lineColor: Color, fillColor: Color, id: string): string {
  switch (fp) {
    case 'Solid': return rgb(fillColor);
    case 'None': return 'none';
    default:
      // Gradient / pattern fills mapped to approximate SVG equivalents
      return rgb(fillColor);
  }
}

// ── SVG element builder ────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) {
    e.setAttribute(k, String(v));
  }
  return e;
}

function group(attrs: Record<string, string> = {}): SVGGElement {
  return el('g', attrs);
}

// ── Arrowhead marker definitions ───────────────────────────────────────────

function createArrowDefs(defs: SVGDefsElement, id: string, color: Color, type: ArrowType): void {
  if (type === 'None') return;
  const marker = el('marker', {
    id,
    markerWidth: '10', markerHeight: '7',
    refX: '10', refY: '3.5',
    orient: 'auto',
  });
  if (type === 'Open' || type === 'Half') {
    const path = el('path', {
      d: type === 'Half' ? 'M 0 0 L 10 3.5 L 0 3.5' : 'M 0 0 L 10 3.5 L 0 7',
      stroke: rgb(color),
      fill: 'none',
      'stroke-width': '1.5',
    });
    marker.appendChild(path);
  } else {
    const polygon = el('polygon', {
      points: '0 0, 10 3.5, 0 7',
      fill: rgb(color),
    });
    marker.appendChild(polygon);
  }
  defs.appendChild(marker);
}

// ── Gradient defs for sphere/cylinder fills ────────────────────────────────

function createGradientDef(
  defs: SVGDefsElement, id: string,
  fp: FillPattern, lineColor: Color, fillColor: Color
): string {
  if (fp === 'Sphere' || fp === 'HorizontalCylinder' || fp === 'VerticalCylinder') {
    const isHorizontal = fp === 'HorizontalCylinder';
    const isVertical = fp === 'VerticalCylinder';
    const isSphere = fp === 'Sphere';

    const grad = el(isSphere ? 'radialGradient' : 'linearGradient', {
      id,
      ...(isHorizontal ? { x1: '0', y1: '0.5', x2: '1', y2: '0.5' } : {}),
      ...(isVertical ? { x1: '0.5', y1: '0', x2: '0.5', y2: '1' } : {}),
    });
    const stop1 = el('stop', { offset: '0%', 'stop-color': rgb(lineColor) });
    const stop2 = el('stop', { offset: '100%', 'stop-color': rgb(fillColor) });
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    return `url(#${id})`;
  }
  return fillStyle(fp, lineColor, fillColor, id);
}

// ── Hatch pattern defs ─────────────────────────────────────────────────────

function createHatchDef(
  defs: SVGDefsElement, id: string,
  fp: FillPattern, lineColor: Color
): string {
  const size = 8;
  const pat = el('pattern', {
    id, patternUnits: 'userSpaceOnUse',
    width: String(size), height: String(size),
  });
  const col = rgb(lineColor);

  const addLine = (x1: number, y1: number, x2: number, y2: number) => {
    pat.appendChild(el('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': '1' }));
  };

  switch (fp) {
    case 'Horizontal': addLine(0, size / 2, size, size / 2); break;
    case 'Vertical': addLine(size / 2, 0, size / 2, size); break;
    case 'Cross':
      addLine(0, size / 2, size, size / 2);
      addLine(size / 2, 0, size / 2, size);
      break;
    case 'Forward': addLine(0, size, size, 0); break;
    case 'Backward': addLine(0, 0, size, size); break;
    case 'CrossDiag':
      addLine(0, size, size, 0);
      addLine(0, 0, size, size);
      break;
    default: break;
  }

  defs.appendChild(pat);
  return `url(#${id})`;
}

function getFill(defs: SVGDefsElement, fp: FillPattern, lineColor: Color, fillColor: Color, uniqueId: string): string {
  switch (fp) {
    case 'None': return 'none';
    case 'Solid': return rgb(fillColor);
    case 'Sphere':
    case 'HorizontalCylinder':
    case 'VerticalCylinder':
      return createGradientDef(defs, uniqueId, fp, lineColor, fillColor);
    case 'Horizontal': case 'Vertical': case 'Cross':
    case 'Forward': case 'Backward': case 'CrossDiag':
      return createHatchDef(defs, uniqueId, fp, lineColor);
    default: return rgb(fillColor);
  }
}

// ── Primitive renderers ────────────────────────────────────────────────────

let _fillDefCount = 0;

function renderLine(g: LineGraphic, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  if (g.points.length === 0) return group();

  const grp = group({ class: 'mo-line' });
  // Points are in LOCAL space relative to g.origin; convert to absolute diagram coords first.
  const pts = g.points.map(p => {
    const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
    return mo2svg(ax, ay, vb, svgW, svgH);
  });

  // Arrowhead markers
  let markerStart = '';
  let markerEnd = '';
  if (g.arrow[0] !== 'None') {
    const mid = `arrow-s-${_fillDefCount++}`;
    createArrowDefs(defs, mid, g.color, g.arrow[0]);
    markerStart = `url(#${mid})`;
  }
  if (g.arrow[1] !== 'None') {
    const mid = `arrow-e-${_fillDefCount++}`;
    createArrowDefs(defs, mid, g.color, g.arrow[1]);
    markerEnd = `url(#${mid})`;
  }

  const scaleX = svgW / vb.width;
  const thickness = Math.max(0.5, g.thickness * scaleX);

  if (g.smooth === 'Bezier' && pts.length >= 3) {
    // Convert polyline to quadratic bezier curves through midpoints
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
    const path = el('path', {
      d,
      stroke: rgb(g.color),
      'stroke-width': thickness,
      fill: 'none',
      'stroke-dasharray': svgLinePattern(g.pattern),
      ...(markerStart ? { 'marker-start': markerStart } : {}),
      ...(markerEnd ? { 'marker-end': markerEnd } : {}),
    });
    grp.appendChild(path);
  } else {
    const pointStr = pts.map(p => `${p[0]},${p[1]}`).join(' ');
    const polyline = el('polyline', {
      points: pointStr,
      stroke: rgb(g.color),
      'stroke-width': thickness,
      fill: 'none',
      'stroke-dasharray': svgLinePattern(g.pattern),
      ...(markerStart ? { 'marker-start': markerStart } : {}),
      ...(markerEnd ? { 'marker-end': markerEnd } : {}),
    });
    grp.appendChild(polyline);
  }

  // Points are already converted to absolute coords; no extra transform needed.
  return grp;
}

function renderRectangle(g: RectangleGraphic, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  const fid = `fill-${_fillDefCount++}`;
  const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
  const scaleX = svgW / vb.width;
  const rx = g.radius > 0 ? g.radius * scaleX : 0;
  const grp = group({ class: 'mo-rect' });

  if (g.rotation !== 0) {
    // Rotated rectangle: compute all 4 corners, render as polygon
    const corners: Point[] = [
      [g.extent[0][0], g.extent[0][1]], [g.extent[1][0], g.extent[0][1]],
      [g.extent[1][0], g.extent[1][1]], [g.extent[0][0], g.extent[1][1]],
    ];
    const svgPts = corners
      .map(c => localToAbsolute(c, g.origin, g.rotation))
      .map(([ax, ay]) => mo2svg(ax, ay, vb, svgW, svgH));
    grp.appendChild(el('polygon', {
      points: svgPts.map(p => `${p[0]},${p[1]}`).join(' '),
      fill,
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': Math.max(0.5, g.lineThickness * scaleX),
      'stroke-dasharray': svgLinePattern(g.pattern),
    }));
  } else {
    // No rotation: add origin to extent corners directly
    const [p1, p2] = [
      mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
      mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH),
    ];
    const x = Math.min(p1[0], p2[0]);
    const y = Math.min(p1[1], p2[1]);
    const w = Math.abs(p2[0] - p1[0]);
    const h = Math.abs(p2[1] - p1[1]);
    grp.appendChild(el('rect', {
      x, y, width: w, height: h, rx, ry: rx,
      fill,
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': Math.max(0.5, g.lineThickness * scaleX),
      'stroke-dasharray': svgLinePattern(g.pattern),
    }));
  }
  return grp;
}

function renderEllipse(g: EllipseGraphic, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  // Convert extent corners to absolute diagram coords (origin + local extent)
  const [p1, p2] = [
    mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
    mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH),
  ];
  const cx = (p1[0] + p2[0]) / 2;
  const cy = (p1[1] + p2[1]) / 2;
  const rx = Math.abs(p2[0] - p1[0]) / 2;
  const ry = Math.abs(p2[1] - p1[1]) / 2;

  const fid = `fill-${_fillDefCount++}`;
  const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
  const scaleX = svgW / vb.width;
  const strokeWidth = Math.max(0.5, g.lineThickness * scaleX);

  const grp = group({ class: 'mo-ellipse' });

  const isFullCircle = Math.abs(g.endAngle - g.startAngle) >= 360;
  if (isFullCircle) {
    grp.appendChild(el('ellipse', {
      cx, cy, rx, ry,
      fill,
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': strokeWidth,
      'stroke-dasharray': svgLinePattern(g.pattern),
    }));
  } else {
    const startRad = g.startAngle * Math.PI / 180;
    const endRad = g.endAngle * Math.PI / 180;
    const x1 = cx + rx * Math.cos(startRad);
    const y1 = cy - ry * Math.sin(startRad);
    const x2 = cx + rx * Math.cos(endRad);
    const y2 = cy - ry * Math.sin(endRad);
    const largeArc = Math.abs(g.endAngle - g.startAngle) > 180 ? 1 : 0;
    grp.appendChild(el('path', {
      d: `M ${x1} ${y1} A ${rx} ${ry} 0 ${largeArc} 0 ${x2} ${y2}`,
      fill: 'none',
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': strokeWidth,
      'stroke-dasharray': svgLinePattern(g.pattern),
    }));
  }

  // Apply rotation around the origin point (in SVG coords) if needed
  if (g.rotation !== 0) {
    const [ox, oy] = mo2svg(g.origin[0], g.origin[1], vb, svgW, svgH);
    grp.setAttribute('transform', `rotate(${-g.rotation}, ${ox}, ${oy})`);
  }
  return grp;
}

function renderPolygon(g: PolygonGraphic, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  if (g.points.length === 0) return group();

  // Apply localToAbsolute to each point, same as renderLine
  const pts = g.points.map(p => {
    const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
    return mo2svg(ax, ay, vb, svgW, svgH);
  });
  const fid = `fill-${_fillDefCount++}`;
  const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
  const scaleX = svgW / vb.width;
  const grp = group({ class: 'mo-polygon' });

  if (g.smooth === 'Bezier' && pts.length >= 3) {
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    const all = [...pts, pts[0]];
    for (let i = 1; i < all.length - 1; i++) {
      const mx = (all[i][0] + all[i + 1][0]) / 2;
      const my = (all[i][1] + all[i + 1][1]) / 2;
      d += ` Q ${all[i][0]} ${all[i][1]} ${mx} ${my}`;
    }
    d += ' Z';
    grp.appendChild(el('path', {
      d, fill,
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': Math.max(0.5, g.lineThickness * scaleX),
    }));
  } else {
    grp.appendChild(el('polygon', {
      points: pts.map(p => `${p[0]},${p[1]}`).join(' '),
      fill,
      stroke: g.pattern === 'None' ? 'none' : rgb(g.lineColor),
      'stroke-width': Math.max(0.5, g.lineThickness * scaleX),
      'stroke-dasharray': svgLinePattern(g.pattern),
    }));
  }
  return grp;
}

function renderText(g: TextGraphic, vb: ViewBox, svgW: number, svgH: number): SVGElement {
  // Convert extent corners to absolute diagram coords
  const [p1, p2] = [
    mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
    mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH),
  ];
  const cx = (p1[0] + p2[0]) / 2;
  const cy = (p1[1] + p2[1]) / 2;
  const boxW = Math.abs(p2[0] - p1[0]);
  const boxH = Math.abs(p2[1] - p1[1]);

  const fontSize = g.fontSize > 0
    ? g.fontSize * (svgW / vb.width)
    : Math.max(6, Math.min(boxH * 0.6, boxW / Math.max(1, g.textString.length) * 1.5));

  const textAnchor = g.horizontalAlignment === 'Left' ? 'start'
    : g.horizontalAlignment === 'Right' ? 'end' : 'middle';
  const anchorX = g.horizontalAlignment === 'Left' ? Math.min(p1[0], p2[0])
    : g.horizontalAlignment === 'Right' ? Math.max(p1[0], p2[0]) : cx;

  const textEl = el('text', {
    x: anchorX, y: cy + fontSize * 0.35,
    'font-size': fontSize,
    'text-anchor': textAnchor,
    'dominant-baseline': 'middle',
    fill: rgb(g.textColor),
    'font-weight': g.textStyle.includes('Bold') ? 'bold' : 'normal',
    'font-style': g.textStyle.includes('Italic') ? 'italic' : 'normal',
    'text-decoration': g.textStyle.includes('UnderLine') ? 'underline' : 'none',
  });
  textEl.textContent = g.textString;

  const grp = group({ class: 'mo-text' });
  grp.appendChild(textEl);
  return grp;
}

function renderBitmap(g: BitmapGraphic, vb: ViewBox, svgW: number, svgH: number): SVGElement {
  // Convert extent corners to absolute diagram coords
  const [p1, p2] = [
    mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
    mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH),
  ];
  const x = Math.min(p1[0], p2[0]);
  const y = Math.min(p1[1], p2[1]);
  const w = Math.abs(p2[0] - p1[0]);
  const h = Math.abs(p2[1] - p1[1]);
  const grp = group({ class: 'mo-bitmap' });
  if (g.imageSource) {
    grp.appendChild(el('image', {
      x, y, width: w, height: h,
      href: `data:image/png;base64,${g.imageSource}`,
      preserveAspectRatio: 'xMidYMid meet',
    }));
  } else {
    const rect = el('rect', { x, y, width: w, height: h, fill: '#eee', stroke: '#999', 'stroke-width': 1 });
    const txt = el('text', { x: x + w / 2, y: y + h / 2, 'text-anchor': 'middle', fill: '#666', 'font-size': 10 });
    txt.textContent = '🖼';
    grp.appendChild(rect);
    grp.appendChild(txt);
  }
  return grp;
}

function renderGraphic(g: Graphic, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  switch (g.type) {
    case 'Line': return renderLine(g, vb, svgW, svgH, defs);
    case 'Rectangle': return renderRectangle(g, vb, svgW, svgH, defs);
    case 'Ellipse': return renderEllipse(g, vb, svgW, svgH, defs);
    case 'Polygon': return renderPolygon(g, vb, svgW, svgH, defs);
    case 'Text': return renderText(g, vb, svgW, svgH);
    case 'Bitmap': return renderBitmap(g, vb, svgW, svgH);
  }
}

// ── Component renderer ─────────────────────────────────────────────────────

function renderComponent(
  comp: DiagramComponent,
  vb: ViewBox, svgW: number, svgH: number,
  defs: SVGDefsElement
): SVGGElement {
  const { transformation } = comp;
  const [[ex1, ey1], [ex2, ey2]] = transformation.extent;
  const [ox_mo, oy_mo] = transformation.origin;

  // Absolute diagram coords = origin + local extent (Bug #2 fix: don't double-subtract vb origin)
  const [p1x, p1y] = mo2svg(ox_mo + ex1, oy_mo + ey1, vb, svgW, svgH);
  const [p2x, p2y] = mo2svg(ox_mo + ex2, oy_mo + ey2, vb, svgW, svgH);

  const x = Math.min(p1x, p2x);
  const y = Math.min(p1y, p2y);
  const w = Math.abs(p2x - p1x);
  const h = Math.abs(p2y - p1y);

  const grp = group({
    class: 'mo-component',
    'data-name': comp.name,
    'data-line': String(comp.sourceLine),
    cursor: 'pointer',
  });

  // Box background
  const rect = el('rect', {
    x, y, width: w, height: h, rx: 4, ry: 4,
    fill: '#e8f4fd',
    stroke: '#2196f3',
    'stroke-width': Math.max(1, w * 0.02),
  });

  // Short type name label (last segment of dotted path)
  const shortType = comp.typeName.includes('.')
    ? comp.typeName.split('.').pop()!
    : comp.typeName;

  const fontSize = Math.max(6, Math.min(h * 0.25, w / Math.max(1, shortType.length) * 1.4));

  const typeLabel = el('text', {
    x: x + w / 2, y: y + h * 0.38,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': fontSize,
    fill: '#555',
    'font-style': 'italic',
  });
  typeLabel.textContent = shortType;

  const nameLabel = el('text', {
    x: x + w / 2, y: y + h * 0.65,
    'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': fontSize * 1.1,
    fill: '#1565c0',
    'font-weight': 'bold',
  });
  nameLabel.textContent = comp.name;

  // Hover highlight overlay (invisible by default)
  const highlight = el('rect', {
    x, y, width: w, height: h, rx: 4, ry: 4,
    fill: 'rgba(33,150,243,0.15)',
    stroke: 'none',
    class: 'mo-hover-highlight',
  });
  (highlight as SVGElement).style.opacity = '0';

  grp.appendChild(rect);
  grp.appendChild(typeLabel);
  grp.appendChild(nameLabel);
  grp.appendChild(highlight);

  // Apply rotation around the center of the absolute extent (Modelica CCW → SVG -angle)
  if (transformation.rotation !== 0) {
    const cxSvg = (p1x + p2x) / 2;
    const cySvg = (p1y + p2y) / 2;
    grp.setAttribute('transform', `rotate(${-transformation.rotation}, ${cxSvg}, ${cySvg})`);
  }

  // Click → navigate to source
  grp.addEventListener('click', () => {
    vscode.postMessage({ type: 'navigate', componentName: comp.name, line: comp.sourceLine });
  });
  grp.addEventListener('mouseenter', () => {
    (highlight as SVGElement).style.opacity = '1';
    (rect as SVGElement).style.stroke = '#1565c0';
  });
  grp.addEventListener('mouseleave', () => {
    (highlight as SVGElement).style.opacity = '0';
    (rect as SVGElement).style.stroke = '#2196f3';
  });

  return grp;
}

// ── Connection renderer ────────────────────────────────────────────────────

function renderConnection(conn: DiagramConnection, vb: ViewBox, svgW: number, svgH: number, defs: SVGDefsElement): SVGElement {
  const grp = group({ class: 'mo-connection' });

  if (conn.line.points.length === 0) {
    // No explicit points: skip (can't draw without waypoints)
    return grp;
  }

  const lineEl = renderLine(conn.line, vb, svgW, svgH, defs);

  // Tooltip
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${conn.from} → ${conn.to}`;
  grp.appendChild(title);
  grp.appendChild(lineEl);
  return grp;
}

// ── Main render function ───────────────────────────────────────────────────

function render(m: DiagramModel): void {
  _fillDefCount = 0;

  // Update toolbar title
  const titleEl = document.getElementById('toolbar-title');
  if (titleEl) titleEl.textContent = m.className;

  // Remove empty state
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'none';

  const container = document.getElementById('svg-container')!;
  // Remove existing SVG (keep status/error overlays)
  const existing = container.querySelector('svg');
  if (existing) existing.remove();

  // Use fixed internal dimensions so the diagram layout never changes with
  // window size.  CSS (#svg-container svg { width:100%; height:100% }) and
  // the viewBox + preserveAspectRatio attributes handle visual scaling.
  const svgW = DIAGRAM_W;
  const svgH = DIAGRAM_H;

  const svgEl = el('svg', {
    viewBox: `0 0 ${svgW} ${svgH}`,
    preserveAspectRatio: 'xMidYMid meet',
    xmlns: SVG_NS,
  });

  const defs = el('defs', {});
  svgEl.appendChild(defs);

  // Use icon layer if active and available
  const layer: LayerAnnotation = (currentLayer === 'icon' && m.icon) ? m.icon : m.diagram;
  const declaredVb = makeViewBox(layer.coordinateSystem);

  // Auto-expand viewbox to encompass all components and connections that may lie
  // outside the declared coordinateSystem extent (common in real Modelica files).
  const bounds = computeActualBounds(m);
  let vb: ViewBox;
  if (bounds) {
    const padX = Math.max((bounds.x2 - bounds.x1) * 0.08, 5);
    const padY = Math.max((bounds.y2 - bounds.y1) * 0.08, 5);
    const x1 = Math.min(declaredVb.x1, bounds.x1 - padX);
    const y1 = Math.min(declaredVb.y1, bounds.y1 - padY);
    const x2 = Math.max(declaredVb.x2, bounds.x2 + padX);
    const y2 = Math.max(declaredVb.y2, bounds.y2 + padY);
    vb = { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
  } else {
    vb = declaredVb;
  }

  // Root group for pan/zoom
  const root = group({ id: 'root', transform: `translate(${panX},${panY}) scale(${zoom})` });
  svgEl.appendChild(root);

  // Background
  root.appendChild(el('rect', { x: 0, y: 0, width: svgW, height: svgH, fill: 'white' }));

  // ── Diagram-level graphics ──
  const diagramLayer = group({ class: 'mo-diagram-layer' });
  for (const g of layer.graphics) {
    if (g.visible !== false) {
      diagramLayer.appendChild(renderGraphic(g, vb, svgW, svgH, defs));
    }
  }
  root.appendChild(diagramLayer);

  // ── Components ──
  const componentLayer = group({ class: 'mo-component-layer' });
  for (const comp of m.components) {
    if (comp.visible !== false) {
      componentLayer.appendChild(renderComponent(comp, vb, svgW, svgH, defs));
    }
  }
  root.appendChild(componentLayer);

  // ── Connections ──
  const connectionLayer = group({ class: 'mo-connection-layer' });
  for (const conn of m.connections) {
    connectionLayer.appendChild(renderConnection(conn, vb, svgW, svgH, defs));
  }
  root.appendChild(connectionLayer);

  // Title
  const title = el('text', {
    x: 10, y: 20,
    'font-size': 14, fill: '#333', 'font-family': 'sans-serif',
  });
  title.textContent = m.className;
  svgEl.appendChild(title);

  container.appendChild(svgEl);
  setupPanZoom(svgEl, root);
}

// ── Pan / Zoom ─────────────────────────────────────────────────────────────

/**
 * Convert a screen-space mouse position to the SVG's internal viewBox
 * coordinate system, accounting for whatever CSS scaling the browser has
 * applied to the SVG element (e.g. because of the viewBox attribute).
 */
function getMouseInSVG(svgEl: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svgEl.getScreenCTM();
  if (ctm) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const t = pt.matrixTransform(ctm.inverse());
    return { x: t.x, y: t.y };
  }
  // Fallback when getScreenCTM is unavailable
  const rect = svgEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * DIAGRAM_W / (rect.width || DIAGRAM_W),
    y: (clientY - rect.top) * DIAGRAM_H / (rect.height || DIAGRAM_H),
  };
}

function setupPanZoom(svgEl: SVGSVGElement, root: SVGGElement): void {
  svgEl.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    // Convert cursor position to SVG viewBox coordinates so zoom is
    // towards the cursor regardless of how the SVG is scaled on screen.
    const mouse = getMouseInSVG(svgEl, e.clientX, e.clientY);

    panX = mouse.x - (mouse.x - panX) * factor;
    panY = mouse.y - (mouse.y - panY) * factor;
    zoom *= factor;

    root.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
  }, { passive: false });

  svgEl.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    // Don't start pan if clicking a component
    const target = e.target as Element;
    if (target.closest('.mo-component')) return;
    isPanning = true;
    // Store starting position in SVG viewBox coordinates
    const mouse = getMouseInSVG(svgEl, e.clientX, e.clientY);
    panStartX = mouse.x;
    panStartY = mouse.y;
    panStartPanX = panX;
    panStartPanY = panY;
    svgEl.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    const svg = document.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    const mouse = getMouseInSVG(svg, e.clientX, e.clientY);
    panX = panStartPanX + (mouse.x - panStartX);
    panY = panStartPanY + (mouse.y - panStartY);
    root.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      const svg = document.querySelector('svg');
      if (svg) (svg as unknown as HTMLElement).style.cursor = 'grab';
    }
  });

  // Double-click resets view
  svgEl.addEventListener('dblclick', (e: MouseEvent) => {
    const target = e.target as Element;
    if (target.closest('.mo-component')) return;
    panX = 0; panY = 0; zoom = 1;
    root.setAttribute('transform', `translate(0,0) scale(1)`);
  });

  svgEl.style.cursor = 'grab';
}

// ── Message handler ────────────────────────────────────────────────────────

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; model?: DiagramModel; error?: string };

  switch (msg.type) {
    case 'update':
      if (msg.model) {
        currentModel = msg.model;
        panX = 0; panY = 0; zoom = 1;
        render(currentModel);
        showStatus('');
      }
      break;

    case 'error':
      showError(msg.error ?? 'Unknown error');
      break;

    case 'loading':
      showStatus('Parsing…');
      break;
  }
});

// ── Status / error display ─────────────────────────────────────────────────

function showStatus(msg: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function showError(msg: string): void {
  const el = document.getElementById('error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ── Layer toggle & toolbar (must run from bundled script — webview CSP blocks inline scripts) ──

let currentLayer: 'diagram' | 'icon' = 'diagram';

function wireToolbar(): void {
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    panX = 0; panY = 0; zoom = 1;
    const root = document.getElementById('root');
    if (root) root.setAttribute('transform', 'translate(0,0) scale(1)');
  });

  document.getElementById('btn-layer')?.addEventListener('click', () => {
    currentLayer = currentLayer === 'diagram' ? 'icon' : 'diagram';
    const btn = document.getElementById('btn-layer');
    if (btn) {
      btn.textContent = currentLayer === 'diagram' ? '⊞ Diagram' : '⊡ Icon';
    }
    if (currentModel) render(currentModel);
  });
}

wireToolbar();

// No resize listener needed: the SVG uses a fixed viewBox coordinate space
// and CSS (width/height 100%) so the browser scales it uniformly without
// requiring a full re-render.
