// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { anything, instance, mock, when } from 'ts-mockito';
import * as tasClient from 'vscode-tas-client';
import { ApplicationEnvironment } from '../application/applicationEnvironment.node';
import { Channel, IApplicationEnvironment, IWorkspaceService } from '../application/types';
import { WorkspaceService } from '../application/workspace.node';
import { ConfigurationService } from '../configuration/service.node';
import { ExperimentService } from './service';
import { IConfigurationService } from '../types';
import * as Telemetry from '../../telemetry/index';
import { JVSC_EXTENSION_ID_FOR_TESTS } from '../../../test/constants.node';
import { MockMemento } from '../../../test/mocks/mementos';
import { Experiments } from '../types';
suite('Experimentation service', () => {
    const extensionVersion = '1.2.3';

    let configurationService: IConfigurationService;
    let appEnvironment: IApplicationEnvironment;
    let globalMemento: MockMemento;
    let workspace: IWorkspaceService;

    setup(() => {
        configurationService = mock(ConfigurationService);
        appEnvironment = mock(ApplicationEnvironment);
        globalMemento = new MockMemento();
        workspace = mock(WorkspaceService);
        when(workspace.getConfiguration(anything(), anything())).thenReturn({
            get: () => [],
            has: () => false,
            inspect: () => undefined,
            update: () => Promise.resolve()
        });
    });

    teardown(() => {
        sinon.restore();
        Telemetry._resetSharedProperties();
    });

    function configureSettings(enabled: boolean, optInto: string[], optOutFrom: string[]) {
        when(configurationService.getSettings(undefined)).thenReturn({
            experiments: {
                enabled,
                optInto,
                optOutFrom
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    function configureApplicationEnvironment(channel: Channel, version: string) {
        when(appEnvironment.channel).thenReturn(channel);
        when(appEnvironment.extensionName).thenReturn(JVSC_EXTENSION_ID_FOR_TESTS);
        when(appEnvironment.packageJson).thenReturn({ version });
    }

    suite('Initialization', () => {
        test('Users with a release version of the extension should be in the Public target population', () => {
            const getExperimentationServiceStub = sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, [], []);
            configureApplicationEnvironment('stable', extensionVersion);

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );

            sinon.assert.calledWithMatch(
                getExperimentationServiceStub,
                JVSC_EXTENSION_ID_FOR_TESTS,
                extensionVersion,
                tasClient.TargetPopulation.Public,
                sinon.match.any,
                globalMemento
            );
        });

        test('Users with an Insiders version of the extension should be the Insiders target population', () => {
            const getExperimentationServiceStub = sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, [], []);
            configureApplicationEnvironment('insiders', extensionVersion);

            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );

            sinon.assert.calledWithMatch(
                getExperimentationServiceStub,
                JVSC_EXTENSION_ID_FOR_TESTS,
                extensionVersion,
                tasClient.TargetPopulation.Insiders,
                sinon.match.any,
                globalMemento
            );
        });

        test('Users can only opt into experiment groups', () => {
            sinon.stub(tasClient, 'getExperimentationService');

            configureSettings(true, ['Foo - experiment', 'Bar - control'], []);
            configureApplicationEnvironment('stable', extensionVersion);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );

            assert.deepEqual(experimentService._optInto, ['Foo - experiment']);
        });

        test('Users can only opt out of experiment groups', () => {
            sinon.stub(tasClient, 'getExperimentationService');
            configureSettings(true, [], ['Foo - experiment', 'Bar - control']);
            configureApplicationEnvironment('stable', extensionVersion);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );

            assert.deepEqual(experimentService._optOutFrom, ['Foo - experiment']);
        });
    });

    suite('In-experiment check', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const experiment: any = 'Test Experiment - experiment';
        let telemetryEvents: { eventName: string; properties: object | undefined }[] = [];
        let sendTelemetryEventStub: sinon.SinonStub;

        setup(() => {
            sendTelemetryEventStub = sinon
                .stub(Telemetry, 'sendTelemetryEvent')
                .callsFake((eventName: string, _, properties: object | undefined) => {
                    const telemetry = { eventName, properties };
                    telemetryEvents.push(telemetry);
                });

            sinon.stub(tasClient, 'getExperimentationService').returns({
                getTreatmentVariable: () => true
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            configureApplicationEnvironment('stable', extensionVersion);
        });

        teardown(() => {
            telemetryEvents = [];
        });

        test('If the opt-in and opt-out arrays are empty, return the value from the experimentation framework for a given experiment', async () => {
            configureSettings(true, [], []);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
        });

        test('If the experiment setting is disabled, inExperiment should return false', async () => {
            configureSettings(false, [], []);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
            sinon.assert.notCalled(sendTelemetryEventStub);
        });

        test('If the opt-in setting contains the experiment name, inExperiment should return true', async () => {
            configureSettings(true, [experiment], []);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isTrue(result);
        });

        test('If the opt-out setting contains the experiment name, inExperiment should return false', async () => {
            configureSettings(true, [], [experiment]);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.inExperiment(experiment);

            assert.isFalse(result);
        });
    });

    suite('Experiment value retrieval', () => {
        const experiment = 'Test Experiment - experiment' as unknown as Experiments;

        setup(() => {
            sinon.stub(tasClient, 'getExperimentationService').returns({
                getTreatmentVariable: () => 'value'
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            configureApplicationEnvironment('stable', extensionVersion);
        });

        test('If the service is enabled and the opt-out array is empty,return the value from the experimentation framework for a given experiment', async () => {
            configureSettings(true, [], []);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.equal(result, 'value');
        });

        test('If the experiment setting is disabled, getExperimentValue should return undefined', async () => {
            configureSettings(false, [], []);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.isUndefined(result);
        });

        test('If the opt-out setting contains the experiment name, igetExperimentValue should return undefined', async () => {
            configureSettings(true, [], [experiment as any]);

            const experimentService = new ExperimentService(
                instance(configurationService),
                instance(workspace),
                instance(appEnvironment),
                globalMemento
            );
            const result = await experimentService.getExperimentValue(experiment);

            assert.isUndefined(result);
        });
    });
});
