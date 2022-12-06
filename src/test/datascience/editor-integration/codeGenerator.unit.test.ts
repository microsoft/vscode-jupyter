// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { assert } from 'chai';
import { NotebookDocument, Position, Range, Uri } from 'vscode';

import { IConfigurationService, IWatchableJupyterSettings } from '../../../platform/common/types';
import { CodeGenerator } from '../../../interactive-window/editor-integration/codeGenerator';
import { MockDocumentManager } from '../mockDocumentManager';
import { anything, instance, mock, when } from 'ts-mockito';
import { IGeneratedCodeStore, InteractiveCellMetadata } from '../../../interactive-window/editor-integration/types';
import { GeneratedCodeStorage } from '../../../interactive-window/editor-integration/generatedCodeStorage';
import { IVSCodeNotebook } from '../../../platform/common/application/types';

// eslint-disable-next-line
suite('Code Generator Unit Tests', () => {
    let codeGenerator: CodeGenerator;
    let documentManager: MockDocumentManager;
    let configurationService: IConfigurationService;
    let pythonSettings: IWatchableJupyterSettings;
    let storage: IGeneratedCodeStore;
    let notebook: NotebookDocument;
    let vscodeNotebooks: IVSCodeNotebook;
    setup(() => {
        configurationService = mock<IConfigurationService>();
        pythonSettings = mock<IWatchableJupyterSettings>();
        storage = new GeneratedCodeStorage();
        when(configurationService.getSettings(anything())).thenReturn(instance(pythonSettings));
        documentManager = new MockDocumentManager();
        notebook = mock<NotebookDocument>();
        vscodeNotebooks = mock<IVSCodeNotebook>();
        when(notebook.uri).thenReturn();
        codeGenerator = new CodeGenerator(
            documentManager,
            instance(configurationService),
            storage,
            instance(notebook),
            instance(vscodeNotebooks),
            []
        );
    });
    teardown(() => codeGenerator.dispose());
    function addSingleChange(file: string, range: Range, newText: string) {
        documentManager.changeDocument(file, [{ range, newText }]);
    }

    async function sendCode(code: string, line: number, file?: string) {
        const fileName = file ? file : 'foo.py';
        const metadata: InteractiveCellMetadata = {
            interactiveWindowCellMarker: '# %%',
            interactive: {
                uristring: Uri.file(fileName).toString(),
                lineIndex: line,
                originalSource: code
            },
            id: '1'
        };
        return codeGenerator.generateCode(metadata, -1, false);
    }

    test('Add a cell and edit it', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.equal(generatedCodes[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodes[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodes[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodes[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Edit the first cell, removing it
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(2, 0)), '');

        // Get our hashes again. The line number should change
        // We should have a single hash
        generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.equal(generatedCodes[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodes[0].generatedCodes[0].line, 2, 'Wrong start line');
        assert.equal(generatedCodes[0].generatedCodes[0].endLine, 2, 'Wrong end line');
        assert.equal(generatedCodes[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Execute %%latex magic in a cell with a cell marker', async () => {
        const file = '# %%\r\n%%latex\r\n$e^2$';
        const code = '# %%\r\n%%latex\r\n$e^2$';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 1);

        // We should have a single hash
        let generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.strictEqual(generatedCodes[0].generatedCodes[0].code.trim(), '%%latex\n$e^2$');
    });

    test('Execute %%latex magic in a cell with a cell marker and commented out cell magic', async () => {
        const file = '# %%\r\n#!%%latex\r\n$e^2$';
        const code = '# %%\r\n#!%%latex\r\n$e^2$';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 1);

        // We should have a single hash
        let generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.strictEqual(generatedCodes[0].generatedCodes[0].code.trim(), '%%latex\n$e^2$');
    });

    test('Execute %%html magic in a cell with a cell marker', async () => {
        const file = '# %%\r\n%%html\r\n<button>Hello</button>';
        const code = '# %%\r\n%%html\r\n<button>Hello</button>';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 1);

        // We should have a single hash
        let generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.strictEqual(generatedCodes[0].generatedCodes[0].code.trim(), '%%html\n<button>Hello</button>');
    });

    test('Add a cell, delete it, and recreate it', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.equal(generatedCodes[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodes[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodes[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodes[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Change the second cell
        addSingleChange('foo.py', new Range(new Position(3, 0), new Position(3, 0)), 'print ("bob")\r\n');

        // Should be no hashes now
        generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 0, 'Hash should be gone');

        // Undo the last change
        addSingleChange('foo.py', new Range(new Position(3, 0), new Position(4, 0)), '');

        // Hash should reappear
        generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 1, 'No hashes found');
        assert.equal(generatedCodes[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodes[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodes[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodes[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Delete code below', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")\r\n#%%\r\nprint("baz")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFile = storage.all;
        assert.equal(generatedCodesByFile.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Change the third cell
        addSingleChange('foo.py', new Range(new Position(5, 0), new Position(5, 0)), 'print ("bob")\r\n');

        // Should be the same hashes
        generatedCodesByFile = storage.all;
        assert.equal(generatedCodesByFile.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Delete the first cell
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(2, 0)), '');

        // Hash should move
        generatedCodesByFile = storage.all;
        assert.equal(generatedCodesByFile.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].line, 2, 'Wrong start line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].endLine, 3, 'Wrong end line');
        assert.equal(generatedCodesByFile[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Modify code after sending twice', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")\r\n#%%\r\nprint("baz")';
        const code = '#%%\r\nprint("bar")';
        const thirdCell = '#%%\r\nprint ("bob")\r\nprint("baz")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Change the third cell
        addSingleChange('foo.py', new Range(new Position(5, 0), new Position(5, 0)), 'print ("bob")\r\n');

        // Send the third cell
        await sendCode(thirdCell, 4);

        // Should be two hashes
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 2, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].line, 6, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].endLine, 7, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].executionCount, 2, 'Wrong execution count');

        // Delete the first cell
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(2, 0)), '');

        // Hashes should move
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 2, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 2, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 3, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].executionCount, 2, 'Wrong execution count');
    });

    test('Run same cell twice', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")\r\n#%%\r\nprint("baz")';
        const code = '#%%\r\nprint("bar")';
        const thirdCell = '#%%\r\nprint ("bob")\r\nprint("baz")';

        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // Add a second cell
        await sendCode(thirdCell, 4);

        // Add this code a second time
        await sendCode(code, 2);

        // Execution count should go up, but still only have two cells.
        const generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 2, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 3, 'Wrong execution count');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].line, 6, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].endLine, 6, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[1].executionCount, 2, 'Wrong execution count');
    });

    test('Two files with same cells', async () => {
        const file1 = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")\r\n#%%\r\nprint("baz")';
        const file2 = file1;
        const code = '#%%\r\nprint("bar")';
        const thirdCell = '#%%\r\nprint ("bob")\r\nprint("baz")';

        // Create our documents
        documentManager.addDocument(file1, 'foo.py');
        documentManager.addDocument(file2, 'bar.py');

        // Add this code
        await sendCode(code, 2);
        await sendCode(code, 2, 'bar.py');

        // Add a second cell
        await sendCode(thirdCell, 4);

        // Add this code a second time
        await sendCode(code, 2);

        // Execution count should go up, but still only have two cells.
        const generatedCodes = storage.all;
        assert.equal(generatedCodes.length, 2, 'Wrong number of hashes');
        const fooHash = generatedCodes.find((h) => h.uri.fsPath === Uri.file('foo.py').fsPath);
        const barHash = generatedCodes.find((h) => h.uri.fsPath === Uri.file('bar.py').fsPath);
        assert.ok(fooHash, 'No hash for foo.py');
        assert.ok(barHash, 'No hash for bar.py');
        assert.equal(fooHash!.generatedCodes.length, 2, 'Not enough hashes found');
        assert.equal(fooHash!.generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(fooHash!.generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(fooHash!.generatedCodes[0].executionCount, 4, 'Wrong execution count');
        assert.equal(fooHash!.generatedCodes[1].line, 6, 'Wrong start line');
        assert.equal(fooHash!.generatedCodes[1].endLine, 6, 'Wrong end line');
        assert.equal(fooHash!.generatedCodes[1].executionCount, 3, 'Wrong execution count');
        assert.equal(barHash!.generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(barHash!.generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(barHash!.generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(barHash!.generatedCodes[0].executionCount, 2, 'Wrong execution count');
    });

    test('Delete cell with dupes in code, put cell back', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")\r\n#%%\r\nprint("baz")';
        const code = '#%%\r\nprint("foo")';

        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Modify the code
        addSingleChange('foo.py', new Range(new Position(3, 0), new Position(3, 1)), '');

        // Should have zero hashes
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 0, 'Too many hashes found');

        // Put back the original cell
        addSingleChange('foo.py', new Range(new Position(3, 0), new Position(3, 0)), 'p');
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 5, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Modify the code
        addSingleChange('foo.py', new Range(new Position(3, 0), new Position(3, 1)), '');
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 0, 'Too many hashes found');

        // Remove the first cell
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(2, 0)), '');
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 0, 'Too many hashes found');

        // Put back the original cell
        addSingleChange('foo.py', new Range(new Position(1, 0), new Position(1, 0)), 'p');
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 2, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 3, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Add a cell and edit different parts of it', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        const generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Edit the cell we added
        addSingleChange('foo.py', new Range(new Position(2, 0), new Position(2, 0)), '#');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 0), new Position(2, 1)), '');
        assert.equal(storage.all.length, 1, 'Cell should be back');
        addSingleChange('foo.py', new Range(new Position(2, 0), new Position(2, 1)), '');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 0), new Position(2, 0)), '#');
        assert.equal(storage.all.length, 1, 'Cell should be back');
        addSingleChange('foo.py', new Range(new Position(2, 1), new Position(2, 2)), '');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 1), new Position(2, 1)), '%');
        assert.equal(storage.all.length, 1, 'Cell should be back');
        addSingleChange('foo.py', new Range(new Position(2, 2), new Position(2, 3)), '');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 2), new Position(2, 2)), '%');
        assert.equal(storage.all.length, 1, 'Cell should be back');
        addSingleChange('foo.py', new Range(new Position(2, 3), new Position(2, 4)), '');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 3), new Position(2, 3)), '\r');
        assert.equal(storage.all.length, 1, 'Cell should be back');
        addSingleChange('foo.py', new Range(new Position(2, 4), new Position(2, 5)), '');
        assert.equal(storage.all.length, 0, 'Cell should be destroyed');
        addSingleChange('foo.py', new Range(new Position(2, 4), new Position(2, 4)), '\n');
        assert.equal(storage.all.length, 1, 'Cell should be back');
    });

    test('Add a cell and edit it to be exactly the same', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Replace with the same cell
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(4, 0)), file);
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
        assert.equal(storage.all.length, 1, 'Cell should be back');
    });

    test('Add a cell and edit it to not be exactly the same', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const file2 = '#%%\r\nprint("fooze")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Replace with the new code
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(4, 0)), file2);
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 0, 'Hashes should be gone');

        // Put back old code
        addSingleChange('foo.py', new Range(new Position(0, 0), new Position(4, 0)), file);
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Apply multiple edits at once', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Apply a couple of edits at once
        documentManager.changeDocument('foo.py', [
            {
                range: new Range(new Position(0, 0), new Position(0, 0)),
                newText: '#%%\r\nprint("new cell")\r\n'
            },
            {
                range: new Range(new Position(0, 0), new Position(0, 0)),
                newText: '#%%\r\nprint("new cell")\r\n'
            }
        ]);
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 8, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 8, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        documentManager.changeDocument('foo.py', [
            {
                range: new Range(new Position(0, 0), new Position(0, 0)),
                newText: '#%%\r\nprint("new cell")\r\n'
            },
            {
                range: new Range(new Position(0, 0), new Position(2, 0)),
                newText: ''
            }
        ]);
        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 8, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 8, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });

    test('Clear generated code information, e.g. when restarting the kernel', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        const code = '#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(code, 2);

        // We should have a single hash
        let generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 4, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');

        // Restart the kernel
        storage.clear();

        generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 0, 'Restart should have cleared');
    });

    test('More than one cell in range', async () => {
        const file = '#%%\r\nprint("foo")\r\n#%%\r\nprint("bar")';
        // Create our document
        documentManager.addDocument(file, 'foo.py');

        // Add this code
        await sendCode(file, 0);

        // We should have a single hash
        const generatedCodesByFiles = storage.all;
        assert.equal(generatedCodesByFiles.length, 1, 'No hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes.length, 1, 'Not enough hashes found');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].line, 2, 'Wrong start line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].endLine, 4, 'Wrong end line');
        assert.equal(generatedCodesByFiles[0].generatedCodes[0].executionCount, 1, 'Wrong execution count');
    });
});
