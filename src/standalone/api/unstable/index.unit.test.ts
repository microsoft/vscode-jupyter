// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { assert, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { anything, instance, mock, verify, when } from 'ts-mockito';
import type { Event } from 'vscode';
import { JupyterServerCollection } from '../../../api';
import { IRemoteKernelFinderController } from '../../../kernels/jupyter/finder/types';
import { IJupyterServerProviderRegistry, IRemoteKernelFinder } from '../../../kernels/jupyter/types';
import { INotebookPythonEnvironmentService } from '../../../notebooks/types';
import { IExtensionContext, IExtensions } from '../../../platform/common/types';
import { IServiceContainer, IServiceManager } from '../../../platform/ioc/types';
import { buildApi } from '..';
import { startJupyterServerKernelDiscovery } from '.';

use(chaiAsPromised);

suite('Unstable Jupyter server API', () => {
    test('Starts discovery for the caller-owned collection and returns a finder-backed facade', async () => {
        const extensions = mock<IExtensions>();
        const registry = mock<IJupyterServerProviderRegistry>();
        const finderController = mock<IRemoteKernelFinderController>();
        const finder = createFinder('idle');
        const matchingCollection = mock<JupyterServerCollection>();
        const otherCollection = mock<JupyterServerCollection>();
        when(extensions.determineExtensionFromCallStack()).thenReturn({
            extensionId: 'publisher.extension',
            displayName: 'Provider Extension'
        });
        when(matchingCollection.extensionId).thenReturn('publisher.extension');
        when(matchingCollection.id).thenReturn('collection-1');
        when(otherCollection.extensionId).thenReturn('other.extension');
        when(otherCollection.id).thenReturn('collection-1');
        when(registry.jupyterCollections).thenReturn([instance(otherCollection), instance(matchingCollection)]);
        when(finderController.startJupyterServerKernelDiscovery(instance(matchingCollection), 'server-1')).thenResolve(
            finder
        );
        const serviceContainer = createServiceContainer(
            instance(extensions),
            instance(registry),
            instance(finderController)
        );

        const discovery = await startJupyterServerKernelDiscovery('collection-1', 'server-1', serviceContainer);

        assert.notStrictEqual(discovery as unknown, finder as unknown);
        assert.strictEqual(discovery.status, 'idle');
        assert.isTrue(Object.isFrozen(discovery));
        verify(finderController.startJupyterServerKernelDiscovery(instance(matchingCollection), 'server-1')).once();
        verify(finderController.startJupyterServerKernelDiscovery(instance(otherCollection), anything())).never();
    });

    test('Rejects when the calling extension does not own the requested collection', async () => {
        const extensions = mock<IExtensions>();
        const registry = mock<IJupyterServerProviderRegistry>();
        const finderController = mock<IRemoteKernelFinderController>();
        const otherCollection = mock<JupyterServerCollection>();
        when(extensions.determineExtensionFromCallStack()).thenReturn({
            extensionId: 'publisher.extension',
            displayName: 'Provider Extension'
        });
        when(otherCollection.extensionId).thenReturn('other.extension');
        when(otherCollection.id).thenReturn('collection-1');
        when(registry.jupyterCollections).thenReturn([instance(otherCollection)]);
        const serviceContainer = createServiceContainer(
            instance(extensions),
            instance(registry),
            instance(finderController)
        );

        await assert.isRejected(
            startJupyterServerKernelDiscovery('collection-1', 'server-1', serviceContainer),
            "Jupyter Server Collection 'collection-1' was not found for extension 'publisher.extension'."
        );

        verify(finderController.startJupyterServerKernelDiscovery(anything(), anything())).never();
    });

    test('Exposes server kernel discovery through the public API', async () => {
        const extensions = mock<IExtensions>();
        const registry = mock<IJupyterServerProviderRegistry>();
        const finderController = mock<IRemoteKernelFinderController>();
        const finder = createFinder('discovering');
        const environmentService = mock<INotebookPythonEnvironmentService>();
        const context = mock<IExtensionContext>();
        const matchingCollection = mock<JupyterServerCollection>();
        when(extensions.determineExtensionFromCallStack()).thenReturn({
            extensionId: 'publisher.extension',
            displayName: 'Provider Extension'
        });
        when(matchingCollection.extensionId).thenReturn('publisher.extension');
        when(matchingCollection.id).thenReturn('collection-1');
        when(registry.jupyterCollections).thenReturn([instance(matchingCollection)]);
        when(finderController.startJupyterServerKernelDiscovery(instance(matchingCollection), 'server-1')).thenResolve(
            finder
        );
        const serviceContainer = createServiceContainer(
            instance(extensions),
            instance(registry),
            instance(finderController),
            instance(environmentService)
        );
        const api = buildApi(Promise.resolve(), instance(mock<IServiceManager>()), serviceContainer, instance(context));

        const discovery = await api.startJupyterServerKernelDiscovery('collection-1', 'server-1');

        assert.strictEqual(discovery.status, 'discovering');
        verify(finderController.startJupyterServerKernelDiscovery(instance(matchingCollection), 'server-1')).once();
    });
});

function createServiceContainer(
    extensions: IExtensions,
    registry: IJupyterServerProviderRegistry,
    finderController: IRemoteKernelFinderController,
    environmentService?: INotebookPythonEnvironmentService
): IServiceContainer {
    return {
        get: <T>(serviceIdentifier: symbol): T => {
            if (serviceIdentifier === IExtensions) {
                return extensions as T;
            }
            if (serviceIdentifier === IJupyterServerProviderRegistry) {
                return registry as T;
            }
            if (serviceIdentifier === IRemoteKernelFinderController) {
                return finderController as T;
            }
            if (serviceIdentifier === INotebookPythonEnvironmentService && environmentService) {
                return environmentService as T;
            }
            throw new Error(`Unexpected service identifier: ${String(serviceIdentifier)}`);
        },
        getAll: () => [],
        tryGet: () => undefined
    };
}

function createFinder(status: IRemoteKernelFinder['status']): IRemoteKernelFinder {
    return {
        status,
        lastError: undefined,
        onDidChangeStatus: (() => ({ dispose: () => undefined })) as Event<void>
    } as unknown as IRemoteKernelFinder;
}
