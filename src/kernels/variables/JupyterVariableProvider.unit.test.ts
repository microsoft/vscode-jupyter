// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { JupyterVariablesProvider } from './JupyterVariablesProvider';
import { NotebookDocument, CancellationTokenSource, VariablesResult, Variable } from 'vscode';
import { mock, instance, when, anything, verify, objectContaining } from 'ts-mockito';
import { IKernelProvider, IKernel } from '../types';
import { IJupyterVariables, IVariableDescription } from './types';

suite('JupyterVariablesProvider', () => {
    let variables: IJupyterVariables;
    let kernelProvider: IKernelProvider;
    let provider: JupyterVariablesProvider;
    const notebook = mock<NotebookDocument>();
    const cancellationToken = new CancellationTokenSource().token;

    const objectVariable: IVariableDescription = {
        name: 'myObject',
        value: '...',
        root: 'myObject',
        properties: ['myList'],
        propertyChain: []
    };

    const listVariable: IVariableDescription = {
        name: 'myList',
        value: '[...]',
        count: 3,
        root: 'myObject',
        propertyChain: ['myList']
    };

    function createListItem(index: number): IVariableDescription {
        return {
            name: index.toString(),
            value: `value${index}`,
            count: index,
            root: 'myObject',
            propertyChain: ['myList', index]
        };
    }

    async function provideVariables(parent: Variable | undefined) {
        const results: VariablesResult[] = [];
        for await (const result of provider.provideVariables(
            instance(notebook),
            parent,
            1, // Named
            0,
            cancellationToken
        )) {
            results.push(result);
        }
        return results;
    }

    const listVariableItems = [0, 1, 2].map(createListItem);

    setup(() => {
        variables = mock<IJupyterVariables>();
        kernelProvider = mock<IKernelProvider>();
        provider = new JupyterVariablesProvider(instance(variables), instance(kernelProvider));
    });

    test('provideVariables without parent should yield variables', async () => {
        const kernel = mock<IKernel>();

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([objectVariable])
        );
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const results = await provideVariables(undefined);

        assert.isNotEmpty(results);
        assert.equal(results.length, 1);
        assert.equal(results[0].variable.name, 'myObject');
    });

    test('provideVariables with a parent should call get children correctly', async () => {
        const kernel = mock<IKernel>();

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([objectVariable])
        );
        when(
            variables.getAllVariableDiscriptions(
                anything(),
                objectContaining({ root: 'myObject', propertyChain: [] }),
                anything()
            )
        ).thenReturn(Promise.resolve([listVariable]));
        when(
            variables.getAllVariableDiscriptions(
                anything(),
                objectContaining({ root: 'myObject', propertyChain: ['myList'] }),
                anything()
            )
        ).thenReturn(Promise.resolve(listVariableItems));
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        // pass each the result as the parent in the next call
        let rootVariable = (await provideVariables(undefined))[0];
        const listResult = (await provideVariables(rootVariable!.variable))[0];
        const listItems = await provideVariables(listResult!.variable);

        assert.equal(listResult.variable.name, 'myList');
        assert.isNotEmpty(listItems);
        assert.equal(listItems.length, 3);
        listItems.forEach((item, index) => {
            assert.equal(item.variable.name, index.toString());
            assert.equal(item.variable.value, `value${index}`);
        });
    });

    test('Getting variables again with new execution count should get updated variables', async () => {
        const kernel = mock<IKernel>();
        const intVariable: IVariableDescription = {
            name: 'myInt',
            value: '1',
            root: '',
            propertyChain: []
        };

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything()))
            .thenReturn(Promise.resolve([intVariable]))
            .thenReturn(Promise.resolve([{ ...intVariable, value: '2' }]));

        when(kernelProvider.getKernelExecution(anything()))
            .thenReturn({ executionCount: 1 } as any)
            .thenReturn({ executionCount: 2 } as any);

        const first = await provideVariables(undefined);
        const second = await provideVariables(undefined);

        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0].variable.value, '1');
        assert.equal(second[0].variable.value, '2');
    });

    test('Getting variables again with same execution count should not make another call', async () => {
        const kernel = mock<IKernel>();
        const intVariable: IVariableDescription = {
            name: 'myInt',
            value: '1',
            root: '',
            propertyChain: []
        };

        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        when(variables.getAllVariableDiscriptions(anything(), undefined, anything())).thenReturn(
            Promise.resolve([intVariable])
        );

        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const first = await provideVariables(undefined);
        const second = await provideVariables(undefined);

        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0].variable.value, '1');

        verify(variables.getAllVariableDiscriptions(anything(), undefined, anything())).once();
    });
});
