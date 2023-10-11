// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as assert from 'assert';
import * as TypeMoq from 'typemoq';
import { CodeExecutionHelperBase } from './codeExecutionHelper';
import { MockEditor } from '../../../test/datascience/mockTextEditor';
import { IServiceContainer } from '../../ioc/types';
import { Uri, Selection } from 'vscode';
import { MockDocumentManager } from '../../../test/datascience/mockDocumentManager';
import { createMockedDocument } from '../../../test/datascience/editor-integration/helpers';

function initializeMockTextEditor(inputText: string, selection: Selection): MockEditor {
    const file = Uri.file('test.py');
    const mockDocument = createMockedDocument(inputText, file, 1, true);
    const mockTextEditor = new MockEditor(new MockDocumentManager(), mockDocument);
    mockTextEditor.selection = selection;
    return mockTextEditor;
}

const inputText = `print(1)

if (true):
    print(2)
    print(3)
    print('''a multiline
    string''')
    `;

suite('Normalize selected text for execution', () => {
    const serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();

    test('Normalize first line including newline', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(0, 0, 1, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal('print(1)', text);
    });

    test('Normalize several lines', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(0, 0, 7, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal(inputText.trimEnd(), text);
    });

    test('Normalize indented lines', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(3, 0, 5, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal('print(2)\nprint(3)', text);
    });

    test('Normalize indented lines but first line partially selected', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(3, 3, 5, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal('print(2)\nprint(3)', text);
    });

    test('Normalize single indented line', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(3, 4, 3, 12));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal('print(2)', text);
    });

    test('Normalize indented line including leading newline', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(3, 12, 4, 12));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal('\nprint(3)', text);
    });

    test('Normalize a multi-line string', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(5, 0, 7, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal("print('''a multiline\nstring''')", text);
    });
});
