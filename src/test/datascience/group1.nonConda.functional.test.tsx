// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as assert from 'assert';
import { Disposable } from 'vscode';

import { InteractiveWindowMessages } from '../../client/datascience/interactive-common/interactiveWindowTypes';
import { DataScienceIocContainer } from './dataScienceIocContainer';
import { takeSnapshot, writeDiffSnapshot } from './helpers';
import {
    addCode,
    getOrCreateInteractiveWindow,
    runTest
} from './interactiveWindowTestHelpers';
import {
    CellPosition,
    verifyHtmlOnCell} from './testHelpers';
// tslint:disable-next-line: no-require-imports no-var-requires

// tslint:disable:max-func-body-length trailing-comma no-any no-multiline-string
suite('DataScience Interactive Window output tests', () => {
    const disposables: Disposable[] = [];
    let ioc: DataScienceIocContainer;
    let snapshot: any;

    suiteSetup(() => {
        snapshot = takeSnapshot();
    });
    setup(async () => {
        ioc = new DataScienceIocContainer();
        ioc.registerDataScienceTypes();
        return ioc.activate();
    });

    suiteTeardown(() => {
        writeDiffSnapshot(snapshot, 'Interactive Window');
    });

    teardown(async () => {
        for (const disposable of disposables) {
            if (!disposable) {
                continue;
            }
            // tslint:disable-next-line:no-any
            const promise = disposable.dispose() as Promise<any>;
            if (promise) {
                await promise;
            }
        }
        await ioc.dispose();
    });



    function verifyHtmlOnInteractiveCell(html: string | undefined | RegExp, cellIndex: number | CellPosition) {
        const iw = ioc.getInteractiveWebPanel(undefined).wrapper;
        iw.update();
        verifyHtmlOnCell(iw, 'InteractiveCell', html, cellIndex);
    }

    runTest(
        'Simple text with no python extension',
        async (c) => {
            // Interactive window will attempt to connect so we can only
            // run this test with raw kernel
            if (ioc.isRawKernel) {
                ioc.setPythonExtensionState(false);
                await getOrCreateInteractiveWindow(ioc);

                await addCode(ioc, 'a=1\na');
                verifyHtmlOnInteractiveCell('1', CellPosition.Last);

                assert.ok(
                    !ioc.attemptedPythonExtension,
                    'Python extension installation should not happen on simple open'
                );
            } else {
                c.skip();
            }
        },
        () => {
            return ioc;
        }
    );

    runTest(
        'Saving without python extension',
        async (c) => {
            if (ioc.isRawKernel) {
                ioc.setPythonExtensionState(false);

                await addCode(ioc, 'a=1\na');

                const { window, mount } = await getOrCreateInteractiveWindow(ioc);

                const exportPromise = mount.waitForMessage(InteractiveWindowMessages.ReturnAllCells);
                window.exportCells();
                await exportPromise;

                assert.ok(ioc.attemptedPythonExtension, 'Export should warn user about installing');
            } else {
                c.skip();
            }
        },
        () => {
            return ioc;
        }
    );

});
