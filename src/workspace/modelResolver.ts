import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseModelicaFile } from '../parser/modelicaParser';
import { DiagramModel, DiagramComponent, Graphic } from '../model/diagramModel';

interface ModelIndexEntry {
  filePath: string;
  className: string;
  fullName?: string;
  packageName?: string;
}

interface ParsedFileCache {
  mtimeMs: number;
  model: DiagramModel;
}

interface IndexCache {
  key: string;
  entries: ModelIndexEntry[];
}

type ResolutionState = 'resolved' | 'unresolved' | 'ambiguous';

function normalizeTypeName(typeName: string): string {
  return typeName.replace(/^\./, '').trim();
}

function extractWithinPackage(content: string): string | undefined {
  const withinMatch = content.match(/\bwithin\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/);
  return withinMatch?.[1];
}

function extractClasses(content: string): Array<{ className: string; fullName?: string; packageName?: string }> {
  const withinPackage = extractWithinPackage(content);
  const classRe = /\b(model|class|block|connector|record|package)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const out: Array<{ className: string; fullName?: string; packageName?: string }> = [];

  let m: RegExpExecArray | null;
  while ((m = classRe.exec(content)) !== null) {
    const className = m[2];
    const fullName = withinPackage ? `${withinPackage}.${className}` : className;
    out.push({ className, fullName, packageName: withinPackage });
  }
  return out;
}

function commonPathPrefixLength(a: string, b: string): number {
  const ap = path.resolve(a).split(path.sep);
  const bp = path.resolve(b).split(path.sep);
  let i = 0;
  while (i < ap.length && i < bp.length && ap[i].toLowerCase() === bp[i].toLowerCase()) {
    i++;
  }
  return i;
}

export class WorkspaceModelResolver {
  private parsedFileCache = new Map<string, ParsedFileCache>();
  private iconCache = new Map<string, { mtimeMs: number; graphics: Graphic[] }>();
  private indexCache?: IndexCache;

  public async enrichModelComponents(
    diagramModel: DiagramModel,
    contextText: string
  ): Promise<DiagramModel> {
    const entries = await this.getWorkspaceIndex();
    if (entries.length === 0) {
      return diagramModel;
    }

    const contextDir = path.dirname(diagramModel.filePath);
    const contextPackage = extractWithinPackage(contextText);
    const enrichedComponents: DiagramComponent[] = [];

    for (const component of diagramModel.components) {
      const resolution = this.resolveComponentType(component.typeName, contextDir, contextPackage, entries);
      if (!resolution.filePath) {
        enrichedComponents.push({
          ...component,
          resolutionState: resolution.state,
        });
        continue;
      }

      const iconGraphics = this.getModelIconGraphics(resolution.filePath);
      if (iconGraphics.length === 0) {
        const parsed = this.getParsedFileModel(resolution.filePath);
        enrichedComponents.push({
          ...component,
          resolvedTypePath: resolution.filePath,
          resolvedIconCoordinateSystem: parsed.icon?.coordinateSystem,
          resolutionState: 'unresolved',
        });
        continue;
      }

      const parsed = this.getParsedFileModel(resolution.filePath);
      enrichedComponents.push({
        ...component,
        resolvedTypePath: resolution.filePath,
        resolvedIconGraphics: iconGraphics,
        resolvedIconCoordinateSystem: parsed.icon?.coordinateSystem,
        resolutionState: 'resolved',
      });
    }

    return {
      ...diagramModel,
      components: enrichedComponents,
    };
  }

  private resolveComponentType(
    typeName: string,
    contextDir: string,
    contextPackage: string | undefined,
    entries: ModelIndexEntry[]
  ): { filePath?: string; state: ResolutionState } {
    const normalized = normalizeTypeName(typeName);
    const shortName = normalized.split('.').pop() ?? normalized;

    const candidates = entries.filter((entry) => {
      if (entry.fullName && entry.fullName === normalized) return true;
      if (entry.className === normalized) return true;
      if (entry.className === shortName) return true;
      return false;
    });

    if (candidates.length === 0) {
      return { state: 'unresolved' };
    }

    const ranked = [...candidates].sort((a, b) => {
      const aDir = path.dirname(a.filePath);
      const bDir = path.dirname(b.filePath);

      const aSameDir = aDir.toLowerCase() === contextDir.toLowerCase() ? 1 : 0;
      const bSameDir = bDir.toLowerCase() === contextDir.toLowerCase() ? 1 : 0;
      if (aSameDir !== bSameDir) return bSameDir - aSameDir;

      const aPackageMatch = a.packageName && contextPackage && a.packageName === contextPackage ? 1 : 0;
      const bPackageMatch = b.packageName && contextPackage && b.packageName === contextPackage ? 1 : 0;
      if (aPackageMatch !== bPackageMatch) return bPackageMatch - aPackageMatch;

      const aPrefix = commonPathPrefixLength(aDir, contextDir);
      const bPrefix = commonPathPrefixLength(bDir, contextDir);
      if (aPrefix !== bPrefix) return bPrefix - aPrefix;

      return a.filePath.localeCompare(b.filePath);
    });

    if (ranked.length > 1) {
      const first = ranked[0];
      const second = ranked[1];
      const firstDir = path.dirname(first.filePath).toLowerCase();
      const secondDir = path.dirname(second.filePath).toLowerCase();
      const firstScore = commonPathPrefixLength(firstDir, contextDir.toLowerCase());
      const secondScore = commonPathPrefixLength(secondDir, contextDir.toLowerCase());
      if (firstScore === secondScore && firstDir !== contextDir.toLowerCase() && secondDir !== contextDir.toLowerCase()) {
        return { state: 'ambiguous' };
      }
    }

    return { filePath: ranked[0].filePath, state: 'resolved' };
  }

  private getModelIconGraphics(filePath: string): Graphic[] {
    try {
      const stat = fs.statSync(filePath);
      const cached = this.iconCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.graphics;
      }

      const parsed = this.getParsedFileModel(filePath);
      const graphics = parsed.icon?.graphics ?? [];
      this.iconCache.set(filePath, { mtimeMs: stat.mtimeMs, graphics });
      return graphics;
    } catch {
      return [];
    }
  }

  private getParsedFileModel(filePath: string): DiagramModel {
    const stat = fs.statSync(filePath);
    const cached = this.parsedFileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.model;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const model = parseModelicaFile(content, filePath);
    this.parsedFileCache.set(filePath, { mtimeMs: stat.mtimeMs, model });
    return model;
  }

  private async getWorkspaceIndex(): Promise<ModelIndexEntry[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return [];
    }

    const key = folders.map((f) => f.uri.fsPath).sort().join('|');
    if (this.indexCache?.key === key) {
      return this.indexCache.entries;
    }

    const entries: ModelIndexEntry[] = [];
    const files = await vscode.workspace.findFiles('**/*.mo', '**/{.git,node_modules,dist,out,build}/**');
    for (const uri of files) {
      const filePath = uri.fsPath;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const classDefs = extractClasses(content);
        for (const cls of classDefs) {
          entries.push({
            filePath,
            className: cls.className,
            fullName: cls.fullName,
            packageName: cls.packageName,
          });
        }
      } catch {
        // Ignore unreadable files and continue indexing.
      }
    }

    this.indexCache = { key, entries };
    return entries;
  }
}

