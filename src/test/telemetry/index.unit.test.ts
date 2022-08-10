// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';

/* eslint-disable , , @typescript-eslint/no-explicit-any */
import { expect } from 'chai';
import rewiremock from 'rewiremock';
import * as TypeMoq from 'typemoq';

import { instance, mock, verify, when } from 'ts-mockito';
import { WorkspaceConfiguration } from 'vscode';
import { IWorkspaceService } from '../../platform/common/application/types';
import { WorkspaceService } from '../../platform/common/application/workspace.node';
import { EXTENSION_ROOT_DIR } from '../../platform/constants.node';
import {
    _resetSharedProperties,
    clearTelemetryReporter,
    isTelemetryDisabled,
    sendTelemetryEvent,
    setSharedProperty
} from '../../telemetry';
import {
    isUnitTestExecution,
    isTestExecution,
    setTestExecution,
    setUnitTestExecution
} from '../../platform/common/constants';

suite('Telemetry', () => {
    let workspaceService: IWorkspaceService;
    const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
    const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();

    class Reporter {
        public static eventName: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];
        public static errorProps: string[] | undefined;
        public static clear() {
            Reporter.eventName = [];
            Reporter.properties = [];
            Reporter.measures = [];
            Reporter.errorProps = undefined;
        }
        public sendTelemetryEvent(eventName: string, properties?: {}, measures?: {}) {
            Reporter.eventName.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        }
        public sendTelemetryErrorEvent(eventName: string, properties?: {}, measures?: {}, errorProps?: string[]) {
            this.sendTelemetryEvent(eventName, properties, measures);
            Reporter.errorProps = errorProps;
        }
    }

    setup(() => {
        workspaceService = mock(WorkspaceService);
        setTestExecution(false);
        setUnitTestExecution(false);
        clearTelemetryReporter();
        Reporter.clear();
    });
    teardown(() => {
        setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
        setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
        rewiremock.disable();
        _resetSharedProperties();
    });

    const testsForisTelemetryDisabled = [
        {
            testName: 'Returns true when globalValue is set to false',
            settings: { globalValue: false },
            expectedResult: true
        },
        {
            testName: 'Returns false otherwise',
            settings: {},
            expectedResult: false
        }
    ];

    suite('Function isTelemetryDisabled()', () => {
        testsForisTelemetryDisabled.forEach((testParams) => {
            test(testParams.testName, async () => {
                const workspaceConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
                when(workspaceService.getConfiguration('telemetry')).thenReturn(workspaceConfig.object);
                workspaceConfig
                    .setup((c) => c.inspect<string>('enableTelemetry'))
                    .returns(() => testParams.settings as any)
                    .verifiable(TypeMoq.Times.once());

                expect(isTelemetryDisabled(instance(workspaceService))).to.equal(testParams.expectedResult);

                verify(workspaceService.getConfiguration('telemetry')).once();
                workspaceConfig.verifyAll();
            });
        });
    });

    test('Send Telemetry', () => {
        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';
        const properties = { hello: 'world', foo: 'bar' };
        const measures = { start: 123, end: 987 };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, measures, properties as any);

        expect(Reporter.eventName).to.deep.equal([eventName]);
        expect(Reporter.measures).to.deep.equal([measures]);
        expect(Reporter.properties).to.deep.equal([properties]);
    });
    test('Send Telemetry with no properties', () => {
        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';

        sendTelemetryEvent(eventName as any);

        expect(Reporter.eventName).to.deep.equal([eventName]);
        expect(Reporter.measures).to.deep.equal([undefined], 'Measures should be empty');
        expect(Reporter.properties).to.deep.equal([{}], 'Properties should be empty');
    });
    test('Send Telemetry with shared properties', () => {
        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';
        const properties = { hello: 'world', foo: 'bar' };
        const measures = { start: 123, end: 987 };
        const expectedProperties = { ...properties, one: 'two' };

        setSharedProperty('one' as any, 'two' as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, measures, properties as any);

        expect(Reporter.eventName).to.deep.equal([eventName]);
        expect(Reporter.measures).to.deep.equal([measures]);
        expect(Reporter.properties).to.deep.equal([expectedProperties]);
    });
    test('Shared properties will replace existing ones', () => {
        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';
        const properties = { hello: 'world', foo: 'bar' };
        const measures = { start: 123, end: 987 };
        const expectedProperties = { ...properties, foo: 'baz' };

        setSharedProperty('foo' as any, 'baz' as any);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, measures, properties as any);

        expect(Reporter.eventName).to.deep.equal([eventName]);
        expect(Reporter.measures).to.deep.equal([measures]);
        expect(Reporter.properties).to.deep.equal([expectedProperties]);
    });
    test('Send Error Telemetry', () => {
        rewiremock.enable();
        const error = new Error('Boo');
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';
        const properties = { hello: 'world', foo: 'bar' };
        const measures = { start: 123, end: 987 };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, measures, properties as any, error);

        const expectedErrorProperties = {
            failed: 'true',
            failureCategory: 'unknown',
            failureSubCategory: '',
            originalEventName: eventName
        };

        expect(Reporter.eventName).to.deep.equal(['ERROR']);
        expect(Reporter.measures).to.deep.equal([measures]);
        expect(Reporter.properties[0].stackTrace).to.be.length.greaterThan(1);
        delete Reporter.properties[0].stackTrace;
        expect(Reporter.properties).to.deep.equal([expectedErrorProperties]);
    });
    test('Send Error Telemetry with stack trace', () => {
        rewiremock.enable();
        const error = new Error('Boo');
        const root = EXTENSION_ROOT_DIR.replace(/\\/g, '/');
        error.stack = [
            'Error: Boo',
            `at Context.test (${root}/src/test/telemetry/index.unit.test.ts:50:23)`,
            `at callFn (${root}/node_modules/mocha/lib/runnable.js:372:21)`,
            `at Test.Runnable.run (${root}/node_modules/mocha/lib/runnable.js:364:7)`,
            `at Runner.runTest (${root}/node_modules/mocha/lib/runner.js:455:10)`,
            `at ${root}/node_modules/mocha/lib/runner.js:573:12`,
            `at next (${root}/node_modules/mocha/lib/runner.js:369:14)`,
            `at ${root}/node_modules/mocha/lib/runner.js:379:7`,
            `at next (${root}/node_modules/mocha/lib/runner.js:303:14)`,
            `at ${root}/node_modules/mocha/lib/runner.js:342:7`,
            `at done (${root}/node_modules/mocha/lib/runnable.js:319:5)`,
            `at callFn (${root}/node_modules/mocha/lib/runnable.js:395:7)`,
            `at Hook.Runnable.run (${root}/node_modules/mocha/lib/runnable.js:364:7)`,
            `at next (${root}/node_modules/mocha/lib/runner.js:317:10)`,
            `at Immediate.<anonymous> (${root}/node_modules/mocha/lib/runner.js:347:5)`,
            'at runCallback (timers.js:789:20)',
            'at tryOnImmediate (timers.js:751:5)',
            'at processImmediate [as _immediateCallback] (timers.js:722:5)'
        ].join('\n\t');
        rewiremock('@vscode/extension-telemetry').with({ default: Reporter });

        const eventName = 'Testing';
        const properties = { hello: 'world', foo: 'bar' };
        const measures = { start: 123, end: 987 };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendTelemetryEvent(eventName as any, measures, properties as any, error);

        const expectedErrorProperties = {
            failed: 'true',
            failureCategory: 'unknown',
            failureSubCategory: '',
            originalEventName: eventName
        };

        const stackTrace = Reporter.properties[0].stackTrace;
        delete Reporter.properties[0].stackTrace;

        expect(Reporter.eventName).to.deep.equal(['ERROR']);
        expect(Reporter.measures).to.deep.equal([measures]);
        expect(Reporter.properties).to.deep.equal([expectedErrorProperties]);
        expect(stackTrace).to.be.length.greaterThan(1);

        const expectedStack = [
            `at Context.test ${root}/src/test/telemetry/index.unit.test.ts:50:23`,
            `at callFn ${root}/node_modules/mocha/lib/runnable.js:372:21`,
            `at Test.Runnable.run ${root}/node_modules/mocha/lib/runnable.js:364:7`,
            `at Runner.runTest ${root}/node_modules/mocha/lib/runner.js:455:10`,
            `at  ${root}/node_modules/mocha/lib/runner.js:573:12`,
            `at next ${root}/node_modules/mocha/lib/runner.js:369:14`,
            `at  ${root}/node_modules/mocha/lib/runner.js:379:7`,
            `at next ${root}/node_modules/mocha/lib/runner.js:303:14`,
            `at  ${root}/node_modules/mocha/lib/runner.js:342:7`,
            `at done ${root}/node_modules/mocha/lib/runnable.js:319:5`,
            `at callFn ${root}/node_modules/mocha/lib/runnable.js:395:7`,
            `at Hook.Runnable.run ${root}/node_modules/mocha/lib/runnable.js:364:7`,
            `at next ${root}/node_modules/mocha/lib/runner.js:317:10`,
            `at Immediate ${root}/node_modules/mocha/lib/runner.js:347:5`,
            'at runCallback timers.js:789:20',
            'at tryOnImmediate timers.js:751:5',
            'at processImmediate [as _immediateCallback] timers.js:722:5'
        ].join('\n\t');

        expect(stackTrace).to.be.equal(expectedStack);
    });
});
