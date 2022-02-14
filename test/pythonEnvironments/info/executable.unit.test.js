"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const typemoq_1 = require("typemoq");
const types_1 = require("../../../client/common/process/types");
const exec_1 = require("../../../client/pythonEnvironments/exec");
const executable_1 = require("../../../client/pythonEnvironments/info/executable");
suite('getExecutablePath()', () => {
    let deps;
    const python = (0, exec_1.buildPythonExecInfo)('path/to/python');
    setup(() => {
        deps = typemoq_1.Mock.ofType(undefined, typemoq_1.MockBehavior.Strict);
    });
    test('should get the value by running python', async () => {
        const expected = 'path/to/dummy/executable';
        deps.setup((d) => d.shellExec(`${python.command} -c "import sys;print(sys.executable)"`, typemoq_1.It.isAny()))
            .returns(() => Promise.resolve({ stdout: expected }));
        const exec = async (c, a) => deps.object.shellExec(c, a);
        const result = await (0, executable_1.getExecutablePath)(python, exec);
        (0, chai_1.expect)(result).to.equal(expected, 'getExecutablePath() should return get the value by running Python');
        deps.verifyAll();
    });
    test('should throw if exec() fails', async () => {
        const stderr = 'oops';
        deps.setup((d) => d.shellExec(`${python.command} -c "import sys;print(sys.executable)"`, typemoq_1.It.isAny()))
            .returns(() => Promise.reject(new types_1.StdErrError(stderr)));
        const exec = async (c, a) => deps.object.shellExec(c, a);
        const promise = (0, executable_1.getExecutablePath)(python, exec);
        (0, chai_1.expect)(promise).to.eventually.be.rejectedWith(stderr);
        deps.verifyAll();
    });
});
//# sourceMappingURL=executable.unit.test.js.map