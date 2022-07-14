/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import {
    CancellationTokenSource,
    ConfigurationChangeEvent,
    Diagnostic,
    DiagnosticCollection,
    EventEmitter,
    Range,
    TextDocument,
    TextEditor,
    Uri,
    WorkspaceConfiguration
} from 'vscode';
import { IWorkspaceService } from '../../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../../platform/common/constants';
import { disposeAllDisposables } from '../../../platform/common/helpers';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { IDisposable } from '../../../platform/common/types';
import { ignoreListSettingName } from '../../../platform/interpreter/reservedNamedProvider.node';
import { IReservedPythonNamedProvider } from '../../../platform/interpreter/types';
import { ResourceMap } from '../../../platform/vscode-path/map';
import {
    enabledSettingName,
    ReservedFileNamesDiagnosticProvider
} from '../../../standalone/diagnostics/reservedFileNameDiagnostics.node';
import { sleep } from '../../core';
import { uriEquals } from '../../datascience/helpers';
import { mockedVSCodeNamespaces } from '../../vscode-mock';
import { DataScience } from '../../../platform/common/utils/localize';

suite('Reserved Names Diagnostics Provider', () => {
    const disposables: IDisposable[] = [];
    let reservedNamedProvider: IReservedPythonNamedProvider;
    let diagnosticProvider: ReservedFileNamesDiagnosticProvider;
    let workspace: IWorkspaceService;
    let fs: IFileSystemNode;
    let workspaceConfig: WorkspaceConfiguration;
    let settingsChanged: EventEmitter<ConfigurationChangeEvent>;
    let onDidChangeActiveTextEditor: EventEmitter<TextEditor | undefined>;
    let onDidCloseTextDocument: EventEmitter<TextDocument>;
    const defaultIgnoreList = ['**/site-packages/**', '**/lib/python/**', '**/lib64/python/**'];
    let diagnosticCollectionItems = new ResourceMap<Diagnostic[]>();
    let cancellationToken: CancellationTokenSource;
    setup(() => {
        onDidChangeActiveTextEditor = new EventEmitter<TextEditor | undefined>();
        onDidCloseTextDocument = new EventEmitter<TextDocument>();
        reservedNamedProvider = mock<IReservedPythonNamedProvider>();
        workspace = mock<IWorkspaceService>();
        fs = mock<IFileSystemNode>();
        workspaceConfig = mock<WorkspaceConfiguration>();
        cancellationToken = new CancellationTokenSource();
        disposables.push(cancellationToken);
        when(workspace.getConfiguration('jupyter')).thenReturn(instance(workspaceConfig));
        when(workspaceConfig.get(ignoreListSettingName, anything())).thenReturn(defaultIgnoreList);
        when(workspaceConfig.get(enabledSettingName, anything())).thenReturn(true);
        settingsChanged = new EventEmitter<ConfigurationChangeEvent>();
        when(workspace.onDidChangeConfiguration).thenReturn(settingsChanged.event);
        when(mockedVSCodeNamespaces.window.visibleTextEditors).thenReturn([]);
        when(mockedVSCodeNamespaces.workspace.onDidCloseTextDocument).thenReturn(onDidCloseTextDocument.event);
        when(mockedVSCodeNamespaces.window.onDidChangeActiveTextEditor).thenReturn(onDidChangeActiveTextEditor.event);
        when(mockedVSCodeNamespaces.languages.createDiagnosticCollection(anything())).thenCall(() => {
            const mockCollection = mock<DiagnosticCollection>();
            when(mockCollection.clear()).thenCall(() => diagnosticCollectionItems.clear());
            when(mockCollection.delete(anything())).thenCall((uri) => diagnosticCollectionItems.delete(uri));
            when(mockCollection.get(anything())).thenCall((uri) => diagnosticCollectionItems.get(uri));
            when(mockCollection.has(anything())).thenCall((uri) => diagnosticCollectionItems.has(uri));
            when(mockCollection.set(anything(), anything())).thenCall((uri, value) =>
                diagnosticCollectionItems.set(uri, value)
            );
            when(mockCollection.forEach(anything())).thenCall((cb) => diagnosticCollectionItems.forEach(cb));
            return instance(mockCollection);
        });
        diagnosticProvider = new ReservedFileNamesDiagnosticProvider(
            instance(reservedNamedProvider),
            instance(fs),
            instance(workspace)
        );
        disposables.push(diagnosticProvider);
        disposables.push(onDidChangeActiveTextEditor);
        disposables.push(onDidCloseTextDocument);
    });
    teardown(() => {
        disposeAllDisposables(disposables);
        diagnosticCollectionItems.clear();
    });
    test('Produces diagnostics', async () => {
        const uri = Uri.file('textdocument.py');
        const textDoc = mock<TextDocument>();
        when(textDoc.uri).thenReturn(uri);
        when(textDoc.languageId).thenReturn(PYTHON_LANGUAGE);
        when(textDoc.lineCount).thenReturn(10);
        when(textDoc.lineAt(anything())).thenCall(() => {
            return {
                range: new Range(10, 0, 10, 10)
            };
        });
        const textEditor = mock<TextEditor>();
        when(textEditor.document).thenReturn(instance(textDoc));
        when(mockedVSCodeNamespaces.window.visibleTextEditors).thenReturn([instance(textEditor)]);
        when(reservedNamedProvider.isReserved(uriEquals(uri))).thenResolve(true);

        await diagnosticProvider.activate();

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 1);
        const diagnostics = diagnosticCollectionItems.get(uri)!;
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, DataScience.pythonFileOverridesPythonPackage());

        // Clear the diagnostics when the document is closed.
        onDidCloseTextDocument.fire(instance(textDoc));

        assert.strictEqual(diagnosticCollectionItems.size, 0);
    });
    test('Test enable/disabling of feature', async () => {
        when(workspaceConfig.get(enabledSettingName, anything())).thenReturn(false);
        const uri = Uri.file('textdocument.py');
        const textDoc = mock<TextDocument>();
        when(textDoc.uri).thenReturn(uri);
        when(textDoc.languageId).thenReturn(PYTHON_LANGUAGE);
        when(textDoc.lineCount).thenReturn(10);
        when(textDoc.lineAt(anything())).thenCall(() => {
            return {
                range: new Range(10, 0, 10, 10)
            };
        });
        const textEditor = mock<TextEditor>();
        when(textEditor.document).thenReturn(instance(textDoc));
        when(mockedVSCodeNamespaces.window.visibleTextEditors).thenReturn([instance(textEditor)]);
        when(reservedNamedProvider.isReserved(uriEquals(uri))).thenResolve(true);

        await diagnosticProvider.activate();

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 0);

        // Upon enabling the feature, we should get the diagnostic for currently opened documents.
        when(workspaceConfig.get(enabledSettingName, anything())).thenReturn(true);
        settingsChanged.fire({
            affectsConfiguration: (section) => section === `jupyter.${enabledSettingName}`
        });

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 1);
        const diagnostics = diagnosticCollectionItems.get(uri)!;
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, DataScience.pythonFileOverridesPythonPackage());

        // Disabling the feature should clear the diagnostics.
        when(workspaceConfig.get(enabledSettingName, anything())).thenReturn(false);
        settingsChanged.fire({
            affectsConfiguration: (section) => section === `jupyter.${enabledSettingName}`
        });

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 0);
    });
    test('Does not produce diagnostics', async () => {
        const uri = Uri.file('textdocument.py');
        const textDoc = mock<TextDocument>();
        when(textDoc.uri).thenReturn(uri);
        when(textDoc.languageId).thenReturn(PYTHON_LANGUAGE);
        when(textDoc.lineCount).thenReturn(10);
        when(textDoc.lineAt(anything())).thenCall(() => {
            return {
                range: new Range(10, 0, 10, 10)
            };
        });
        const textEditor = mock<TextEditor>();
        when(textEditor.document).thenReturn(instance(textDoc));
        when(mockedVSCodeNamespaces.window.visibleTextEditors).thenReturn([instance(textEditor)]);
        when(reservedNamedProvider.isReserved(uriEquals(uri))).thenResolve(false);

        await diagnosticProvider.activate();

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 0);
    });
    test('Produces diagnostics when a new document is opened', async () => {
        const uri = Uri.file('textdocument.py');
        const textDoc = mock<TextDocument>();
        when(textDoc.uri).thenReturn(uri);
        when(textDoc.languageId).thenReturn(PYTHON_LANGUAGE);
        when(textDoc.lineCount).thenReturn(10);
        when(textDoc.lineAt(anything())).thenCall(() => {
            return {
                range: new Range(10, 0, 10, 10)
            };
        });
        const textEditor = mock<TextEditor>();
        when(textEditor.document).thenReturn(instance(textDoc));
        when(mockedVSCodeNamespaces.window.visibleTextEditors).thenReturn([]);
        when(reservedNamedProvider.isReserved(uriEquals(uri))).thenResolve(true);

        await diagnosticProvider.activate();

        await sleep(1);

        assert.strictEqual(diagnosticCollectionItems.size, 0);

        // Open the document.
        onDidChangeActiveTextEditor.fire(instance(textEditor));

        await sleep(1);
        const diagnostics = diagnosticCollectionItems.get(uri)!;
        assert.strictEqual(diagnostics.length, 1);
        assert.strictEqual(diagnostics[0].message, DataScience.pythonFileOverridesPythonPackage());
    });
    test('Test providing file decorations', async () => {
        await diagnosticProvider.activate();

        when(reservedNamedProvider.isReserved(uriEquals(Uri.file('xml.py')))).thenResolve(true);
        const decoration = await diagnosticProvider.provideFileDecoration(Uri.file('xml.py'), cancellationToken.token);
        assert.strictEqual(decoration?.tooltip, DataScience.pythonFileOverridesPythonPackage());

        when(reservedNamedProvider.isReserved(uriEquals(Uri.file('xml.ts')))).thenResolve(false);
        assert.isUndefined(await diagnosticProvider.provideFileDecoration(Uri.file('xml.ts'), cancellationToken.token));

        when(reservedNamedProvider.isReserved(uriEquals(Uri.file('something else.py')))).thenResolve(false);
        assert.isUndefined(
            await diagnosticProvider.provideFileDecoration(Uri.file('something else.py'), cancellationToken.token)
        );

        // Disable and try again.
        when(workspaceConfig.get(enabledSettingName, anything())).thenReturn(false);
        settingsChanged.fire({
            affectsConfiguration: (section) => section === `jupyter.${enabledSettingName}`
        });
        when(reservedNamedProvider.isReserved(anything())).thenResolve(true);

        assert.isUndefined(await diagnosticProvider.provideFileDecoration(Uri.file('xml.py'), cancellationToken.token));
        assert.isUndefined(await diagnosticProvider.provideFileDecoration(Uri.file('xml.ts'), cancellationToken.token));
        assert.isUndefined(
            await diagnosticProvider.provideFileDecoration(Uri.file('something else.py'), cancellationToken.token)
        );
    });
});
