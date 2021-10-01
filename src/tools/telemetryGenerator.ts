// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as ts from 'typescript';
import * as fs from 'fs-extra';
import * as glob from 'glob';

/**
 * A TypeScript language service host
 */
class TypeScriptLanguageServiceHost implements ts.LanguageServiceHost {
    private readonly _files: string[];
    private readonly _compilerOptions: ts.CompilerOptions;

    constructor(files: string[], compilerOptions: ts.CompilerOptions) {
        this._files = files;
        this._compilerOptions = compilerOptions;
    }

    // --- language service host ---------------

    getCompilationSettings(): ts.CompilerOptions {
        return this._compilerOptions;
    }
    getScriptFileNames(): string[] {
        return this._files;
    }
    getScriptVersion(_fileName: string): string {
        return '1';
    }
    getProjectVersion(): string {
        return '1';
    }
    getScriptSnapshot(fileName: string): ts.IScriptSnapshot {
        if (this._files.includes(fileName)) {
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        } else {
            return ts.ScriptSnapshot.fromString('');
        }
    }
    getScriptKind(_fileName: string): ts.ScriptKind {
        return ts.ScriptKind.TS;
    }
    getCurrentDirectory(): string {
        return '';
    }
    getDefaultLibFileName(_options: ts.CompilerOptions): string {
        return 'defaultLib:lib.d.ts';
    }
    isDefaultLibFileName(fileName: string): boolean {
        return fileName === this.getDefaultLibFileName(this._compilerOptions);
    }
}

function findNode(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
    let found: ts.Node | undefined;
    sourceFile.forEachChild(visit);
    function visit(node: ts.Node) {
        if (node.pos === position) {
            found = node;
            return;
        } else if (node.pos > position) {
            return;
        }
        ts.forEachChild(node, visit);
    }
    return found;
}

/** Generate documentation for all classes in a set of .ts files */
function generateDocumentation(fileNames: string[], options: ts.CompilerOptions): void {
    let host = new TypeScriptLanguageServiceHost(fileNames, options);
    let languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    let program = languageService.getProgram();

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }

    return;

    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported nodes
        if (!isNodeExported(node)) {
            return;
        }

        if (ts.isEnumDeclaration(node) && node.members) {
            // This is an enum. Telemetry is described with enums
            if (node.name.getText(sourceFile).includes('Telemetry')) {
                console.log(`Found exported telemetry enum ${node.name.text}:`);
                // This is a telemetry enum. Print out members
                node.members.forEach((m) => {
                    console.log(`   ${m.getText(sourceFile)}`);

                    // Find all references for this enum
                    const references = languageService.getReferencesAtPosition(
                        m.getSourceFile().fileName,
                        m.name.pos + m.name.getLeadingTriviaWidth()
                    );
                    if (references) {
                        console.log(`    References:`);
                        references.forEach((r) => {
                            if (!r.isDefinition) {
                                const refSourceFile = program?.getSourceFile(r.fileName);
                                if (refSourceFile) {
                                    const refNode = findNode(refSourceFile, r.textSpan.start);
                                    const endRefLine = refSourceFile.getLineEndOfPosition(refNode?.pos || 0);
                                    const grandParent = refNode?.parent?.parent;
                                    const snapshot = host.getScriptSnapshot(`./${r.fileName}`);
                                    console.log(
                                        `        ${r.fileName} =>${snapshot.getText(grandParent?.pos || 0, endRefLine)}`
                                    );
                                } else {
                                    console.log(`        ${r.fileName} => ${JSON.stringify(r.textSpan)}`);
                                }
                            }
                        });
                    }
                });
            }
        } else if (ts.isModuleDeclaration(node)) {
            // This is a namespace, visit its children
            ts.forEachChild(node, visit.bind(undefined, sourceFile));
        }
    }

    /** True if this is visible outside this file, false otherwise */
    function isNodeExported(node: ts.Node): boolean {
        return (
            (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
            (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
        );
    }
}

export default async function generateTelemetryMd() {
    // Find files with 'telemetry' in them
    // Import typescript compiler
    // Build entire tree?
    // Find all constants prefixed with DS_INTERNAL or DATASCIENCE
    // Generate list that has:
    // - Telemetry name
    // - All references
    // - Description (based on comments on constant or comments in mapping)
    // Glob all of the source files
    const files = await new Promise<string[]>((resolve, reject) => {
        glob('./src/**/*.ts', (ex, res) => {
            if (ex) {
                reject(ex);
            } else {
                resolve(res);
            }
        });
    });

    // Print out the source tree
    generateDocumentation(files, {
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS
    });
}
