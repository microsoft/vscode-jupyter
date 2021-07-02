// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */

import { expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as TypeMoq from 'typemoq';
import { IFileSystem } from '../../../client/common/platform/types';
import { EnvironmentVariablesService } from '../../../client/common/variables/environment';
import { IEnvironmentVariablesProvider } from '../../../client/common/variables/types';
import { KernelEnvironmentVariablesService } from '../../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../client/interpreter/activation/types';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';

use(chaiAsPromised);

suite('Kernel Environment Variables Service', () => {
    let fs: TypeMoq.IMock<IFileSystem>;
    let envActivation: TypeMoq.IMock<IEnvironmentActivationService>;
    let customVariablesService: TypeMoq.IMock<IEnvironmentVariablesProvider>;
    let variablesService: EnvironmentVariablesService;
    let kernelVariablesService: KernelEnvironmentVariablesService;
    const interpreter: PythonEnvironment = {
        envType: EnvironmentType.Conda,
        path: 'foobar',
        sysPrefix: '0'
    };
    const kernelSpec: IJupyterKernelSpec = {
        name: 'kernel',
        path: 'foobar',
        display_name: 'kernel',
        interpreterPath: 'foobar',
        argv: []
    };

    setup(() => {
        fs = TypeMoq.Mock.ofType<IFileSystem>(undefined, TypeMoq.MockBehavior.Strict);
        envActivation = TypeMoq.Mock.ofType<IEnvironmentActivationService>(undefined, TypeMoq.MockBehavior.Strict);
        customVariablesService = TypeMoq.Mock.ofType<IEnvironmentVariablesProvider>(
            undefined,
            TypeMoq.MockBehavior.Strict
        );
        variablesService = new EnvironmentVariablesService(fs.object);
        kernelVariablesService = new KernelEnvironmentVariablesService(
            envActivation.object,
            variablesService,
            customVariablesService.object
        );
    });

    suite(`getEnvironmentVariables()`, () => {
        test('Interpreter path trumps process', async () => {
            envActivation
                .setup((e) =>
                    e.getActivatedEnvironmentVariables(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())
                )
                .returns(() => Promise.resolve({ PATH: 'foobar' }));
            customVariablesService
                .setup((c) => c.getCustomEnvironmentVariables(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve(undefined));

            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, interpreter, kernelSpec);

            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            expect(processPath).to.not.be.undefined;
            expect(vars).to.not.be.undefined;
            expect(vars![processPath!]).to.be.equal('foobar');
        });

        test('Paths are merged', async () => {
            envActivation
                .setup((e) =>
                    e.getActivatedEnvironmentVariables(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())
                )
                .returns(() => Promise.resolve({ pATh: 'foobar' }));
            customVariablesService
                .setup((c) => c.getCustomEnvironmentVariables(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve({ PATH: 'foobaz' }));

            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, interpreter, kernelSpec);
            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            expect(processPath).to.not.be.undefined;
            expect(vars).to.not.be.undefined;
            expect(vars![processPath!]).to.be.equal('foobar;foobaz');
        });
    });
});
