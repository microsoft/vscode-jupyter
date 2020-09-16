// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { IExtensionSingleActivationService } from '../../../activation/types';
import { IDebugService } from '../../../common/application/types';
import { IDisposableRegistry } from '../../../common/types';
import { DebuggerTypeName } from '../../constants';
import { IDebugSessionLoggingFactory, IOutdatedDebuggerPromptFactory } from '../types';

@injectable()
export class DebugAdapterActivator implements IExtensionSingleActivationService {
    constructor(
        @inject(IDebugService) private readonly debugService: IDebugService,
        @inject(IDebugSessionLoggingFactory) private debugSessionLoggingFactory: IDebugSessionLoggingFactory,
        @inject(IOutdatedDebuggerPromptFactory) private debuggerPromptFactory: IOutdatedDebuggerPromptFactory,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry
    ) {}
    public async activate(): Promise<void> {
        this.disposables.push(
            this.debugService.registerDebugAdapterTrackerFactory(DebuggerTypeName, this.debugSessionLoggingFactory)
        );
        this.disposables.push(
            this.debugService.registerDebugAdapterTrackerFactory(DebuggerTypeName, this.debuggerPromptFactory)
        );
    }
}
