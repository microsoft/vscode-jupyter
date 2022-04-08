import * as path from '../../platform/vscode-path/path';
import * as uriPath from '../../platform/vscode-path/resources';
import { getEnvironmentVariable, getOSType, getUserHomeDir, OSType } from '../../platform/common/utils/platform.node';
import { pathExists } from '../../platform/common/platform/fileUtils.node';
import { Uri } from 'vscode';

export function getPyenvDir(): Uri {
    // Check if the pyenv environment variables exist: PYENV on Windows, PYENV_ROOT on Unix.
    // They contain the path to pyenv's installation folder.
    // If they don't exist, use the default path: ~/.pyenv/pyenv-win on Windows, ~/.pyenv on Unix.
    // If the interpreter path starts with the path to the pyenv folder, then it is a pyenv environment.
    // See https://github.com/pyenv/pyenv#locating-the-python-installation for general usage,
    // And https://github.com/pyenv-win/pyenv-win for Windows specifics.
    let pyenvDir = getEnvironmentVariable('PYENV_ROOT') ?? getEnvironmentVariable('PYENV');

    if (!pyenvDir) {
        const homeDir = getUserHomeDir() || Uri.file('');
        pyenvDir =
            getOSType() === OSType.Windows
                ? path.join(homeDir.fsPath, '.pyenv', 'pyenv-win')
                : path.join(homeDir.fsPath, '.pyenv');
    }

    return Uri.file(pyenvDir);
}
/**
 * Checks if a given directory path is same as `pyenv` shims path. This checks
 * `~/.pyenv/shims` on posix and `~/.pyenv/pyenv-win/shims` on windows.
 * @param {Uri} dirPath: Absolute path to any directory
 * @returns {boolean}: Returns true if the patch is same as `pyenv` shims directory.
 */

export function isPyenvShimDir(dirPath: Uri): boolean {
    const shimPath = uriPath.joinPath(getPyenvDir(), 'shims');
    return uriPath.isEqual(shimPath, dirPath, true);
}
/**
 * Checks if the given interpreter belongs to a pyenv based environment.
 * @param {Uri} interpreterPath: Absolute path to the python interpreter.
 * @returns {boolean}: Returns true if the interpreter belongs to a pyenv environment.
 */

export async function isPyenvEnvironment(interpreterPath: Uri): Promise<boolean> {
    const pathToCheck = interpreterPath;
    const pyenvDir = getPyenvDir();

    if (!(await pathExists(pyenvDir.fsPath))) {
        return false;
    }

    return uriPath.isEqualOrParent(pathToCheck, pyenvDir);
}

export interface IPyenvVersionStrings {
    pythonVer?: string;
    distro?: string;
    distroVer?: string;
}
/**
 * This function provides parsers for some of the common and known distributions
 * supported by pyenv. To get the list of supported pyenv distributions, run
 * `pyenv install --list`
 *
 * The parsers below were written based on the list obtained from pyenv version 1.2.21
 */
function getKnownPyenvVersionParsers(): Map<string, (path: string) => IPyenvVersionStrings | undefined> {
    /**
     * This function parses versions that are plain python versions.
     * @param str string to parse
     *
     * Parses :
     *   2.7.18
     *   3.9.0
     */
    function pythonOnly(str: string): IPyenvVersionStrings {
        return {
            pythonVer: str,
            distro: undefined,
            distroVer: undefined
        };
    }

    /**
     * This function parses versions that are distro versions.
     * @param str string to parse
     *
     * Examples:
     *   miniconda3-4.7.12
     *   anaconda3-2020.07
     */
    function distroOnly(str: string): IPyenvVersionStrings | undefined {
        const parts = str.split('-');
        if (parts.length === 3) {
            return {
                pythonVer: undefined,
                distroVer: `${parts[1]}-${parts[2]}`,
                distro: parts[0]
            };
        }

        if (parts.length === 2) {
            return {
                pythonVer: undefined,
                distroVer: parts[1],
                distro: parts[0]
            };
        }

        return {
            pythonVer: undefined,
            distroVer: undefined,
            distro: str
        };
    }

    /**
     * This function parser pypy environments supported by the pyenv install command
     * @param str string to parse
     *
     * Examples:
     *  pypy-c-jit-latest
     *  pypy-c-nojit-latest
     *  pypy-dev
     *  pypy-stm-2.3
     *  pypy-stm-2.5.1
     *  pypy-1.5-src
     *  pypy-1.5
     *  pypy3.5-5.7.1-beta-src
     *  pypy3.5-5.7.1-beta
     *  pypy3.5-5.8.0-src
     *  pypy3.5-5.8.0
     */
    function pypyParser(str: string): IPyenvVersionStrings | undefined {
        const pattern = /[0-9\.]+/;

        const parts = str.split('-');
        const pythonVer = parts[0].search(pattern) > 0 ? parts[0].substr('pypy'.length) : undefined;
        if (parts.length === 2) {
            return {
                pythonVer,
                distroVer: parts[1],
                distro: 'pypy'
            };
        }

        if (
            parts.length === 3 &&
            (parts[2].startsWith('src') ||
                parts[2].startsWith('beta') ||
                parts[2].startsWith('alpha') ||
                parts[2].startsWith('win64'))
        ) {
            const part1 = parts[1].startsWith('v') ? parts[1].substr(1) : parts[1];
            return {
                pythonVer,
                distroVer: `${part1}-${parts[2]}`,
                distro: 'pypy'
            };
        }

        if (parts.length === 3 && parts[1] === 'stm') {
            return {
                pythonVer,
                distroVer: parts[2],
                distro: `${parts[0]}-${parts[1]}`
            };
        }

        if (parts.length === 4 && parts[1] === 'c') {
            return {
                pythonVer,
                distroVer: parts[3],
                distro: `pypy-${parts[1]}-${parts[2]}`
            };
        }

        if (parts.length === 4 && parts[3].startsWith('src')) {
            return {
                pythonVer,
                distroVer: `${parts[1]}-${parts[2]}-${parts[3]}`,
                distro: 'pypy'
            };
        }

        return {
            pythonVer,
            distroVer: undefined,
            distro: 'pypy'
        };
    }

    const parsers: Map<string, (path: string) => IPyenvVersionStrings | undefined> = new Map();
    parsers.set('activepython', distroOnly);
    parsers.set('anaconda', distroOnly);
    parsers.set('graalpython', distroOnly);
    parsers.set('ironpython', distroOnly);
    parsers.set('jython', distroOnly);
    parsers.set('micropython', distroOnly);
    parsers.set('miniconda', distroOnly);
    parsers.set('miniforge', distroOnly);
    parsers.set('pypy', pypyParser);
    parsers.set('pyston', distroOnly);
    parsers.set('stackless', distroOnly);
    parsers.set('3', pythonOnly);
    parsers.set('2', pythonOnly);

    return parsers;
}
/**
 * This function parses the name of the commonly installed versions of pyenv based environments.
 * @param str string to parse.
 *
 * Remarks: Depending on the environment, the name itself can contain distribution info like
 * name and version. Sometimes it may also have python version as a part of the name. This function
 * extracts the various strings.
 */

export function parsePyenvVersion(str: string): IPyenvVersionStrings | undefined {
    const allParsers = getKnownPyenvVersionParsers();
    const knownPrefixes = Array.from(allParsers.keys());

    const parsers = knownPrefixes
        .filter((k) => str.startsWith(k))
        .map((p) => allParsers.get(p))
        .filter((p) => p !== undefined);

    if (parsers.length > 0 && parsers[0]) {
        return parsers[0](str);
    }

    return undefined;
}
