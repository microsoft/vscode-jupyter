// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable  */

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { SemVer } from 'semver';
import { anything, instance, mock, when } from 'ts-mockito';
import * as TypeMoq from 'typemoq';
import { Uri } from 'vscode';
import { getFilePath } from '../../../platform/common/platform/fs-paths';
import { IFileSystem } from '../../../platform/common/platform/types';
import {
    createCondaEnv,
    createPythonEnv,
    createWindowsStoreEnv
} from '../../../platform/common/process/pythonEnvironment.node';
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

    test('getInterpreterInformation should return an object if the python path is valid', async () => {
        const json = {
            versionInfo: [3, 7, 5, 'candidate'],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]'
        };

        processService
            .setup((p) => p.shellExec(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ stdout: JSON.stringify(json) }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getInterpreterInformation();
        const expectedResult = {
            uri: pythonPath,
            version: new SemVer('3.7.5-candidate'),
            sysPrefix: json.sysPrefix,
            sysVersion: undefined
        };

        expect(result).to.deep.equal(expectedResult, 'Incorrect value returned by getInterpreterInformation().');
    });

    test('getInterpreterInformation should return an object if the version info contains less than 4 items', async () => {
        const json = {
            versionInfo: [3, 7, 5],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]'
        };

        processService
            .setup((p) => p.shellExec(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ stdout: JSON.stringify(json) }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getInterpreterInformation();
        const expectedResult = {
            uri: pythonPath,
            version: new SemVer('3.7.5'),
            sysPrefix: json.sysPrefix,
            sysVersion: undefined
        };

        expect(result).to.deep.equal(
            expectedResult,
            'Incorrect value returned by getInterpreterInformation() with truncated versionInfo.'
        );
    });

    test('getInterpreterInformation should return an object with the architecture value set to x86 if json.is64bit is not 64bit', async () => {
        const json = {
            versionInfo: [3, 7, 5, 'candidate'],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]'
        };

        processService
            .setup((p) => p.shellExec(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ stdout: JSON.stringify(json) }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getInterpreterInformation();
        const expectedResult = {
            uri: pythonPath,
            version: new SemVer('3.7.5-candidate'),
            sysPrefix: json.sysPrefix,
            sysVersion: undefined
        };

        expect(result).to.deep.equal(
            expectedResult,
            'Incorrect value returned by getInterpreterInformation() for x86b architecture.'
        );
    });

    test('getInterpreterInformation should error out if interpreterInfo.py times out', async () => {
        processService
            .setup((p) => p.shellExec(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .returns(() => Promise.reject(new Error('timed out')));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getInterpreterInformation();

        expect(result).to.equal(
            undefined,
            'getInterpreterInfo() should return undefined because interpreterInfo timed out.'
        );
    });

    test('getInterpreterInformation should return undefined if the json value returned by interpreterInfo.py is not valid', async () => {
        processService
            .setup((p) => p.shellExec(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve({ stdout: 'bad json' }));
        const env = createPythonEnv(
            { uri: pythonPath } as PythonEnvironment,
            processService.object,
            instance(fileSystem)
        );

        const result = await env.getInterpreterInformation();

        expect(result).to.equal(undefined, 'getInterpreterInfo() should return undefined because of bad json.');
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

suite('WindowsStoreEnvironment', () => {
    let processService: TypeMoq.IMock<IProcessService>;
    const pythonPath = Uri.file('foo');

    setup(() => {
        processService = TypeMoq.Mock.ofType<IProcessService>(undefined, TypeMoq.MockBehavior.Strict);
    });

    test('Should return pythonPath if it is the path to the windows store interpreter', async () => {
        const env = createWindowsStoreEnv({ uri: pythonPath } as PythonEnvironment, processService.object);

        const executablePath = await env.getExecutablePath();

        expect(executablePath).to.equal(pythonPath);
        processService.verifyAll();
    });
});
