// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { assert } from 'chai';
import { anything, capture, instance, mock, verify, when } from 'ts-mockito';
import { ApplicationShell } from '../../../../platform/common/application/applicationShell';
import { IApplicationShell, IWorkspaceService } from '../../../../platform/common/application/types';
import { WorkspaceService } from '../../../../platform/common/application/workspace';
import { PathUtils } from '../../../../platform/common/platform/pathUtils';
import { IPathUtils } from '../../../../platform/common/types';
import { IInterpreterSelector } from '../../../../platform/interpreter/configuration/types';
import { JupyterInterpreterSelector } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterSelector';
import { JupyterInterpreterStateStore } from '../../../../kernels/jupyter/interpreter/jupyterInterpreterStateStore';

suite('DataScience - Jupyter Interpreter Picker', () => {
    let picker: JupyterInterpreterSelector;
    let interpreterSelector: IInterpreterSelector;
    let appShell: IApplicationShell;
    let interpreterSelectionState: JupyterInterpreterStateStore;
    let workspace: IWorkspaceService;
    let pathUtils: IPathUtils;

    setup(() => {
        interpreterSelector = mock<IInterpreterSelector>();
        interpreterSelectionState = mock(JupyterInterpreterStateStore);
        appShell = mock(ApplicationShell);
        workspace = mock(WorkspaceService);
        pathUtils = mock(PathUtils);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        picker = new JupyterInterpreterSelector(
            instance(interpreterSelector),
            instance(appShell),
            instance(interpreterSelectionState),
            instance(workspace),
            instance(pathUtils)
        );
    });

    test('Should display the list of interpreters', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interpreters = ['something'] as any[];
        when(interpreterSelector.getSuggestions(undefined)).thenResolve(interpreters);
        when(appShell.showQuickPick(anything(), anything())).thenResolve();

        await picker.selectInterpreter();

        verify(interpreterSelector.getSuggestions(undefined)).once();
        verify(appShell.showQuickPick(anything(), anything())).once();
    });
    test('Selected interpreter must be returned', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interpreters = ['something'] as any[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interpreter = {} as any;
        when(interpreterSelector.getSuggestions(undefined)).thenResolve(interpreters);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        when(appShell.showQuickPick(anything(), anything())).thenResolve({ interpreter } as any);

        const selected = await picker.selectInterpreter();

        assert.isOk(selected === interpreter, 'Not the same instance');
    });
    test('Should display current interpreter path in the picker', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const interpreters = ['something'] as any[];
        const displayPath = 'Display Path';
        when(interpreterSelectionState.selectedPythonPath).thenReturn('jupyter.exe');
        when(pathUtils.getDisplayName('jupyter.exe', anything())).thenReturn(displayPath);
        when(interpreterSelector.getSuggestions(undefined)).thenResolve(interpreters);
        when(appShell.showQuickPick(anything(), anything())).thenResolve();

        await picker.selectInterpreter();

        assert.equal(capture(appShell.showQuickPick).first()[1]?.placeHolder, `current: ${displayPath}`);
    });
});
