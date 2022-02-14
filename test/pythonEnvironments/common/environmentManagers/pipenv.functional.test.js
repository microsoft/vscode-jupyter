"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const path = require("path");
const sinon = require("sinon");
const platformApis = require("../../../../client/common/utils/platform");
const externalDependencies = require("../../../../client/pythonEnvironments/common/externalDependencies");
const pipenv_1 = require("../../../../client/pythonEnvironments/common/environmentManagers/pipenv");
const commonTestConstants_1 = require("../commonTestConstants");
suite('Pipenv utils', () => {
    let readFile;
    let getEnvVar;
    setup(() => {
        getEnvVar = sinon.stub(platformApis, 'getEnvironmentVariable');
        readFile = sinon.stub(externalDependencies, 'readFile');
    });
    teardown(() => {
        readFile.restore();
        getEnvVar.restore();
    });
    test('Global pipenv environment is associated with a project whose Pipfile lies at 3 levels above the project', async () => {
        getEnvVar.withArgs('PIPENV_MAX_DEPTH').returns('5');
        const expectedDotProjectFile = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'globalEnvironments', 'project3-2s1eXEJ2', '.project');
        const project = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'project3');
        readFile.withArgs(expectedDotProjectFile).resolves(project);
        const interpreterPath = path.join(commonTestConstants_1.TEST_LAYOUT_ROOT, 'pipenv', 'globalEnvironments', 'project3-2s1eXEJ2', 'Scripts', 'python.exe');
        const folder = path.join(project, 'parent', 'child', 'folder');
        const isRelated = await (0, pipenv_1.isPipenvEnvironmentRelatedToFolder)(interpreterPath, folder);
        assert.strictEqual(isRelated, true);
    });
});
//# sourceMappingURL=pipenv.functional.test.js.map