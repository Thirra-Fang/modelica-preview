import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseModelicaFile } from './parser/modelicaParser';
import { DiagramModel } from './model/diagramModel';

// ── WebView panel management ───────────────────────────────────────────────

let previewPanel: vscode.WebviewPanel | undefined;
let currentDocumentUri: vscode.Uri | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Register the show-preview command
  const showPreviewCmd = vscode.commands.registerCommand(
    'modelica-preview.showPreview',
    () => showPreview(context)
  );

  // Auto-update when a .mo file is saved
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.languageId === 'modelica' || doc.fileName.endsWith('.mo')) {
      if (previewPanel && currentDocumentUri?.fsPath === doc.uri.fsPath) {
        scheduleUpdate(doc.uri, context);
      }
    }
  });

  // Auto-update as the user types (debounced 600ms)
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.languageId === 'modelica' || event.document.fileName.endsWith('.mo')) {
      if (previewPanel && currentDocumentUri?.fsPath === event.document.uri.fsPath) {
        scheduleUpdate(event.document.uri, context, event.document.getText());
      }
    }
  });

  // Track which editor is active; refresh preview if user switches to a .mo file
  const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) return;
    if (editor.document.languageId === 'modelica' || editor.document.fileName.endsWith('.mo')) {
      if (previewPanel) {
        currentDocumentUri = editor.document.uri;
        scheduleUpdate(editor.document.uri, context, editor.document.getText());
      }
    }
  });

  context.subscriptions.push(showPreviewCmd, onSave, onChange, onActiveEditorChange);
}

export function deactivate(): void {
  previewPanel?.dispose();
}

// ── Preview panel ──────────────────────────────────────────────────────────

function showPreview(context: vscode.ExtensionContext): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a Modelica (.mo) file first.');
    return;
  }
  if (!editor.document.fileName.endsWith('.mo') && editor.document.languageId !== 'modelica') {
    vscode.window.showWarningMessage('Active file is not a Modelica (.mo) file.');
    return;
  }

  currentDocumentUri = editor.document.uri;

  if (previewPanel) {
    // Reuse existing panel
    previewPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    previewPanel = vscode.window.createWebviewPanel(
      'modelicaPreview',
      'Modelica Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, 'out')),
        ],
      }
    );

    previewPanel.webview.html = buildWebviewHtml(previewPanel.webview, context);

    // Handle messages from the webview
    previewPanel.webview.onDidReceiveMessage(
      (msg: { type: string; componentName?: string; line?: number }) => {
        if (msg.type === 'navigate' && currentDocumentUri) {
          navigateToComponent(currentDocumentUri, msg.line ?? 0);
        }
      },
      undefined,
      context.subscriptions
    );

    previewPanel.onDidDispose(() => {
      previewPanel = undefined;
      currentDocumentUri = undefined;
    }, null, context.subscriptions);
  }

  // Send initial content
  scheduleUpdate(editor.document.uri, context, editor.document.getText());
}

// ── Update logic ───────────────────────────────────────────────────────────

function scheduleUpdate(
  uri: vscode.Uri,
  context: vscode.ExtensionContext,
  content?: string
): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => updatePreview(uri, content), 300);
}

function updatePreview(uri: vscode.Uri, content?: string): void {
  if (!previewPanel) return;

  previewPanel.webview.postMessage({ type: 'loading' });

  try {
    const text = content ?? fs.readFileSync(uri.fsPath, 'utf8');
    const diagramModel: DiagramModel = parseModelicaFile(text, uri.fsPath);

    // Update panel title
    previewPanel.title = `Preview: ${diagramModel.className}`;

    previewPanel.webview.postMessage({ type: 'update', model: diagramModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    previewPanel.webview.postMessage({ type: 'error', error: `Parse error: ${msg}` });
  }
}

// ── Navigate to component definition ──────────────────────────────────────

async function navigateToComponent(docUri: vscode.Uri, line: number): Promise<void> {
  const lineIndex = Math.max(0, line - 1); // convert 1-based to 0-based
  const doc = await vscode.workspace.openTextDocument(docUri);
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

// ── WebView HTML builder ───────────────────────────────────────────────────

function buildWebviewHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const rendererUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(context.extensionPath, 'out', 'webview', 'renderer.js'))
  );

  const htmlPath = path.join(context.extensionPath, 'out', 'webview', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Replace template placeholders
  html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
  html = html.replace(/\{\{rendererUri\}\}/g, rendererUri.toString());

  return html;
}
