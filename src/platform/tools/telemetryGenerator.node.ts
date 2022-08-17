// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as ts from 'typescript';
import * as fs from 'fs-extra';
import glob from 'glob';

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
    readFile(path: string, encoding?: string | undefined): string | undefined {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fs.readFileSync(path, { encoding } as any).toString();
    }
    fileExists(path: string): boolean {
        return fs.existsSync(path);
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

type TelemetryProperty = {
    name: string;
    description: string;
};

type TelemetryLocation = {
    file: string;
    line: number;
    char: number;
    code: string;
};

type TelemetryEntry = {
    name: string;
    description: string;
    locations: TelemetryLocation[];
    properties: TelemetryProperty[];
};

let fileDescriptor: number = 0;
function writeOutput(line: string) {
    if (fileDescriptor === 0) {
        fileDescriptor = fs.openSync(`./TELEMETRY.md`, 'w');
    }
    fs.writeFileSync(fileDescriptor, `${line}\n`);
}

const MultineLineRegex = /(?:\/\*)((.|[\r\n])*?)(?:\*\/)/g;
const StarRemovalRegex = /(?:\*)((.|[\r\n])*?)(.*)/g;
const NormalRemovalRegex = /(?:\/\/)((.|[\r\n])*?)(.*)/g;

function extractLinesFromComments(comment: string): string {
    // Strip out comment on each line
    MultineLineRegex.lastIndex = -1;
    const multineLineMatch = MultineLineRegex.exec(comment);
    if (multineLineMatch && multineLineMatch.length > 1) {
        // Scrape off the * on the front
        const withStars = multineLineMatch[1].toString();

        // Go through the star removal regex, adding up the lines
        StarRemovalRegex.lastIndex = -1;
        let m: RegExpExecArray | null = null;
        let result = '';
        while ((m = StarRemovalRegex.exec(withStars)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === StarRemovalRegex.lastIndex) {
                StarRemovalRegex.lastIndex++;
            }

            if (m && m.length > 3) {
                result = `${result}\n${m[3]}`;
            }
        }
        return result;
    }
    // Otherwise should be regular comments
    NormalRemovalRegex.lastIndex = -1;
    const regularCommentMatch = NormalRemovalRegex.test(comment);
    if (regularCommentMatch) {
        NormalRemovalRegex.lastIndex = -1;
        let m: RegExpExecArray | null = null;
        let result = '';
        while ((m = NormalRemovalRegex.exec(comment)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === NormalRemovalRegex.lastIndex) {
                NormalRemovalRegex.lastIndex++;
            }

            if (m && m.length > 3) {
                result = `${result}\n${m[3]}`;
            }
        }
        return result;
    }
    // No comments found
    return '';
}

function computeDescription(
    host: TypeScriptLanguageServiceHost,
    indexNode: ts.Node,
    grandParent: ts.Node,
    indexSourceFile: ts.SourceFile
) {
    if (grandParent && grandParent.pos < indexNode.pos - 10) {
        const lineOfRef = indexSourceFile.getLineAndCharacterOfPosition(indexNode.pos);
        const lineOfGrandParent = indexSourceFile.getLineAndCharacterOfPosition(grandParent.pos);
        if (lineOfRef.line > lineOfGrandParent.line + 1) {
            const snapshot = host.getScriptSnapshot(`./${indexSourceFile.fileName}`);
            const startLinePos = indexSourceFile.getPositionOfLineAndCharacter(lineOfGrandParent.line + 1, 0);
            const endLinePos = indexSourceFile.getPositionOfLineAndCharacter(lineOfRef.line, 0);
            const comment = snapshot.getText(startLinePos, endLinePos);
            return extractLinesFromComments(comment);
        }
    }
    return '';
}

function computeLocations(
    program: ts.Program,
    host: TypeScriptLanguageServiceHost,
    references: ts.ReferenceEntry[],
    indexNode: ts.Node
) {
    const locations: TelemetryLocation[] = [];
    references.forEach((r) => {
        const refSourceFile = program?.getSourceFile(r.fileName);
        if (refSourceFile) {
            const refNode = findNode(refSourceFile, r.textSpan.start);
            if (refNode && refNode.pos !== indexNode.pos) {
                const snapshot = host.getScriptSnapshot(`./${refSourceFile.fileName}`);
                // Grab 3 lines in each direction around this refnode for the location
                const lineAndChar = refSourceFile.getLineAndCharacterOfPosition(refNode.pos);
                const startPos = refSourceFile.getPositionOfLineAndCharacter(Math.max(lineAndChar.line - 3, 0), 0);
                const endPos = refSourceFile.getLineEndOfPosition(
                    refSourceFile.getPositionOfLineAndCharacter(lineAndChar.line + 3, 0)
                );
                locations.push({
                    file: refSourceFile.fileName,
                    line: lineAndChar.line,
                    char: lineAndChar.character,
                    code: snapshot.getText(startPos, endPos)
                });
            }
        }
    });
    return locations;
}

function computeProperties(host: TypeScriptLanguageServiceHost, indexNode: ts.Node, indexSourceFile: ts.SourceFile) {
    const properties: TelemetryProperty[] = [];
    const greatGrandParent = indexNode.parent.parent.parent;
    if (greatGrandParent) {
        // Should have 4 children if any properties. 3rd one is the
        // type for the class
        const thirdChild = greatGrandParent.getChildAt(2, indexSourceFile);
        // If this is a type declaration, we have properties
        if (thirdChild && ts.isTypeLiteralNode(thirdChild)) {
            const snapshot = host.getScriptSnapshot(`./${indexSourceFile.fileName}`);

            // Pull them apart
            thirdChild.members.forEach((m) => {
                const lastToken = m.getLastToken(indexSourceFile)!;
                const name = snapshot.getText(m.pos, lastToken.end);
                const description = ``;
                properties.push({ name, description });
            });
        }
    }
    return properties;
}

function generateTelemetryEntry(
    program: ts.Program,
    host: TypeScriptLanguageServiceHost,
    eventDefinition: string,
    indexNode: ts.Node,
    indexSourceFile: ts.SourceFile,
    references: ts.ReferenceEntry[]
): TelemetryEntry {
    // First compute event name. Should be in the form:
    // EnumMember = 'EVENT_NAME'
    const match = /\s*\w+\s*=\s*'(\w+.+)'/.exec(eventDefinition);
    const eventName = match ? match[1].toString() : eventDefinition;

    // Then compute description using the grandparent node (comments are ignored, so grandparent
    // should be the previous ; on the previous entry)
    const grandParent = indexNode.parent?.parent;
    const description = computeDescription(host, indexNode, grandParent, indexSourceFile);

    // Then compute all of the locations that the reference telemetry is used
    const locations = computeLocations(program, host, references, indexNode);

    // Compute properties that are listed in the index node
    const properties = computeProperties(host, indexNode, indexSourceFile);

    // Return the telemetry entry
    return {
        name: eventName,
        description,
        locations,
        properties
    };
}
function writeTelemetryEntry(entry: TelemetryEntry) {
    writeOutput(`<details>`);
    writeOutput(`  <summary>${entry.name}</summary>\n`);
    writeOutput(`## Description\n`);
    if (entry.description.length <= 2) {
        writeOutput(`\nNo description provided\n`);
    } else {
        writeOutput(`\n${entry.description}\n`);
    }
    writeOutput(`## Properties\n`);
    if (!entry.properties || entry.properties.length < 1) {
        writeOutput(`\nNo properties for event\n`);
    } else {
        entry.properties.forEach((p) => {
            if (p.description && p.description.length > 2) {
                writeOutput(`- ${p.name} : `);
                writeOutput(`  - ${p.description}`);
            } else {
                writeOutput(`- ${p.name}`);
            }
        });
    }
    writeOutput(`\n## Locations Used`);
    if (!entry.locations || entry.locations.length < 1) {
        writeOutput(`\nEvent can be removed. Not referenced anywhere\n`);
    } else {
        entry.locations.forEach((l) => {
            const link = `https://github.com/microsoft/vscode-jupyter/tree/main/${l.file}`;
            writeOutput(`\n[${l.file}](${link})`);
            writeOutput('```typescript');
            writeOutput(l.code.replace(/\r\n/g, '\n'));
            writeOutput('```\n');
        });
    }
    writeOutput(`</details>`);
}

/** Generate documentation for all classes in a set of .ts files */
function generateDocumentation(fileNames: string[], options: ts.CompilerOptions): void {
    let host = new TypeScriptLanguageServiceHost(fileNames, options);
    let languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    let program = languageService.getProgram();
    let entries: TelemetryEntry[] = [];

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }

    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported nodes
        if (!isNodeExported(node)) {
            return;
        }

        if (ts.isEnumDeclaration(node) && node.members) {
            // This is an enum. Telemetry is described with enums
            const nodeName = node.name.getText(sourceFile);
            if (nodeName.includes('Telemetry') || nodeName.includes('EventName')) {
                console.log(`Found exported telemetry enum ${nodeName}:`);
                // This is a telemetry enum. Print out members
                node.members.forEach((m) => {
                    console.log(`   ${m.getText(sourceFile)}`);

                    // Find all references for this enum
                    const references = languageService.getReferencesAtPosition(
                        m.getSourceFile().fileName,
                        m.name.pos + m.name.getLeadingTriviaWidth()
                    );
                    if (references && program) {
                        console.log(`    References:`);
                        references.forEach((r) => {
                            const refSourceFile = program?.getSourceFile(r.fileName);
                            if (refSourceFile) {
                                const refNode = findNode(refSourceFile, r.textSpan.start);
                                // See if this is the special 'telemetry.ts' file that forces telemetry to be type safe
                                if (refNode && r.fileName.endsWith('src/telemetry.ts')) {
                                    entries.push(
                                        generateTelemetryEntry(
                                            program!,
                                            host,
                                            m.getText(sourceFile),
                                            refNode,
                                            refSourceFile,
                                            references
                                        )
                                    );
                                }
                            }
                            console.log(`        ${r.fileName} => ${JSON.stringify(r.textSpan)}`);
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

    // Write our header first
    writeOutput('# Telemetry created by Jupyter Extension\n');
    writeOutput('Expand each section to see more information about that event.\n');

    // Sort entries by name
    const sorted = entries.sort((a, b) => {
        return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });

    // Then write out each one
    sorted.forEach(writeTelemetryEntry);

    // Close our file
    fs.closeSync(fileDescriptor);
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
