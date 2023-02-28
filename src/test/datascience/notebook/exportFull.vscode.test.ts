// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
import { assert, expect } from 'chai';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import { Common, DataScience } from '../../../platform/common/utils/localize';
import { IVSCodeNotebook } from '../../../platform/common/application/types';
import { traceInfo } from '../../../platform/logging';
import { IConfigurationService, IDisposable } from '../../../platform/common/types';
import { captureScreenShot, IExtensionTestApi, PYTHON_PATH } from '../../common.node';
import { initialize } from '../../initialize.node';
import {
    closeNotebooksAndCleanUpAfterTests,
    createEmptyPythonNotebook,
    hijackPrompt,
    insertCodeCell,
    insertMarkdownCell,
    saveActiveNotebook,
    startJupyterServer
} from './helper.node';
import { commands, ConfigurationTarget, Uri, window, workspace } from 'vscode';
import { createDeferred } from '../../../platform/common/utils/async';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../constants.node';
import { ProductNames } from '../../../platform/interpreter/installer/productNames';
import { Product } from '../../../platform/interpreter/installer/types';
import { ProcessService } from '../../../platform/common/process/proc.node';
import { INbConvertInterpreterDependencyChecker, INotebookImporter } from '../../../kernels/jupyter/types';
import { JupyterImporter } from '../../../standalone/import-export/jupyterImporter.node';
import { IInterpreterService } from '../../../platform/interpreter/contracts';
import { CodeSnippets, Identifiers } from '../../../platform/common/constants';
import { noop } from '../../../platform/common/utils/misc';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { format } from '../../../platform/common/helpers';

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const expectedPromptMessageSuffix = `requires ${ProductNames.get(Product.ipykernel)!} to be installed.`;

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite('Export @export', function () {
    let api: IExtensionTestApi;
    const disposables: IDisposable[] = [];
    let proc: ProcessService;
    let vscodeNotebook: IVSCodeNotebook;
    let importer: JupyterImporter;
    let nbConvertDependencyChecker: INbConvertInterpreterDependencyChecker;
    let interpreterService: IInterpreterService;
    let activeInterpreter: PythonEnvironment;
    let defaultCellMarker: string;
    let template: string;
    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup');
        this.timeout(120_000);
        try {
            api = await initialize();
            importer = api.serviceContainer.get<JupyterImporter>(INotebookImporter);
            nbConvertDependencyChecker = api.serviceContainer.get<INbConvertInterpreterDependencyChecker>(
                INbConvertInterpreterDependencyChecker
            );
            interpreterService = api.serviceContainer.get<IInterpreterService>(IInterpreterService);
            await hijackPrompt(
                'showErrorMessage',
                { endsWith: expectedPromptMessageSuffix },
                { result: Common.install, clickImmediately: true },
                disposables
            );

            sinon.restore();
            vscodeNotebook = api.serviceContainer.get<IVSCodeNotebook>(IVSCodeNotebook);
            proc = new ProcessService();
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            await captureScreenShot('export-suite');
            throw e;
        }
    });
    suiteTeardown(async () => {
        proc.dispose();
        await fs.unlink(template).catch(noop);
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            traceInfo(`Start Test ${this.currentTest?.title}`);
            sinon.restore();
            await startJupyterServer();
            await createEmptyPythonNotebook(disposables);
            assert.isOk(vscodeNotebook.activeNotebookEditor, 'No active notebook');
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
            activeInterpreter = (await interpreterService.getActiveInterpreter(
                vscodeNotebook.activeNotebookEditor?.notebook.uri
            ))!;
            defaultCellMarker =
                api.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings()
                    .defaultCellMarker || Identifiers.DefaultCodeCellMarker;
            const version = await nbConvertDependencyChecker.getNbConvertVersion(activeInterpreter);
            if (!template) {
                template = (await importer.createTemplateFile(version!.major >= 6))!;
            }
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        // Revert back our settings just in case
        const settings = workspace.getConfiguration('jupyter', null);
        await settings.update('pythonExportMethod', 'direct', ConfigurationTarget.Global);

        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
    });
    suiteTeardown(() => closeNotebooksAndCleanUpAfterTests(disposables));
    test('Export a basic notebook document', async () => {
        await insertCodeCell('print("Hello World")', { index: 0 });
        await insertMarkdownCell('# Markdown Header\nmarkdown string', { index: 1 });
        await insertCodeCell('%whos', { index: 2 });
        await saveActiveNotebook();

        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                // Make sure we have a new editor (not undefined)
                deferred.resolve();
            }
        });

        // Execute our export command
        await commands.executeCommand('jupyter.exportAsPythonScript');

        // Wait until our active document changes
        await deferred.promise;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();
        const expected = `# %%${os.EOL}print("Hello World")${os.EOL}${os.EOL}# %% [markdown]${os.EOL}# # Markdown Header${os.EOL}# markdown string${os.EOL}${os.EOL}# %%${os.EOL}%whos${os.EOL}${os.EOL}`;

        // Verify text content
        expect(text).to.equal(expected, 'Exported text does not match');

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
    test('Export a basic notebook document with magics commented out', async () => {
        await insertCodeCell('print("Hello World")', { index: 0 });
        await insertMarkdownCell('# Markdown Header\nmarkdown string', { index: 1 });
        await insertCodeCell('%whos\n!shellcmd', { index: 2 });
        await saveActiveNotebook();

        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                deferred.resolve();
            }
        });

        const settings = workspace.getConfiguration('jupyter', null);
        await settings.update('pythonExportMethod', 'commentMagics', ConfigurationTarget.Global);

        // Execute our export command
        await commands.executeCommand('jupyter.exportAsPythonScript');

        // Wait until our active document changes
        await deferred.promise;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();
        const expected = `# %%${os.EOL}print("Hello World")${os.EOL}${os.EOL}# %% [markdown]${os.EOL}# # Markdown Header${os.EOL}# markdown string${os.EOL}${os.EOL}# %%${os.EOL}# %whos${os.EOL}# !shellcmd${os.EOL}${os.EOL}`;

        // Verify text content
        expect(text).to.equal(expected, 'Exported text does not match');

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
    test('Export a basic notebook document with nbconvert', async () => {
        await insertCodeCell('print("Hello World")', { index: 0 });
        await insertMarkdownCell('# Markdown Header\nmarkdown string', { index: 1 });
        await insertCodeCell('%whos\n!shellcmd', { index: 2 });
        await saveActiveNotebook();
        const nbFile = window.activeNotebookEditor!.notebook.uri.fsPath;
        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                deferred.resolve();
            }
        });

        const settings = workspace.getConfiguration('jupyter', null);
        await settings.update('pythonExportMethod', 'nbconvert', ConfigurationTarget.Global);

        // Execute our export command
        await commands.executeCommand('jupyter.exportAsPythonScript');

        // Wait until our active document changes
        await deferred.promise;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();
        const output = await proc.exec(PYTHON_PATH, [
            '-m',
            'jupyter',
            'nbconvert',
            nbFile,
            '--to',
            'python',
            '--stdout',
            '--template',
            template!
        ]);

        // Verify text content
        const prefix = DataScience.instructionComments(defaultCellMarker);
        let expectedContents = output.stdout;
        if (expectedContents.includes('get_ipython')) {
            expectedContents = format(CodeSnippets.ImportIPython, defaultCellMarker, expectedContents);
        }
        expectedContents = prefix.concat(expectedContents);

        expect(text).to.equal(expectedContents, 'Exported text does not match');

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
    test('Import a notebook file from disk', async () => {
        // Prep to see when
        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                deferred.resolve();
            }
        });

        // Execute our export command
        const testFilePath = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'test',
            'datascience',
            'notebook',
            'test.ipynb'
        );
        const importFile = Uri.file(testFilePath);
        await commands.executeCommand('jupyter.importnotebook', importFile);

        // Wait until our active document changes
        await deferred.promise;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();

        // Verify text content
        expect(text).to.equal(`# %%${os.EOL}a=1${os.EOL}a${os.EOL}${os.EOL}`, 'Exported text does not match');

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
    test('Import a notebook file from disk using nbconvert', async () => {
        // Prep to see when
        const deferred = createDeferred<any>();
        const onDidChangeDispose = window.onDidChangeActiveTextEditor((te) => {
            if (te) {
                deferred.resolve();
            }
        });

        // Set to nbconvert
        const settings = workspace.getConfiguration('jupyter', null);
        await settings.update('pythonExportMethod', 'nbconvert', ConfigurationTarget.Global);

        // Execute our export command
        const testFilePath = path.join(
            EXTENSION_ROOT_DIR_FOR_TESTS,
            'src',
            'test',
            'datascience',
            'notebook',
            'test.ipynb'
        );
        const importFile = Uri.file(testFilePath);
        await commands.executeCommand('jupyter.importnotebook', importFile);

        // Wait until our active document changes
        await deferred.promise;

        assert(window.activeTextEditor?.document.languageId === 'python', 'Document opened by export was not python');

        const text = window.activeTextEditor?.document.getText();

        // Verify text content
        expect(text).to.equal(
            `# To add a new cell, type '# %%'\n# To add a new markdown cell, type '# %% [markdown]'\n# %%\na=1\na\n\n`,
            'Exported text does not match'
        );

        // Clean up dispose
        onDidChangeDispose.dispose();
    });
});
