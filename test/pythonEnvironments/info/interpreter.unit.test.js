"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const path_1 = require("path");
const semver_1 = require("semver");
const typemoq_1 = require("typemoq");
const types_1 = require("../../../client/common/process/types");
const platform_1 = require("../../../client/common/utils/platform");
const exec_1 = require("../../../client/pythonEnvironments/exec");
const interpreter_1 = require("../../../client/pythonEnvironments/info/interpreter");
const constants_1 = require("../../constants");
const script = (0, path_1.join)(constants_1.EXTENSION_ROOT_DIR_FOR_TESTS, 'pythonFiles', 'interpreterInfo.py');
suite('extractInterpreterInfo()', () => {
});
suite('getInterpreterInfo()', () => {
    let deps;
    const python = (0, exec_1.buildPythonExecInfo)('path/to/python');
    setup(() => {
        deps = typemoq_1.Mock.ofType(undefined, typemoq_1.MockBehavior.Strict);
    });
    test('should call exec() with the proper command and timeout', async () => {
        const json = {
            versionInfo: [3, 7, 5, 'candidate', 1],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: true,
        };
        const cmd = `"${python.command}" "${script}"`;
        deps
            .setup((d) => d.shellExec(cmd, typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        await (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        deps.verifyAll();
    });
    test('should quote spaces in the command', async () => {
        const json = {
            versionInfo: [3, 7, 5, 'candidate', 1],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: true,
        };
        const _python = (0, exec_1.buildPythonExecInfo)(' path to /my python ');
        const cmd = `" path to /my python " "${script}"`;
        deps
            .setup((d) => d.shellExec(cmd, typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        await (0, interpreter_1.getInterpreterInfo)(_python, shellExec);
        deps.verifyAll();
    });
    test('should handle multi-command (e.g. conda)', async () => {
        const json = {
            versionInfo: [3, 7, 5, 'candidate', 1],
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: true,
        };
        const _python = (0, exec_1.buildPythonExecInfo)(['path/to/conda', 'run', '-n', 'my-env', 'python']);
        const cmd = `"path/to/conda" "run" "-n" "my-env" "python" "${script}"`;
        deps
            .setup((d) => d.shellExec(cmd, typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        await (0, interpreter_1.getInterpreterInfo)(_python, shellExec);
        deps.verifyAll();
    });
    test('should return an object if exec() is successful', async () => {
        const expected = {
            architecture: platform_1.Architecture.x64,
            path: python.command,
            version: new semver_1.SemVer('3.7.5-candidate1'),
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            sysVersion: undefined,
        };
        const json = {
            versionInfo: [3, 7, 5, 'candidate', 1],
            sysPrefix: expected.sysPrefix,
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: true,
        };
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = await (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        (0, chai_1.expect)(result).to.deep.equal(expected, 'broken');
        deps.verifyAll();
    });
    test('should return an object if the version info contains less than 4 items', async () => {
        const expected = {
            architecture: platform_1.Architecture.x64,
            path: python.command,
            version: new semver_1.SemVer('3.7.5'),
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            sysVersion: undefined,
        };
        const json = {
            versionInfo: [3, 7, 5],
            sysPrefix: expected.sysPrefix,
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: true,
        };
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = await (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        (0, chai_1.expect)(result).to.deep.equal(expected, 'broken');
        deps.verifyAll();
    });
    test('should return an object with the architecture value set to x86 if json.is64bit is not 64bit', async () => {
        const expected = {
            architecture: platform_1.Architecture.x86,
            path: python.command,
            version: new semver_1.SemVer('3.7.5-candidate'),
            sysPrefix: '/path/of/sysprefix/versions/3.7.5rc1',
            sysVersion: undefined,
        };
        const json = {
            versionInfo: [3, 7, 5, 'candidate'],
            sysPrefix: expected.sysPrefix,
            version: '3.7.5rc1 (default, Oct 18 2019, 14:48:48) \n[Clang 11.0.0 (clang-1100.0.33.8)]',
            is64Bit: false,
        };
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({
            stdout: JSON.stringify(json),
        }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = await (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        (0, chai_1.expect)(result).to.deep.equal(expected, 'broken');
        deps.verifyAll();
    });
    test('should return undefined if the result of exec() writes to stderr', async () => {
        const err = new types_1.StdErrError('oops!');
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.reject(err));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        await (0, chai_1.expect)(result).to.eventually.be.rejectedWith(err);
        deps.verifyAll();
    });
    test('should fail if exec() fails (e.g. the script times out)', async () => {
        const err = new Error('oops');
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.reject(err));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        await (0, chai_1.expect)(result).to.eventually.be.rejectedWith(err);
        deps.verifyAll();
    });
    test('should fail if the json value returned by interpreterInfo.py is not valid', async () => {
        deps
            .setup((d) => d.shellExec(typemoq_1.It.isAny(), typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({ stdout: 'bad json' }));
        const shellExec = async (c, t) => deps.object.shellExec(c, t);
        const result = (0, interpreter_1.getInterpreterInfo)(python, shellExec);
        await (0, chai_1.expect)(result).to.eventually.be.rejected;
        deps.verifyAll();
    });
});
//# sourceMappingURL=interpreter.unit.test.js.map