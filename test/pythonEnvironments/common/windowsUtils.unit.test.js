"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const windowsUtils_1 = require("../../../client/pythonEnvironments/common/windowsUtils");
suite('Windows Utils tests', () => {
    const testParams = [
        { path: 'python.exe', expected: true },
        { path: 'python3.exe', expected: true },
        { path: 'python38.exe', expected: true },
        { path: 'python3.8.exe', expected: true },
        { path: 'python', expected: false },
        { path: 'python3', expected: false },
        { path: 'python38', expected: false },
        { path: 'python3.8', expected: false },
        { path: 'idle.exe', expected: false },
        { path: 'pip.exe', expected: false },
        { path: 'python.dll', expected: false },
        { path: 'python3.dll', expected: false },
        { path: 'python3.8.dll', expected: false },
    ];
    testParams.forEach((testParam) => {
        test(`Python executable check ${testParam.expected ? 'should match' : 'should not match'} this path: ${testParam.path}`, () => {
            assert.deepEqual((0, windowsUtils_1.matchPythonBinFilename)(testParam.path), testParam.expected);
        });
    });
});
//# sourceMappingURL=windowsUtils.unit.test.js.map