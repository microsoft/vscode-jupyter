// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IApplicationEnvironment } from '../platform/common/application/types';
import { JVSC_EXTENSION_ID } from '../platform/common/constants';

import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { ILocalKernelFinder, IRawNotebookSupportedService, IRemoteKernelFinder } from './raw/types';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import { registerTypes as registerWidgetTypes } from './ipywidgets-message-coordination/serviceRegistry.web';
import { injectable } from 'inversify';
import { JupyterServerUriStorage } from './jupyter/launcher/serverUriStorage';
import { IJupyterServerUriStorage, IJupyterUriProviderRegistration } from './jupyter/types';
import { JupyterServerSelector } from './jupyter/serverSelector';
import { JupyterUriProviderRegistration } from './jupyter/jupyterUriProviderRegistration';
import { RemoteKernelFinder } from './jupyter/remoteKernelFinder.web';
import { LocalKernelFinder } from './raw/finder/localKernelFinder.web';
import { NotebookProvider } from './jupyter/launcher/notebookProvider';
import { IKernelProvider, INotebookProvider } from './types';
import { KernelProvider } from './kernelProvider.web';

@injectable()
class RawNotebookSupportedService implements IRawNotebookSupportedService {
    isSupported: boolean = false;
}

export function registerTypes(serviceManager: IServiceManager, isDevMode: boolean) {
    serviceManager.addSingleton<IRawNotebookSupportedService>(
        IRawNotebookSupportedService,
        RawNotebookSupportedService
    );
    const isVSCInsiders = serviceManager.get<IApplicationEnvironment>(IApplicationEnvironment).channel === 'insiders';
    const packageJson: { engines: { vscode: string } } | undefined =
        vscode.extensions.getExtension(JVSC_EXTENSION_ID)?.packageJSON;
    const isInsiderVersion = packageJson?.engines?.vscode?.toLowerCase()?.endsWith('insider');
    setSharedProperty('isInsiderExtension', isVSCInsiders && isInsiderVersion ? 'true' : 'false');

    // This will ensure all subsequent telemetry will get the context of whether it is a custom/native/old notebook editor.
    // This is temporary, and once we ship native editor this needs to be removed.
    setSharedProperty('ds_notebookeditor', 'native');
    setSharedProperty('localOrRemoteConnection', 'remote');
    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IJupyterServerUriStorage>(IJupyterServerUriStorage, JupyterServerUriStorage);
    serviceManager.addSingleton<JupyterServerSelector>(JupyterServerSelector, JupyterServerSelector);
    serviceManager.addSingleton<IJupyterUriProviderRegistration>(
        IJupyterUriProviderRegistration,
        JupyterUriProviderRegistration
    );
    serviceManager.addSingleton<ILocalKernelFinder>(ILocalKernelFinder, LocalKernelFinder);
    serviceManager.addSingleton<IRemoteKernelFinder>(IRemoteKernelFinder, RemoteKernelFinder);
    serviceManager.addSingleton<INotebookProvider>(INotebookProvider, NotebookProvider);
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);

    // Subdirectories
    registerWidgetTypes(serviceManager, isDevMode);
}
