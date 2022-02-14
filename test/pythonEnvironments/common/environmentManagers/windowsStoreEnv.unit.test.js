"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const path = require("path");
const sinon = require("sinon");
const platformApis = require("../../../../client/common/utils/platform");
const windowsStoreLocator_1 = require("../../../../client/pythonEnvironments/base/locators/lowLevel/windowsStoreLocator");
const windowsStoreEnv_1 = require("../../../../client/pythonEnvironments/common/environmentManagers/windowsStoreEnv");
const commonTestConstants_1 = require("../commonTestConstants");
suite('Windows Store Env', () => {
    let getEnvVarStub;
    const testLocalAppData = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'storeApps');
    const testStoreAppRoot = path.join(testLocalAppData, 'Microsoft', 'WindowsApps');
    setup(() => {
        getEnvVarStub = sinon.stub(platformApis, 'getEnvironmentVariable');
        getEnvVarStub.withArgs('LOCALAPPDATA').returns(testLocalAppData);
    });
    teardown(() => {
        getEnvVarStub.restore();
    });
    test('Store Python Interpreters', async () => {
        const expected = [path.join(testStoreAppRoot, 'python3.7.exe'), path.join(testStoreAppRoot, 'python3.8.exe')];
        const actual = await (0, windowsStoreLocator_1.getWindowsStorePythonExes)();
        assert.deepEqual(actual, expected);
    });
    test('isWindowsStoreDir: valid case', () => {
        assert.deepStrictEqual((0, windowsStoreEnv_1.isWindowsStoreDir)(testStoreAppRoot), true);
        assert.deepStrictEqual((0, windowsStoreEnv_1.isWindowsStoreDir)(testStoreAppRoot + path.sep), true);
    });
    test('isWindowsStoreDir: invalid case', () => {
        assert.deepStrictEqual((0, windowsStoreEnv_1.isWindowsStoreDir)(__dirname), false);
    });
});
//# sourceMappingURL=windowsStoreEnv.unit.test.js.map