// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Uri } from 'vscode';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { IFileSystem } from '../../../platform/common/platform/types';
import { createCondaEnv, createPythonEnv } from '../../../platform/common/process/pythonEnvironment.node';
import { IProcessService, StdErrError } from '../../../platform/common/process/types.node';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';

use(chaiAsPromised);

suite('PythonEnvironment', () => {
    let processService: TypeMoq.IMock<IProcessService>;
    let fileSystem: IFileSystem;
    const pythonPath = Uri.file('path/to/python');

    setup(() => {
        processService = TypeMoq.Mock.ofType<IProcessService>(undefined, TypeMoq.MockBehavior.Strict);
        fileSystem = mock<IFileSystem>();
    });
    test('getExecutablePath should return pythonPath if pythonPath is a file', async () => {
        when(fileSystem.exists(anything())).thenCall((file: Uri) => file.fsPath === pythonPath.fsPath);
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getExecutablePath();

        expect(result).to.equal(pythonPath, "getExecutablePath() sbould return pythonPath if it's a file");
    });

    test('getExecutablePath should not return pythonPath if pythonPath is not a file', async () => {
        const executablePath = 'path/to/dummy/executable';
        when(fileSystem.exists(anything())).thenCall((file: Uri) => file.fsPath !== pythonPath.fsPath);
        const argv = ['-c', 'import sys;print(sys.executable)'];
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), argv, { throwOnStdErr: true }))
            .returns(() => Promise.resolve({ stdout: executablePath }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getExecutablePath();

        expect(result.path.slice(1)).to.equal(
            executablePath,
            "getExecutablePath() sbould not return pythonPath if it's not a file"
        );
    });

    test('getExecutablePath should throw if the result of exec() writes to stderr', async () => {
        const stderr = 'bar';
        when(fileSystem.exists(anything())).thenCall((file: Uri) => file.fsPath !== pythonPath.fsPath);
        const argv = ['-c', 'import sys;print(sys.executable)'];
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), argv, { throwOnStdErr: true }))
            .returns(() => Promise.reject(new StdErrError(stderr)));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutablePath();

        await expect(result).to.eventually.be.rejectedWith(stderr);
    });

    test('isModuleInstalled should call processService.exec()', async () => {
        const moduleName = 'foo';
        const argv = ['-c', `import ${moduleName}`];
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), argv, { throwOnStdErr: true }))
            .returns(() => Promise.resolve({ stdout: '' }))
            .verifiable(TypeMoq.Times.once());
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        await env.isModuleInstalled(moduleName);

        processService.verifyAll();
    });

    test('isModuleInstalled should return true when processService.exec() succeeds', async () => {
        const moduleName = 'foo';
        const argv = ['-c', `import ${moduleName}`];
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), argv, { throwOnStdErr: true }))
            .returns(() => Promise.resolve({ stdout: '' }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.isModuleInstalled(moduleName);

        expect(result).to.equal(true, 'isModuleInstalled() should return true if the module exists');
    });

    test('isModuleInstalled should return false when processService.exec() throws', async () => {
        const moduleName = 'foo';
        const argv = ['-c', `import ${moduleName}`];
        processService
            .setup((p) => p.exec(getFilePath(pythonPath), argv, { throwOnStdErr: true }))
            .returns(() => Promise.reject(new StdErrError('bar')));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.isModuleInstalled(moduleName);

        expect(result).to.equal(false, 'isModuleInstalled() should return false if the module does not exist');
    });

    test('getExecutionInfo should return pythonPath and the execution arguments as is', () => {
        const args = ['-a', 'b', '-c'];
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutionInfo(args);

        expect(result).to.deep.equal(
            {
                command: getFilePath(pythonPath),
                args,
                python: [getFilePath(pythonPath)],
                pythonExecutable: getFilePath(pythonPath)
            },
            'getExecutionInfo should return pythonPath and the command and execution arguments as is'
        );
    });
});

suite('CondaEnvironment', () => {
    let processService: TypeMoq.IMock<IProcessService>;
    let fileSystem: IFileSystem;
    const args = ['-a', 'b', '-c'];
    const pythonPath = Uri.file('path/to/python');
    const condaFile = 'path/to/conda';

    setup(() => {
        processService = TypeMoq.Mock.ofType<IProcessService>(undefined, TypeMoq.MockBehavior.Strict);
        fileSystem = mock<IFileSystem>();
    });

    test('getExecutionInfo with a named environment should return execution info using the environment name', () => {
        const condaInfo = { name: 'foo', path: 'bar', version: undefined };
        const env = createCondaEnv(
            condaFile,
            condaInfo,
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutionInfo(args);

        expect(result).to.deep.equal({
            command: condaFile,
            args: ['run', '-n', condaInfo.name, 'python', ...args],
            python: [condaFile, 'run', '-n', condaInfo.name, 'python'],
            pythonExecutable: 'python'
        });
    });

    test('getExecutionInfo with a non-named environment should return execution info using the environment path', () => {
        const condaInfo = { name: '', path: 'bar', version: undefined };
        const env = createCondaEnv(
            condaFile,
            condaInfo,
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutionInfo(args);

        expect(result).to.deep.equal({
            command: condaFile,
            args: ['run', '-p', condaInfo.path, 'python', ...args],
            python: [condaFile, 'run', '-p', condaInfo.path, 'python'],
            pythonExecutable: 'python'
        });
    });

    test('getExecutionObservableInfo with a named environment should return execution info using pythonPath only', () => {
        const expected = {
            command: getFilePath(pythonPath),
            args,
            python: [getFilePath(pythonPath)],
            pythonExecutable: getFilePath(pythonPath)
        };
        const condaInfo = { name: 'foo', path: 'bar', version: undefined };
        const env = createCondaEnv(
            condaFile,
            condaInfo,
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutionObservableInfo(args);

        expect(result).to.deep.equal(expected);
    });

    test('getExecutionObservableInfo with a non-named environment should return execution info using pythonPath only', () => {
        const expected = {
            command: getFilePath(pythonPath),
            args,
            python: [getFilePath(pythonPath)],
            pythonExecutable: getFilePath(pythonPath)
        };
        const condaInfo = { name: '', path: 'bar', version: undefined };
        const env = createCondaEnv(
            condaFile,
            condaInfo,
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = env.getExecutionObservableInfo(args);

        expect(result).to.deep.equal(expected);
    });
});
