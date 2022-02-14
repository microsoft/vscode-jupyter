"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const path = require("path");
const sinon = require("sinon");
const fs_1 = require("fs");
const externalDependencies = require("../../../client/pythonEnvironments/common/externalDependencies");
const posixUtils_1 = require("../../../client/pythonEnvironments/common/posixUtils");
suite('Posix Utils tests', () => {
    let readDirStub;
    let resolveSymlinkStub;
    class FakeDirent extends fs_1.Dirent {
        constructor(name, _isFile, _isLink) {
            super();
            this.name = name;
            this._isFile = _isFile;
            this._isLink = _isLink;
        }
        isFile() {
            return this._isFile;
        }
        isDirectory() {
            return !this._isFile && !this._isLink;
        }
        isBlockDevice() {
            return false;
        }
        isCharacterDevice() {
            return false;
        }
        isSymbolicLink() {
            return this._isLink;
        }
        isFIFO() {
            return false;
        }
        isSocket() {
            return false;
        }
    }
    setup(() => {
        readDirStub = sinon.stub(fs_1.promises, 'readdir');
        readDirStub
            .withArgs(path.join('usr', 'bin'), { withFileTypes: true })
            .resolves([
            new FakeDirent('python', false, true),
            new FakeDirent('python3', false, true),
            new FakeDirent('python3.7', false, true),
            new FakeDirent('python3.8', false, true),
        ]);
        readDirStub
            .withArgs(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.9', 'lib'), {
            withFileTypes: true,
        })
            .resolves([new FakeDirent('python3.9', true, false)]);
        resolveSymlinkStub = sinon.stub(externalDependencies, 'resolveSymbolicLink');
        resolveSymlinkStub
            .withArgs(path.join('usr', 'bin', 'python3.7'))
            .resolves(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.7', 'lib', 'python3.7'));
        resolveSymlinkStub
            .withArgs(path.join('usr', 'bin', 'python3'))
            .resolves(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.7', 'lib', 'python3.7'));
        resolveSymlinkStub
            .withArgs(path.join('usr', 'bin', 'python'))
            .resolves(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.7', 'lib', 'python3.7'));
        resolveSymlinkStub
            .withArgs(path.join('usr', 'bin', 'python3.8'))
            .resolves(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.8', 'lib', 'python3.8'));
        resolveSymlinkStub
            .withArgs(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.9', 'lib', 'python3.9'))
            .resolves(path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.9', 'lib', 'python3.9'));
    });
    teardown(() => {
        readDirStub.restore();
        resolveSymlinkStub.restore();
    });
    test('getPythonBinFromPosixPaths', async () => {
        const expectedPaths = [
            path.join('usr', 'bin', 'python'),
            path.join('usr', 'bin', 'python3.8'),
            path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.9', 'lib', 'python3.9'),
        ].sort((a, b) => a.length - b.length);
        const actualPaths = await (0, posixUtils_1.getPythonBinFromPosixPaths)([
            path.join('usr', 'bin'),
            path.join('System', 'Library', 'Frameworks', 'Python.framework', 'Versions', '3.9', 'lib'),
        ]);
        actualPaths.sort((a, b) => a.length - b.length);
        assert.deepStrictEqual(actualPaths, expectedPaths);
    });
});
//# sourceMappingURL=posixUtils.unit.test.js.map