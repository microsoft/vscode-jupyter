// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { instance, mock } from 'ts-mockito';
import { FileSystem } from '../../../platform/common/platform/fileSystem.node';
import { IExtensionContext, IHttpClient } from '../../../platform/common/types';
import { EnvironmentVariablesService } from '../../../platform/common/variables/environment.node';
import { IEnvironmentVariablesService } from '../../../platform/common/variables/types';

use(chaiAsPromised);

// Functional tests that run code using the VS Code API are found
// in envVarsService.test.ts.

suite('Environment Variables Service', () => {
    let variablesService: IEnvironmentVariablesService;
    setup(() => {
        const context: IExtensionContext = mock(IExtensionContext);
        const client: IHttpClient = mock(IHttpClient);
        const fs = new FileSystem(instance(context), instance(client));
        variablesService = new EnvironmentVariablesService(fs);
    });

    suite('parseFile()', () => {
        test('Custom variables should be undefined with no argument', async () => {
            const vars = await variablesService.parseFile(undefined);
            expect(vars).to.equal(undefined, 'Variables should be undefined');
        });
    });
});
