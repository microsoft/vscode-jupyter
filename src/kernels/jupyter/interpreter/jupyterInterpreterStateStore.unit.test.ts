// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { anything, instance, mock, when } from 'ts-mockito';
import { EventEmitter, Memento } from 'vscode';
import { arePathsSame } from '../../../platform/common/platform/fileUtils';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { MockMemento } from '../../../test/mocks/mementos';
import { JupyterInterpreterService } from './jupyterInterpreterService.node';
import { JupyterInterpreterStateStore } from './jupyterInterpreterStateStore';

suite('Jupyter Interpreter State', () => {
    let selected: JupyterInterpreterStateStore;
    let memento: Memento;
    let interpreterService: JupyterInterpreterService;
    let interpreterSelectedEventEmitter: EventEmitter<PythonEnvironment>;

    setup(() => {
        memento = mock(MockMemento);
        interpreterService = mock(JupyterInterpreterService);
        when(memento.update(anything(), anything())).thenResolve();
        interpreterSelectedEventEmitter = new EventEmitter<PythonEnvironment>();
        when(interpreterService.onDidChangeInterpreter).thenReturn(interpreterSelectedEventEmitter.event);
        selected = new JupyterInterpreterStateStore(instance(memento));
    });

    test('Interpreter should not be set for fresh installs', async () => {
        when(memento.get(anything(), false)).thenReturn(false);

        assert.isFalse(selected.interpreterSetAtleastOnce);
    });
    test('If memento is set (for subsequent sesssions), return true', async () => {
        const uri = 'jupyter.exe';
        when(memento.get<string | undefined>(anything(), undefined)).thenReturn(uri);

        assert.isOk(selected.interpreterSetAtleastOnce);
    });
    test('Get python path from memento', async () => {
        const uri = 'jupyter.exe';
        when(memento.get<string | undefined>(anything(), undefined)).thenReturn(uri);

        assert.isTrue(arePathsSame(selected.selectedPythonPath!.fsPath, uri));
    });
});
