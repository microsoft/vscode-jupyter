// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as ts from 'typescript';
import * as glob from 'glob';
import { ConsoleForegroundColors } from '../client/logging/_global';

/** Generate documentation for all classes in a set of .ts files */
function generateDocumentation(fileNames: string[], options: ts.CompilerOptions): void {
    // Build a program using the set of root file names in fileNames
    let program = ts.createProgram(fileNames, options);

    // Visit every sourceFile in the program
    for (const sourceFile of program.getSourceFiles()) {
        if (!sourceFile.isDeclarationFile) {
            // Walk the tree to search for classes
            ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
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
