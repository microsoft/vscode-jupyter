// Copyright (c) Microsoft Corporation.
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
import { registerTypes as registerJupyterTypes } from './jupyter/serviceRegistry.web';
import { injectable } from 'inversify';
import { IKernelFinder, IKernelProvider, IStartupCodeProvider, IThirdPartyKernelProvider } from './types';
import { KernelProvider, ThirdPartyKernelProvider } from './kernelProvider.web';
import { KernelFinder } from './kernelFinder';
import { PreferredRemoteKernelIdProvider } from './jupyter/preferredRemoteKernelIdProvider';
import { IJupyterVariables, IKernelVariableRequester } from './variables/types';
import { KernelVariables } from './variables/kernelVariables';
import { JupyterVariables } from './variables/jupyterVariables';
import { PythonVariablesRequester } from './variables/pythonVariableRequester';
import { CellOutputDisplayIdTracker } from './execution/cellDisplayIdTracker';
import { KernelAutoReConnectFailedMonitor } from './kernelAutoReConnectFailedMonitor';
import { KernelAutoReconnectMonitor } from './kernelAutoReConnectMonitor';
import { DebugStartupCodeProvider } from './debuggerStartupCodeProvider';

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
    const isPythonExtensionInstalled = serviceManager.get<IPythonExtensionChecker>(IPythonExtensionChecker);
    setSharedProperty(
        'isPythonExtensionInstalled',
        isPythonExtensionInstalled.isPythonExtensionInstalled ? 'true' : 'false'
    );
    const rawService = serviceManager.get<IRawNotebookSupportedService>(IRawNotebookSupportedService);
    setSharedProperty('rawKernelSupported', rawService.isSupported ? 'true' : 'false');

    serviceManager.addSingleton<IKernelVariableRequester>(
        IKernelVariableRequester,
        PythonVariablesRequester,
        Identifiers.PYTHON_VARIABLES_REQUESTER
    );
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, JupyterVariables, Identifiers.ALL_VARIABLES);
    serviceManager.addSingleton<IJupyterVariables>(IJupyterVariables, KernelVariables, Identifiers.KERNEL_VARIABLES);

    serviceManager.addSingleton<IExtensionSyncActivationService>(IExtensionSyncActivationService, KernelCrashMonitor);
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoReConnectFailedMonitor
    );
    serviceManager.addSingleton<IExtensionSyncActivationService>(
        IExtensionSyncActivationService,
        KernelAutoReconnectMonitor
    );
    serviceManager.addSingleton<IKernelProvider>(IKernelProvider, KernelProvider);
    serviceManager.addSingleton<IThirdPartyKernelProvider>(IThirdPartyKernelProvider, ThirdPartyKernelProvider);
    serviceManager.addSingleton<PreferredRemoteKernelIdProvider>(
        PreferredRemoteKernelIdProvider,
        PreferredRemoteKernelIdProvider
    );
    serviceManager.addSingleton<IKernelFinder>(IKernelFinder, KernelFinder);

    // Subdirectories
    registerJupyterTypes(serviceManager, isDevMode);

    serviceManager.addSingleton<CellOutputDisplayIdTracker>(CellOutputDisplayIdTracker, CellOutputDisplayIdTracker);
    serviceManager.addSingleton<IStartupCodeProvider>(IStartupCodeProvider, DebugStartupCodeProvider);
}
