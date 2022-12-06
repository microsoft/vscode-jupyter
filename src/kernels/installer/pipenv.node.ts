// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from '../../platform/vscode-path/path';
import { traceError } from '../../platform/logging';
import { getEnvironmentVariable } from '../../platform/common/utils/platform.node';
import { pathExists, readFile } from '../../platform/common/platform/fileUtils.node';
import { Uri } from 'vscode';
import { normCasePath, arePathsSame } from '../../platform/common/platform/fileUtils';

function getSearchHeight() {
    // PIPENV_MAX_DEPTH tells pipenv the maximum number of directories to recursively search for
    // a Pipfile, defaults to 3: https://pipenv.pypa.io/en/latest/advanced/#pipenv.environments.PIPENV_MAX_DEPTH
    const maxDepthStr = getEnvironmentVariable('PIPENV_MAX_DEPTH');
    if (maxDepthStr === undefined) {
        return 3;
    }
    const maxDepth = parseInt(maxDepthStr, 10);
    // eslint-disable-next-line no-restricted-globals
    if (isNaN(maxDepth)) {
        traceError(`PIPENV_MAX_DEPTH is incorrectly set. Converting value '${maxDepthStr}' to number results in NaN`);
        return 1;
    }
    return maxDepth;
}

/**
 * Returns the path to Pipfile associated with the provided directory.
 * @param searchDir the directory to look into
 * @param lookIntoParentDirectories set to true if we should also search for Pipfile in parent directory
 */
export async function _getAssociatedPipfile(
    searchDir: string,
    options: { lookIntoParentDirectories: boolean }
): Promise<string | undefined> {
    const pipFileName = getEnvironmentVariable('PIPENV_PIPFILE') || 'Pipfile';
    let heightToSearch = options.lookIntoParentDirectories ? getSearchHeight() : 1;
    while (heightToSearch > 0 && !arePathsSame(searchDir, path.dirname(searchDir))) {
        const pipFile = path.join(searchDir, pipFileName);
        if (await pathExists(pipFile)) {
            return pipFile;
        }
        searchDir = path.dirname(searchDir);
        heightToSearch -= 1;
    }
    return undefined;
}

/**
 * Returns the project directory for pipenv environments given the environment folder
 * @param envFolder Path to the environment folder
 */
async function getProjectDir(envFolder: string): Promise<string | undefined> {
    // Global pipenv environments have a .project file with the absolute path to the project
    // See https://github.com/pypa/pipenv/blob/v2018.6.25/CHANGELOG.rst#features--improvements
    // This is the layout we expect
    // <Environment folder>
    // |__ .project  <--- check if .project exists here
    // |__ Scripts/bin
    //     |__ python  <--- interpreterPath
    // We get the project by reading the .project file
    const dotProjectFile = path.join(envFolder, '.project');
    if (!(await pathExists(dotProjectFile))) {
        return undefined;
    }
    const projectDir = await readFile(dotProjectFile);
    if (!(await pathExists(projectDir))) {
        traceError(
            `The .project file inside environment folder: ${envFolder} doesn't contain a valid path to the project`
        );
        return undefined;
    }
    return projectDir;
}

/**
 * If interpreter path belongs to a global pipenv environment, return associated Pipfile, otherwise return `undefined`.
 * @param interpreterPath Absolute path to any python interpreter.
 */
async function getPipfileIfGlobal(interpreterPath: Uri): Promise<string | undefined> {
    const envFolder = path.dirname(path.dirname(interpreterPath.fsPath));
    const projectDir = await getProjectDir(envFolder);
    if (projectDir === undefined) {
        return undefined;
    }

    // This is the layout we expect to see.
    //  project
    // |__ Pipfile  <--- check if Pipfile exists here and return it
    // The name of the project (directory where Pipfile resides) is used as a prefix in the environment folder
    const envFolderName = path.basename(normCasePath(envFolder));
    if (!envFolderName.startsWith(`${path.basename(normCasePath(projectDir))}-`)) {
        return undefined;
    }

    return _getAssociatedPipfile(projectDir, { lookIntoParentDirectories: false });
}

/**
 * Returns true if interpreter path belongs to a global pipenv environment which is associated with a particular folder,
 * false otherwise.
 * @param interpreterPath Absolute path to any python interpreter.
 */
export async function isPipenvEnvironmentRelatedToFolder(interpreterPath: Uri, folder: Uri): Promise<boolean> {
    const pipFileAssociatedWithEnvironment = await getPipfileIfGlobal(interpreterPath);
    if (!pipFileAssociatedWithEnvironment) {
        return false;
    }

    // PIPENV_NO_INHERIT is used to tell pipenv not to look for Pipfile in parent directories
    // https://pipenv.pypa.io/en/latest/advanced/#pipenv.environments.PIPENV_NO_INHERIT
    const lookIntoParentDirectories = getEnvironmentVariable('PIPENV_NO_INHERIT') === undefined;
    const pipFileAssociatedWithFolder = await _getAssociatedPipfile(folder.fsPath, { lookIntoParentDirectories });
    if (!pipFileAssociatedWithFolder) {
        return false;
    }
    return arePathsSame(pipFileAssociatedWithEnvironment, pipFileAssociatedWithFolder);
}
