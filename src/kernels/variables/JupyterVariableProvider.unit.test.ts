// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { JupyterVariablesProvider } from './JupyterVariablesProvider';
import { NotebookDocument, CancellationTokenSource, EventEmitter, VariablesResult, Variable, Uri } from 'vscode';
import { mock, instance, when, anything, verify, objectContaining } from 'ts-mockito';
import { IKernelProvider, IKernel } from '../types';
import { IJupyterVariables, IVariableDescription } from './types';

suite.only('JupyterVariablesProvider', () => {
    let variables: IJupyterVariables;
    let kernelProvider: IKernelProvider;
    let kernelEventEmitter = new EventEmitter<{ status: any; kernel: IKernel }>();
    let provider: JupyterVariablesProvider;
    const notebook = mock<NotebookDocument>();
    const cancellationToken = new CancellationTokenSource().token;
    const kernel = mock<IKernel>();

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

    function setVariablesForParent(
        parent: IVariableDescription | undefined,
        result: IVariableDescription[],
        updated?: IVariableDescription[],
        startIndex?: number
    ) {
        const whenCallHappens = when(
            variables.getAllVariableDiscriptions(anything(), parent, startIndex ?? anything(), anything())
        );

        whenCallHappens.thenReturn(Promise.resolve(result));
        if (updated) {
            whenCallHappens.thenReturn(Promise.resolve(updated));
        }
    }

    async function provideVariables(parent: Variable | undefined, kind = 1) {
        const results: VariablesResult[] = [];
        for await (const result of provider.provideVariables(instance(notebook), parent, kind, 0, cancellationToken)) {
            results.push(result);
        }
        return results;
    }

    setup(() => {
        variables = mock<IJupyterVariables>();
        kernelProvider = mock<IKernelProvider>();
        when(kernelProvider.onKernelStatusChanged).thenReturn(kernelEventEmitter.event);
        when(kernelProvider.get(anything())).thenReturn(instance(kernel));
        provider = new JupyterVariablesProvider(instance(variables), instance(kernelProvider), []);
    });

    test('provideVariables without parent should yield variables', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);
        setVariablesForParent(undefined, [objectVariable]);

        const results = await provideVariables(undefined);

        assert.isNotEmpty(results);
        assert.equal(results.length, 1);
        assert.equal(results[0].variable.name, 'myObject');
        assert.equal(results[0].variable.expression, 'myObject');
    });

    test('provideVariables with a parent should call get children correctly', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const listVariableItems = [0, 1, 2].map(createListItem);
        setVariablesForParent(undefined, [objectVariable]);
        setVariablesForParent(objectContaining({ root: 'myObject', propertyChain: [] }), [listVariable]);
        setVariablesForParent(objectContaining({ root: 'myObject', propertyChain: ['myList'] }), listVariableItems);

        // pass each the result as the parent in the next call
        let rootVariable = (await provideVariables(undefined))[0];
        const listResult = (await provideVariables(rootVariable!.variable))[0];
        const listItems = await provideVariables(listResult!.variable, 2);

        assert.equal(listResult.variable.name, 'myList');
        assert.equal(listResult.variable.expression, 'myObject.myList');
        assert.isNotEmpty(listItems);
        assert.equal(listItems.length, 3);
        listItems.forEach((item, index) => {
            assert.equal(item.variable.name, index.toString());
            assert.equal(item.variable.value, `value${index}`);
            assert.equal(item.variable.expression, `myObject.myList[${index}]`);
        });
    });

    test('All indexed variables should be returned when requested', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const listVariable: IVariableDescription = {
            name: 'myList',
            value: '[...]',
            count: 6,
            root: 'myList',
            propertyChain: []
        };

        const firstPage = [0, 1, 2].map(createListItem);
        const secondPage = [3, 4, 5].map(createListItem);
        setVariablesForParent(undefined, [listVariable]);
        setVariablesForParent(objectContaining({ root: 'myList', propertyChain: [] }), firstPage, undefined, 0);
        setVariablesForParent(
            objectContaining({ root: 'myList', propertyChain: [] }),
            secondPage,
            undefined,
            firstPage.length
        );

        const rootVariable = (await provideVariables(undefined))[0];
        const listItemResult = await provideVariables(rootVariable!.variable, 2);

        assert.equal(listItemResult.length, 6, 'full list of items should be returned');
        listItemResult.forEach((item, index) => {
            assert.equal(item.variable.name, index.toString());
            assert.equal(item.variable.value, `value${index}`);
        });
    });

    test('Getting less indexed items than the specified count is handled', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const listVariable: IVariableDescription = {
            name: 'myList',
            value: '[...]',
            count: 6,
            root: 'myList',
            propertyChain: []
        };

        const firstPage = [0, 1, 2].map(createListItem);
        const secondPage = [3, 4].map(createListItem);
        setVariablesForParent(undefined, [listVariable]);
        setVariablesForParent(objectContaining({ root: 'myList', propertyChain: [] }), firstPage, undefined, 0);
        setVariablesForParent(
            objectContaining({ root: 'myList', propertyChain: [] }),
            secondPage,
            undefined,
            firstPage.length
        );
        setVariablesForParent(objectContaining({ root: 'myList', propertyChain: [] }), [], undefined, 5);

        const rootVariable = (await provideVariables(undefined))[0];
        const listItemResult = await provideVariables(rootVariable!.variable, 2);

        assert.equal(listItemResult.length, 5);
        listItemResult.forEach((item, index) => {
            assert.equal(item.variable.name, index.toString());
            assert.equal(item.variable.value, `value${index}`);
        });
    });

    test('Getting variables again with new execution count should get updated variables', async () => {
        when(kernelProvider.getKernelExecution(anything()))
            .thenReturn({ executionCount: 1 } as any)
            .thenReturn({ executionCount: 2 } as any);

        const intVariable: IVariableDescription = {
            name: 'myInt',
            value: '1',
            root: '',
            propertyChain: []
        };
        setVariablesForParent(undefined, [intVariable], [{ ...intVariable, value: '2' }]);

        const first = await provideVariables(undefined);
        const second = await provideVariables(undefined);

        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0].variable.value, '1');
        assert.equal(second[0].variable.value, '2');
    });

    test('Getting variables again with same execution count should not make another call', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const intVariable: IVariableDescription = {
            name: 'myInt',
            value: '1',
            root: '',
            propertyChain: []
        };

        setVariablesForParent(undefined, [intVariable]);

        const first = await provideVariables(undefined);
        const second = await provideVariables(undefined);

        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
        assert.equal(first[0].variable.value, '1');

        verify(variables.getAllVariableDiscriptions(anything(), anything(), anything(), anything())).once();
    });

    test('Cache pages of indexed children correctly', async () => {
        when(kernelProvider.getKernelExecution(anything())).thenReturn({ executionCount: 1 } as any);

        const listVariable: IVariableDescription = {
            name: 'myList',
            value: '[...]',
            count: 6,
            root: 'myList',
            propertyChain: []
        };

        const firstPage = [0, 1, 2].map(createListItem);
        const secondPage = [3, 4, 5].map(createListItem);
        setVariablesForParent(undefined, [listVariable]);
        setVariablesForParent(objectContaining({ root: 'myList', propertyChain: [] }), firstPage, undefined, 0);
        setVariablesForParent(
            objectContaining({ root: 'myList', propertyChain: [] }),
            secondPage,
            undefined,
            firstPage.length
        );

        const rootVariable = (await provideVariables(undefined))[0];
        await provideVariables(rootVariable!.variable, 2);

        // once for the parent and once for each of the two pages of list items
        verify(variables.getAllVariableDiscriptions(anything(), anything(), anything(), anything())).thrice();

        const listItemResult = await provideVariables(rootVariable!.variable, 2);

        assert.equal(listItemResult.length, 6, 'full list of items should be returned');
        listItemResult.forEach((item, index) => {
            assert.equal(item.variable.name, index.toString());
            assert.equal(item.variable.value, `value${index}`);
        });

        // no extra calls for getting the children again
        verify(variables.getAllVariableDiscriptions(anything(), anything(), anything(), anything())).thrice();
    });

    function fireKernelStatusChange(notebook: string, status: string) {
        kernelEventEmitter.fire({
            status: status,
            kernel: {
                id: notebook,
                status: status,
                notebook: { uri: Uri.file(notebook) } as NotebookDocument
            } as IKernel
        });
    }

    test('Kernel restart should trigger variable changes', async () => {
        let variablesChangedForNotebooks: string[] = [];
        provider.onDidChangeVariables((e) => {
            variablesChangedForNotebooks.push(e.uri.path);
        });

        fireKernelStatusChange('/1.ipynb', 'idle');
        fireKernelStatusChange('/1.ipynb', 'busy');
        fireKernelStatusChange('/1.ipynb', 'idle');
        fireKernelStatusChange('/1.ipynb', 'restarting');
        fireKernelStatusChange('/1.ipynb', 'idle');

        assert.equal(variablesChangedForNotebooks.length, 1, 'variable change event should have fired once');
        assert.equal(variablesChangedForNotebooks[0], '/1.ipynb');
    });

    test('Kernel restart should trigger variable changes for each notebook', async () => {
        let variablesChangedForNotebooks: string[] = [];
        provider.onDidChangeVariables((e) => {
            variablesChangedForNotebooks.push(e.uri.path);
        });

        fireKernelStatusChange('/1.ipynb', 'idle');
        fireKernelStatusChange('/2.ipynb', 'idle');

        fireKernelStatusChange('/1.ipynb', 'autorestarting');
        fireKernelStatusChange('/1.ipynb', 'unknown'); // extra status updates that should not trigger additional change events
        fireKernelStatusChange('/1.ipynb', 'dead');
        fireKernelStatusChange('/1.ipynb', 'restarting');

        fireKernelStatusChange('/2.ipynb', 'restarting');

        fireKernelStatusChange('/1.ipynb', 'idle');
        fireKernelStatusChange('/2.ipynb', 'idle');

        assert.equal(
            variablesChangedForNotebooks.length,
            2,
            'variable change event should have fired for each restart from a healthy state'
        );
        assert.include(variablesChangedForNotebooks, '/1.ipynb');
        assert.include(variablesChangedForNotebooks, '/2.ipynb');
    });
});
