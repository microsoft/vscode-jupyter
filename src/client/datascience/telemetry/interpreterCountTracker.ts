// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../../activation/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from '../../interpreter/contracts';
import { IPythonExtensionChecker } from '../../api/types';
import { noop } from '../../common/utils/misc';
import { IDisposableRegistry, IExtensions } from '../../common/types';

@injectable()
export class InterpreterCountTracker implements IExtensionSingleActivationService {
    private static interpreterCount = 0;
    private interpretersTracked?: boolean;
    public static get totalNumberOfInterpreters() {
        return InterpreterCountTracker.interpreterCount;
    }
    constructor(
        @inject(IExtensions) private readonly extensions: IExtensions,
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async activate() {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            this.extensions.onDidChange(this.trackInterpreters, this, this.disposables);
            return;
        }
        this.trackInterpreters();
    }
    private trackInterpreters() {
        if (this.interpretersTracked) {
            return;
        }
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
        this.interpretersTracked = true;
        this.interpreterService
            .getInterpreters()
            .then((items) => (InterpreterCountTracker.interpreterCount = items.length))
            .catch(noop);
    }
}
