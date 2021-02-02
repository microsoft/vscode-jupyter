// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { expect } from 'chai';
import { workspace } from 'vscode';
import { AsyncDisposableRegistry } from '../../../client/common/asyncDisposableRegistry';
import { IAsyncDisposableRegistry, IConfigurationService } from '../../../client/common/types';
import { IServiceContainer } from '../../../client/ioc/types';
import { getExtensionSettings } from '../../common';
import { initialize } from '../../initialize';

// eslint-disable-next-line
suite('Configuration Service', () => {
    let serviceContainer: IServiceContainer;
    suiteSetup(async () => {
        serviceContainer = (await initialize()).serviceContainer;
    });

    test('Ensure same instance of settings return', () => {
        const workspaceUri = workspace.workspaceFolders![0].uri;
        const settings = serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(workspaceUri);
        const instanceIsSame = settings === getExtensionSettings(workspaceUri);
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
