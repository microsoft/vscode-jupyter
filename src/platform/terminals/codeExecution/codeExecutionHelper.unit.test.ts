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
    print(3)`;

suite('Normalize selected text for execution', () => {
    const serviceContainer = TypeMoq.Mock.ofType<IServiceContainer>();

    test('getCodeExecutionCommands should return correct commands for Python', () => {
        const editor = initializeMockTextEditor(inputText, new Selection(0, 0, 1, 0));
        const helper = new CodeExecutionHelperBase(serviceContainer.object);
        const text = helper.getSelectedTextToExecute(editor);
        assert.equal(text, 'print(1)');
    });
});
