"use strict";
(() => {
  // src/webview/renderer.ts
  var vscode = acquireVsCodeApi();
  var currentModel = null;
  var DIAGRAM_W = 800;
  var DIAGRAM_H = 600;
  var panX = 0;
  var panY = 0;
  var zoom = 1;
  var isPanning = false;
  var panStartX = 0;
  var panStartY = 0;
  var panStartPanX = 0;
  var panStartPanY = 0;
  function makeViewBox(cs) {
    const [[x1, y1], [x2, y2]] = cs.extent;
    return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
  }
  function mo2svg(mx, my, vb, svgW, svgH) {
    const sx = (mx - vb.x1) / vb.width * svgW;
    const sy = svgH - (my - vb.y1) / vb.height * svgH;
    return [sx, sy];
  }
  function localToAbsolute(p, origin, rotDeg) {
    if (rotDeg === 0)
      return [p[0] + origin[0], p[1] + origin[1]];
    const r = rotDeg * Math.PI / 180;
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    return [
      origin[0] + p[0] * cosR - p[1] * sinR,
      origin[1] + p[0] * sinR + p[1] * cosR
    ];
  }
  function computeActualBounds(m, layer, includeComponentsAndConnections) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (x, y) => {
      if (x < minX)
        minX = x;
      if (x > maxX)
        maxX = x;
      if (y < minY)
        minY = y;
      if (y > maxY)
        maxY = y;
    };
    if (includeComponentsAndConnections) {
      for (const comp of m.components) {
        const { transformation: t } = comp;
        const [[ex1, ey1], [ex2, ey2]] = t.extent;
        const corners = [[ex1, ey1], [ex2, ey1], [ex2, ey2], [ex1, ey2]];
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
    }
    for (const g of layer.graphics) {
      if (g.type === "Line" || g.type === "Polygon") {
        for (const p of g.points) {
          const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
          expand(ax, ay);
        }
      } else if (g.type !== "Bitmap") {
        for (const p of g.extent) {
          const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
          expand(ax, ay);
        }
      }
    }
    if (!isFinite(minX))
      return null;
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  }
  function rgb(c) {
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function svgLinePattern(pattern) {
    switch (pattern) {
      case "Dash":
        return "6 4";
      case "Dot":
        return "2 4";
      case "DashDot":
        return "6 4 2 4";
      case "DashDotDot":
        return "6 4 2 4 2 4";
      default:
        return "none";
    }
  }
  function fillStyle(fp, lineColor, fillColor, id) {
    switch (fp) {
      case "Solid":
        return rgb(fillColor);
      case "None":
        return "none";
      default:
        return rgb(fillColor);
    }
  }
  var SVG_NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      e.setAttribute(k, String(v));
    }
    return e;
  }
  function group(attrs = {}) {
    return el("g", attrs);
  }
  function createArrowDefs(defs, id, color, type) {
    if (type === "None")
      return;
    const marker = el("marker", {
      id,
      markerWidth: "10",
      markerHeight: "7",
      refX: "10",
      refY: "3.5",
      orient: "auto"
    });
    if (type === "Open" || type === "Half") {
      const path = el("path", {
        d: type === "Half" ? "M 0 0 L 10 3.5 L 0 3.5" : "M 0 0 L 10 3.5 L 0 7",
        stroke: rgb(color),
        fill: "none",
        "stroke-width": "1.5"
      });
      marker.appendChild(path);
    } else {
      const polygon = el("polygon", {
        points: "0 0, 10 3.5, 0 7",
        fill: rgb(color)
      });
      marker.appendChild(polygon);
    }
    defs.appendChild(marker);
  }
  function createGradientDef(defs, id, fp, lineColor, fillColor) {
    if (fp === "Sphere" || fp === "HorizontalCylinder" || fp === "VerticalCylinder") {
      const isHorizontal = fp === "HorizontalCylinder";
      const isVertical = fp === "VerticalCylinder";
      const isSphere = fp === "Sphere";
      const grad = el(isSphere ? "radialGradient" : "linearGradient", {
        id,
        ...isHorizontal ? { x1: "0", y1: "0.5", x2: "1", y2: "0.5" } : {},
        ...isVertical ? { x1: "0.5", y1: "0", x2: "0.5", y2: "1" } : {}
      });
      const stop1 = el("stop", { offset: "0%", "stop-color": rgb(lineColor) });
      const stop2 = el("stop", { offset: "100%", "stop-color": rgb(fillColor) });
      grad.appendChild(stop1);
      grad.appendChild(stop2);
      defs.appendChild(grad);
      return `url(#${id})`;
    }
    return fillStyle(fp, lineColor, fillColor, id);
  }
  function createHatchDef(defs, id, fp, lineColor) {
    const size = 8;
    const pat = el("pattern", {
      id,
      patternUnits: "userSpaceOnUse",
      width: String(size),
      height: String(size)
    });
    const col = rgb(lineColor);
    const addLine = (x1, y1, x2, y2) => {
      pat.appendChild(el("line", { x1, y1, x2, y2, stroke: col, "stroke-width": "1" }));
    };
    switch (fp) {
      case "Horizontal":
        addLine(0, size / 2, size, size / 2);
        break;
      case "Vertical":
        addLine(size / 2, 0, size / 2, size);
        break;
      case "Cross":
        addLine(0, size / 2, size, size / 2);
        addLine(size / 2, 0, size / 2, size);
        break;
      case "Forward":
        addLine(0, size, size, 0);
        break;
      case "Backward":
        addLine(0, 0, size, size);
        break;
      case "CrossDiag":
        addLine(0, size, size, 0);
        addLine(0, 0, size, size);
        break;
      default:
        break;
    }
    defs.appendChild(pat);
    return `url(#${id})`;
  }
  function getFill(defs, fp, lineColor, fillColor, uniqueId) {
    switch (fp) {
      case "None":
        return "none";
      case "Solid":
        return rgb(fillColor);
      case "Sphere":
      case "HorizontalCylinder":
      case "VerticalCylinder":
        return createGradientDef(defs, uniqueId, fp, lineColor, fillColor);
      case "Horizontal":
      case "Vertical":
      case "Cross":
      case "Forward":
      case "Backward":
      case "CrossDiag":
        return createHatchDef(defs, uniqueId, fp, lineColor);
      default:
        return rgb(fillColor);
    }
  }
  var _fillDefCount = 0;
  function renderLine(g, vb, svgW, svgH, defs) {
    if (g.points.length === 0)
      return group();
    const grp = group({ class: "mo-line" });
    const pts = g.points.map((p) => {
      const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
      return mo2svg(ax, ay, vb, svgW, svgH);
    });
    let markerStart = "";
    let markerEnd = "";
    if (g.arrow[0] !== "None") {
      const mid = `arrow-s-${_fillDefCount++}`;
      createArrowDefs(defs, mid, g.color, g.arrow[0]);
      markerStart = `url(#${mid})`;
    }
    if (g.arrow[1] !== "None") {
      const mid = `arrow-e-${_fillDefCount++}`;
      createArrowDefs(defs, mid, g.color, g.arrow[1]);
      markerEnd = `url(#${mid})`;
    }
    const scaleX = svgW / vb.width;
    const thickness = Math.max(0.5, g.thickness * scaleX);
    if (g.smooth === "Bezier" && pts.length >= 3) {
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
      }
      d += ` L ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
      const path = el("path", {
        d,
        stroke: rgb(g.color),
        "stroke-width": thickness,
        fill: "none",
        "stroke-dasharray": svgLinePattern(g.pattern),
        ...markerStart ? { "marker-start": markerStart } : {},
        ...markerEnd ? { "marker-end": markerEnd } : {}
      });
      grp.appendChild(path);
    } else {
      const pointStr = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
      const polyline = el("polyline", {
        points: pointStr,
        stroke: rgb(g.color),
        "stroke-width": thickness,
        fill: "none",
        "stroke-dasharray": svgLinePattern(g.pattern),
        ...markerStart ? { "marker-start": markerStart } : {},
        ...markerEnd ? { "marker-end": markerEnd } : {}
      });
      grp.appendChild(polyline);
    }
    return grp;
  }
  function renderRectangle(g, vb, svgW, svgH, defs) {
    const fid = `fill-${_fillDefCount++}`;
    const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
    const scaleX = svgW / vb.width;
    const rx = g.radius > 0 ? g.radius * scaleX : 0;
    const grp = group({ class: "mo-rect" });
    if (g.rotation !== 0) {
      const corners = [
        [g.extent[0][0], g.extent[0][1]],
        [g.extent[1][0], g.extent[0][1]],
        [g.extent[1][0], g.extent[1][1]],
        [g.extent[0][0], g.extent[1][1]]
      ];
      const svgPts = corners.map((c) => localToAbsolute(c, g.origin, g.rotation)).map(([ax, ay]) => mo2svg(ax, ay, vb, svgW, svgH));
      grp.appendChild(el("polygon", {
        points: svgPts.map((p) => `${p[0]},${p[1]}`).join(" "),
        fill,
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": Math.max(0.5, g.lineThickness * scaleX),
        "stroke-dasharray": svgLinePattern(g.pattern)
      }));
    } else {
      const [p1, p2] = [
        mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
        mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH)
      ];
      const x = Math.min(p1[0], p2[0]);
      const y = Math.min(p1[1], p2[1]);
      const w = Math.abs(p2[0] - p1[0]);
      const h = Math.abs(p2[1] - p1[1]);
      grp.appendChild(el("rect", {
        x,
        y,
        width: w,
        height: h,
        rx,
        ry: rx,
        fill,
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": Math.max(0.5, g.lineThickness * scaleX),
        "stroke-dasharray": svgLinePattern(g.pattern)
      }));
    }
    return grp;
  }
  function renderEllipse(g, vb, svgW, svgH, defs) {
    const [p1, p2] = [
      mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
      mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH)
    ];
    const cx = (p1[0] + p2[0]) / 2;
    const cy = (p1[1] + p2[1]) / 2;
    const rx = Math.abs(p2[0] - p1[0]) / 2;
    const ry = Math.abs(p2[1] - p1[1]) / 2;
    const fid = `fill-${_fillDefCount++}`;
    const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
    const scaleX = svgW / vb.width;
    const strokeWidth = Math.max(0.5, g.lineThickness * scaleX);
    const grp = group({ class: "mo-ellipse" });
    const isFullCircle = Math.abs(g.endAngle - g.startAngle) >= 360;
    if (isFullCircle) {
      grp.appendChild(el("ellipse", {
        cx,
        cy,
        rx,
        ry,
        fill,
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": strokeWidth,
        "stroke-dasharray": svgLinePattern(g.pattern)
      }));
    } else {
      const startRad = g.startAngle * Math.PI / 180;
      const endRad = g.endAngle * Math.PI / 180;
      const x1 = cx + rx * Math.cos(startRad);
      const y1 = cy - ry * Math.sin(startRad);
      const x2 = cx + rx * Math.cos(endRad);
      const y2 = cy - ry * Math.sin(endRad);
      const largeArc = Math.abs(g.endAngle - g.startAngle) > 180 ? 1 : 0;
      grp.appendChild(el("path", {
        d: `M ${x1} ${y1} A ${rx} ${ry} 0 ${largeArc} 0 ${x2} ${y2}`,
        fill: "none",
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": strokeWidth,
        "stroke-dasharray": svgLinePattern(g.pattern)
      }));
    }
    if (g.rotation !== 0) {
      const [ox, oy] = mo2svg(g.origin[0], g.origin[1], vb, svgW, svgH);
      grp.setAttribute("transform", `rotate(${-g.rotation}, ${ox}, ${oy})`);
    }
    return grp;
  }
  function renderPolygon(g, vb, svgW, svgH, defs) {
    if (g.points.length === 0)
      return group();
    const pts = g.points.map((p) => {
      const [ax, ay] = localToAbsolute(p, g.origin, g.rotation);
      return mo2svg(ax, ay, vb, svgW, svgH);
    });
    const fid = `fill-${_fillDefCount++}`;
    const fill = getFill(defs, g.fillPattern, g.lineColor, g.fillColor, fid);
    const scaleX = svgW / vb.width;
    const grp = group({ class: "mo-polygon" });
    if (g.smooth === "Bezier" && pts.length >= 3) {
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      const all = [...pts, pts[0]];
      for (let i = 1; i < all.length - 1; i++) {
        const mx = (all[i][0] + all[i + 1][0]) / 2;
        const my = (all[i][1] + all[i + 1][1]) / 2;
        d += ` Q ${all[i][0]} ${all[i][1]} ${mx} ${my}`;
      }
      d += " Z";
      grp.appendChild(el("path", {
        d,
        fill,
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": Math.max(0.5, g.lineThickness * scaleX)
      }));
    } else {
      grp.appendChild(el("polygon", {
        points: pts.map((p) => `${p[0]},${p[1]}`).join(" "),
        fill,
        stroke: g.pattern === "None" ? "none" : rgb(g.lineColor),
        "stroke-width": Math.max(0.5, g.lineThickness * scaleX),
        "stroke-dasharray": svgLinePattern(g.pattern)
      }));
    }
    return grp;
  }
  function renderText(g, vb, svgW, svgH) {
    const [p1, p2] = [
      mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
      mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH)
    ];
    const cx = (p1[0] + p2[0]) / 2;
    const cy = (p1[1] + p2[1]) / 2;
    const boxW = Math.abs(p2[0] - p1[0]);
    const boxH = Math.abs(p2[1] - p1[1]);
    const fontSize = g.fontSize > 0 ? g.fontSize * (svgW / vb.width) : Math.max(6, Math.min(boxH * 0.6, boxW / Math.max(1, g.textString.length) * 1.5));
    const textAnchor = g.horizontalAlignment === "Left" ? "start" : g.horizontalAlignment === "Right" ? "end" : "middle";
    const anchorX = g.horizontalAlignment === "Left" ? Math.min(p1[0], p2[0]) : g.horizontalAlignment === "Right" ? Math.max(p1[0], p2[0]) : cx;
    const textEl = el("text", {
      x: anchorX,
      y: cy + fontSize * 0.35,
      "font-size": fontSize,
      "text-anchor": textAnchor,
      "dominant-baseline": "middle",
      fill: rgb(g.textColor),
      "font-weight": g.textStyle.includes("Bold") ? "bold" : "normal",
      "font-style": g.textStyle.includes("Italic") ? "italic" : "normal",
      "text-decoration": g.textStyle.includes("UnderLine") ? "underline" : "none"
    });
    textEl.textContent = g.textString;
    const grp = group({ class: "mo-text" });
    grp.appendChild(textEl);
    return grp;
  }
  function renderBitmap(g, vb, svgW, svgH) {
    const [p1, p2] = [
      mo2svg(g.extent[0][0] + g.origin[0], g.extent[0][1] + g.origin[1], vb, svgW, svgH),
      mo2svg(g.extent[1][0] + g.origin[0], g.extent[1][1] + g.origin[1], vb, svgW, svgH)
    ];
    const x = Math.min(p1[0], p2[0]);
    const y = Math.min(p1[1], p2[1]);
    const w = Math.abs(p2[0] - p1[0]);
    const h = Math.abs(p2[1] - p1[1]);
    const grp = group({ class: "mo-bitmap" });
    if (g.imageSource) {
      grp.appendChild(el("image", {
        x,
        y,
        width: w,
        height: h,
        href: `data:image/png;base64,${g.imageSource}`,
        preserveAspectRatio: "xMidYMid meet"
      }));
    } else {
      const rect = el("rect", { x, y, width: w, height: h, fill: "#eee", stroke: "#999", "stroke-width": 1 });
      const txt = el("text", { x: x + w / 2, y: y + h / 2, "text-anchor": "middle", fill: "#666", "font-size": 10 });
      txt.textContent = "\u{1F5BC}";
      grp.appendChild(rect);
      grp.appendChild(txt);
    }
    return grp;
  }
  function renderGraphic(g, vb, svgW, svgH, defs) {
    switch (g.type) {
      case "Line":
        return renderLine(g, vb, svgW, svgH, defs);
      case "Rectangle":
        return renderRectangle(g, vb, svgW, svgH, defs);
      case "Ellipse":
        return renderEllipse(g, vb, svgW, svgH, defs);
      case "Polygon":
        return renderPolygon(g, vb, svgW, svgH, defs);
      case "Text":
        return renderText(g, vb, svgW, svgH);
      case "Bitmap":
        return renderBitmap(g, vb, svgW, svgH);
    }
  }
  function mapIconPointToComponent(p, iconExtent, componentExtent) {
    const [[ix1, iy1], [ix2, iy2]] = iconExtent;
    const [[cx1, cy1], [cx2, cy2]] = componentExtent;
    const iconW = ix2 - ix1 || 1;
    const iconH = iy2 - iy1 || 1;
    const tx = (p[0] - ix1) / iconW;
    const ty = (p[1] - iy1) / iconH;
    return [cx1 + tx * (cx2 - cx1), cy1 + ty * (cy2 - cy1)];
  }
  function mapIconGraphicToComponent(graphic, iconExtent, componentExtent) {
    const mapP = (p) => mapIconPointToComponent(p, iconExtent, componentExtent);
    if (graphic.type === "Line") {
      const points = graphic.points.map(
        (p) => mapP(localToAbsolute(p, graphic.origin, graphic.rotation))
      );
      return { ...graphic, points, origin: [0, 0], rotation: 0 };
    }
    if (graphic.type === "Polygon") {
      const points = graphic.points.map(
        (p) => mapP(localToAbsolute(p, graphic.origin, graphic.rotation))
      );
      return { ...graphic, points, origin: [0, 0], rotation: 0 };
    }
    if (graphic.type === "Rectangle") {
      if (graphic.rotation !== 0) {
        const corners = [
          [graphic.extent[0][0], graphic.extent[0][1]],
          [graphic.extent[1][0], graphic.extent[0][1]],
          [graphic.extent[1][0], graphic.extent[1][1]],
          [graphic.extent[0][0], graphic.extent[1][1]]
        ];
        const mapped = corners.map((c) => mapP(localToAbsolute(c, graphic.origin, graphic.rotation)));
        return {
          type: "Polygon",
          visible: graphic.visible,
          origin: [0, 0],
          rotation: 0,
          lineColor: graphic.lineColor,
          fillColor: graphic.fillColor,
          pattern: graphic.pattern,
          fillPattern: graphic.fillPattern,
          lineThickness: graphic.lineThickness,
          points: mapped,
          smooth: "None"
        };
      }
      const a0 = [
        graphic.extent[0][0] + graphic.origin[0],
        graphic.extent[0][1] + graphic.origin[1]
      ];
      const a1 = [
        graphic.extent[1][0] + graphic.origin[0],
        graphic.extent[1][1] + graphic.origin[1]
      ];
      return {
        ...graphic,
        extent: [mapP(a0), mapP(a1)],
        origin: [0, 0],
        rotation: 0
      };
    }
    if (graphic.type === "Ellipse") {
      const abs0 = [
        graphic.extent[0][0] + graphic.origin[0],
        graphic.extent[0][1] + graphic.origin[1]
      ];
      const abs1 = [
        graphic.extent[1][0] + graphic.origin[0],
        graphic.extent[1][1] + graphic.origin[1]
      ];
      const m0 = mapP(abs0);
      const m1 = mapP(abs1);
      const pivot = mapP(graphic.origin);
      if (graphic.rotation !== 0) {
        return {
          ...graphic,
          extent: [
            [m0[0] - pivot[0], m0[1] - pivot[1]],
            [m1[0] - pivot[0], m1[1] - pivot[1]]
          ],
          origin: pivot,
          rotation: graphic.rotation
        };
      }
      return {
        ...graphic,
        extent: [m0, m1],
        origin: [0, 0],
        rotation: 0
      };
    }
    if (graphic.type === "Text" || graphic.type === "Bitmap") {
      const abs0 = [
        graphic.extent[0][0] + graphic.origin[0],
        graphic.extent[0][1] + graphic.origin[1]
      ];
      const abs1 = [
        graphic.extent[1][0] + graphic.origin[0],
        graphic.extent[1][1] + graphic.origin[1]
      ];
      return {
        ...graphic,
        extent: [mapP(abs0), mapP(abs1)],
        origin: [0, 0],
        rotation: 0
      };
    }
    return graphic;
  }
  function renderComponent(comp, vb, svgW, svgH, defs) {
    const { transformation } = comp;
    const [[ex1, ey1], [ex2, ey2]] = transformation.extent;
    const [ox_mo, oy_mo] = transformation.origin;
    const [p1x, p1y] = mo2svg(ox_mo + ex1, oy_mo + ey1, vb, svgW, svgH);
    const [p2x, p2y] = mo2svg(ox_mo + ex2, oy_mo + ey2, vb, svgW, svgH);
    const x = Math.min(p1x, p2x);
    const y = Math.min(p1y, p2y);
    const w = Math.abs(p2x - p1x);
    const h = Math.abs(p2y - p1y);
    const grp = group({
      class: "mo-component",
      "data-name": comp.name,
      "data-line": String(comp.sourceLine),
      cursor: "pointer"
    });
    let rect = null;
    const iconExtent = comp.resolvedIconCoordinateSystem?.extent ?? [[-100, -100], [100, 100]];
    const hasResolvedIcon = !!comp.resolvedIconGraphics && comp.resolvedIconGraphics.length > 0;
    if (hasResolvedIcon) {
      const componentExtent = [[ox_mo + ex1, oy_mo + ey1], [ox_mo + ex2, oy_mo + ey2]];
      for (const iconGraphic of comp.resolvedIconGraphics) {
        if (iconGraphic.visible === false)
          continue;
        const mapped = mapIconGraphicToComponent(iconGraphic, iconExtent, componentExtent);
        grp.appendChild(renderGraphic(mapped, vb, svgW, svgH, defs));
      }
    } else {
      rect = el("rect", {
        x,
        y,
        width: w,
        height: h,
        rx: 4,
        ry: 4,
        fill: "#e8f4fd",
        stroke: "#2196f3",
        "stroke-width": Math.max(1, w * 0.02)
      });
      grp.appendChild(rect);
    }
    const shortType = comp.typeName.includes(".") ? comp.typeName.split(".").pop() : comp.typeName;
    const fontSize = Math.max(6, Math.min(h * 0.25, w / Math.max(1, shortType.length) * 1.4));
    const typeLabel = el("text", {
      x: x + w / 2,
      y: y + h * 0.38,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-size": fontSize,
      fill: "#555",
      "font-style": "italic"
    });
    typeLabel.textContent = shortType;
    const nameLabel = el("text", {
      x: x + w / 2,
      y: y + h * 0.65,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-size": fontSize * 1.1,
      fill: "#1565c0",
      "font-weight": "bold"
    });
    nameLabel.textContent = comp.name;
    const highlight = el("rect", {
      x,
      y,
      width: w,
      height: h,
      rx: 4,
      ry: 4,
      fill: "rgba(33,150,243,0.15)",
      stroke: "none",
      class: "mo-hover-highlight"
    });
    highlight.style.opacity = "0";
    grp.appendChild(typeLabel);
    grp.appendChild(nameLabel);
    grp.appendChild(highlight);
    if (transformation.rotation !== 0) {
      const cxSvg = (p1x + p2x) / 2;
      const cySvg = (p1y + p2y) / 2;
      grp.setAttribute("transform", `rotate(${-transformation.rotation}, ${cxSvg}, ${cySvg})`);
    }
    grp.addEventListener("click", () => {
      vscode.postMessage({ type: "navigate", componentName: comp.name, line: comp.sourceLine });
    });
    grp.addEventListener("mouseenter", () => {
      highlight.style.opacity = "1";
      if (rect) {
        rect.style.stroke = "#1565c0";
      }
    });
    grp.addEventListener("mouseleave", () => {
      highlight.style.opacity = "0";
      if (rect) {
        rect.style.stroke = "#2196f3";
      }
    });
    return grp;
  }
  function renderConnection(conn, vb, svgW, svgH, defs) {
    const grp = group({ class: "mo-connection" });
    if (conn.line.points.length === 0) {
      return grp;
    }
    const lineEl = renderLine(conn.line, vb, svgW, svgH, defs);
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = `${conn.from} \u2192 ${conn.to}`;
    grp.appendChild(title);
    grp.appendChild(lineEl);
    return grp;
  }
  function render(m) {
    _fillDefCount = 0;
    const titleEl = document.getElementById("toolbar-title");
    if (titleEl)
      titleEl.textContent = m.className;
    const emptyState = document.getElementById("empty-state");
    if (emptyState)
      emptyState.style.display = "none";
    const container = document.getElementById("svg-container");
    const existing = container.querySelector("svg");
    if (existing)
      existing.remove();
    const svgW = DIAGRAM_W;
    const svgH = DIAGRAM_H;
    const svgEl = el("svg", {
      viewBox: `0 0 ${svgW} ${svgH}`,
      preserveAspectRatio: "xMidYMid meet",
      xmlns: SVG_NS
    });
    const defs = el("defs", {});
    svgEl.appendChild(defs);
    const isIconLayer = currentLayer === "icon" && !!m.icon;
    const layer = currentLayer === "icon" && m.icon ? m.icon : m.diagram;
    const declaredVb = makeViewBox(layer.coordinateSystem);
    const bounds = computeActualBounds(m, layer, !isIconLayer);
    let vb;
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
    const root = group({ id: "root", transform: `translate(${panX},${panY}) scale(${zoom})` });
    svgEl.appendChild(root);
    root.appendChild(el("rect", { x: 0, y: 0, width: svgW, height: svgH, fill: "white" }));
    const diagramLayer = group({ class: "mo-diagram-layer" });
    for (const g of layer.graphics) {
      if (g.visible !== false) {
        diagramLayer.appendChild(renderGraphic(g, vb, svgW, svgH, defs));
      }
    }
    root.appendChild(diagramLayer);
    if (!isIconLayer) {
      const componentLayer = group({ class: "mo-component-layer" });
      for (const comp of m.components) {
        if (comp.visible !== false) {
          componentLayer.appendChild(renderComponent(comp, vb, svgW, svgH, defs));
        }
      }
      root.appendChild(componentLayer);
      const connectionLayer = group({ class: "mo-connection-layer" });
      for (const conn of m.connections) {
        connectionLayer.appendChild(renderConnection(conn, vb, svgW, svgH, defs));
      }
      root.appendChild(connectionLayer);
    }
    const title = el("text", {
      x: 10,
      y: 20,
      "font-size": 14,
      fill: "#333",
      "font-family": "sans-serif"
    });
    title.textContent = m.className;
    svgEl.appendChild(title);
    container.appendChild(svgEl);
    setupPanZoom(svgEl, root);
  }
  function getMouseInSVG(svgEl, clientX, clientY) {
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const t = pt.matrixTransform(ctm.inverse());
      return { x: t.x, y: t.y };
    }
    const rect = svgEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * DIAGRAM_W / (rect.width || DIAGRAM_W),
      y: (clientY - rect.top) * DIAGRAM_H / (rect.height || DIAGRAM_H)
    };
  }
  function setupPanZoom(svgEl, root) {
    svgEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const mouse = getMouseInSVG(svgEl, e.clientX, e.clientY);
      panX = mouse.x - (mouse.x - panX) * factor;
      panY = mouse.y - (mouse.y - panY) * factor;
      zoom *= factor;
      root.setAttribute("transform", `translate(${panX},${panY}) scale(${zoom})`);
    }, { passive: false });
    svgEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0)
        return;
      const target = e.target;
      if (target.closest(".mo-component"))
        return;
      isPanning = true;
      const mouse = getMouseInSVG(svgEl, e.clientX, e.clientY);
      panStartX = mouse.x;
      panStartY = mouse.y;
      panStartPanX = panX;
      panStartPanY = panY;
      svgEl.style.cursor = "grabbing";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!isPanning)
        return;
      const svg = document.querySelector("svg");
      if (!svg)
        return;
      const mouse = getMouseInSVG(svg, e.clientX, e.clientY);
      panX = panStartPanX + (mouse.x - panStartX);
      panY = panStartPanY + (mouse.y - panStartY);
      root.setAttribute("transform", `translate(${panX},${panY}) scale(${zoom})`);
    });
    window.addEventListener("mouseup", () => {
      if (isPanning) {
        isPanning = false;
        const svg = document.querySelector("svg");
        if (svg)
          svg.style.cursor = "grab";
      }
    });
    svgEl.addEventListener("dblclick", (e) => {
      const target = e.target;
      if (target.closest(".mo-component"))
        return;
      panX = 0;
      panY = 0;
      zoom = 1;
      root.setAttribute("transform", `translate(0,0) scale(1)`);
    });
    svgEl.style.cursor = "grab";
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "update":
        if (msg.model) {
          currentModel = msg.model;
          panX = 0;
          panY = 0;
          zoom = 1;
          render(currentModel);
          showStatus("");
        }
        break;
      case "error":
        showError(msg.error ?? "Unknown error");
        break;
      case "loading":
        showStatus("Parsing\u2026");
        break;
    }
  });
  function showStatus(msg) {
    const el2 = document.getElementById("status");
    if (!el2)
      return;
    el2.textContent = msg;
    el2.style.display = msg ? "block" : "none";
  }
  function showError(msg) {
    const el2 = document.getElementById("error");
    if (!el2)
      return;
    el2.textContent = msg;
    el2.style.display = "block";
    setTimeout(() => {
      el2.style.display = "none";
    }, 5e3);
  }
  var currentLayer = "diagram";
  function wireToolbar() {
    document.getElementById("btn-reset")?.addEventListener("click", () => {
      panX = 0;
      panY = 0;
      zoom = 1;
      const root = document.getElementById("root");
      if (root)
        root.setAttribute("transform", "translate(0,0) scale(1)");
    });
    document.getElementById("btn-layer")?.addEventListener("click", () => {
      currentLayer = currentLayer === "diagram" ? "icon" : "diagram";
      const btn = document.getElementById("btn-layer");
      if (btn) {
        btn.textContent = currentLayer === "diagram" ? "\u229E Diagram" : "\u22A1 Icon";
      }
      if (currentModel)
        render(currentModel);
    });
  }
  wireToolbar();
})();
//# sourceMappingURL=renderer.js.map
