"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const path = require("path");
const TypeMoq = require("typemoq");
const fs_paths_1 = require("../../../../client/common/platform/fs-paths");
const condaService_1 = require("../../../../client/pythonEnvironments/common/environmentManagers/condaService");
suite('Interpreters Conda Service', () => {
    let platformService;
    let condaService;
    let fileSystem;
    let workspaceService;
    setup(async () => {
        workspaceService = TypeMoq.Mock.ofType();
        platformService = TypeMoq.Mock.ofType();
        fileSystem = TypeMoq.Mock.ofType();
        fileSystem
            .setup((fs) => fs.arePathsSame(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns((p1, p2) => {
            const utils = fs_paths_1.FileSystemPathUtils.withDefaults(fs_paths_1.FileSystemPaths.withDefaults(platformService.object.isWindows));
            return utils.arePathsSame(p1, p2);
        });
        condaService = new condaService_1.CondaService(platformService.object, fileSystem.object, [], workspaceService.object);
    });
    const testsForInterpreter = [
        {
            pythonPath: path.join('users', 'foo', 'envs', 'test1', 'python'),
            environmentName: 'test1',
            isLinux: true,
            expectedCondaPath: path.join('users', 'foo', 'bin', 'conda'),
        },
        {
            pythonPath: path.join('users', 'foo', 'envs', 'test2', 'python'),
            environmentName: 'test2',
            isLinux: true,
            expectedCondaPath: path.join('users', 'foo', 'envs', 'test2', 'conda'),
        },
        {
            pythonPath: path.join('users', 'foo', 'envs', 'test3', 'python'),
            environmentName: 'test3',
            isLinux: false,
            expectedCondaPath: path.join('users', 'foo', 'Scripts', 'conda.exe'),
        },
        {
            pythonPath: path.join('users', 'foo', 'envs', 'test4', 'python'),
            environmentName: 'test4',
            isLinux: false,
            expectedCondaPath: path.join('users', 'foo', 'conda.exe'),
        },
    ];
    testsForInterpreter.forEach((t) => {
        test(`Finds conda.exe for subenvironment ${t.environmentName}`, async () => {
            platformService.setup((p) => p.isLinux).returns(() => t.isLinux);
            platformService.setup((p) => p.isWindows).returns(() => !t.isLinux);
            platformService.setup((p) => p.isMac).returns(() => false);
            fileSystem
                .setup((f) => f.fileExists(TypeMoq.It.is((p) => {
                if (p === t.expectedCondaPath) {
                    return true;
                }
                return false;
            })))
                .returns(() => Promise.resolve(true));
            const condaFile = await condaService.getCondaFileFromInterpreter(t.pythonPath, t.environmentName);
            assert.strictEqual(condaFile, t.expectedCondaPath);
        });
        test(`Finds conda.exe for different ${t.environmentName}`, async () => {
            platformService.setup((p) => p.isLinux).returns(() => t.isLinux);
            platformService.setup((p) => p.isWindows).returns(() => !t.isLinux);
            platformService.setup((p) => p.isMac).returns(() => false);
            fileSystem
                .setup((f) => f.fileExists(TypeMoq.It.is((p) => {
                if (p === t.expectedCondaPath) {
                    return true;
                }
                return false;
            })))
                .returns(() => Promise.resolve(true));
            const condaFile = await condaService.getCondaFileFromInterpreter(t.pythonPath, undefined);
            if (t.expectedCondaPath.includes(t.environmentName)) {
                assert.strictEqual(condaFile, t.expectedCondaPath);
            }
            else {
                assert.strictEqual(condaFile, undefined);
            }
        });
    });
});
//# sourceMappingURL=condaService.unit.test.js.map