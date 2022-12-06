// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { inject, injectable, named } from 'inversify';
import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, ProviderResult } from 'vscode';
import { IExtensionSingleActivationService } from '../../platform/activation/types';
import { IDebugService } from '../../platform/common/application/types';
import { Identifiers, PYTHON_LANGUAGE } from '../../platform/common/constants';
import { IDisposableRegistry } from '../../platform/common/types';
import { pythonIWKernelDebugAdapter, pythonKernelDebugAdapter } from './constants';
import { IJupyterDebugService } from './debuggingTypes';
import { IJupyterVariables } from '../../kernels/variables/types';

/**
 * Registes a DebugAdapter for handling variable values when debugging.
 */
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
        this.disposables.push(this.debugService.registerDebugAdapterTrackerFactory(pythonIWKernelDebugAdapter, this));
        return Promise.resolve();
    }

    public createDebugAdapterTracker(_session: DebugSession): ProviderResult<DebugAdapterTracker> {
        return this.debugVariables;
    }
}
