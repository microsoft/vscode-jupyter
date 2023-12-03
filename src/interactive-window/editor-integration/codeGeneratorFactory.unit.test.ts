// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { instance, mock, when } from 'ts-mockito';
import { EventEmitter, NotebookDocument } from 'vscode';
import { dispose } from '../../platform/common/utils/lifecycle';
import { IConfigurationService, IDisposable } from '../../platform/common/types';
import { CodeGenerator } from './codeGenerator';
import { CodeGeneratorFactory } from './codeGeneratorFactory';
import { GeneratedCodeStorage } from './generatedCodeStorage';
import { GeneratedCodeStorageFactory } from './generatedCodeStorageFactory';
import { IGeneratedCodeStorageFactory } from './types';
import { mockedVSCodeNamespaces } from '../../test/vscode-mock';

suite('CodeGeneratorFactory', () => {
    let factory: CodeGeneratorFactory;
    let configService: IConfigurationService;
    let storageFactory: IGeneratedCodeStorageFactory;
    let disposables: IDisposable[] = [];
    let onDidCloseNotebookDocument: EventEmitter<NotebookDocument>;
    let clearMethodOnStorage: sinon.SinonSpy<[], void>;
    setup(() => {
        configService = mock<IConfigurationService>();
        storageFactory = new GeneratedCodeStorageFactory();
        onDidCloseNotebookDocument = new EventEmitter<NotebookDocument>();
        when(mockedVSCodeNamespaces.workspace.onDidCloseNotebookDocument).thenReturn(onDidCloseNotebookDocument.event);
        disposables.push(onDidCloseNotebookDocument);
        factory = new CodeGeneratorFactory(instance(configService), storageFactory, disposables);
        factory.activate();
        clearMethodOnStorage = sinon.spy(GeneratedCodeStorage.prototype, 'clear');
    });
    teardown(() => {
        disposables = dispose(disposables);
        sinon.restore();
    });
    test('Return nothing for unknown notebooks', () => {
        const nb = instance(mock<NotebookDocument>());
        const generator = factory.get(nb);
        assert.isUndefined(generator);
    });
    test('Return existing generator & dispose when nb is closed', () => {
        const nb1 = instance(mock<NotebookDocument>());
        const generator1 = factory.getOrCreate(nb1);
        assert.instanceOf(generator1, CodeGenerator);
        assert.equal(generator1, factory.get(nb1), 'generator for nb1 should be the same');
        assert.equal(generator1, factory.getOrCreate(nb1), 'generator for nb1 should be the same');

        const nb2 = instance(mock<NotebookDocument>());
        const generator2 = factory.getOrCreate(nb2);
        assert.notEqual(generator2, generator1, 'generators should not be the same');
        assert.equal(generator2, factory.get(nb2), 'generator for nb2 should be the same');
        assert.equal(generator2, factory.getOrCreate(nb2), 'generator for nb2 should be the same');

        const nb3 = instance(mock<NotebookDocument>());
        assert.isUndefined(factory.get(nb3), 'There should be no generator associated with nb3');

        // Dispose nb1
        assert.strictEqual(clearMethodOnStorage.callCount, 0, 'Should not have been invoked');
        onDidCloseNotebookDocument.fire(nb1);
        assert.isUndefined(factory.get(nb1), 'There should be no generator associated with nb1');
        assert.strictEqual(clearMethodOnStorage.callCount, 1, 'Should have been invoked once');

        // Dispose nb2
        onDidCloseNotebookDocument.fire(nb2);
        assert.isUndefined(factory.get(nb2), 'There should be no generator associated with nb2');
        assert.strictEqual(clearMethodOnStorage.callCount, 2, 'Should have been invoked 2 times');

        // Dispose nb3
        onDidCloseNotebookDocument.fire(nb3);
        assert.isUndefined(factory.get(nb3), 'There should be no generator associated with nb3');
        assert.strictEqual(clearMethodOnStorage.callCount, 2, 'Invocation count should not change');
    });
});
