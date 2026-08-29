/**
 * SLOPSHOP TypeScript Compiler AST Parser & Validation Engine
 * 
 * Uses the installed TypeScript compiler parser (ts.createSourceFile / AST visitor)
 * rather than regular expressions to:
 * 1. Validate JS/TS/TSX/JSX syntax strictly and report exact diagnostic lines & columns.
 * 2. Extract top-level exports, declarations, and imports from AST structures.
 * 3. Detect duplicate export identifier collisions and conflicting signatures.
 * 4. Verify structural integrity of code modifications before writing to disk.
 */

import ts from 'typescript';
import type { FileModification, ValidationError } from './slopshopPipeline.ts';
import { normalizeRelativePath } from './slopshopPipeline.ts';

export interface AstSyntaxError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: number;
}

export interface AstExportSymbol {
  readonly file: string;
  readonly name: string;
  readonly kind:
    | 'function'
    | 'class'
    | 'variable'
    | 'type'
    | 'interface'
    | 'enum'
    | 'namespace'
    | 'named'
    | 'default'
    | 'reexport';
  readonly isDefault?: boolean;
  readonly isTypeOnly?: boolean;
  readonly line?: number;
  readonly column?: number;
}

export interface AstImportSymbol {
  readonly file: string;
  readonly moduleSpecifier: string;
  readonly defaultImport?: string;
  readonly namedImports: readonly string[];
  readonly isTypeOnly?: boolean;
}

export interface AstValidationResult {
  readonly valid: boolean;
  readonly syntaxErrors: readonly AstSyntaxError[];
  readonly exports: readonly AstExportSymbol[];
  readonly imports: readonly AstImportSymbol[];
  readonly collisions: readonly ValidationError[];
  readonly errors: readonly ValidationError[];
}

export interface AstTransform {
  readonly path: string;
  readonly operation: 'append_statements' | 'replace_export';
  readonly content: string;
  readonly exportName?: string;
  readonly expectedFileSha256?: string;
}

export interface AstTransformResult {
  readonly content: string;
  readonly replacedRange?: { readonly start: number; readonly end: number };
}

/**
 * Determine TypeScript ScriptKind from file path
 */
export function getScriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.ts')) return ts.ScriptKind.TS;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.Unknown;
}

/**
 * Checks whether a file path has an extension parseable by TypeScript
 */
export function isTypeScriptParseable(filePath: string): boolean {
  const kind = getScriptKindForPath(filePath);
  return kind !== ts.ScriptKind.Unknown;
}

/**
 * Parse code content into a TypeScript SourceFile AST
 */
export function parseSourceToAst(filePath: string, content: string): ts.SourceFile {
  const scriptKind = getScriptKindForPath(filePath);
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true, // setParentNodes
    scriptKind
  );
}

function exportedNamesForStatement(statement: ts.Statement): string[] {
  if (!hasExportModifier(statement) && !ts.isExportAssignment(statement) && !ts.isExportDeclaration(statement)) return [];
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    return [hasDefaultModifier(statement) ? 'default' : statement.name?.text].filter((name): name is string => Boolean(name));
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap(declaration => extractBindingIdentifiers(declaration.name));
  }
  if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
    return [statement.name.getText()];
  }
  if (ts.isExportAssignment(statement)) return ['default'];
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    return statement.exportClause.elements.map(element => element.name.text);
  }
  return [];
}

/** Apply a bounded transform by locating syntax nodes, then reparse the complete result. */
export function transformSourceWithAst(filePath: string, source: string, transform: AstTransform): AstTransformResult {
  if (!isTypeScriptParseable(filePath)) throw new Error(`AST transforms require a JavaScript or TypeScript target: ${filePath}`);
  const sourceValidation = parseAndValidateSource(filePath, source);
  if (!sourceValidation.valid) throw new Error(`Target source is not syntactically valid: ${sourceValidation.errors.map(error => error.message).join('; ')}`);
  const snippetValidation = parseAndValidateSource(filePath, transform.content);
  if (!snippetValidation.valid) throw new Error(`Transform content is not syntactically valid: ${snippetValidation.errors.map(error => error.message).join('; ')}`);

  let content: string;
  let replacedRange: AstTransformResult['replacedRange'];
  if (transform.operation === 'append_statements') {
    content = `${source.replace(/\s*$/, '')}\n${transform.content.trim()}\n`;
  } else {
    if (!transform.exportName) throw new Error('replace_export requires exportName.');
    const sourceFile = parseSourceToAst(filePath, source);
    const matches = sourceFile.statements.filter(statement => exportedNamesForStatement(statement).includes(transform.exportName!));
    if (matches.length !== 1) throw new Error(`replace_export expected exactly one export named "${transform.exportName}" in ${filePath}; found ${matches.length}.`);
    const node = matches[0];
    const start = node.getFullStart();
    const end = node.getEnd();
    content = `${source.slice(0, start)}${transform.content.trim()}${source.slice(end)}`;
    replacedRange = { start, end };
  }

  const resultValidation = parseAndValidateSource(filePath, content);
  if (!resultValidation.valid) throw new Error(`AST transform produced invalid source: ${resultValidation.errors.map(error => error.message).join('; ')}`);
  return { content, replacedRange };
}

/**
 * Extract syntax diagnostic errors from a parsed SourceFile
 */
export function extractSyntaxDiagnostics(sourceFile: ts.SourceFile, filePath: string): AstSyntaxError[] {
  const diagnostics: AstSyntaxError[] = [];
  const parseDiagnostics = (sourceFile as any).parseDiagnostics as ts.Diagnostic[] | undefined;

  if (Array.isArray(parseDiagnostics)) {
    for (const diag of parseDiagnostics) {
      if (diag.category === ts.DiagnosticCategory.Error) {
        const start = diag.start ?? 0;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
        diagnostics.push({
          file: filePath,
          line: line + 1,
          column: character + 1,
          message,
          code: diag.code
        });
      }
    }
  }

  return diagnostics;
}

function hasExportModifier(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    return modifiers ? modifiers.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword) : false;
  }
  return false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (ts.canHaveModifiers(node)) {
    const modifiers = ts.getModifiers(node);
    return modifiers ? modifiers.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.DefaultKeyword) : false;
  }
  return false;
}

function extractBindingIdentifiers(bindingName: ts.BindingName): string[] {
  if (ts.isIdentifier(bindingName)) {
    return [bindingName.text];
  }
  const results: string[] = [];
  if (ts.isObjectBindingPattern(bindingName) || ts.isArrayBindingPattern(bindingName)) {
    for (const element of bindingName.elements) {
      if (ts.isBindingElement(element)) {
        results.push(...extractBindingIdentifiers(element.name));
      }
    }
  }
  return results;
}

/**
 * Extract top-level exports and detect export collisions using TypeScript AST visitor
 */
export function extractExportsFromAst(
  sourceFile: ts.SourceFile,
  filePath: string
): {
  exports: AstExportSymbol[];
  collisions: ValidationError[];
} {
  const exports: AstExportSymbol[] = [];
  const collisions: ValidationError[] = [];
  const exportNames = new Map<string, { kind: string; line: number; column: number; count: number }>();

  function recordExport(symbol: AstExportSymbol) {
    exports.push(symbol);
    const existing = exportNames.get(symbol.name);
    if (existing) {
      existing.count += 1;
      // If symbol is not default export and not overload signature, flag collision
      if (symbol.name !== 'default') {
        collisions.push({
          code: 'EXPORT_COLLISION',
          message: `Duplicate export identifier "${symbol.name}" (${symbol.kind}) in file "${filePath}" at line ${symbol.line}:${symbol.column} (previously declared at line ${existing.line}:${existing.column})`,
          path: filePath,
          details: {
            name: symbol.name,
            kind: symbol.kind,
            line: symbol.line,
            column: symbol.column,
            previousLine: existing.line,
            previousColumn: existing.column
          }
        });
      }
    } else {
      exportNames.set(symbol.name, {
        kind: symbol.kind,
        line: symbol.line ?? 1,
        column: symbol.column ?? 1,
        count: 1
      });
    }
  }

  for (const statement of sourceFile.statements) {
    const isExported = hasExportModifier(statement);
    const isDefault = hasDefaultModifier(statement);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));

    // 1. Function Declaration: export function foo() {} / export default function() {}
    if (ts.isFunctionDeclaration(statement)) {
      if (isExported || isDefault) {
        const name = isDefault && !statement.name ? 'default' : (statement.name?.text || 'default');
        recordExport({
          file: filePath,
          name,
          kind: 'function',
          isDefault: isDefault || name === 'default',
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 2. Class Declaration: export class Foo {} / export default class {}
    else if (ts.isClassDeclaration(statement)) {
      if (isExported || isDefault) {
        const name = isDefault && !statement.name ? 'default' : (statement.name?.text || 'default');
        recordExport({
          file: filePath,
          name,
          kind: 'class',
          isDefault: isDefault || name === 'default',
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 3. Variable Statement: export const a = 1, b = 2; export const { x, y } = obj;
    else if (ts.isVariableStatement(statement)) {
      if (isExported) {
        for (const decl of statement.declarationList.declarations) {
          const names = extractBindingIdentifiers(decl.name);
          const declPos = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
          for (const n of names) {
            recordExport({
              file: filePath,
              name: n,
              kind: 'variable',
              isDefault: false,
              line: declPos.line + 1,
              column: declPos.character + 1
            });
          }
        }
      }
    }
    // 4. Type Alias Declaration: export type Foo = string;
    else if (ts.isTypeAliasDeclaration(statement)) {
      if (isExported) {
        recordExport({
          file: filePath,
          name: statement.name.text,
          kind: 'type',
          isTypeOnly: true,
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 5. Interface Declaration: export interface Foo {}
    else if (ts.isInterfaceDeclaration(statement)) {
      if (isExported) {
        recordExport({
          file: filePath,
          name: statement.name.text,
          kind: 'interface',
          isTypeOnly: true,
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 6. Enum Declaration: export enum Foo {}
    else if (ts.isEnumDeclaration(statement)) {
      if (isExported) {
        recordExport({
          file: filePath,
          name: statement.name.text,
          kind: 'enum',
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 7. Module / Namespace Declaration: export namespace Foo {}
    else if (ts.isModuleDeclaration(statement)) {
      if (isExported) {
        recordExport({
          file: filePath,
          name: statement.name.text,
          kind: 'namespace',
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 8. Export Declaration: export { a, b as c }; export * from './mod'; export type { T };
    else if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause) {
        if (ts.isNamedExports(statement.exportClause)) {
          for (const spec of statement.exportClause.elements) {
            const specPos = sourceFile.getLineAndCharacterOfPosition(spec.getStart(sourceFile));
            const exportedName = spec.name.text;
            const isTypeOnly = Boolean(spec.isTypeOnly || statement.isTypeOnly);
            recordExport({
              file: filePath,
              name: exportedName,
              kind: 'named',
              isTypeOnly,
              line: specPos.line + 1,
              column: specPos.character + 1
            });
          }
        } else if (ts.isNamespaceExport(statement.exportClause)) {
          recordExport({
            file: filePath,
            name: statement.exportClause.name.text,
            kind: 'namespace',
            line: line + 1,
            column: character + 1
          });
        }
      } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        // export * from './other'
        recordExport({
          file: filePath,
          name: `* from ${statement.moduleSpecifier.text}`,
          kind: 'reexport',
          line: line + 1,
          column: character + 1
        });
      }
    }
    // 9. Export Assignment: export default expr; export = expr;
    else if (ts.isExportAssignment(statement)) {
      recordExport({
        file: filePath,
        name: 'default',
        kind: 'default',
        isDefault: true,
        line: line + 1,
        column: character + 1
      });
    }
  }

  return { exports, collisions };
}

/**
 * Extract imports from AST
 */
export function extractImportsFromAst(sourceFile: ts.SourceFile, filePath: string): AstImportSymbol[] {
  const imports: AstImportSymbol[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleSpecifier = statement.moduleSpecifier.text;
      let defaultImport: string | undefined;
      const namedImports: string[] = [];

      if (statement.importClause) {
        if (statement.importClause.name) {
          defaultImport = statement.importClause.name.text;
        }
        if (statement.importClause.namedBindings) {
          if (ts.isNamedImports(statement.importClause.namedBindings)) {
            for (const el of statement.importClause.namedBindings.elements) {
              namedImports.push(el.name.text);
            }
          } else if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
            namedImports.push(`* as ${statement.importClause.namedBindings.name.text}`);
          }
        }
      }

      imports.push({
        file: filePath,
        moduleSpecifier,
        defaultImport,
        namedImports,
        isTypeOnly: Boolean(statement.importClause?.isTypeOnly)
      });
    }
  }

  return imports;
}

/**
 * Parse and validate a single source file with the TypeScript compiler parser
 */
export function parseAndValidateSource(filePath: string, content: string): AstValidationResult {
  const normRes = normalizeRelativePath(filePath);
  const normalizedPath = normRes.normalized || filePath;

  if (!isTypeScriptParseable(normalizedPath)) {
    // Non-TS/JS file (e.g. Markdown, CSS, SQL, text) — not parsed as TypeScript AST
    return {
      valid: true,
      syntaxErrors: [],
      exports: [],
      imports: [],
      collisions: [],
      errors: []
    };
  }

  const sourceFile = parseSourceToAst(normalizedPath, content);
  const syntaxErrors = extractSyntaxDiagnostics(sourceFile, normalizedPath);
  const { exports, collisions } = extractExportsFromAst(sourceFile, normalizedPath);
  const imports = extractImportsFromAst(sourceFile, normalizedPath);

  const errors: ValidationError[] = [...collisions];

  for (const err of syntaxErrors) {
    errors.push({
      code: 'SYNTAX_ERROR',
      message: `TypeScript syntax error in "${normalizedPath}" at line ${err.line}:${err.column}: ${err.message}`,
      path: normalizedPath,
      details: { line: err.line, column: err.column, code: err.code }
    });
  }

  return {
    valid: errors.length === 0,
    syntaxErrors,
    exports,
    imports,
    collisions,
    errors
  };
}

/**
 * Validate an array of file modifications using TypeScript compiler parser AST
 */
export function validateTypeScriptModifications(
  modifications: readonly FileModification[]
): AstValidationResult {
  const allSyntaxErrors: AstSyntaxError[] = [];
  const allExports: AstExportSymbol[] = [];
  const allImports: AstImportSymbol[] = [];
  const allCollisions: ValidationError[] = [];
  const allErrors: ValidationError[] = [];

  for (const mod of modifications) {
    if (mod.action === 'delete') continue;
    if (!isTypeScriptParseable(mod.path)) continue;

    const res = parseAndValidateSource(mod.path, mod.content || '');
    allSyntaxErrors.push(...res.syntaxErrors);
    allExports.push(...res.exports);
    allImports.push(...res.imports);
    allCollisions.push(...res.collisions);
    allErrors.push(...res.errors);
  }

  return {
    valid: allErrors.length === 0,
    syntaxErrors: allSyntaxErrors,
    exports: allExports,
    imports: allImports,
    collisions: allCollisions,
    errors: allErrors
  };
}
