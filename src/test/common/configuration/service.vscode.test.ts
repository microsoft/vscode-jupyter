// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect } from 'chai';
import { workspace } from 'vscode';
import { AsyncDisposableRegistry } from '../../../platform/common/asyncDisposableRegistry';
import { IAsyncDisposableRegistry, IConfigurationService } from '../../../platform/common/types';
import { IServiceContainer } from '../../../platform/ioc/types';
import { getExtensionSettings } from '../../common.node';
import { initialize } from '../../initialize.node';

// eslint-disable-next-line
suite('Configuration Service', () => {
    let serviceContainer: IServiceContainer;
    suiteSetup(async () => {
        serviceContainer = (await initialize()).serviceContainer;
    });

    test('Ensure same instance of settings return', async () => {
        const workspaceUri = workspace.workspaceFolders![0].uri;
        const settings = serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(workspaceUri);
        const instanceIsSame = settings === (await getExtensionSettings(workspaceUri));
        expect(instanceIsSame).to.be.equal(true, 'Incorrect settings');
    });

    test('Ensure async registry returns expected class', async () => {
        const asyncRegistry = serviceContainer.get<IAsyncDisposableRegistry>(IAsyncDisposableRegistry);
        expect(asyncRegistry).to.be.instanceOf(AsyncDisposableRegistry);
    });

    test('Ensure async registry works', async () => {
        // Do not retrieve AsyncDisposableRegistry from IOC container, as this will dispose all of the
        // classes that we use in tests (basically all singletons are destroyed and tests break).
        const asyncRegistry = new AsyncDisposableRegistry();
        let disposed = false;
        const disposable = {
            dispose(): Promise<void> {
                disposed = true;
                return Promise.resolve();
            }
        };
        asyncRegistry.push(disposable);
        await asyncRegistry.dispose();
        expect(disposed).to.be.equal(true, "Didn't dispose during async registry cleanup");
    });
});
