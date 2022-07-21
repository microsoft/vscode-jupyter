/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line
/* eslint-disable comma-dangle */
// eslint-disable-next-line
/* eslint-disable max-classes-per-file */
// eslint-disable-next-line
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
// eslint-disable-next-line
/* eslint-disable class-methods-use-this */
// eslint-disable-next-line
/* eslint-disable consistent-return */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IPythonApiProvider, IPythonDebuggerPathProvider } from './types';

@injectable()
export class PythonDebuggerPathProvider implements IPythonDebuggerPathProvider {
    constructor(@inject(IPythonApiProvider) private readonly apiProvider: IPythonApiProvider) {}

    public getDebuggerPath(): Promise<string> {
        return this.apiProvider.getApi().then((api) => api.getDebuggerPath());
    }
}
