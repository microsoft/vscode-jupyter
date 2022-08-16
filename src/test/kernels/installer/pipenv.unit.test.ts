// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from 'assert';
import * as path from '../../../platform/vscode-path/path';
import * as sinon from 'sinon';
import * as platformApis from '../../../platform/common/utils/platform.node';
import * as fileUtils from '../../../platform/common/platform/fileUtils.node';
import * as fileUtilsCommon from '../../../platform/common/platform/fileUtils';
import { TEST_LAYOUT_ROOT } from '../../../test/pythonEnvironments/constants';
import { isPipenvEnvironmentRelatedToFolder, _getAssociatedPipfile } from '../../../kernels/installer/pipenv.node';
import { Uri } from 'vscode';

suite('Pipenv helper', () => {
    suite('isPipenvEnvironmentRelatedToFolder()', async () => {
        let readFile: sinon.SinonStub;
        let getEnvVar: sinon.SinonStub;
        let pathExists: sinon.SinonStub;
        let arePathsSame: sinon.SinonStub;

        setup(() => {
            getEnvVar = sinon.stub(platformApis, 'getEnvironmentVariable');
            readFile = sinon.stub(fileUtils, 'readFile');
            pathExists = sinon.stub(fileUtils, 'pathExists');
            arePathsSame = sinon.stub(fileUtilsCommon, 'arePathsSame');
        });

        teardown(() => {
            readFile.restore();
            getEnvVar.restore();
            pathExists.restore();
            arePathsSame.restore();
        });

        test('Global pipenv environment is associated with a project whose Pipfile lies at 3 levels above the project', async () => {
            // Don't actually want to stub these two here.
            pathExists.restore();
            arePathsSame.restore();

            getEnvVar.withArgs('PIPENV_MAX_DEPTH').returns('5');
            const expectedDotProjectFile = Uri.file(
                path.join(TEST_LAYOUT_ROOT, 'pipenv', 'globalEnvironments', 'project3-2s1eXEJ2', '.project')
            );
            const project = path.join(TEST_LAYOUT_ROOT, 'pipenv', 'project3');
            readFile.withArgs(expectedDotProjectFile.fsPath).resolves(project);
            const interpreterPath = Uri.file(
                path.join(
                    TEST_LAYOUT_ROOT,
                    'pipenv',
                    'globalEnvironments',
                    'project3-2s1eXEJ2',
                    'Scripts',
                    'python.exe'
                )
            );
            const folder = Uri.file(path.join(project, 'parent', 'child', 'folder'));

            const isRelated = await isPipenvEnvironmentRelatedToFolder(interpreterPath, folder);

            assert.strictEqual(isRelated, true);
        });

        test('If no Pipfile is associated with the environment, return false', async () => {
            const expectedDotProjectFile = path.join('environments', 'project-2s1eXEJ2', '.project');
            // Dot project file doesn't exist
            pathExists.withArgs(expectedDotProjectFile).resolves(false);
            const interpreterPath = Uri.file(path.join('environments', 'project-2s1eXEJ2', 'Scripts', 'python.exe'));
            pathExists.withArgs(interpreterPath.fsPath).resolves(true);
            const folder = Uri.file(path.join('path', 'to', 'folder'));

            const isRelated = await isPipenvEnvironmentRelatedToFolder(interpreterPath, folder);

            assert.strictEqual(isRelated, false);
        });

        test('If a Pipfile is associated with the environment but no pipfile is associated with the folder, return false', async () => {
            const expectedDotProjectFile = path.join('environments', 'project-2s1eXEJ2', '.project');
            pathExists.withArgs(expectedDotProjectFile).resolves(true);
            const project = path.join('path', 'to', 'project');
            readFile.withArgs(expectedDotProjectFile).resolves(project);
            pathExists.withArgs(project).resolves(true);
            const pipFileAssociatedWithEnvironment = path.join(project, 'Pipfile');
            // Pipfile associated with environment exists
            pathExists.withArgs(pipFileAssociatedWithEnvironment).resolves(true);
            const interpreterPath = Uri.file(path.join('environments', 'project-2s1eXEJ2', 'Scripts', 'python.exe'));
            pathExists.withArgs(interpreterPath.fsPath).resolves(true);
            const folder = Uri.file(path.join('path', 'to', 'folder'));
            const pipFileAssociatedWithFolder = path.join(folder.fsPath, 'Pipfile');
            // Pipfile associated with folder doesn't exist
            pathExists.withArgs(pipFileAssociatedWithFolder).resolves(false);

            const isRelated = await isPipenvEnvironmentRelatedToFolder(interpreterPath, folder);

            assert.strictEqual(isRelated, false);
        });

        test('If a Pipfile is associated with the environment and another is associated with the folder, but the path to both Pipfiles are different, return false', async () => {
            const expectedDotProjectFile = path.join('environments', 'project-2s1eXEJ2', '.project');
            pathExists.withArgs(expectedDotProjectFile).resolves(true);
            const project = path.join('path', 'to', 'project');
            readFile.withArgs(expectedDotProjectFile).resolves(project);
            pathExists.withArgs(project).resolves(true);
            const pipFileAssociatedWithEnvironment = path.join(project, 'Pipfile');
            // Pipfile associated with environment exists
            pathExists.withArgs(pipFileAssociatedWithEnvironment).resolves(true);
            const interpreterPath = Uri.file(path.join('environments', 'project-2s1eXEJ2', 'Scripts', 'python.exe'));
            pathExists.withArgs(interpreterPath.fsPath).resolves(true);
            const folder = Uri.file(path.join('path', 'to', 'folder'));
            const pipFileAssociatedWithFolder = path.join(folder.fsPath, 'Pipfile');
            // Pipfile associated with folder exists
            pathExists.withArgs(pipFileAssociatedWithFolder).resolves(true);
            // But the paths to both Pipfiles aren't the same
            arePathsSame.withArgs(pipFileAssociatedWithEnvironment, pipFileAssociatedWithFolder).resolves(false);

            const isRelated = await isPipenvEnvironmentRelatedToFolder(interpreterPath, folder);

            assert.strictEqual(isRelated, false);
        });

        test('If a Pipfile is associated with the environment and another is associated with the folder, and the path to both Pipfiles are same, return true', async () => {
            const expectedDotProjectFile = Uri.file(path.join('environments', 'project-2s1eXEJ2', '.project'));
            pathExists.withArgs(expectedDotProjectFile.fsPath).resolves(true);
            const project = Uri.file(path.join('path', 'to', 'project'));
            readFile.withArgs(expectedDotProjectFile.fsPath).resolves(project.fsPath);
            pathExists.withArgs(project.fsPath).resolves(true);
            const pipFileAssociatedWithEnvironment = Uri.file(path.join(project.fsPath, 'Pipfile'));
            // Pipfile associated with environment exists
            pathExists.withArgs(pipFileAssociatedWithEnvironment.fsPath).resolves(true);
            const interpreterPath = Uri.file(path.join('environments', 'project-2s1eXEJ2', 'Scripts', 'python.exe'));
            pathExists.withArgs(interpreterPath.fsPath).resolves(true);
            const folder = Uri.file(path.join('path', 'to', 'folder'));
            const pipFileAssociatedWithFolder = Uri.file(path.join(folder.fsPath, 'Pipfile'));
            // Pipfile associated with folder exists
            pathExists.withArgs(pipFileAssociatedWithFolder.fsPath).resolves(true);
            // The paths to both Pipfiles are also the same
            arePathsSame
                .withArgs(pipFileAssociatedWithEnvironment.fsPath, pipFileAssociatedWithFolder.fsPath)
                .resolves(true);

            const isRelated = await isPipenvEnvironmentRelatedToFolder(interpreterPath, folder);

            assert.strictEqual(isRelated, true);
        });
    });

    suite('_getAssociatedPipfile()', async () => {
        let getEnvVar: sinon.SinonStub;
        let pathExists: sinon.SinonStub;
        setup(() => {
            getEnvVar = sinon.stub(platformApis, 'getEnvironmentVariable');
            pathExists = sinon.stub(fileUtils, 'pathExists');
        });

        teardown(() => {
            getEnvVar.restore();
            pathExists.restore();
        });

        test('Correct Pipfile is returned for folder whose Pipfile lies in the folder directory', async () => {
            const project = path.join('path', 'to', 'project');
            pathExists.withArgs(project).resolves(true);
            const pipFile = path.join(project, 'Pipfile');
            pathExists.withArgs(pipFile).resolves(true);
            const folder = project;

            const result = await _getAssociatedPipfile(folder, { lookIntoParentDirectories: false });

            assert.strictEqual(result, pipFile);
        });

        test('Correct Pipfile is returned for folder if a custom Pipfile name is being used', async () => {
            getEnvVar.withArgs('PIPENV_PIPFILE').returns('CustomPipfile');
            const project = path.join('path', 'to', 'project');
            pathExists.withArgs(project).resolves(true);
            const pipFile = path.join(project, 'CustomPipfile');
            pathExists.withArgs(pipFile).resolves(true);
            const folder = project;

            const result = await _getAssociatedPipfile(folder, { lookIntoParentDirectories: false });

            assert.strictEqual(result, pipFile);
        });

        test('Correct Pipfile is returned for folder whose Pipfile lies 3 levels above the folder', async () => {
            getEnvVar.withArgs('PIPENV_MAX_DEPTH').returns('5');
            const project = path.join('path', 'to', 'project');
            pathExists.withArgs(project).resolves(true);
            const pipFile = path.join(project, 'Pipfile');
            pathExists.withArgs(pipFile).resolves(true);
            const folder = path.join(project, 'parent', 'child', 'folder');
            pathExists.withArgs(folder).resolves(true);

            const result = await _getAssociatedPipfile(folder, { lookIntoParentDirectories: true });

            assert.strictEqual(result, pipFile);
        });

        test('No Pipfile is returned for folder if no Pipfile exists in the associated directories', async () => {
            getEnvVar.withArgs('PIPENV_MAX_DEPTH').returns('5');
            const project = path.join('path', 'to', 'project');
            pathExists.withArgs(project).resolves(true);
            const pipFile = path.join(project, 'Pipfile');
            // Pipfile doesn't exist
            pathExists.withArgs(pipFile).resolves(false);
            const folder = path.join(project, 'parent', 'child', 'folder');
            pathExists.withArgs(folder).resolves(true);

            const result = await _getAssociatedPipfile(folder, { lookIntoParentDirectories: true });

            assert.strictEqual(result, undefined);
        });
    });
});
