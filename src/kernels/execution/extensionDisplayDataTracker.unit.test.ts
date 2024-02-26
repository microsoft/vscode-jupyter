// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type * as nbformat from '@jupyterlab/nbformat';
import { assert } from 'chai';
import { cellOutputToVSCCellOutput } from './helpers';
import { IKernelSession } from '../types';
import { instance, mock } from 'ts-mockito';
import {
    isDisplayDataTrackedTestOnly,
    isDisplayIdTrackedForAnExtension,
    isDisplayIdTrackedForExtension,
    trackDisplayDataForExtension,
    unTrackDisplayDataForExtension
} from './extensionDisplayDataTracker';

suite('Display Data Tracker', () => {
    function createKernel() {
        return mock<IKernelSession>();
    }
    test('Do not track anything', () => {
        const kernel = createKernel();
        const displayDataOutput: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: 1,
            output_type: 'display_data',
            metadata: {
                foo: 'bar'
            }
        };
        const displayDataOutputIncorrectOutput: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: 1,
            output_type: 'execute_result',
            metadata: {
                foo: 'bar'
            }
        };

        trackDisplayDataForExtension('ext1', instance(kernel), cellOutputToVSCCellOutput(displayDataOutput));
        assert.strictEqual(isDisplayDataTrackedTestOnly(instance(kernel)), false, 'Should not be tracking kernel');

        trackDisplayDataForExtension(
            'ext1',
            instance(kernel),
            cellOutputToVSCCellOutput(displayDataOutputIncorrectOutput)
        );
        assert.strictEqual(isDisplayDataTrackedTestOnly(instance(kernel)), false, 'Should not be tracking kernel');
    });
    test('Track & untrack display data', () => {
        const kernel = createKernel();
        const displayDataOutput: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: 1,
            transient: {
                display_id: '123'
            },
            output_type: 'display_data',
            metadata: {
                foo: 'bar'
            }
        };

        trackDisplayDataForExtension('ext1', instance(kernel), cellOutputToVSCCellOutput(displayDataOutput));
        assert.strictEqual(isDisplayDataTrackedTestOnly(instance(kernel)), true, 'Should be tracking kernel');

        assert.strictEqual(
            isDisplayIdTrackedForAnExtension(instance(kernel), '123'),
            true,
            'Should be tracking display id'
        );
        assert.strictEqual(
            isDisplayIdTrackedForExtension('ext1', instance(kernel), '123'),
            true,
            'Should be tracking display id for extension'
        );

        unTrackDisplayDataForExtension(instance(kernel), '123');
        assert.strictEqual(
            isDisplayIdTrackedForAnExtension(instance(kernel), '123'),
            false,
            'Should not be tracking display id'
        );
        assert.strictEqual(
            isDisplayIdTrackedForExtension('ext1', instance(kernel), '123'),
            false,
            'Should not be tracking display id for extension'
        );
    });
    test('Track & untrack display data', () => {
        const kernel = createKernel();
        const displayDataOutput: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: 2000,
            transient: {
                display_id: '2000'
            },
            output_type: 'display_data',
            metadata: {
                foo: 'bar'
            }
        };
        trackDisplayDataForExtension('ext1', instance(kernel), cellOutputToVSCCellOutput(displayDataOutput));
        assert.strictEqual(
            isDisplayIdTrackedForAnExtension(instance(kernel), '2000'),
            true,
            'Should be tracking display id'
        );
        assert.strictEqual(
            isDisplayIdTrackedForExtension('ext1', instance(kernel), '2000'),
            true,
            'Should be tracking display id for extension'
        );

        // Track 999, and verify they are all tracked
        for (let i = 1; i <= 999; i += 1) {
            const displayId = i.toString();
            const output: nbformat.IOutput = {
                data: {
                    'application/vnd.custom': { one: 1, two: 2 },
                    'text/plain': 'Hello World'
                },
                execution_count: i,
                transient: {
                    display_id: displayId
                },
                output_type: 'display_data',
                metadata: {
                    foo: 'bar'
                }
            };

            trackDisplayDataForExtension('ext1', instance(kernel), cellOutputToVSCCellOutput(output));
            assert.strictEqual(
                isDisplayIdTrackedForAnExtension(instance(kernel), displayId),
                true,
                'Should be tracking display id'
            );
            assert.strictEqual(
                isDisplayIdTrackedForExtension('ext1', instance(kernel), displayId),
                true,
                'Should be tracking display id for extension'
            );
        }

        // Verify the first item still exists.
        assert.strictEqual(
            isDisplayIdTrackedForAnExtension(instance(kernel), '2000'),
            true,
            'Should be tracking display id'
        );
        assert.strictEqual(
            isDisplayIdTrackedForExtension('ext1', instance(kernel), '2000'),
            true,
            'Should be tracking display id for extension'
        );

        // Moment we add another, then the first one should be gone.
        const output: nbformat.IOutput = {
            data: {
                'application/vnd.custom': { one: 1, two: 2 },
                'text/plain': 'Hello World'
            },
            execution_count: '1000',
            transient: {
                display_id: '1000'
            },
            output_type: 'display_data',
            metadata: {
                foo: 'bar'
            }
        };

        trackDisplayDataForExtension('ext1', instance(kernel), cellOutputToVSCCellOutput(output));
        assert.strictEqual(
            isDisplayIdTrackedForAnExtension(instance(kernel), '2000'),
            false,
            'Should not be tracking display id'
        );
        assert.strictEqual(
            isDisplayIdTrackedForExtension('ext1', instance(kernel), '2000'),
            false,
            'Should not be tracking display id for extension'
        );
    });
});
