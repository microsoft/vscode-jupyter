// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { JupyterVariablesProvider } from './JupyterVariablesProvider';
import { NotebookDocument, CancellationToken, NotebookVariablesRequestKind, VariablesResult } from 'vscode';
import { mock, instance, when, anything, verify } from 'ts-mockito';
import { IKernelProvider, IKernel } from '../types';
import { IJupyterVariables, IVariableDescription } from './types';

suite('JupyterVariablesProvider', () => {
    let variables: IJupyterVariables;
    let kernelProvider: IKernelProvider;
    let provider: JupyterVariablesProvider;
    const notebook = mock<NotebookDocument>();
    const cancellationToken = mock<CancellationToken>();

    const listVariable: IVariableDescription = {
        name: 'myList',
        value: '[...]',
        count: 3,
        root: 'myList',
        propertyChain: []
    };

    const listItem: IVariableDescription = {
        name: '1',
        value: 'value1',
        count: 0,
        root: 'myList',
        propertyChain: [1]
    };

    setup(() => {
        variables = mock<IJupyterVariables>();
        kernelProvider = mock<IKernelProvider>();
        provider = new JupyterVariablesProvider(instance(variables), instance(kernelProvider));
    });

    test('provideVariables without parent should yield variables', async () => {
        const kernel = mock<IKernel>();

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([listVariable])
        );
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 0 } as any);

        const results: VariablesResult[] = [];
        for await (const result of provider.provideVariables(
            instance(notebook),
            undefined,
            NotebookVariablesRequestKind.Named,
            0,
            instance(cancellationToken)
        )) {
            results.push(result);
        }

        assert.isNotEmpty(results);
    });

    test('provideVariables with a parent should call get children correctly', async () => {
        const kernel = mock<IKernel>();

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([listVariable])
        );
        when(variables.getAllVariableDiscriptions(anything(), listVariable, anything())).thenReturn(
            Promise.resolve([listItem])
        );
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 0 } as any);

        const rootVariables = [];
        for await (const result of provider.provideVariables(
            instance(notebook),
            undefined,
            NotebookVariablesRequestKind.Named,
            0,
            instance(cancellationToken)
        )) {
            rootVariables.push(result);
        }

        const children = [];
        for await (const result of provider.provideVariables(
            instance(notebook),
            rootVariables[0].variable,
            NotebookVariablesRequestKind.Named,
            0,
            instance(cancellationToken)
        )) {
            children.push(result);
        }

        assert.isNotEmpty(rootVariables);
    });

    test('Getting variables again with new execution count should get updated variables', async () => {
        const kernel = mock<IKernel>();

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([listVariable])
        );
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 0 } as any);

        const rootVariables = [];
        for await (const result of provider.provideVariables(
            instance(notebook),
            undefined,
            NotebookVariablesRequestKind.Named,
            0,
            instance(cancellationToken)
        )) {
            rootVariables.push(result);
        }

        verify(variables.getAllVariableDiscriptions).twice();
    });
});
