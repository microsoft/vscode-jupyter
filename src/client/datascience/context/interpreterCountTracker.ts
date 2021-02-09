// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { IExtensionSingleActivationService } from '../../activation/types';
import { inject, injectable } from 'inversify';
import { IInterpreterService } from '../../interpreter/contracts';
import { IPythonExtensionChecker } from '../../api/types';
import { noop } from '../../common/utils/misc';

@injectable()
export class InterpreterCountTracker implements IExtensionSingleActivationService {
    private static interpreterCount = 0;
    public static get totalNumberOfInterpreters() {
        return InterpreterCountTracker.interpreterCount;
    }
    constructor(
        @inject(IPythonExtensionChecker) private readonly pythonExtensionChecker: IPythonExtensionChecker,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService
    ) {}
    public async activate() {
        if (!this.pythonExtensionChecker.isPythonExtensionInstalled) {
            return;
        }
        this.interpreterService
            .getInterpreters()
            .then((items) => (InterpreterCountTracker.interpreterCount = items.length))
            .catch(noop);
    }
}
