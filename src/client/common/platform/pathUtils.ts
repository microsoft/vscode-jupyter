// eslint-disable-next-line
// TODO: Drop this file.
// See https://github.com/microsoft/vscode-python/issues/8542.

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { IPathUtils, IsWindows } from '../types';
import { OSType } from '../utils/platform';
import { Executables, FileSystemPaths, FileSystemPathUtils } from './fs-paths';
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const untildify = require('untildify');

@injectable()
export class PathUtils implements IPathUtils {
    private readonly utils: FileSystemPathUtils;
    constructor(
        // "true" if targeting a Windows host.
        @inject(IsWindows) private readonly isWindows: boolean
    ) {
        const osType = isWindows ? OSType.Windows : OSType.Unknown;
        // We cannot just use FileSystemPathUtils.withDefaults() because
        // of the isWindows arg.
        this.utils = new FileSystemPathUtils(
            untildify('~'),
            FileSystemPaths.withDefaults(),
            new Executables(path.delimiter, osType),
            path
        );
    }

    public get home(): string {
        return this.utils.home;
    }

    public get delimiter(): string {
        return this.utils.executables.delimiter;
    }

    public get separator(): string {
        return this.utils.paths.sep;
    }

    // eslint-disable-next-line
    // TODO: Deprecate in favor of IPlatformService?
    public getPathVariableName(): 'Path' | 'PATH' {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return this.utils.executables.envVar as any;
    }

    public getDisplayName(pathValue: string, cwd?: string): string {
        // Paths on windows can either contain \ or / Both work.
        // Thus, C:\Python.exe is the same as C:/Python.exe
        // If we're on windows ensure we convert the / in pathValue to \.
        // For cases like here https://github.com/microsoft/vscode-jupyter/issues/399
        pathValue = this.isWindows ? pathValue.replace(/\//g, '\\') : pathValue;
        return this.utils.getDisplayName(pathValue, cwd);
    }

    public basename(pathValue: string, ext?: string): string {
        return this.utils.paths.basename(pathValue, ext);
    }
}
