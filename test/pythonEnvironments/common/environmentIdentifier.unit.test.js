"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const path = require("path");
const sinon = require("sinon");
const platformApis = require("../../../client/common/utils/platform");
const info_1 = require("../../../client/pythonEnvironments/base/info");
const environmentIdentifier_1 = require("../../../client/pythonEnvironments/common/environmentIdentifier");
const externalDependencies = require("../../../client/pythonEnvironments/common/externalDependencies");
const common_1 = require("../../common");
const commonTestConstants_1 = require("./commonTestConstants");
suite('Environment Identifier', () => {
    suite('Conda', () => {
        test('Conda layout with conda-meta and python binary in the same directory', async () => {
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'conda1', 'python.exe');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepEqual(envType, info_1.PythonEnvKind.Conda);
        });
        test('Conda layout with conda-meta and python binary in a sub directory', async () => {
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'conda2', 'bin', 'python');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepEqual(envType, info_1.PythonEnvKind.Conda);
        });
    });
    suite('Pipenv', () => {
        let getEnvVar;
        let readFile;
        setup(() => {
            getEnvVar = sinon.stub(platformApis, 'getEnvironmentVariable');
            readFile = sinon.stub(externalDependencies, 'readFile');
        });
        teardown(() => {
            readFile.restore();
            getEnvVar.restore();
        });
        test('Path to a global pipenv environment', async () => {
            const expectedDotProjectFile = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'globalEnvironments', 'project2-vnNIWe9P', '.project');
            const expectedProjectFile = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'project2');
            readFile.withArgs(expectedDotProjectFile).resolves(expectedProjectFile);
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'globalEnvironments', 'project2-vnNIWe9P', 'bin', 'python');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.strictEqual(envType, info_1.PythonEnvKind.Pipenv);
        });
        test('Path to a local pipenv environment with a custom Pipfile name', async () => {
            getEnvVar.withArgs('PIPENV_PIPFILE').returns('CustomPipfileName');
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'project1', '.venv', 'Scripts', 'python.exe');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.strictEqual(envType, info_1.PythonEnvKind.Pipenv);
        });
    });
    suite('Windows Store', () => {
        let getEnvVar;
        let pathExists;
        const fakeLocalAppDataPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'storeApps');
        const fakeProgramFilesPath = 'X:\\Program Files';
        const executable = ['python.exe', 'python3.exe', 'python3.8.exe'];
        suiteSetup(() => {
            getEnvVar = sinon.stub(platformApis, 'getEnvironmentVariable');
            getEnvVar.withArgs('LOCALAPPDATA').returns(fakeLocalAppDataPath);
            getEnvVar.withArgs('ProgramFiles').returns(fakeProgramFilesPath);
            pathExists = sinon.stub(externalDependencies, 'pathExists');
            pathExists.withArgs(path.join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', 'idle.exe')).resolves(true);
        });
        suiteTeardown(() => {
            getEnvVar.restore();
            pathExists.restore();
        });
        executable.forEach((exe) => {
            test(`Path to local app data windows store interpreter (${exe})`, async () => {
                getEnvVar.withArgs('LOCALAPPDATA').returns(fakeLocalAppDataPath);
                const interpreterPath = path.join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', exe);
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Path to local app data windows store interpreter app sub-directory (${exe})`, async () => {
                getEnvVar.withArgs('LOCALAPPDATA').returns(fakeLocalAppDataPath);
                const interpreterPath = path.join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', 'PythonSoftwareFoundation.Python.3.8_qbz5n2kfra8p0', exe);
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Path to program files windows store interpreter app sub-directory (${exe})`, async () => {
                const interpreterPath = path.join(fakeProgramFilesPath, 'WindowsApps', 'PythonSoftwareFoundation.Python.3.8_qbz5n2kfra8p0', exe);
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Local app data not set (${exe})`, async () => {
                getEnvVar.withArgs('LOCALAPPDATA').returns(undefined);
                const interpreterPath = path.join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', exe);
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Program files app data not set (${exe})`, async () => {
                const interpreterPath = path.join(fakeProgramFilesPath, 'WindowsApps', 'PythonSoftwareFoundation.Python.3.8_qbz5n2kfra8p0', exe);
                getEnvVar.withArgs('ProgramFiles').returns(undefined);
                pathExists.withArgs(path.join(path.dirname(interpreterPath), 'idle.exe')).resolves(true);
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Path using forward slashes (${exe})`, async () => {
                const interpreterPath = path
                    .join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', exe)
                    .replace('\\', '/');
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
            test(`Path using long path style slashes (${exe})`, async () => {
                const interpreterPath = path
                    .join(fakeLocalAppDataPath, 'Microsoft', 'WindowsApps', exe)
                    .replace('\\', '/');
                pathExists.callsFake((p) => {
                    if (p.endsWith('idle.exe')) {
                        return Promise.resolve(true);
                    }
                    return Promise.resolve(false);
                });
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(`\\\\?\\${interpreterPath}`);
                assert.deepEqual(envType, info_1.PythonEnvKind.WindowsStore);
            });
        });
    });
    suite('Pyenv', () => {
        let getEnvVarStub;
        let getOsTypeStub;
        let getUserHomeDirStub;
        suiteSetup(() => {
            getEnvVarStub = sinon.stub(platformApis, 'getEnvironmentVariable');
            getOsTypeStub = sinon.stub(platformApis, 'getOSType');
            getUserHomeDirStub = sinon.stub(platformApis, 'getUserHomeDir');
        });
        suiteTeardown(() => {
            getEnvVarStub.restore();
            getOsTypeStub.restore();
            getUserHomeDirStub.restore();
        });
        test('PYENV_ROOT is not set on non-Windows, fallback to the default value ~/.pyenv', async function () {
            if ((0, common_1.getOSType)() === common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv1', '.pyenv', 'versions', '3.6.9', 'bin', 'python');
            getUserHomeDirStub.returns(path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv1'));
            getEnvVarStub.withArgs('PYENV_ROOT').returns(undefined);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.Pyenv);
            return undefined;
        });
        test('PYENV is not set on Windows, fallback to the default value %USERPROFILE%\\.pyenv\\pyenv-win', async function () {
            if ((0, common_1.getOSType)() !== common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv2', '.pyenv', 'pyenv-win', 'versions', '3.6.9', 'bin', 'python.exe');
            getUserHomeDirStub.returns(path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv2'));
            getEnvVarStub.withArgs('PYENV').returns(undefined);
            getOsTypeStub.returns(platformApis.OSType.Windows);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.Pyenv);
            return undefined;
        });
        test('PYENV_ROOT is set to a custom value on non-Windows', async function () {
            if ((0, common_1.getOSType)() === common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv3', 'versions', '3.6.9', 'bin', 'python');
            getEnvVarStub.withArgs('PYENV_ROOT').returns(path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv3'));
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.Pyenv);
            return undefined;
        });
        test('PYENV is set to a custom value on Windows', async function () {
            if ((0, common_1.getOSType)() !== common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv3', 'versions', '3.6.9', 'bin', 'python.exe');
            getEnvVarStub.withArgs('PYENV').returns(path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pyenv3'));
            getOsTypeStub.returns(platformApis.OSType.Windows);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.Pyenv);
            return undefined;
        });
    });
    suite('Venv', () => {
        test('Pyvenv.cfg is in the same directory as the interpreter', async () => {
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'venv1', 'python');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepEqual(envType, info_1.PythonEnvKind.Venv);
        });
        test('Pyvenv.cfg is in the same directory as the interpreter', async () => {
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'venv2', 'bin', 'python');
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepEqual(envType, info_1.PythonEnvKind.Venv);
        });
    });
    suite('Virtualenvwrapper', () => {
        let getEnvVarStub;
        let getOsTypeStub;
        let getUserHomeDirStub;
        suiteSetup(() => {
            getEnvVarStub = sinon.stub(platformApis, 'getEnvironmentVariable');
            getOsTypeStub = sinon.stub(platformApis, 'getOSType');
            getUserHomeDirStub = sinon.stub(platformApis, 'getUserHomeDir');
            getUserHomeDirStub.returns(path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'virtualenvwrapper1'));
        });
        suiteTeardown(() => {
            getEnvVarStub.restore();
            getOsTypeStub.restore();
            getUserHomeDirStub.restore();
        });
        test('WORKON_HOME is set to its default value ~/.virtualenvs on non-Windows', async function () {
            if ((0, common_1.getOSType)() === common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'virtualenvwrapper1', '.virtualenvs', 'myenv', 'bin', 'python');
            getEnvVarStub.withArgs('WORKON_HOME').returns(undefined);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.VirtualEnvWrapper);
            return undefined;
        });
        test('WORKON_HOME is set to its default value %USERPROFILE%\\Envs on Windows', async function () {
            if ((0, common_1.getOSType)() !== common_1.OSType.Windows) {
                return this.skip();
            }
            const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'virtualenvwrapper1', 'Envs', 'myenv', 'Scripts', 'python');
            getEnvVarStub.withArgs('WORKON_HOME').returns(undefined);
            getOsTypeStub.returns(platformApis.OSType.Windows);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.VirtualEnvWrapper);
            return undefined;
        });
        test('WORKON_HOME is set to a custom value', async () => {
            const workonHomeDir = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'virtualenvwrapper2');
            const interpreterPath = path.join(workonHomeDir, 'myenv', 'bin', 'python');
            getEnvVarStub.withArgs('WORKON_HOME').returns(workonHomeDir);
            const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
            assert.deepStrictEqual(envType, info_1.PythonEnvKind.VirtualEnvWrapper);
        });
    });
    suite('Virtualenv', () => {
        const activateFiles = [
            { folder: 'virtualenv1', file: 'activate' },
            { folder: 'virtualenv2', file: 'activate.sh' },
            { folder: 'virtualenv3', file: 'activate.ps1' },
        ];
        activateFiles.forEach(({ folder, file }) => {
            test(`Folder contains ${file}`, async () => {
                const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, folder, 'bin', 'python');
                const envType = await (0, environmentIdentifier_1.identifyEnvironment)(interpreterPath);
                assert.deepStrictEqual(envType, info_1.PythonEnvKind.VirtualEnv);
            });
        });
    });
});
//# sourceMappingURL=environmentIdentifier.unit.test.js.map