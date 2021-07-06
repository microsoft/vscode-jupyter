// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

/* eslint-disable  */

import { expect, use } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as TypeMoq from 'typemoq';
import * as path from 'path';
import { IFileSystem } from '../../../client/common/platform/types';
import { EnvironmentVariablesService } from '../../../client/common/variables/environment';
import { IEnvironmentVariablesProvider } from '../../../client/common/variables/types';
import { KernelEnvironmentVariablesService } from '../../../client/datascience/kernel-launcher/kernelEnvVarsService';
import { IJupyterKernelSpec } from '../../../client/datascience/types';
import { IEnvironmentActivationService } from '../../../client/interpreter/activation/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { EnvironmentType, PythonEnvironment } from '../../../client/pythonEnvironments/info';

use(chaiAsPromised);

suite('Kernel Environment Variables Service', () => {
    let fs: TypeMoq.IMock<IFileSystem>;
    let envActivation: TypeMoq.IMock<IEnvironmentActivationService>;
    let customVariablesService: TypeMoq.IMock<IEnvironmentVariablesProvider>;
    let variablesService: EnvironmentVariablesService;
    let kernelVariablesService: KernelEnvironmentVariablesService;
    let interpreterService: TypeMoq.IMock<IInterpreterService>;
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
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>(undefined, TypeMoq.MockBehavior.Strict);
        variablesService = new EnvironmentVariablesService(fs.object);
        kernelVariablesService = new KernelEnvironmentVariablesService(
            interpreterService.object,
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
            expect(vars![processPath!]).to.be.equal(`foobar${path.delimiter}foobaz`);
        });

        test('KernelSpec interpreterPath used if interpreter is undefined', async () => {
            interpreterService
                .setup((e) => e.getInterpreterDetails('foobar'))
                .returns(() =>
                    Promise.resolve({ envType: EnvironmentType.Conda, path: 'foopath', sysPrefix: 'foosysprefix' })
                );
            envActivation
                .setup((e) =>
                    e.getActivatedEnvironmentVariables(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny())
                )
                .returns(() => Promise.resolve({ PATH: 'foobar' }));
            customVariablesService
                .setup((c) => c.getCustomEnvironmentVariables(TypeMoq.It.isAny()))
                .returns(() => Promise.resolve({ PATH: 'foobaz' }));

            // undefined for interpreter here, interpreterPath from the spec should be used
            const vars = await kernelVariablesService.getEnvironmentVariables(undefined, undefined, kernelSpec);
            const processPath = Object.keys(process.env).find((k) => k.toLowerCase() == 'path');
            expect(processPath).to.not.be.undefined;
            expect(vars).to.not.be.undefined;
            expect(vars![processPath!]).to.be.equal(`foobar${path.delimiter}foobaz`);
        });
    });
});
