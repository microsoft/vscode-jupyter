"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const path = require("path");
const sinon = require("sinon");
const platformApis = require("../../../../client/common/utils/platform");
const externalDependencies = require("../../../../client/pythonEnvironments/common/externalDependencies");
const poetry_1 = require("../../../../client/pythonEnvironments/common/environmentManagers/poetry");
const commonTestConstants_1 = require("../commonTestConstants");
const testPoetryDir = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'poetry');
const project1 = path.join(testPoetryDir, 'project1');
const project4 = path.join(testPoetryDir, 'project4');
const project3 = path.join(testPoetryDir, 'project3');
suite('isPoetryEnvironment Tests', () => {
    let shellExecute;
    let getPythonSetting;
    suite('Global poetry environment', async () => {
        setup(() => {
            sinon.stub(platformApis, 'getOSType').callsFake(() => platformApis.OSType.Windows);
        });
        teardown(() => {
            sinon.restore();
        });
        test('Return true if environment folder name matches global env pattern and environment is of virtual env type', async () => {
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(testPoetryDir, 'poetry-tutorial-project-6hnqYwvD-py3.8', 'Scripts', 'python.exe'));
            (0, chai_1.expect)(result).to.equal(true);
        });
        test('Return false if environment folder name does not matches env pattern', async () => {
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(testPoetryDir, 'wannabeglobalenv', 'Scripts', 'python.exe'));
            (0, chai_1.expect)(result).to.equal(false);
        });
        test('Return false if environment folder name matches env pattern but is not of virtual env type', async () => {
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(testPoetryDir, 'project1-haha-py3.8', 'Scripts', 'python.exe'));
            (0, chai_1.expect)(result).to.equal(false);
        });
    });
    suite('Local poetry environment', async () => {
        setup(() => {
            shellExecute = sinon.stub(externalDependencies, 'shellExecute');
            getPythonSetting = sinon.stub(externalDependencies, 'getPythonSetting');
            getPythonSetting.returns('poetry');
            shellExecute.callsFake((command, _options) => {
                if (command === 'poetry env list --full-path') {
                    return Promise.resolve({ stdout: '' });
                }
                return Promise.reject(new Error('Command failed'));
            });
        });
        teardown(() => {
            sinon.restore();
        });
        test('Return true if environment folder name matches criteria for local envs', async () => {
            sinon.stub(platformApis, 'getOSType').callsFake(() => platformApis.OSType.Windows);
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(project1, '.venv', 'Scripts', 'python.exe'));
            (0, chai_1.expect)(result).to.equal(true);
        });
        test(`Return false if environment folder name is not named '.venv' for local envs`, async () => {
            sinon.stub(platformApis, 'getOSType').callsFake(() => platformApis.OSType.Windows);
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(project1, '.venv2', 'Scripts', 'python.exe'));
            (0, chai_1.expect)(result).to.equal(false);
        });
        test(`Return false if running poetry for project dir as cwd fails (pyproject.toml file is invalid)`, async () => {
            sinon.stub(platformApis, 'getOSType').callsFake(() => platformApis.OSType.Linux);
            const result = await (0, poetry_1.isPoetryEnvironment)(path.join(project4, '.venv', 'bin', 'python'));
            (0, chai_1.expect)(result).to.equal(false);
        });
    });
});
suite('Poetry binary is located correctly', async () => {
    let shellExecute;
    let getPythonSetting;
    setup(() => {
        getPythonSetting = sinon.stub(externalDependencies, 'getPythonSetting');
        shellExecute = sinon.stub(externalDependencies, 'shellExecute');
    });
    teardown(() => {
        sinon.restore();
    });
    test("Return undefined if pyproject.toml doesn't exist in cwd", async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((_command, _options) => Promise.resolve({ stdout: '' }));
        const poetry = await poetry_1.Poetry.getPoetry(testPoetryDir);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal(undefined);
    });
    test('Return undefined if cwd contains pyproject.toml which does not contain a poetry section', async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((_command, _options) => Promise.resolve({ stdout: '' }));
        const poetry = await poetry_1.Poetry.getPoetry(project3);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal(undefined);
    });
    test('When user has specified a valid poetry path, use it', async () => {
        getPythonSetting.returns('poetryPath');
        shellExecute.callsFake((command, options) => {
            if (command === `poetryPath env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)) {
                return Promise.resolve({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });
        const poetry = await poetry_1.Poetry.getPoetry(project1);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal('poetryPath');
    });
    test("When user hasn't specified a path, use poetry on PATH if available", async () => {
        getPythonSetting.returns('poetry');
        shellExecute.callsFake((command, options) => {
            if (command === `poetry env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)) {
                return Promise.resolve({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });
        const poetry = await poetry_1.Poetry.getPoetry(project1);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal('poetry');
    });
    test('When poetry is not available on PATH, try using the default poetry location if valid', async () => {
        const home = platformApis.getUserHomeDir();
        if (!home) {
            (0, chai_1.assert)(true);
            return;
        }
        const defaultPoetry = path.join(home, '.poetry', 'bin', 'poetry');
        const pathExistsSync = sinon.stub(externalDependencies, 'pathExistsSync');
        pathExistsSync.withArgs(defaultPoetry).returns(true);
        pathExistsSync.callThrough();
        getPythonSetting.returns('poetry');
        shellExecute.callsFake((command, options) => {
            if (command === `${defaultPoetry} env list --full-path` &&
                options.cwd &&
                externalDependencies.arePathsSame(options.cwd, project1)) {
                return Promise.resolve({ stdout: '' });
            }
            return Promise.reject(new Error('Command failed'));
        });
        const poetry = await poetry_1.Poetry.getPoetry(project1);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal(defaultPoetry);
    });
    test('Return undefined otherwise', async () => {
        getPythonSetting.returns('poetry');
        shellExecute.callsFake((_command, _options) => Promise.reject(new Error('Command failed')));
        const poetry = await poetry_1.Poetry.getPoetry(project1);
        (0, chai_1.expect)(poetry === null || poetry === void 0 ? void 0 : poetry.command).to.equal(undefined);
    });
});
//# sourceMappingURL=poetry.unit.test.js.map