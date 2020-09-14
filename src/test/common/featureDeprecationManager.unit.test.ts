// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable:max-func-body-length no-any

import { expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { WorkspaceConfiguration } from 'vscode';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../../client/common/application/types';
import { FeatureDeprecationManager } from '../../client/common/featureDeprecationManager';
import { DeprecatedSettingAndValue, IPersistentState, IPersistentStateFactory } from '../../client/common/types';

suite('Feature Deprecation Manager Tests', () => {
    test('Ensure deprecated command Build_Workspace_Symbols registers its popup', () => {
        const persistentState: TypeMoq.IMock<IPersistentStateFactory> = TypeMoq.Mock.ofType<IPersistentStateFactory>();
        const persistentBool: TypeMoq.IMock<IPersistentState<boolean>> = TypeMoq.Mock.ofType<
            IPersistentState<boolean>
        >();
        persistentBool.setup((a) => a.value).returns(() => true);
        persistentBool.setup((a) => a.updateValue(TypeMoq.It.isValue(false))).returns(() => Promise.resolve());
        persistentState
            .setup((a) =>
                a.createGlobalPersistentState(
                    TypeMoq.It.isValue('SHOW_DEPRECATED_FEATURE_PROMPT_BUILD_WORKSPACE_SYMBOLS'),
                    TypeMoq.It.isValue(true)
                )
            )
            .returns(() => persistentBool.object)
            .verifiable(TypeMoq.Times.once());
        const popupMgr: TypeMoq.IMock<IApplicationShell> = TypeMoq.Mock.ofType<IApplicationShell>();
        popupMgr
            .setup((p) =>
                p.showInformationMessage(TypeMoq.It.isAnyString(), TypeMoq.It.isAnyString(), TypeMoq.It.isAnyString())
            )
            .returns(
                (_val) =>
                    new Promise<string>((resolve, _reject) => {
                        resolve('Learn More');
                    })
            );
        const cmdManager: TypeMoq.IMock<ICommandManager> = TypeMoq.Mock.ofType<ICommandManager>();
        const workspaceConfig: TypeMoq.IMock<WorkspaceConfiguration> = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
        workspaceConfig
            .setup((ws) => ws.has(TypeMoq.It.isAnyString()))
            .returns(() => false)
            .verifiable(TypeMoq.Times.atLeastOnce());
        const workspace: TypeMoq.IMock<IWorkspaceService> = TypeMoq.Mock.ofType<IWorkspaceService>();
        workspace
            .setup((w) => w.getConfiguration(TypeMoq.It.isValue('python'), TypeMoq.It.isAny()))
            .returns(() => workspaceConfig.object);
        const featureDepMgr: FeatureDeprecationManager = new FeatureDeprecationManager(
            persistentState.object,
            cmdManager.object,
            workspace.object,
            popupMgr.object
        );

        featureDepMgr.initialize();
    });
    test('Ensure setting is checked', () => {
        const pythonConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
        const deprecatedSetting: DeprecatedSettingAndValue = { setting: 'autoComplete.preloadModules' };
        // tslint:disable-next-line:no-any
        const _ = {} as any;
        const featureDepMgr = new FeatureDeprecationManager(_, _, _, _);

        pythonConfig
            .setup((p) => p.has(TypeMoq.It.isValue(deprecatedSetting.setting)))
            .returns(() => false)
            .verifiable(TypeMoq.Times.atLeastOnce());

        let isUsed = featureDepMgr.isDeprecatedSettingAndValueUsed(pythonConfig.object, deprecatedSetting);
        pythonConfig.verifyAll();
        expect(isUsed).to.be.equal(false, 'Setting should not be used');

        type TestConfigs = { valueInSetting: any; expectedValue: boolean; valuesToLookFor?: any[] };
        let testConfigs: TestConfigs[] = [
            { valueInSetting: [], expectedValue: false },
            { valueInSetting: ['1'], expectedValue: true },
            { valueInSetting: [1], expectedValue: true },
            { valueInSetting: [{}], expectedValue: true }
        ];

        for (const config of testConfigs) {
            pythonConfig.reset();
            pythonConfig
                .setup((p) => p.has(TypeMoq.It.isValue(deprecatedSetting.setting)))
                .returns(() => true)
                .verifiable(TypeMoq.Times.atLeastOnce());
            pythonConfig
                .setup((p) => p.get(TypeMoq.It.isValue(deprecatedSetting.setting)))
                .returns(() => config.valueInSetting);

            isUsed = featureDepMgr.isDeprecatedSettingAndValueUsed(pythonConfig.object, deprecatedSetting);

            pythonConfig.verifyAll();
            expect(isUsed).to.be.equal(config.expectedValue, `Failed for config = ${JSON.stringify(config)}`);
        }

        testConfigs = [
            { valueInSetting: 'true', expectedValue: true, valuesToLookFor: ['true', true] },
            { valueInSetting: true, expectedValue: true, valuesToLookFor: ['true', true] },
            { valueInSetting: 'false', expectedValue: true, valuesToLookFor: ['false', false] },
            { valueInSetting: false, expectedValue: true, valuesToLookFor: ['false', false] }
        ];

        for (const config of testConfigs) {
            pythonConfig.reset();
            pythonConfig
                .setup((p) => p.has(TypeMoq.It.isValue(deprecatedSetting.setting)))
                .returns(() => true)
                .verifiable(TypeMoq.Times.atLeastOnce());
            pythonConfig
                .setup((p) => p.get(TypeMoq.It.isValue(deprecatedSetting.setting)))
                .returns(() => config.valueInSetting);

            deprecatedSetting.values = config.valuesToLookFor;
            isUsed = featureDepMgr.isDeprecatedSettingAndValueUsed(pythonConfig.object, deprecatedSetting);

            pythonConfig.verifyAll();
            expect(isUsed).to.be.equal(config.expectedValue, `Failed for config = ${JSON.stringify(config)}`);
        }
    });
});
