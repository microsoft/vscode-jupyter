// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as vscode from 'vscode';
import { JupyterCompletionItem, filterCompletions } from './pythonKernelCompletionProvider';
import { MockDocument } from '../../test/datascience/mockDocument';
import { generateSortString } from './helpers';

suite('Jupyter Completion Unit Tests', () => {
    let mockDocument: MockDocument;
    setup(() => {
        mockDocument = new MockDocument('print(1)\n', 'test.ipynb', () => Promise.resolve(false));
    });

    function createCompletionItem(
        label: string,
        index: number,
        range?: vscode.Range,
        kind?: vscode.CompletionItemKind
    ): JupyterCompletionItem {
        return {
            label,
            sortText: generateSortString(index),
            itemText: label,
            range: range ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
            kind
        };
    }

    test('Filter paths', async () => {
        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('%bar', 0),
            createCompletionItem('test.ipynb', 1)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [];
        const filtered = filterCompletions(
            undefined,
            false,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 0)
        );
        assert.isNotEmpty(filtered, 'Filtered list should have an item in it');
        assert.equal(filtered.length, 1, 'Wrong number of filtered results');
        assert.ok(
            filtered.find((f) => f.label == '%bar' && f.sortText?.startsWith('ZZZ')),
            'Magic not found and not sorted at end'
        );
    });

    test('Labels are minimized', async () => {
        mockDocument = new MockDocument('print(1)\ndf.', 'test.ipynb', () => Promise.resolve(false));

        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('df.foobar', 0),
            createCompletionItem('df.BAZ', 1)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [];
        const filtered = filterCompletions(
            undefined,
            false,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 3)
        );
        assert.isNotEmpty(filtered, 'Filtered list should have items in it');
        assert.equal(filtered.length, 2, 'Wrong number of filtered results');
        assert.ok(
            filtered.find((f) => f.label == 'BAZ'),
            'Labels not minimized'
        );
    });

    test('Show paths in a string', async () => {
        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('%bar', 0),
            createCompletionItem('test.ipynb', 1)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [];
        const filtered = filterCompletions(
            '"',
            true,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 1)
        );
        assert.isNotEmpty(filtered, 'Filtered list should have an item in it');
        assert.equal(filtered.length, 2, 'Wrong number of filtered results');
        assert.ok(
            filtered.find((f) => f.label == 'test.ipynb'),
            'Inside string should show paths'
        );
    });

    test('Show paths in a string from inside string', async () => {
        mockDocument = new MockDocument('print(1)\nprint("")', 'test.ipynb', () => Promise.resolve(false));
        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('%bar', 0),
            createCompletionItem('test.ipynb', 1),
            createCompletionItem('foo/', 2)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [];
        const filtered = filterCompletions(
            undefined,
            true,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 7)
        );
        assert.isNotEmpty(filtered, 'Filtered list should have an item in it');
        assert.equal(filtered.length, 3, 'Wrong number of filtered results');
        assert.ok(
            filtered.find((f) => f.label == 'test.ipynb'),
            'Inside string didnt work'
        );
        assert.ok(
            filtered.find((f) => f.label == 'foo/'),
            'Inside string didnt work'
        );
    });

    test('Duplicates are removed (and pylance trumps dupes)', async () => {
        mockDocument = new MockDocument('print(1)\ndf.', 'test.ipynb', () => Promise.resolve(false));

        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('df.foobar', 0),
            createCompletionItem('df.BAZ', 1)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [
            createCompletionItem('foobar', 0, undefined, vscode.CompletionItemKind.Function),
            createCompletionItem('BAZ', 1, undefined, vscode.CompletionItemKind.Function)
        ];
        const filtered = filterCompletions(
            undefined,
            false,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 3)
        );
        assert.isEmpty(filtered, 'Filtered list should not have any items in it');
    });

    test('Multi level Labels are minimized', async () => {
        mockDocument = new MockDocument('print(1)\ndf.Age.', 'test.ipynb', () => Promise.resolve(false));

        const jupyterCompletions: JupyterCompletionItem[] = [
            createCompletionItem('df.Age.value_count', 0),
            createCompletionItem('df.Age.boxxing', 1)
        ];
        const pylanceCompletions: JupyterCompletionItem[] = [];
        const filtered = filterCompletions(
            undefined,
            true,
            jupyterCompletions,
            pylanceCompletions,
            mockDocument,
            new vscode.Position(1, 7)
        );
        assert.isNotEmpty(filtered, 'Filtered list should have items in it');
        assert.equal(filtered.length, 2, 'Wrong number of filtered results');
        assert.ok(
            filtered.find((f) => f.label == 'value_count'),
            'Multi-level Labels not minimized'
        );
    });
});
