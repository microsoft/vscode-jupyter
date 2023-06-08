// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as TypeMoq from 'typemoq';
import { Uri } from 'vscode';
import { getFilePath } from '../../platform/common/platform/fs-paths';
import { IFileSystem } from '../../platform/common/platform/types';
import { IProcessService, StdErrError } from '../../platform/common/process/types.node';
import { PythonEnvironment } from '../../platform/pythonEnvironments/info';
import { noop } from '../../test/core';
import { createPythonEnv } from './pythonEnvironment.node';
import { createPythonProcessService } from './pythonProcess.node';

use(chaiAsPromised);

// eslint-disable-next-line
suite('PythonProcessService', () => {
    let processService: TypeMoq.IMock<IProcessService>;
    let fileSystem: TypeMoq.IMock<IFileSystem>;
    const pythonPath = Uri.file('path/to/python');

    setup(() => {
        processService = TypeMoq.Mock.ofType<IProcessService>(undefined, TypeMoq.MockBehavior.Strict);
        fileSystem = TypeMoq.Mock.ofType<IFileSystem>(undefined, TypeMoq.MockBehavior.Strict);
    });

    test('execObservable should call processService.execObservable', () => {
        const args = ['-a', 'b', '-c'];
        const options = {};
        const observable = {
            proc: undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            out: {} as any,
            dispose: () => {
                noop();
            }
        };
        processService.setup((p) => p.execObservable(getFilePath(pythonPath), args, options)).returns(() => observable);
        const env = createPythonEnv({ uri: pythonPath } as PythonEnvironment, processService.object, fileSystem.object);
        const procs = createPythonProcessService(processService.object, env);

        const result = procs.execObservable(args, options);

        processService.verify((p) => p.execObservable(getFilePath(pythonPath), args, options), TypeMoq.Times.once());
        expect(result).to.be.equal(observable, 'execObservable should return an observable');
    });

    test('execModuleObservable should call processService.execObservable with the -m argument', () => {
        const args = ['-a', 'b', '-c'];
        const moduleName = 'foo';
        const expectedArgs = ['-m', moduleName, ...args];
        const options = {};
        const observable = {
            proc: undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            out: {} as any,
            dispose: () => {
                noop();
            }
        };
        processService
            .setup((p) => p.execObservable(getFilePath(pythonPath), expectedArgs, options))
            .returns(() => observable);
        const env = createPythonEnv({ uri: pythonPath } as PythonEnvironment, processService.object, fileSystem.object);
        const procs = createPythonProcessService(processService.object, env);

        const result = procs.execModuleObservable(moduleName, args, options);

        processService.verify(
            (p) => p.execObservable(getFilePath(pythonPath), expectedArgs, options),
            TypeMoq.Times.once()
        );
        expect(result).to.be.equal(observable, 'execModuleObservable should return an observable');
    });

    test('exec should call processService.exec', async () => {
        const args = ['-a', 'b', '-c'];
        const options = {};
        const stdout = 'foo';
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), args, options))
            .returns(() => Promise.resolve({ stdout }));
        const env = createPythonEnv({ uri: pythonPath } as PythonEnvironment, processService.object, fileSystem.object);
        const procs = createPythonProcessService(processService.object, env);

        const result = await procs.exec(args, options);

        processService.verify((p) => p.exec(getFilePath(pythonPath), args, options), TypeMoq.Times.once());
        expect(result.stdout).to.be.equal(stdout, 'exec should return the content of stdout');
    });

    test('execModule should call processService.exec with the -m argument', async () => {
        const args = ['-a', 'b', '-c'];
        const moduleName = 'foo';
        const expectedArgs = ['-m', moduleName, ...args];
        const options = {};
        const stdout = 'bar';
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), expectedArgs, options))
            .returns(() => Promise.resolve({ stdout }));
        const env = createPythonEnv({ uri: pythonPath } as PythonEnvironment, processService.object, fileSystem.object);
        const procs = createPythonProcessService(processService.object, env);

        const result = await procs.execModule(moduleName, args, options);

        processService.verify((p) => p.exec(getFilePath(pythonPath), expectedArgs, options), TypeMoq.Times.once());
        expect(result.stdout).to.be.equal(stdout, 'exec should return the content of stdout');
    });

    test('execModule should throw an error if the module is not installed', async () => {
        const args = ['-a', 'b', '-c'];
        const moduleName = 'foo';
        const expectedArgs = ['-m', moduleName, ...args];
        const options = {};
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), expectedArgs, options))
            .returns(() => Promise.resolve({ stdout: 'bar', stderr: `Error: No module named ${moduleName}` }));
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), ['-c', `import ${moduleName}`], { throwOnStdErr: true }))
            .returns(() => Promise.reject(new StdErrError('not installed')));
        const env = createPythonEnv({ uri: pythonPath } as PythonEnvironment, processService.object, fileSystem.object);
        const procs = createPythonProcessService(processService.object, env);

        const result = procs.execModule(moduleName, args, options);

        await expect(result).to.eventually.be.rejectedWith(`Module '${moduleName}' not installed`);
    });
});
