// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import { warnAboutWidgetVersionsThatAreNotSupported } from './incompatibleWidgetHandler';

/* eslint-disable , @typescript-eslint/no-explicit-any */
suite('Incompatible Widgets', () => {
    suite('Using qgrid widget with CDN turned on', () => {
        async function testLoadingQgrid(versionToLoad: string, warningExpectedToBeDisplayed: boolean) {
            let warningDisplayed = false;
            warnAboutWidgetVersionsThatAreNotSupported(
                { moduleName: 'qgrid' },
                versionToLoad,
                true,
                () => (warningDisplayed = true)
            );

            assert.equal(warningDisplayed, warningExpectedToBeDisplayed);
        }
        test('Widget script is not found for qgrid v1.1.0, then do not display a warning', async () => {
            // This test just ensures we never display warnings for 1.1.0.
            // This will never happen as the file exists on CDN.
            // Hence gurantees that we'll not display when not required.
            await testLoadingQgrid('1.1.0', false);
        });
        test('Widget script is not found for qgrid v1.1.1, then do not display a warning', async () => {
            // This test just ensures we never display warnings for 1.1.0.
            // This will never happen as the file exists on CDN.
            // Hence gurantees that we'll not display when not required.
            await testLoadingQgrid('1.1.1', false);
        });
        test('Widget script is not found for qgrid v1.1.2, then display a warning', async () => {
            // We know there are no scripts on CDN for > 1.1.1
            await testLoadingQgrid('1.1.2', true);
        });
        test('Widget script is not found for qgrid v^1.1.2, then display a warning', async () => {
            // We know there are no scripts on CDN for > 1.1.1
            await testLoadingQgrid('^1.1.2', true);
        });
        test('Widget script is not found for qgrid v1.3.0, then display a warning', async () => {
            // We know there are no scripts on CDN for > 1.1.1
            await testLoadingQgrid('1.3.0', true);
        });
        test('Widget script is not found for qgrid v^1.3.0, then display a warning', async () => {
            // We know there are no scripts on CDN for > 1.1.1
            await testLoadingQgrid('^1.3.0', true);
        });
    });
});
