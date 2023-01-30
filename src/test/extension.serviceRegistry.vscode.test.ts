// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert } from 'chai';
import { traceInfo } from '../platform/logging';
import { captureScreenShot, IExtensionTestApi, testMandatory } from './common.node';

import * as ts from 'typescript';
import * as fs from 'fs-extra';
import glob from 'glob';
import * as path from '../platform/vscode-path/path';

import { initialize } from './initialize.node';
import { interfaces } from 'inversify/lib/interfaces/interfaces';

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

async function getInjectableClasses(fileNames: string[], options: ts.CompilerOptions) {
    let host = new TypeScriptLanguageServiceHost(fileNames, options);
    let languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    let program = languageService.getProgram();
    const classes = new Set<string>();

    // Visit every sourceFile in the program
    if (program) {
        for (const sourceFile of program.getSourceFiles()) {
            if (!sourceFile.isDeclarationFile && !sourceFile.fileName.includes('.test')) {
                // Walk the tree to search for classes
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }

    /** visit nodes finding exported classes */
    function visit(sourceFile: ts.SourceFile, node: ts.Node) {
        // Only consider exported classes
        if (!isNodeExported(node)) {
            return;
        }

        if (ts.isClassDeclaration(node) && node.modifiers) {
            // See if it has the 'injectable' decorator or not
            if (node.modifiers.find((d) => d.getText(sourceFile).includes('injectable'))) {
                classes.add(node.name?.escapedText.toString().trim() || '');
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
        const globPattern = path.join(__dirname, '..', '..', 'src', '**', '*.ts').replace(/\\/g, '/');
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
suite('Verify serviceRegistry is correct', function () {
    let api: IExtensionTestApi;
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            api = await initialize();
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    testMandatory('Verify all classes with inject on them are in the container', async () => {
        assert.ok(
            api.serviceContainer,
            `Service container not created. Extension should fail to activate. See inversify output`
        );
        const files = await getSourceFiles();
        const classes = await getInjectableClasses(
            files.filter((file) => !file.endsWith('.web.ts')),
            {
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.CommonJS
            }
        );
        const map = (api.serviceManager.getContainer() as any)._bindingDictionary._map as Map<
            number,
            Array<interfaces.Binding<any>>
        >;

        // Go through all the classes and see that each one is an implementation type of something
        const implementationTypes = new Set<string>();
        const notFound = new Set<string>(classes);
        [...map.entries()].forEach((e) => {
            e[1].forEach((b) => {
                let name: string | undefined;
                const type = b.implementationType;
                if (type) {
                    name = type.name;
                }
                const cache = b.cache;
                if (b.type === 'ConstantValue' && cache && cache.constructor) {
                    name = cache.constructor.name;
                }
                if (name) {
                    if (notFound.has(name)) {
                        notFound.delete(name);
                    }
                    implementationTypes.add(name);
                }
            });
        });

        // There are set of known types that are expected to not be picked up because
        // they only show up in dev mode
        const devModeExceptions = ['LogReplayService'];
        devModeExceptions.forEach((d) => notFound.delete(d));

        assert.equal(
            notFound.size,
            0,
            `List of classes not in registry that are marked as injectable: ${[...notFound].join('\n')}`
        );
    });
});
