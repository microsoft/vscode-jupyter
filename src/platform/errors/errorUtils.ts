// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { NotebookCellOutput, NotebookCellOutputItem, Uri, WorkspaceFolder } from 'vscode';
import { getDisplayPath } from '../common/platform/fs-paths';
import { DataScience } from '../common/utils/localize';
import { JupyterConnectError } from './jupyterConnectError';
import { BaseError } from './types';
import * as path from '../../platform/vscode-path/resources';

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ErrorUtils {
    public static outputHasModuleNotInstalledError(moduleName: string, content?: string): boolean {
        return content &&
            (content!.indexOf(`No module named ${moduleName}`) > 0 ||
                content!.indexOf(`No module named '${moduleName}'`) > 0)
            ? true
            : false;
    }
}

/**
 * Given a python traceback, attempt to get the Python error message.
 * Generally Python error messages are at the bottom of the traceback.
 */
export function getTelemetrySafeErrorMessageFromPythonTraceback(traceback: string = '') {
    if (!traceback) {
        return;
    }
    // Look for something like `NameError: name 'XYZ' is not defined` in the last line.
    const pythonErrorMessageRegExp = /\S+Error: /g;
    // Suffix with `:`, in case we pass the value `NameError` back into this function.
    const reversedLines = `${traceback.trim()}: `
        .split('\n')
        .filter((item) => item.trim().length)
        .reverse();
    if (reversedLines.length === 0) {
        return;
    }
    const lastLine = reversedLines[0];
    const message = lastLine.match(pythonErrorMessageRegExp) ? lastLine : undefined;
    const parts = (message || '').split(':');
    // Only get the error type.
    return parts.length && parts[0].endsWith('Error') ? parts[0] : undefined;
}

/**
 * Given a python traceback, attempt to get the Python error message.
 * Note: Python error messages are at the bottom of the traceback.
 */
export function getErrorMessageFromPythonTraceback(traceback: string = '') {
    const lines = getLastTwoLinesFromPythonTracebackWithErrorMessage(traceback);
    return lines ? lines[1] : undefined;
}

/**
 * Given a python traceback, attempt to get the last two lines.
 * THe last line will contain the Python error message.
 * Note: Python error messages are at the bottom of the traceback.
 */
export function getLastTwoLinesFromPythonTracebackWithErrorMessage(
    traceback: string = ''
): undefined | [string, string] {
    if (!traceback) {
        return;
    }
    const reversedLines = traceback
        .trim()
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item.trim().length)
        .reverse();
    if (reversedLines.length === 0) {
        return;
    }
    // If last line doesn't contain the error, return the traceback as is.
    if (!reversedLines[0].includes('Error')) {
        return;
    } else {
        return [reversedLines.length > 1 ? reversedLines[1] : '', reversedLines[0]];
    }
}

export function getLastFrameFromPythonTraceback(
    traceback: string
): { fileName: string; folderName: string; packageName: string } | undefined {
    if (!traceback) {
        return;
    }
    //             File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 38, in C

    // This parameter might be either a string or a string array
    const fixedTraceback: string = Array.isArray(traceback) ? traceback[0] : traceback;
    const lastFrame = fixedTraceback
        .split('\n')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length)
        .reverse()
        .find(
            (line) =>
                line.startsWith('file ') && line.includes(', line ') && line.includes('.py') && line.includes('.py')
        );
    if (!lastFrame) {
        return;
    }
    const file = lastFrame.substring(0, lastFrame.lastIndexOf('.py')) + '.py';
    const parts = file.replace(/\\/g, '/').split('/');
    const indexOfSitePackages = parts.indexOf('site-packages');
    let packageName =
        indexOfSitePackages >= 0 && parts.length > indexOfSitePackages + 1 ? parts[indexOfSitePackages + 1] : '';
    const reversedParts = parts.reverse();
    if (reversedParts.length < 2) {
        return;
    }
    return { fileName: reversedParts[0], folderName: reversedParts[1], packageName };
}

export enum KernelFailureReason {
    /**
     * Errors specific to importing of `win32api` module.
     */
    importWin32apiFailure = 'importWin32apiFailure',
    /**
     * Errors specific to the zmq module.
     */
    zmqModuleFailure = 'zmqModuleFailure',
    /**
     * Errors specific to older versions of IPython.
     */
    oldIPythonFailure = 'oldIPythonFailure',
    /**
     * Errors specific to older versions of IPyKernel.
     */
    oldIPyKernelFailure = 'oldIPyKernelFailure',
    /**
     * Creating files such as os.py and having this in the root directory or some place where Python would load it,
     * would result in the `os` module being overwritten with the users `os.py` file.
     * Novice python users tend to do this very often, and this causes the python runtime to crash.
     *
     * We identify this based on the error message dumped in the stderr stream.
     */
    overridingBuiltinModules = 'overridingBuiltinModules',
    /**
     * Some module or type is not found.
     * This is a common error when using the `import` statement.
     * Again, possible a module has been overwritten with a user file.
     * Or the installed package doesn't contain the necessary types.
     * Samples include:
     * 1.   import win32api
     *      ImportError: No module named 'win32api'
     * 2.   ImportError: cannot import name 'constants' from partially initialized module 'zmq.backend.cython' (most likely due to a circular import) (C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py)
     */
    importFailure = 'importFailure',
    /**
     * Some missing dependency is not installed.
     * Error messages are of the form `ModuleNotFoundError: No module named 'zmq'`
     */
    moduleNotFoundFailure = 'moduleNotFound',
    /**
     * Failure to load some dll.
     * Error messages are of the following form
     *      import win32api
     *      ImportError: DLL load failed: The specified procedure could not be found.
     */
    dllLoadFailure = 'dllLoadFailure',
    /**
     * Failure to start Jupyter due to some unknown reason.
     */
    jupyterStartFailure = 'jupyterStartFailure',
    /**
     * Failure to start Jupyter due to outdated traitlets.
     */
    jupyterStartFailureOutdatedTraitlets = 'jupyterStartFailureOutdatedTraitlets'
}
type BaseFailure<Reason extends KernelFailureReason, ExtraData = {}> = {
    reason: Reason;
    /**
     * Classifications of the errors that is safe for telemetry (no pii).
     */
    telemetrySafeTags: string[];
    /**
     * Message to show to about this error
     */
    message: string;
    /**
     * Link to more information about the error
     */
    moreInfoLink: string | undefined;
} & ExtraData;
export type OverridingBuiltInModulesFailure = BaseFailure<
    KernelFailureReason.overridingBuiltinModules,
    | {
          /**
           * The module that has been overwritten.
           */
          moduleName: string;
          /**
           * Fully qualified path to the module.
           */
          fileName: string;
      }
    | {
          /**
           * The module that has been overwritten.
           */
          moduleName: string;
          /**
           * Folder created by user (that contains a __init__.py) that is overriding the build in module/package.
           */
          folderName: string;
      }
>;
export type ImportErrorFailure = BaseFailure<
    KernelFailureReason.importFailure,
    {
        /**
         * What is being imported from the module.
         */
        name?: string;
        moduleName: string;
        fileName?: string;
    }
>;
export type ModuleNotFoundFailure = BaseFailure<
    KernelFailureReason.moduleNotFoundFailure,
    {
        /**
         * Name of the missing module.
         */
        moduleName: string;
    }
>;
export type DllLoadFailure = BaseFailure<
    KernelFailureReason.dllLoadFailure,
    {
        /**
         * Name of the module that couldn't be loaded.
         */
        moduleName?: string;
    }
>;
export type JupyterStartFailure = BaseFailure<
    KernelFailureReason.jupyterStartFailure | KernelFailureReason.jupyterStartFailureOutdatedTraitlets,
    {
        /**
         * Python error message displayed.
         */
        pythonError?: string;
    }
>;
export type ImportWin32ApiFailure = BaseFailure<KernelFailureReason.importWin32apiFailure>;
export type ZmqModuleFailure = BaseFailure<KernelFailureReason.zmqModuleFailure>;
export type OldIPyKernelFailure = BaseFailure<KernelFailureReason.oldIPyKernelFailure>;
export type OldIPythonFailure = BaseFailure<KernelFailureReason.oldIPythonFailure>;

export type KernelFailure =
    | OverridingBuiltInModulesFailure
    | ImportErrorFailure
    | ModuleNotFoundFailure
    | DllLoadFailure
    | ImportWin32ApiFailure
    | ImportWin32ApiFailure
    | ZmqModuleFailure
    | OldIPyKernelFailure
    | JupyterStartFailure
    | OldIPythonFailure;

export function analyzeKernelErrors(
    workspaceFolders: readonly WorkspaceFolder[],
    error: Error | string,
    kernelDisplayName: string | undefined,
    pythonSysPrefix: string = '',
    filesInCwd: Uri[] = []
): KernelFailure | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stdErrOrStackTrace = error instanceof BaseError ? error.stdErr || error.stack || '' : error.toString();
    const lastTwolinesOfError = getLastTwoLinesFromPythonTracebackWithErrorMessage(stdErrOrStackTrace);
    const stdErr = stdErrOrStackTrace.toLowerCase();

    if (stdErr.includes("ImportError: No module named 'win32api'".toLowerCase())) {
        // force re-installing ipykernel worked.
        /*
          File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\contextlib.py", line 59, in enter
            return next(self.gen)
            File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\site-packages\jupyter_client\connect.py", line 100, in secure_write
            win32_restrict_file_to_user(fname)
            File "C:\Users\<user>\miniconda3\envs\env_zipline\lib\site-packages\jupyter_client\connect.py", line 53, in win32_restrict_file_to_user
            import win32api
            ImportError: No module named 'win32api'
        */
        return {
            reason: KernelFailureReason.importWin32apiFailure,
            message: DataScience.failedToStartKernelDueToWin32APIFailure,
            moreInfoLink: 'https://aka.ms/kernelFailuresWin32Api',
            telemetrySafeTags: ['win32api']
        };
    }
    if (stdErr.includes('ImportError: DLL load failed'.toLowerCase()) && stdErr.includes('win32api')) {
        // Possibly a conda issue on windows
        /*
        win32_restrict_file_to_user
        import win32api
        ImportError: DLL load failed: 找不到指定的程序。
        */
        return {
            reason: KernelFailureReason.importWin32apiFailure,
            message: DataScience.failedToStartKernelDueToWin32APIFailure,
            moreInfoLink: 'https://aka.ms/kernelFailuresWin32Api',
            telemetrySafeTags: ['dll.load.failed', 'win32api']
        };
    }
    if (stdErr.includes('ImportError: DLL load failed'.toLowerCase())) {
        /*
        import xyz
        ImportError: DLL load failed: ....
        */
        const moduleName =
            lastTwolinesOfError && lastTwolinesOfError[0].toLowerCase().startsWith('import')
                ? lastTwolinesOfError[0].substring('import'.length).trim()
                : undefined;
        return {
            reason: KernelFailureReason.dllLoadFailure,
            moduleName,
            message: moduleName
                ? DataScience.failedToStartKernelDueToDllLoadFailure(moduleName)
                : DataScience.failedToStartKernelDueToUnknownDllLoadFailure,
            moreInfoLink: 'https://aka.ms/kernelFailuresDllLoad',
            telemetrySafeTags: ['dll.load.failed']
        };
    }
    if (stdErr.includes("AssertionError: Couldn't find Class NSProcessInfo".toLowerCase())) {
        // Conda environment with IPython 5.8.0 fails with this message.
        // Updating to latest version of ipython fixed it (conda update ipython).
        // Possible we might have to update other packages as well (when using `conda update ipython` plenty of other related pacakges got updated, such as zeromq, nbclient, jedi)
        /*
            Error: Kernel died with exit code 1. Traceback (most recent call last):
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 90, in nope
                "Because Reasons"
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 60, in beginActivityWithOptions
                NSProcessInfo = C('NSProcessInfo')
            File "/Users/donjayamanne/miniconda3/envs/env3/lib/python3.7/site-packages/appnope/_nope.py", line 38, in C
                assert ret is not None, "Couldn't find Class %s" % classname
            AssertionError: Couldn't find Class NSProcessInfo
        */
        return {
            reason: KernelFailureReason.oldIPythonFailure,
            message: DataScience.failedToStartKernelDueToOldIPython,
            moreInfoLink: 'https://aka.ms/kernelFailuresOldIPython',
            telemetrySafeTags: ['oldipython']
        };
    }
    if (
        stdErr.includes('NotImplementedError'.toLowerCase()) &&
        stdErr.includes('asyncio'.toLowerCase()) &&
        stdErr.includes('events.py'.toLowerCase())
    ) {
        /*
        "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\eventloop\zmqstream.py", line 127, in __init__
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self._init_io_state()
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\eventloop\zmqstream.py", line 546, in _init_io_state
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self.io_loop.add_handler(self.socket, self._handle_events, self.io_loop.READ)
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\tornado\platform\asyncio.py", line 99, in add_handler
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     self.asyncio_loop.add_reader(fd, self._handle_events, fd, IOLoop.READ)
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:   File "C:\Users\<user>\AppData\Local\Programs\Python\Python38-32\lib\asyncio\events.py", line 501, in add_reader
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr:     raise NotImplementedError
        Info 2020-08-10 12:14:11: Python Daemon (pid: 16976): write to stderr: NotImplementedError
        */
        return {
            reason: KernelFailureReason.oldIPyKernelFailure,
            message: DataScience.failedToStartKernelDueToOldIPyKernel,
            moreInfoLink: 'https://aka.ms/kernelFailuresOldIPyKernel',
            telemetrySafeTags: ['oldipykernel']
        };
    }

    {
        // zmq errors.
        const tags: string[] = [];
        if (
            stdErr.includes('ImportError: cannot import name'.toLowerCase()) &&
            stdErr.includes('from partially initialized module'.toLowerCase()) &&
            stdErr.includes('zmq.backend.cython'.toLowerCase())
        ) {
            // force re-installing ipykernel worked.
            tags.push('zmq.backend.cython');
        }
        if (
            stdErr.includes('zmq'.toLowerCase()) &&
            stdErr.includes('cython'.toLowerCase()) &&
            stdErr.includes('__init__.py'.toLowerCase())
        ) {
            // force re-installing ipykernel worked.
            /*
          File "C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py", line 6, in <module>
    from . import (constants, error, message, context,
          ImportError: cannot import name 'constants' from partially initialized module 'zmq.backend.cython' (most likely due to a circular import) (C:\Users\<user>\AppData\Roaming\Python\Python38\site-packages\zmq\backend\cython\__init__.py)
        */
            tags.push('zmq.cython');
        }
        // ZMQ general errors
        if (stdErr.includes('zmq.error.ZMQError')) {
            tags.push('zmq.error');
        }

        if (tags.length) {
            return {
                reason: KernelFailureReason.zmqModuleFailure,
                message: DataScience.failedToStartKernelDueToPyZmqFailure,
                moreInfoLink: 'https://aka.ms/kernelFailuresPyzmq',
                telemetrySafeTags: tags
            };
        }
    }

    if (lastTwolinesOfError && lastTwolinesOfError[1].toLowerCase().startsWith('importerror')) {
        const info = extractModuleAndFileFromImportError(lastTwolinesOfError[1]);
        if (info && pythonSysPrefix) {
            // First check if we're overriding any built in modules.
            const error = isBuiltInModuleOverwritten(info.moduleName, info.fileName, workspaceFolders, pythonSysPrefix);
            if (error) {
                return error;
            }

            return {
                reason: KernelFailureReason.importFailure,
                moduleName: info.moduleName,
                fileName: info.fileName,
                message: info.fileName
                    ? DataScience.failedToStartKernelDueToImportFailureFromFile(info.moduleName, info.fileName)
                    : DataScience.failedToStartKernelDueToImportFailure(info.moduleName),
                moreInfoLink: info.fileName
                    ? 'https://aka.ms/kernelFailuresModuleImportErrFromFile'
                    : 'https://aka.ms/kernelFailuresModuleImportErr',
                telemetrySafeTags: ['import.error']
            };
        }
    }
    // This happens when ipykernel is not installed and we attempt to run without checking for ipykernel.
    // '/home/don/samples/pySamples/crap/.venv/bin/python: No module named ipykernel_launcher\n'
    const noModule = 'No module named'.toLowerCase();
    const isNotAPackage = `is not a package`.toLowerCase();
    if (stdErr.includes(noModule) && !isNotAPackage) {
        const line = stdErrOrStackTrace
            .splitLines()
            .map((line) => line.trim())
            .filter((line) => line.length)
            .find((line) => line.toLowerCase().includes(noModule));
        const moduleName = line ? line.substring(line.toLowerCase().indexOf(noModule) + noModule.length).trim() : '';
        if (line) {
            return {
                reason: KernelFailureReason.moduleNotFoundFailure,
                moduleName,
                message: DataScience.failedToStartKernelDueToMissingModule(moduleName),
                moreInfoLink: 'https://aka.ms/kernelFailuresMissingModule',
                telemetrySafeTags: ['module.notfound.error']
            };
        }
    } else if (stdErr.includes(noModule) && isNotAPackage) {
        const line = stdErrOrStackTrace
            .splitLines()
            .map((line) => line.trim())
            .filter((line) => line.length)
            .find((line) => line.toLowerCase().includes(noModule));
        let moduleName = line ? line.substring(line.toLowerCase().indexOf(noModule) + noModule.length).trim() : '';
        let fileName = '';
        let folderName = '';
        if (moduleName.split("'").length > 2) {
            fileName = moduleName.split("'").slice(-2)[0] || '';
            fileName = fileName ? `${fileName}.py` : '';
            folderName = fileName ? fileName : '';
            moduleName = moduleName.split("'")[1] || moduleName;
        }
        const modulesInCwd = filesInCwd
            .filter((file) => path.basename(file).toLowerCase() === '__init__.py')
            .map((file) => path.basename(path.dirname(file)));
        if (
            moduleName &&
            fileName &&
            moduleName !== fileName &&
            filesInCwd.some((file) => path.basename(file).toLowerCase() === fileName.toLowerCase())
        ) {
            return {
                reason: KernelFailureReason.overridingBuiltinModules,
                fileName,
                moduleName,
                message: DataScience.fileSeemsToBeInterferingWithKernelStartup(fileName),
                moreInfoLink: 'https://aka.ms/kernelFailuresOverridingBuiltInModules',
                telemetrySafeTags: ['import.error', 'override.modules']
            };
        } else if (
            moduleName &&
            modulesInCwd &&
            moduleName !== folderName &&
            modulesInCwd.some((folder) => folder.toLowerCase() === folderName.toLowerCase())
        ) {
            return {
                reason: KernelFailureReason.overridingBuiltinModules,
                folderName,
                moduleName,
                message: DataScience.moduleSeemsToBeInterferingWithKernelStartup(folderName),
                moreInfoLink: 'https://aka.ms/kernelFailuresOverridingBuiltInModules',
                telemetrySafeTags: ['import.error', 'override.modules']
            };
        } else {
            return {
                reason: KernelFailureReason.moduleNotFoundFailure,
                moduleName,
                message: DataScience.failedToStartKernelDueToMissingModule(moduleName),
                moreInfoLink: 'https://aka.ms/kernelFailuresMissingModule',
                telemetrySafeTags: ['module.notfound.error']
            };
        }
    } else if (error instanceof BaseError && error.category === 'invalidkernel' && filesInCwd.length) {
        // This is the case when we're using non-zmq and we have no idea why the kernel died.
        // If we have files that could cause the kernel to die, then display an error message
        // informing the user about that.
        const fileName = path.basename(filesInCwd[0]);
        return {
            reason: KernelFailureReason.overridingBuiltinModules,
            fileName,
            moduleName: path.basename(filesInCwd[0], '.py'),
            message: DataScience.fileSeemsToBeInterferingWithKernelStartup(fileName),
            moreInfoLink: 'https://aka.ms/kernelFailuresOverridingBuiltInModules',
            telemetrySafeTags: ['import.error', 'override.modules']
        };
    } else if (
        lastTwolinesOfError &&
        lastTwolinesOfError[1].toLowerCase().startsWith('ModuleNotFoundError'.toLowerCase())
    ) {
        const info = extractModuleAndFileFromImportError(lastTwolinesOfError[1]);
        if (info) {
            return {
                reason: KernelFailureReason.moduleNotFoundFailure,
                moduleName: info.moduleName,
                message: DataScience.failedToStartKernelDueToMissingModule(info.moduleName),
                moreInfoLink: 'https://aka.ms/kernelFailuresMissingModule',
                telemetrySafeTags: ['module.notfound.error']
            };
        }
    }
    if (error instanceof JupyterConnectError) {
        // Get the last error message in the stack trace.
        let errorMessage = stdErrOrStackTrace
            .splitLines()
            .map((line) => line.trim())
            .reverse()
            .find((line) => line.toLowerCase().includes('error: '));
        // https://github.com/microsoft/vscode-jupyter/issues/8295
        const errorMessageDueToOutdatedTraitlets = "AttributeError: 'Namespace' object has no attribute '_flags'";
        const telemetrySafeTags = ['jupyter.startup.failure'];
        let link: string | undefined;
        let reason = KernelFailureReason.jupyterStartFailure;
        // Some times the error message is either in the message or the stderr.
        let pythonError = error.message
            .splitLines({ removeEmptyEntries: true, trim: true })
            .reverse()
            .find((item) => item.toLowerCase().includes('error: '));
        pythonError =
            pythonError ||
            (error.stdErr || '')
                .splitLines({ removeEmptyEntries: true, trim: true })
                .reverse()
                .find((item) => item.toLowerCase().includes('error: '));
        if (stdErr.includes(errorMessageDueToOutdatedTraitlets.toLowerCase())) {
            reason = KernelFailureReason.jupyterStartFailureOutdatedTraitlets;
            errorMessage = DataScience.failedToStartJupyterDueToOutdatedTraitlets(
                kernelDisplayName || '',
                pythonError || ''
            );
            telemetrySafeTags.push('outdated.traitlets');
            link = 'https://aka.ms/kernelFailuresJupyterTrailtletsOutdated';
        } else {
            errorMessage = pythonError
                ? DataScience.failedToStartJupyterWithErrorInfo(kernelDisplayName || '', pythonError)
                : DataScience.failedToStartJupyter(kernelDisplayName || '');
            link = undefined;
        }
        if (errorMessage) {
            return {
                reason,
                message: errorMessage,
                pythonError: pythonError,
                moreInfoLink: link,
                telemetrySafeTags
            };
        }
    }
}

function extractModuleAndFileFromImportError(errorLine: string) {
    errorLine = errorLine.replace(/"/g, "'");
    const matches = errorLine.match(/'[^\\']*(\\'[^\\']*)*'/g);
    const fileMatches = errorLine.match(/\((.*?)\)/g);
    let moduleName: string | undefined;
    let fileName: string | undefined;
    if (matches && matches[0].length > 2) {
        moduleName = matches[0];
        moduleName = moduleName.substring(1, moduleName.length - 1);
    }
    if (fileMatches && fileMatches[0].length > 2) {
        fileName = fileMatches[0];
        fileName = fileName.substring(1, fileName.length - 1);
    }

    return moduleName ? { moduleName, fileName } : undefined;
}
/**
 * When we override the built in modules errors are of the form
 * `ImportError: cannot import name 'Random' from 'random' (/home/don/samples/pySamples/crap/kernel_crash/no_start/random.py)`
 */
function isBuiltInModuleOverwritten(
    moduleName: string,
    fileName: string | undefined,
    workspaceFolders: readonly WorkspaceFolder[],
    pythonSysPrefix?: string
): KernelFailure | undefined {
    // If we cannot tell whether this belongs to python environment,
    // then we cannot tell if it overwrites any built in modules.
    if (!pythonSysPrefix) {
        return;
    }
    // If we cannot tell whether this is part of a worksapce folder,
    // then we cannot tell if the user created this.
    if (workspaceFolders.length === 0) {
        return;
    }
    if (!fileName) {
        return;
    }

    if (fileName.toLowerCase().startsWith(pythonSysPrefix)) {
        // This is a python file, not created by the user.
        return;
    }

    // eslint-disable-next-line local-rules/dont-use-fspath
    if (!workspaceFolders.some((folder) => fileName.toLowerCase().startsWith(folder.uri.fsPath.toLowerCase()))) {
        return;
    }

    return {
        reason: KernelFailureReason.overridingBuiltinModules,
        fileName,
        moduleName,
        message: DataScience.fileSeemsToBeInterferingWithKernelStartup(
            getDisplayPath(Uri.file(fileName), workspaceFolders || [])
        ),
        moreInfoLink: 'https://aka.ms/kernelFailuresOverridingBuiltInModules',
        telemetrySafeTags: ['import.error', 'override.modules']
    };
}

export function createOutputWithErrorMessageForDisplay(errorMessage: string) {
    if (!errorMessage) {
        return;
    }
    // If we have markdown links to run a command, turn that into a link.
    const regex = /\[([^\[\]]*)\]\((.*?)\)/gm;
    let matches: RegExpExecArray | undefined | null;
    while ((matches = regex.exec(errorMessage)) !== null) {
        if (matches.length === 3) {
            errorMessage = errorMessage.replace(matches[0], `<a href='${matches[2]}'>${matches[1]}</a>`);
        }
    }
    // Ensure all lines are colored red as errors (except for lines containing hyperlinks).
    const stack = errorMessage
        .splitLines({ removeEmptyEntries: false, trim: false })
        .map((line) => `\u001b[1;31m${line}`)
        .join('\n');
    return new NotebookCellOutput([
        NotebookCellOutputItem.error({
            message: '',
            name: '',
            stack
        })
    ]);
}
