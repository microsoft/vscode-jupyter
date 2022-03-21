// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import { traceInfo } from '../platform/common/logger';
import { captureScreenShot, IExtensionTestApi } from './common';

import * as ts from 'typescript';
import * as fs from 'fs-extra';
import * as glob from 'glob';
import * as path from 'path';

import { initialize } from './initialize';

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

async function getInjectableClasses(fileNames: string[], options: ts.CompilerOptions) {
    let host = new TypeScriptLanguageServiceHost(fileNames, options);
    let languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    let program = languageService.getProgram();

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile && !sourceFile.fileName.includes('.test')) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }

    let classes: string[] = [];

    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported classes
        if (!isNodeExported(node)) {
            return;
        }

        if (ts.isClassDeclaration(node) && node.decorators) {
            // See if it has the 'injectable' decorator or not
            if (node.decorators.find((d) => d.getText(sourceFile).includes('injectable'))) {
                classes.push(node.name?.getFullText(sourceFile) || '');
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

    return classes;
}

async function getSourceFiles() {
    const files = await new Promise<string[]>((resolve, reject) => {
        const globPattern = path.join(__dirname, '..', '**', '*.ts').replace('\\\\', '/');
        glob(globPattern, (ex, res) => {
            if (ex) {
                reject(ex);
            } else {
                resolve(res);
            }
        });
    });
    return files;
}

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('DataScience - Verify serviceRegistry is correct', function () {
    let api: IExtensionTestApi;
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            api = await initialize();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this.currentTest?.title || 'unknown');
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    test('Verify all classes with inject on them are in the container', async () => {
        assert.ok(
            api.serviceContainer,
            `Service container not created. Extension should fail to activate. See inversify output`
        );
        const files = await getSourceFiles();
        const classes = await getInjectableClasses(files, {
            target: ts.ScriptTarget.ES5,
            module: ts.ModuleKind.CommonJS
        });
        const list = api.serviceManager.getAll('Symbol');
        assert.equal(classes.length, list.length, `Classes not found`);
    });
});
