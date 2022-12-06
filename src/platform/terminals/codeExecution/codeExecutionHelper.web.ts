// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { IServiceContainer } from '../../ioc/types';
import { CodeExecutionHelperBase } from './codeExecutionHelper';

@injectable()
export class CodeExecutionHelper extends CodeExecutionHelperBase {
    // constructor only needed as a injection point
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer) {
        super(serviceContainer);
    }
}
