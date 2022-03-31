// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../platform/activation/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from '../platform/interpreter/contracts.node';
import { IPythonApiProvider, IPythonExtensionChecker } from '../platform/api/types';
import { noop } from '../platform/common/utils/misc';
import { IDisposableRegistry } from '../platform/common/types';

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
