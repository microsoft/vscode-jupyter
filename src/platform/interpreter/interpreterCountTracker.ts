// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../activation/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from './contracts';
import { IPythonApiProvider, IPythonExtensionChecker } from '../api/types';
import { noop } from '../common/utils/misc';
import { IDisposableRegistry } from '../common/types';

/**
 * Sends telemetry for the number of interpreters
 */
@injectable()
export class InterpreterCountTracker implements IExtensionSingleActivationService {
    private static interpreterCount = 0;
    private interpretersTracked?: boolean;
    public static get totalNumberOfInterpreters() {
        return InterpreterCountTracker.interpreterCount;
    }
    constructor(
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IPythonApiProvider) private pythonApi: IPythonApiProvider,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async activate() {
        if (this.pythonExtensionChecker.isPythonExtensionActive) {
            this.trackInterpreters();
        } else {
            this.pythonApi.onDidActivatePythonExtension(this.trackInterpreters, this, this.disposables);
        }
    }
    private trackInterpreters() {
        if (this.interpretersTracked) {
            return;
        }
        if (!this.pythonExtensionChecker.isPythonExtensionActive) {
            return;
        }
        this.interpretersTracked = true;
        this.interpreterService
            .getInterpreters()
            .then((items) => (InterpreterCountTracker.interpreterCount = items.length))
            .catch(noop);
    }
}
