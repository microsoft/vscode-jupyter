// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable , , @typescript-eslint/no-explicit-any, no-multi-str, no-trailing-spaces */
import { expect } from 'chai';
import rewiremock from 'rewiremock';
import * as typemoq from 'typemoq';
import { InteractiveShiftEnterBanner, InteractiveShiftEnterStateKeys } from './shiftEnterBanner';

import { IApplicationShell } from '../platform/common/application/types';
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
import { clearTelemetryReporter } from '../telemetry';

suite('Interactive Shift Enter Banner', () => {
    const oldValueOfVSC_JUPYTER_UNIT_TEST = isUnitTestExecution();
    const oldValueOfVSC_JUPYTER_CI_TEST = isTestExecution();
    let appShell: typemoq.IMock<IApplicationShell>;
    let config: typemoq.IMock<IConfigurationService>;

    class Reporter {
        public static eventNames: string[] = [];
        public static properties: Record<string, string>[] = [];
        public static measures: {}[] = [];
        public sendTelemetryEvent(eventName: string, properties?: {}, measures?: {}) {
            Reporter.eventNames.push(eventName);
            Reporter.properties.push(properties!);
            Reporter.measures.push(measures!);
        }
    }

    setup(() => {
        clearTelemetryReporter();
        setUnitTestExecution(false);
        setTestExecution(false);
        appShell = typemoq.Mock.ofType<IApplicationShell>();
        config = typemoq.Mock.ofType<IConfigurationService>();
        rewiremock.enable();
        rewiremock('@vscode/extension-telemetry').by(() => Reporter);
    });

    teardown(() => {
        setUnitTestExecution(oldValueOfVSC_JUPYTER_UNIT_TEST);
        setTestExecution(oldValueOfVSC_JUPYTER_CI_TEST);
        Reporter.properties = [];
        Reporter.eventNames = [];
        Reporter.measures = [];
        rewiremock.disable();
        clearTelemetryReporter();
    });

    test('Shift Enter Banner with Jupyter available', async () => {
        const shiftBanner = loadBanner(appShell, config, true, true, true, 'Yes');
        await shiftBanner.showBanner();

        appShell.verifyAll();
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.EnableInteractiveShiftEnter
        ]);
    });

    test("Shift Enter Banner don't check Jupyter when disabled", async () => {
        const shiftBanner = loadBanner(appShell, config, false, false, false, 'Yes');
        await shiftBanner.showBanner();

        appShell.verifyAll();
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([]);
    });

    test('Shift Enter Banner changes setting', async () => {
        const shiftBanner = loadBanner(appShell, config, false, false, true, 'Yes');
        await shiftBanner.enableInteractiveShiftEnter();

        appShell.verifyAll();
        config.verifyAll();
    });

    test('Shift Enter Banner say no', async () => {
        const shiftBanner = loadBanner(appShell, config, true, true, true, 'No');
        await shiftBanner.showBanner();

        appShell.verifyAll();
        config.verifyAll();

        expect(Reporter.eventNames).to.deep.equal([
            Telemetry.ShiftEnterBannerShown,
            Telemetry.DisableInteractiveShiftEnter
        ]);
    });
});

// Create a test banner with the given settings
function loadBanner(
    appShell: typemoq.IMock<IApplicationShell>,
    config: typemoq.IMock<IConfigurationService>,
    stateEnabled: boolean,
    bannerShown: boolean,
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
    appShell
        .setup((a) => a.showInformationMessage(typemoq.It.isAny(), typemoq.It.isValue(yes), typemoq.It.isValue(no)))
        .returns(() => Promise.resolve(questionResponse))
        .verifiable(bannerShown ? typemoq.Times.once() : typemoq.Times.never());

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

    return new InteractiveShiftEnterBanner(appShell.object, persistService.object, config.object);
}
