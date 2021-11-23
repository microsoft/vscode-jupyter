// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { injectable } from 'inversify';
import { EnvironmentVariables } from '../variables/types';

@injectable()
export class CurrentProcess {
    public get env(): EnvironmentVariables {
        return (process.env as any) as EnvironmentVariables;
    }
}
