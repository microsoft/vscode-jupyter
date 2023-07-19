// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import TelemetryReporter, {
    RawTelemetryEventProperties,
    TelemetryEventMeasurements,
    TelemetryEventProperties
} from '@vscode/extension-telemetry';
import { assert } from 'chai';
import { setTestExecution, Telemetry } from '../../platform/common/constants';
import { traceInfo } from '../../platform/logging';
import { getTelemetryReporter, setTelemetryReporter } from '../../telemetry';
import { captureScreenShot } from '../common.node';
import { initialize } from '../initialize.node';
import { closeNotebooksAndCleanUpAfterTests, createEmptyPythonNotebook } from './notebook/helper';
import { IDisposable } from '../../platform/common/types';
import { startJupyterServer } from './notebook/helper.node';
import { runNewPythonFile, waitForLastCellToComplete } from './helpers.node';
import { IInteractiveWindowProvider } from '../../interactive-window/types';
import { EventEmitter } from 'vscode';

/* eslint-disable @typescript-eslint/no-explicit-any, no-invalid-this */
suite.skip('Telemetry validation @iw', function () {
    const disposables: IDisposable[] = [];
    let eventsSent: Set<string> = new Set<string>();
    let originalTelemetryReporter: TelemetryReporter | undefined;
    const onDidChangeTelemetryLevel = new EventEmitter<'all' | 'error' | 'crash' | 'off'>();
    const testTelemetryReporter: TelemetryReporter = {
        telemetryLevel: 'all',
        onDidChangeTelemetryLevel: onDidChangeTelemetryLevel.event,
        sendTelemetryEvent: function (
            eventName: string,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements
        ): void {
            eventsSent.add(eventName);
        },
        sendRawTelemetryEvent: function (
            eventName: string,
            _properties?: RawTelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements
        ): void {
            eventsSent.add(eventName);
        },
        sendDangerousTelemetryEvent: function (
            eventName: string,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements,
            _sanitize?: boolean
        ): void {
            eventsSent.add(eventName);
        },
        sendTelemetryErrorEvent: function (
            eventName: string,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements,
            _errorProps?: string[]
        ): void {
            eventsSent.add(eventName);
        },
        sendDangerousTelemetryErrorEvent: function (
            eventName: string,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements,
            _sanitize?: boolean
        ): void {
            eventsSent.add(eventName);
        },
        sendTelemetryException: function (
            _error: Error,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements
        ): void {
            //
        },
        sendDangerousTelemetryException: function (
            _error: Error,
            _properties?: TelemetryEventProperties,
            _measurements?: TelemetryEventMeasurements,
            _sanitize?: boolean
        ): void {
            //
        },
        dispose: async function (): Promise<any> {
            // Do nothing for dispose
        }
    };
    let interactiveWindowProvider: IInteractiveWindowProvider;

    this.timeout(120_000);
    suiteSetup(async function () {
        traceInfo('Suite Setup Telemetry Validation');
        this.timeout(120_000);
        try {
            const api = await initialize();
            interactiveWindowProvider = api.serviceManager.get<IInteractiveWindowProvider>(IInteractiveWindowProvider);
            setTestExecution(false);
            originalTelemetryReporter = await getTelemetryReporter();
            setTelemetryReporter(testTelemetryReporter);
            traceInfo('Suite Setup (completed)');
        } catch (e) {
            traceInfo('Suite Setup (failed) - Execution');
            await captureScreenShot('execution-suite');
            throw e;
        }
    });
    // Use same notebook without starting kernel in every single test (use one for whole suite).
    setup(async function () {
        try {
            setTestExecution(false);
            traceInfo(`Start Test ${this.currentTest?.title}`);
            await startJupyterServer();
            await createEmptyPythonNotebook(disposables);
            traceInfo(`Start Test (completed) ${this.currentTest?.title}`);
        } catch (e) {
            await captureScreenShot(this);
            throw e;
        }
    });
    teardown(async function () {
        traceInfo(`Ended Test ${this.currentTest?.title}`);
        if (this.currentTest?.isFailed()) {
            await captureScreenShot(this);
        }
        setTestExecution(true);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        traceInfo(`Ended Test (completed) ${this.currentTest?.title}`);
        eventsSent.clear();
    });
    suiteTeardown(async () => {
        if (originalTelemetryReporter) {
            setTelemetryReporter(originalTelemetryReporter);
        }
        setTestExecution(true);
        await closeNotebooksAndCleanUpAfterTests(disposables);
        onDidChangeTelemetryLevel.dispose();
    });
    test('Run interactive window', async () => {
        const { activeInteractiveWindow } = await runNewPythonFile(
            interactiveWindowProvider,
            '#%%\na=1\nprint(a)\n#%%\nb=2\nprint(b)\n',
            disposables
        );

        await waitForLastCellToComplete(activeInteractiveWindow);

        // Check for expected events
        const assertEvent = (event: string) => {
            assert.ok(eventsSent.has(event), `Events missing ${event}`);
        };

        // Right now this is the guaranteed list. Might want to expand this.
        assertEvent(Telemetry.RunFileInteractive);
        assertEvent(Telemetry.SwitchKernel);
    });
});
