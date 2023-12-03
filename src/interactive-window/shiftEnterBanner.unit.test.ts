// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable , , @typescript-eslint/no-explicit-any, no-multi-str, no-trailing-spaces */
import * as sinon from 'sinon';
import { expect } from 'chai';
import * as typemoq from 'typemoq';
import { InteractiveShiftEnterBanner, InteractiveShiftEnterStateKeys } from './shiftEnterBanner';
import {
    isTestExecution,
    isUnitTestExecution,
    setTestExecution,
    setUnitTestExecution,
    Telemetry
} from '../platform/common/constants';
import {
    IConfigurationService,
    IPersistentState,
    IPersistentStateFactory,
    IWatchableJupyterSettings
} from '../platform/common/types';
import { getTelemetryReporter } from '../telemetry';
import { anything, when } from 'ts-mockito';
import { mockedVSCodeNamespaces } from '../test/vscode-mock';

suite('Interactive Shift Enter Banner', () => {
    const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
    const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();
    let config: typemoq.IMock<IConfigurationService>;

    class Reporter {
        public static eventNames: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];
    }

    setup(() => {
        const reporter = getTelemetryReporter();
        sinon.stub(reporter, 'sendTelemetryEvent').callsFake((eventName: string, properties?: {}, measures?: {}) => {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        });
        setUnitTestExecution(false);
        setTestExecution(false);
        config = typemoq.Mock.ofType<IConfigurationService>();
    });

    teardown(() => {
        sinon.restore();
        setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
        setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
        Reporter.properties = [];
        Reporter.eventNames = [];
        Reporter.measures = [];
    });

    test('Shift Enter Banner with Jupyter available', async () => {
        const shiftBanner = loadBanner(config, true, true, 'Yes');
        await shiftBanner.showBanner();

        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });

    test("Shift Enter Banner don't check Jupyter when disabled", async () => {
        const shiftBanner = loadBanner(config, false, false, 'Yes');
        await shiftBanner.showBanner();

        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([]);
    });

    test('Shift Enter Banner changes setting', async () => {
        const shiftBanner = loadBanner(config, false, true, 'Yes');
        await shiftBanner.enableInteractiveShiftEnter();

        config.verifyAll();
    });

    test('Shift Enter Banner say no', async () => {
        const shiftBanner = loadBanner(config, true, true, 'No');
        await shiftBanner.showBanner();

        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.DisableInteractiveShiftEnter
        ]);
    });
});

// Create a test banner with the given settings
function loadBanner(
    config: typemoq.IMock<IConfigurationService>,
    stateEnabled: boolean,
    configCalled: boolean,
    questionResponse: string
): InteractiveShiftEnterBanner {
    // Config persist state
    const persistService: typemoq.IMock<IPersistentStateFactory> = typemoq.Mock.ofType<IPersistentStateFactory>();
    const enabledState: typemoq.IMock<IPersistentState<boolean>> = typemoq.Mock.ofType<IPersistentState<boolean>>();
    enabledState.setup((a) => a.value).returns(() => stateEnabled);
    persistService
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InteractiveShiftEnterStateKeys.ShowBanner),
                typemoq.It.isValue(true)
            )
        )
        .returns(() => {
            return enabledState.object;
        });
    persistService
        .setup((a) =>
            a.createGlobalPersistentState(
                typemoq.It.isValue(InteractiveShiftEnterStateKeys.ShowBanner),
                typemoq.It.isValue(false)
            )
        )
        .returns(() => {
            return enabledState.object;
        });

    // Config settings
    const dataScienceSettings = typemoq.Mock.ofType<IWatchableJupyterSettings>();
    dataScienceSettings.setup((d) => d.sendSelectionToInteractiveWindow).returns(() => false);
    config.setup((c) => c.getSettings(typemoq.It.isAny())).returns(() => dataScienceSettings.object);

    const yes = 'Yes';
    const no = 'No';

    // Config AppShell
    when(mockedVSCodeNamespaces.window.showInformationMessage(anything(), yes, no)).thenReturn(
        Promise.resolve(questionResponse) as any
    );

    // Config settings
    config
        .setup((c) =>
            c.updateSetting(
                typemoq.It.isValue('interactiveWindow.textEditor.executeSelection'),
                typemoq.It.isAny(),
                typemoq.It.isAny(),
                typemoq.It.isAny()
            )
        )
        .returns(() => Promise.resolve())
        .verifiable(configCalled ? typemoq.Times.once() : typemoq.Times.never());

    return new InteractiveShiftEnterBanner(persistService.object, config.object);
}
