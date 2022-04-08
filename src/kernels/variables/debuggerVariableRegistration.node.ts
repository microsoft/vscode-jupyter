// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable, named } from 'inversify';
import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, ProviderResult } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IDebugService } from '../../platform/common/application/types';
import { PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IDisposableRegistry } from '../../platform/common/types';
import { pythonKernelDebugAdapter } from '../../platform/debugger/constants';
import { Identifiers } from '../../webviews/webview-side/common/constants';
import { IJupyterDebugService } from '../debugging/types';
import { IJupyterVariables } from './types';

@injectable()
export class DebuggerVariableRegistration implements IExtensionSingleActivationService, DebugAdapterTrackerFactory {
    constructor(
        @inject(IJupyterDebugService) @named(Identifiers.MULTIPLEXING_DEBUGSERVICE) private debugService: IDebugService,
        @inject(IDisposableRegistry) private disposables: IDisposableRegistry,
        @inject(IJupyterVariables) @named(Identifiers.DEBUGGER_VARIABLES) private debugVariables: DebugAdapterTracker
    ) {}
    public activate(): Promise<void> {
        this.disposables.push(this.debugService.registerDebugAdapterTrackerFactory(PYTHON_LANGUAGE, this));
        this.disposables.push(this.debugService.registerDebugAdapterTrackerFactory(pythonKernelDebugAdapter, this));
        return Promise.resolve();
    }

    public createDebugAdapterTracker(_session: DebugSession): ProviderResult<DebugAdapterTracker> {
        return this.debugVariables;
    }
}
