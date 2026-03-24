"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));

// src/model/diagramModel.ts
var DEFAULT_COORDINATE_SYSTEM = {
  extent: [[-100, -100], [100, 100]],
  preserveAspectRatio: true
};

// src/parser/annotationParser.ts
function skip(c) {
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos];
    if (ch === " " || ch === "	" || ch === "\r" || ch === "\n") {
      c.pos++;
    } else if (c.src[c.pos] === "/" && c.src[c.pos + 1] === "/") {
      while (c.pos < c.src.length && c.src[c.pos] !== "\n")
        c.pos++;
    } else if (c.src[c.pos] === "/" && c.src[c.pos + 1] === "*") {
      c.pos += 2;
      const end = c.src.indexOf("*/", c.pos);
      c.pos = end === -1 ? c.src.length : end + 2;
    } else {
      break;
    }
  }
}
function isAlpha(ch) {
  return /[a-zA-Z_]/.test(ch);
}
function isAlphaNum(ch) {
  return /[a-zA-Z0-9_]/.test(ch);
}
function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}
function readIdent(c) {
  let s = "";
  while (c.pos < c.src.length && isAlphaNum(c.src[c.pos])) {
    s += c.src[c.pos++];
  }
  return s;
}
function readIdentPath(c) {
  let path2 = readIdent(c);
  while (c.pos < c.src.length && c.src[c.pos] === "." && c.pos + 1 < c.src.length && isAlpha(c.src[c.pos + 1])) {
    c.pos++;
    path2 += "." + readIdent(c);
  }
  return path2;
}
function readNumber(c) {
  let s = "";
  while (c.pos < c.src.length && isDigit(c.src[c.pos]))
    s += c.src[c.pos++];
  if (c.pos < c.src.length && c.src[c.pos] === ".") {
    s += c.src[c.pos++];
    while (c.pos < c.src.length && isDigit(c.src[c.pos]))
      s += c.src[c.pos++];
  }
  if (c.pos < c.src.length && (c.src[c.pos] === "e" || c.src[c.pos] === "E")) {
    s += c.src[c.pos++];
    if (c.pos < c.src.length && (c.src[c.pos] === "+" || c.src[c.pos] === "-")) {
      s += c.src[c.pos++];
    }
    while (c.pos < c.src.length && isDigit(c.src[c.pos]))
      s += c.src[c.pos++];
  }
  return parseFloat(s);
}
function readString(c) {
  c.pos++;
  let s = "";
  while (c.pos < c.src.length && c.src[c.pos] !== '"') {
    if (c.src[c.pos] === "\\" && c.pos + 1 < c.src.length) {
      c.pos++;
      const esc = c.src[c.pos++];
      switch (esc) {
        case "n":
          s += "\n";
          break;
        case "t":
          s += "	";
          break;
        case '"':
          s += '"';
          break;
        case "\\":
          s += "\\";
          break;
        default:
          s += esc;
      }
    } else {
      s += c.src[c.pos++];
    }
  }
  if (c.pos < c.src.length)
    c.pos++;
  return s;
}
function parseExpr(c) {
  skip(c);
  if (c.pos >= c.src.length)
    return { kind: "ident", value: "" };
  const ch = c.src[c.pos];
  if (ch === "-") {
    c.pos++;
    const inner = parseExpr(c);
    if (inner.kind === "number")
      return { kind: "number", value: -inner.value };
    return { kind: "number", value: 0 };
  }
  if (ch === "{") {
    c.pos++;
    const items = [];
    skip(c);
    while (c.pos < c.src.length && c.src[c.pos] !== "}") {
      items.push(parseExpr(c));
      skip(c);
      if (c.pos < c.src.length && c.src[c.pos] === ",")
        c.pos++;
      skip(c);
    }
    if (c.pos < c.src.length)
      c.pos++;
    return { kind: "array", items };
  }
  if (ch === '"')
    return { kind: "string", value: readString(c) };
  if (isDigit(ch))
    return { kind: "number", value: readNumber(c) };
  if (isAlpha(ch)) {
    const name = readIdentPath(c);
    skip(c);
    if (c.pos < c.src.length && c.src[c.pos] === "(") {
      c.pos++;
      const args = parseArgList(c, ")");
      if (c.pos < c.src.length && c.src[c.pos] === ")")
        c.pos++;
      return { kind: "record", name, args };
    }
    return { kind: "ident", value: name };
  }
  c.pos++;
  return { kind: "ident", value: "" };
}
function parseArgList(c, terminator) {
  const args = {};
  let idx = 0;
  skip(c);
  while (c.pos < c.src.length && c.src[c.pos] !== terminator) {
    skip(c);
    if (c.pos >= c.src.length || c.src[c.pos] === terminator)
      break;
    const savedPos = c.pos;
    if (isAlpha(c.src[c.pos])) {
      const name = readIdent(c);
      skip(c);
      if (c.pos < c.src.length && c.src[c.pos] === "=") {
        c.pos++;
        skip(c);
        args[name] = parseExpr(c);
      } else if (c.pos < c.src.length && c.src[c.pos] === "(") {
        c.pos = savedPos;
        const val = parseExpr(c);
        if (val.kind === "record") {
          const key = val.name.includes(".") ? val.name.split(".").pop() : val.name;
          args[key] = val;
        } else {
          args[String(idx++)] = val;
        }
      } else {
        c.pos = savedPos;
        const val = parseExpr(c);
        args[String(idx++)] = val;
      }
    } else {
      const val = parseExpr(c);
      if (val.kind === "record") {
        const key = val.name.includes(".") ? val.name.split(".").pop() : val.name;
        args[key] = val;
      } else {
        args[String(idx++)] = val;
      }
    }
    skip(c);
    if (c.pos < c.src.length && c.src[c.pos] === ",")
      c.pos++;
    skip(c);
  }
  return args;
}
function parseAnnotationContent(src) {
  const c = { src, pos: 0 };
  return parseArgList(c, "\0");
}
function getNum(v, def = 0) {
  if (!v)
    return def;
  if (v.kind === "number")
    return v.value;
  return def;
}
function getStr(v, def = "") {
  if (!v)
    return def;
  if (v.kind === "string")
    return v.value;
  if (v.kind === "ident")
    return v.value;
  return def;
}
function getBool(v, def = true) {
  if (!v)
    return def;
  if (v.kind === "ident")
    return v.value !== "false";
  return def;
}
function getEnumSuffix(v, def = "") {
  const s = getStr(v, def);
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s || def;
}
function getPoint(v) {
  if (!v)
    return [0, 0];
  if (v.kind === "array" && v.items.length >= 2) {
    return [getNum(v.items[0]), getNum(v.items[1])];
  }
  return [0, 0];
}
function getExtent(v) {
  if (!v)
    return [[-100, -100], [100, 100]];
  if (v.kind === "array" && v.items.length >= 2) {
    return [getPoint(v.items[0]), getPoint(v.items[1])];
  }
  return [[-100, -100], [100, 100]];
}
function getColor(v) {
  if (!v)
    return [0, 0, 0];
  if (v.kind === "array" && v.items.length >= 3) {
    return [getNum(v.items[0]), getNum(v.items[1]), getNum(v.items[2])];
  }
  return [0, 0, 0];
}
function getArrow(v) {
  if (!v)
    return ["None", "None"];
  if (v.kind === "array" && v.items.length >= 2) {
    return [getEnumSuffix(v.items[0], "None"), getEnumSuffix(v.items[1], "None")];
  }
  return ["None", "None"];
}
function getRecordArgs(v) {
  if (!v || v.kind !== "record")
    return {};
  return v.args;
}

// src/parser/modelicaParser.ts
function findBalancedClose(src, open) {
  let depth = 1;
  let i = open + 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\")
          i++;
        i++;
      }
      i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n")
        i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      const end = src.indexOf("*/", i);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "(")
      depth++;
    else if (c === ")")
      depth--;
    if (depth > 0)
      i++;
    else
      break;
  }
  return i;
}
function lineAt(src, pos) {
  let n = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === "\n")
      n++;
  }
  return n;
}
function findAnnotations(src) {
  const results = [];
  const re = /\bannotation\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closePos = findBalancedClose(src, openParen);
    const content = src.slice(openParen + 1, closePos);
    let prefixStart = openParen;
    while (prefixStart > 0 && src[prefixStart - 1] !== ";" && src[prefixStart - 1] !== "{" && src[prefixStart - 1] !== "}") {
      prefixStart--;
    }
    const statementPrefix = src.slice(prefixStart, m.index).trim();
    results.push({
      content,
      openParen,
      statementPrefix,
      line: lineAt(src, m.index)
    });
    re.lastIndex = closePos + 1;
  }
  return results;
}
function findConnects(src) {
  const results = [];
  const re = /\bconnect\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const closePos = findBalancedClose(src, openParen);
    const inner = src.slice(openParen + 1, closePos).trim();
    let depth = 0;
    let splitAt = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === "(")
        depth++;
      else if (inner[i] === ")")
        depth--;
      else if (inner[i] === "," && depth === 0) {
        splitAt = i;
        break;
      }
    }
    if (splitAt < 0) {
      re.lastIndex = closePos + 1;
      continue;
    }
    const from = inner.slice(0, splitAt).trim();
    const to = inner.slice(splitAt + 1).trim();
    let annotContent;
    const after = src.slice(closePos + 1, src.indexOf(";", closePos + 1));
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
function findClassName(src) {
  const re = /\b(model|class|block|connector|record|package)\s+([A-Za-z_][A-Za-z0-9_]*)/;
  const m = re.exec(src);
  return m ? m[2] : "Unknown";
}
function makeDefaultGraphicBase() {
  return { visible: true, origin: [0, 0], rotation: 0 };
}
function extractGraphicBase(args) {
  return {
    visible: getBool(args["visible"], true),
    origin: getPoint(args["origin"]),
    rotation: getNum(args["rotation"], 0)
  };
}
function extractFilledShape(args) {
  return {
    ...extractGraphicBase(args),
    lineColor: getColor(args["lineColor"]),
    fillColor: getColor(args["fillColor"]),
    pattern: getEnumSuffix(args["pattern"], "Solid") || "Solid",
    fillPattern: getEnumSuffix(args["fillPattern"], "None") || "None",
    lineThickness: getNum(args["lineThickness"], 0.25)
  };
}
function extractLineGraphic(args) {
  const pointsVal = args["points"];
  const points = [];
  if (pointsVal?.kind === "array") {
    for (const item of pointsVal.items) {
      points.push(getPoint(item));
    }
  }
  const arrowVal = getArrow(args["arrow"]);
  return {
    ...extractGraphicBase(args),
    type: "Line",
    points,
    color: getColor(args["color"]),
    pattern: getEnumSuffix(args["pattern"], "Solid") || "Solid",
    thickness: getNum(args["thickness"], 0.25),
    arrow: [arrowVal[0], arrowVal[1]],
    arrowSize: getNum(args["arrowSize"], 3),
    smooth: getEnumSuffix(args["smooth"], "None") || "None"
  };
}
function extractRectangleGraphic(args) {
  return {
    ...extractFilledShape(args),
    type: "Rectangle",
    extent: getExtent(args["extent"]),
    radius: getNum(args["radius"], 0)
  };
}
function extractEllipseGraphic(args) {
  return {
    ...extractFilledShape(args),
    type: "Ellipse",
    extent: getExtent(args["extent"]),
    startAngle: getNum(args["startAngle"], 0),
    endAngle: getNum(args["endAngle"], 360)
  };
}
function extractPolygonGraphic(args) {
  const pointsVal = args["points"];
  const points = [];
  if (pointsVal?.kind === "array") {
    for (const item of pointsVal.items)
      points.push(getPoint(item));
  }
  return {
    ...extractFilledShape(args),
    type: "Polygon",
    points,
    smooth: getEnumSuffix(args["smooth"], "None") || "None"
  };
}
function extractTextGraphic(args) {
  const stylesVal = args["textStyle"];
  const textStyle = [];
  if (stylesVal?.kind === "array") {
    for (const item of stylesVal.items) {
      const s = getEnumSuffix(item, "");
      if (s === "Bold" || s === "Italic" || s === "UnderLine")
        textStyle.push(s);
    }
  }
  return {
    ...extractGraphicBase(args),
    type: "Text",
    extent: getExtent(args["extent"]),
    textString: getStr(args["textString"], ""),
    fontSize: getNum(args["fontSize"], 0),
    textColor: getColor(args["textColor"]),
    horizontalAlignment: getEnumSuffix(args["horizontalAlignment"], "Center") || "Center",
    textStyle
  };
}
function extractBitmapGraphic(args) {
  return {
    ...extractGraphicBase(args),
    type: "Bitmap",
    extent: getExtent(args["extent"]),
    fileName: getStr(args["fileName"], ""),
    imageSource: getStr(args["imageSource"], "")
  };
}
function extractGraphic(name, args) {
  switch (name) {
    case "Line":
      return extractLineGraphic(args);
    case "Rectangle":
      return extractRectangleGraphic(args);
    case "Ellipse":
      return extractEllipseGraphic(args);
    case "Polygon":
      return extractPolygonGraphic(args);
    case "Text":
      return extractTextGraphic(args);
    case "Bitmap":
      return extractBitmapGraphic(args);
    default:
      return null;
  }
}
function extractGraphicsList(v) {
  if (!v || v.kind !== "array")
    return [];
  const graphics = [];
  for (const item of v.items) {
    if (item.kind === "record") {
      const g = extractGraphic(item.name, item.args);
      if (g)
        graphics.push(g);
    }
  }
  return graphics;
}
function extractCoordinateSystem(v) {
  if (!v)
    return DEFAULT_COORDINATE_SYSTEM;
  const args = getRecordArgs(v);
  return {
    extent: getExtent(args["extent"]),
    preserveAspectRatio: getBool(args["preserveAspectRatio"], true)
  };
}
function extractLayerAnnotation(args) {
  return {
    coordinateSystem: extractCoordinateSystem(args["coordinateSystem"]),
    graphics: extractGraphicsList(args["graphics"])
  };
}
function extractTransformation(v) {
  if (!v || v.kind !== "record") {
    return { extent: [[-10, -10], [10, 10]], rotation: 0, origin: [0, 0] };
  }
  const args = v.args;
  return {
    extent: getExtent(args["extent"]),
    rotation: getNum(args["rotation"], 0),
    origin: getPoint(args["origin"])
  };
}
function inferComponentFromPrefix(prefix) {
  const clean = prefix.replace(/\s+/g, " ").trim();
  const noMod = clean.replace(/\([^)]*\)\s*$/, "").trim();
  const parts = noMod.split(/\s+/);
  if (parts.length < 2)
    return null;
  const name = parts[parts.length - 1];
  const typeName = parts[parts.length - 2];
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    return null;
  if (!/^\.?[A-Za-z_][A-Za-z0-9_.]*$/.test(typeName))
    return null;
  return { typeName, name };
}
function parseModelicaFile(content, filePath) {
  const className = findClassName(content);
  const components = [];
  const connections = [];
  let diagram = {
    coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
    graphics: []
  };
  let icon;
  const annotations = findAnnotations(content);
  for (const raw of annotations) {
    const parsed = parseAnnotationContent(raw.content);
    if (parsed["Diagram"]) {
      const diagramArgs = getRecordArgs(parsed["Diagram"]);
      diagram = extractLayerAnnotation(diagramArgs);
    }
    if (parsed["Icon"]) {
      const iconArgs = getRecordArgs(parsed["Icon"]);
      icon = extractLayerAnnotation(iconArgs);
    }
    if (parsed["Placement"]) {
      const placementArgs = getRecordArgs(parsed["Placement"]);
      const transformation = extractTransformation(placementArgs["transformation"]);
      const visible = getBool(placementArgs["visible"], true);
      const info = inferComponentFromPrefix(raw.statementPrefix);
      if (info) {
        components.push({
          name: info.name,
          typeName: info.typeName,
          transformation,
          visible,
          sourceLine: raw.line
        });
      }
    }
  }
  const connects = findConnects(content);
  for (const raw of connects) {
    let line = {
      ...makeDefaultGraphicBase(),
      type: "Line",
      points: [],
      color: [0, 0, 0],
      pattern: "Solid",
      thickness: 0.25,
      arrow: ["None", "None"],
      arrowSize: 3,
      smooth: "None"
    };
    if (raw.annotationContent) {
      const annArgs = parseAnnotationContent(raw.annotationContent);
      if (annArgs["Line"] && annArgs["Line"].kind === "record") {
        line = extractLineGraphic(annArgs["Line"].args);
      }
    }
    connections.push({ from: raw.from, to: raw.to, line });
  }
  return { className, filePath, diagram, icon, components, connections };
}

// src/extension.ts
var previewPanel;
var currentDocumentUri;
var debounceTimer;
var previewStatusBar;
function isModelicaDocument(doc) {
  return doc.languageId === "modelica" || doc.fileName.endsWith(".mo");
}
function syncPreviewStatusBar(context, editor) {
  if (!previewStatusBar) {
    previewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    previewStatusBar.command = "modelica-preview.showPreview";
    previewStatusBar.tooltip = "Show Modelica diagram preview";
    context.subscriptions.push(previewStatusBar);
  }
  if (editor && isModelicaDocument(editor.document)) {
    previewStatusBar.text = "$(open-preview) Modelica Preview";
    previewStatusBar.show();
  } else {
    previewStatusBar.hide();
  }
}
function activate(context) {
  const showPreviewCmd = vscode.commands.registerCommand(
    "modelica-preview.showPreview",
    () => showPreview(context)
  );
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (isModelicaDocument(doc)) {
      if (previewPanel && currentDocumentUri?.fsPath === doc.uri.fsPath) {
        scheduleUpdate(doc.uri, context);
      }
    }
  });
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (isModelicaDocument(event.document)) {
      if (previewPanel && currentDocumentUri?.fsPath === event.document.uri.fsPath) {
        scheduleUpdate(event.document.uri, context, event.document.getText());
      }
    }
  });
  const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
    syncPreviewStatusBar(context, editor);
    if (!editor)
      return;
    if (isModelicaDocument(editor.document)) {
      if (previewPanel) {
        currentDocumentUri = editor.document.uri;
        scheduleUpdate(editor.document.uri, context, editor.document.getText());
      }
    }
  });
  syncPreviewStatusBar(context, vscode.window.activeTextEditor);
  context.subscriptions.push(showPreviewCmd, onSave, onChange, onActiveEditorChange);
}
function deactivate() {
  previewPanel?.dispose();
}
function showPreview(context) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Open a Modelica (.mo) file first.");
    return;
  }
  if (!editor.document.fileName.endsWith(".mo") && editor.document.languageId !== "modelica") {
    vscode.window.showWarningMessage("Active file is not a Modelica (.mo) file.");
    return;
  }
  currentDocumentUri = editor.document.uri;
  if (previewPanel) {
    previewPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    previewPanel = vscode.window.createWebviewPanel(
      "modelicaPreview",
      "Modelica Preview",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "out"))
        ]
      }
    );
    previewPanel.webview.html = buildWebviewHtml(previewPanel.webview, context);
    previewPanel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === "navigate" && currentDocumentUri) {
          navigateToComponent(currentDocumentUri, msg.line ?? 0);
        }
      },
      void 0,
      context.subscriptions
    );
    previewPanel.onDidDispose(() => {
      previewPanel = void 0;
      currentDocumentUri = void 0;
    }, null, context.subscriptions);
  }
  scheduleUpdate(editor.document.uri, context, editor.document.getText());
}
function scheduleUpdate(uri, context, content) {
  if (debounceTimer)
    clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => updatePreview(uri, content), 300);
}
function updatePreview(uri, content) {
  if (!previewPanel)
    return;
  previewPanel.webview.postMessage({ type: "loading" });
  try {
    const text = content ?? fs.readFileSync(uri.fsPath, "utf8");
    const diagramModel = parseModelicaFile(text, uri.fsPath);
    previewPanel.title = `Preview: ${diagramModel.className}`;
    previewPanel.webview.postMessage({ type: "update", model: diagramModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    previewPanel.webview.postMessage({ type: "error", error: `Parse error: ${msg}` });
  }
}
async function navigateToComponent(docUri, line) {
  const lineIndex = Math.max(0, line - 1);
  const doc = await vscode.workspace.openTextDocument(docUri);
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}
function buildWebviewHtml(webview, context) {
  const rendererUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, "out", "webview", "renderer.js"))
  );
  const htmlPath = path.join(context.extensionPath, "out", "webview", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
  html = html.replace(/\{\{rendererUri\}\}/g, rendererUri.toString());
  return html;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
