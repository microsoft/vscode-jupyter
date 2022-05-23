// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IPythonExtensionChecker } from '../platform/api/types';
import { IApplicationEnvironment } from '../platform/common/application/types';
import { Identifiers, JVSC_EXTENSION_ID } from '../platform/common/constants';

import { IServiceManager } from '../platform/ioc/types';
import { setSharedProperty } from '../telemetry';
import { IRawNotebookSupportedService } from './raw/types';
import { KernelCrashMonitor } from './kernelCrashMonitor';
import { registerTypes as registerWidgetTypes } from './ipywidgets-message-coordination/serviceRegistry.web';
import { registerTypes as registerJupyterTypes } from './jupyter/serviceRegistry.web';
import { injectable } from 'inversify';
import { IKernelFinder, IKernelProvider } from './types';
import { KernelProvider } from './kernelProvider.web';
import { KernelFinder } from './kernelFinder.web';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { IDataScienceCommandListener } from '../platform/common/types';
import { KernelCommandListener } from './kernelCommandListener';
import { IJupyterDebugService } from './debugging/types';
import { MultiplexingDebugService } from '../platform/debugger/multiplexingDebugService';

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

    serviceManager.addSingleton<IJupyterDebugService>(
        IJupyterDebugService,
        MultiplexingDebugService,
        Identifiers.MULTIPLEXING_DEBUGSERVICE
    );

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider,
        PreferredRemoteKernelIdProvider
    );
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);
    serviceManager.addSingleton<IDataScienceCommandListener>(IDataScienceCommandListener, KernelCommandListener);

    // Subdirectories
    registerWidgetTypes(serviceManager, isDevMode);
    registerJupyterTypes(serviceManager, isDevMode);
}
