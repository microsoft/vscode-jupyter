// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Disposable, Uri, LogLevel, workspace, window } from 'vscode';
import { isCI } from '../common/constants';
import { Arguments, ILogger, TraceDecoratorType, TraceOptions } from './types';
import { CallInfo, trace as traceDecorator } from '../common/utils/decorators';
import { argsToLogString, returnValueToLogString } from './util';
import { splitLines } from '../common/helpers';
import { getDisplayPath } from '../common/platform/fs-paths';
import { trackDisposable } from '../common/utils/lifecycle';
import { OutputChannelNames } from '../common/utils/localize';
import { OutputChannelLogger } from './outputChannelLogger';
import { ConsoleLogger } from './consoleLogger';

let homeAsLowerCase = '';
const DEFAULT_OPTS: TraceOptions = TraceOptions.Arguments | TraceOptions.ReturnValue;

// Information about a traced function/method call.
export type TraceInfo =
    | {
          elapsed: number; // milliseconds
          // Either returnValue or err will be set.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          returnValue?: any;
          err?: Error;
      }
    | undefined;

let loggers: ILogger[] = [];
let globalLoggingLevel: LogLevel = LogLevel.Info;
export const logger: ILogger = {
    error: (message: string, ...data: Arguments) => logError(message, ...data),
    warn: (message: string, ...data: Arguments) => logWarning(message, ...data),
    info: (message: string, ...data: Arguments) => logInfo(message, ...data),
    debug: (message: string, ...data: Arguments) => logDebug(message, ...data),
    trace: (message: string, ...data: Arguments) => logTrace(message, ...data),
    ci: (arg1: any, ...data: string[]) => {
        if (data && Array.isArray(data)) {
            logInfoIfCI(arg1, ...data);
        } else {
            logInfoIfCI(arg1);
        }
    }
};

export function initializeLoggers(options: {
    addConsoleLogger: boolean;
    userNameRegEx?: RegExp;
    homePathRegEx?: RegExp;
    platform?: string;
    arch?: string;
    homePath?: string;
}) {
    globalLoggingLevel = getLoggingLevelFromConfig();
    trackDisposable(
        workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('jupyter.logging')) {
                globalLoggingLevel = getLoggingLevelFromConfig();
            }
        })
    );
    const standardOutputChannel = window.createOutputChannel(OutputChannelNames.jupyter, 'log');
    registerLogger(new OutputChannelLogger(standardOutputChannel, options?.userNameRegEx, options?.homePathRegEx));

    // In CI there's no need for the label.
    registerLogger(new ConsoleLogger(isCI ? undefined : 'Jupyter Extension:'));

    return standardOutputChannel;
}

export function registerLogger(logger: ILogger): Disposable {
    loggers.push(logger);
    return {
        dispose: () => {
            loggers = loggers.filter((l) => l !== logger);
        }
    };
}

type LoggingLevelSettingType = keyof typeof LogLevel | Lowercase<keyof typeof LogLevel> | 'warn' | 'Warn';
function getLoggingLevelFromConfig() {
    try {
        const { level } = workspace
            .getConfiguration('jupyter')
            .get<{ level: LoggingLevelSettingType }>('logging', { level: 'Info' });
        switch (level) {
            case 'debug':
            case 'Debug': {
                return LogLevel.Debug;
            }
            case 'warn':
            case 'Warn':
            case 'warning':
            case 'Warning': {
                return LogLevel.Warning;
            }
            case 'Off':
            case 'off': {
                return LogLevel.Off;
            }
            case 'Error':
            case 'error': {
                return LogLevel.Error;
            }
            case 'Trace':
            case 'trace': {
                return LogLevel.Trace;
            }
            default: {
                return LogLevel.Info;
            }
        }
    } catch (ex) {
        console.error('Failed to get logging level from configuration', ex);
        return LogLevel.Info;
    }
}
export function setHomeDirectory(homeDir: string) {
    homeAsLowerCase = homeDir.toLowerCase();
}

function formatErrors(...args: Arguments) {
    // Format the error message, if showing verbose then include all of the error stack & other details.
    const formatError = globalLoggingLevel <= LogLevel.Debug ? false : true;
    if (!formatError) {
        return args;
    }
    return args.map((arg) => {
        if (!(arg instanceof Error)) {
            return arg;
        }
        // Only format errors raised by Jupyter extension.
        if (!('isJupyterError' in arg)) {
            return arg;
        }
        const info: string[] = [`${arg.name}: ${arg.message}`.trim()];
        if (
            'kernelConnectionMetadata' in arg &&
            arg.kernelConnectionMetadata &&
            typeof arg.kernelConnectionMetadata === 'object' &&
            'id' in arg.kernelConnectionMetadata
        ) {
            info.push(`Kernel Id = ${arg.kernelConnectionMetadata.id}`);
            if (
                'interpreter' in arg.kernelConnectionMetadata &&
                arg.kernelConnectionMetadata.interpreter &&
                typeof arg.kernelConnectionMetadata.interpreter === 'object' &&
                'id' in arg.kernelConnectionMetadata.interpreter &&
                typeof arg.kernelConnectionMetadata.interpreter.id === 'string'
            ) {
                info.push(`Interpreter Id = ${getDisplayPath(arg.kernelConnectionMetadata.interpreter.id)}`);
            }
        }
        if (arg.stack) {
            const stack = splitLines(arg.stack);
            const firstStackLine = stack.find((l) => l.indexOf('at ') === 0);
            if (stack.length === 1) {
                //
            } else if (stack.length === 1) {
                info.push(stack[0]);
            } else if (stack.length > 1 && firstStackLine?.length) {
                info.push(firstStackLine);
            } else {
                info.push(stack[0]);
            }
        }
        const propertiesToIgnore = [
            'stack',
            'message',
            'name',
            'kernelConnectionMetadata',
            'category',
            'exitCode',
            'isJupyterError'
        ];
        Object.keys(arg)
            .filter((key) => propertiesToIgnore.indexOf(key) === -1)
            .forEach((key) => info.push(`${key} = ${String((arg as any)[key]).trim()}`));
        return info
            .filter((l) => l.trim().length)
            .map((l, i) => (i === 0 ? l : `    > ${l}`))
            .join('\n');
    });
}
function logError(message: string, ...args: Arguments): void {
    if (globalLoggingLevel <= LogLevel.Error) {
        args = formatErrors(...args);
        loggers.forEach((l) => l.error(message, ...args));
    }
}

function logWarning(message: string, ...args: Arguments): void {
    if (globalLoggingLevel <= LogLevel.Warning) {
        args = formatErrors(...args);
        loggers.forEach((l) => l.warn(message, ...args));
    }
}

function logInfo(message: string, ...args: Arguments): void {
    if (globalLoggingLevel <= LogLevel.Info) {
        loggers.forEach((l) => l.info(message, ...args));
    }
}
function logDebug(message: string, ...args: Arguments): void {
    if (globalLoggingLevel <= LogLevel.Debug) {
        loggers.forEach((l) => l.debug(message, ...args));
    }
}
function logTrace(message: string, ...args: Arguments): void {
    if (globalLoggingLevel <= LogLevel.Trace) {
        loggers.forEach((l) => l.trace(message, ...args));
    }
}
function logInfoIfCI(msg: () => [message: string, ...args: string[]] | string): void;
function logInfoIfCI(message: string, ...args: string[]): void;
function logInfoIfCI(arg1: any, ...args: Arguments): void {
    if (isCI) {
        if (typeof arg1 === 'function') {
            const fn: () => string | [message: string, ...args: string[]] = arg1;
            const result = fn();
            let message = '';
            let rest: string[] = [];
            if (typeof result === 'string') {
                message = result;
            } else {
                message = result.shift()!;
                rest = result;
            }
            logger.info(message, ...rest);
        } else {
            logger.info(arg1, ...args);
        }
    }
}

/** Logging Decorators go here */

export function debugDecorator(message: string, opts: TraceOptions = DEFAULT_OPTS): TraceDecoratorType {
    return createTracingDecorator({ message, opts, level: LogLevel.Debug });
}
export function errorDecorator(message: string): TraceDecoratorType {
    return createTracingDecorator({ message, opts: DEFAULT_OPTS, level: LogLevel.Error });
}
export function infoDecorator(message: string): TraceDecoratorType {
    return createTracingDecorator({ message, opts: DEFAULT_OPTS, level: LogLevel.Info });
}
export function warnDecorator(message: string): TraceDecoratorType {
    return createTracingDecorator({ message, opts: DEFAULT_OPTS, level: LogLevel.Warning });
}

type ParameterLogInformation =
    | {
          parameterIndex: number;
          propertyOfParameterToLog: string;
      }
    | { parameterIndex: number; ignore: true };
type MethodName = string | symbol;
type ClassInstance = Object;
const formattedParameters = new WeakMap<ClassInstance, Map<MethodName, ParameterLogInformation[]>>();
export function logValue<T>(property: keyof T) {
    return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: any,
        methodName: string | symbol,
        parameterIndex: number
    ) => {
        if (!formattedParameters.has(target)) {
            formattedParameters.set(target, new Map<MethodName, ParameterLogInformation[]>());
        }
        let parameterInfos = formattedParameters.get(target);
        if (!parameterInfos) {
            formattedParameters.set(target, (parameterInfos = new Map<MethodName, ParameterLogInformation[]>()));
        }
        if (!parameterInfos.has(methodName)) {
            parameterInfos.set(methodName, []);
        }
        const params = parameterInfos.get(methodName)!;
        params.push({
            parameterIndex,
            propertyOfParameterToLog: property as string
        });
    };
}
export function ignoreLogging() {
    return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: any,
        methodName: string | symbol,
        parameterIndex: number
    ) => {
        if (!formattedParameters.has(target)) {
            formattedParameters.set(target, new Map<MethodName, ParameterLogInformation[]>());
        }
        let parameterInfos = formattedParameters.get(target);
        if (!parameterInfos) {
            formattedParameters.set(target, (parameterInfos = new Map<MethodName, ParameterLogInformation[]>()));
        }
        if (!parameterInfos.has(methodName)) {
            parameterInfos.set(methodName, []);
        }
        const params = parameterInfos.get(methodName)!;
        params.push({
            parameterIndex,
            ignore: true
        });
    };
}
function createTracingDecorator(logInfo: LogInfo) {
    return traceDecorator(
        (call, traced) => logResult(logInfo, traced, call),
        (logInfo.opts & TraceOptions.BeforeCall) > 0
    );
}

type LogInfo = {
    opts: TraceOptions;
    message: string;
    level?: LogLevel;
};

function normalizeCall(call: CallInfo): CallInfo {
    let { kind, name, args } = call;
    if (!kind || kind === '') {
        kind = 'Function';
    }
    if (!name || name === '') {
        name = '<anon>';
    }
    if (!args) {
        args = [];
    }
    return { kind, name, args, methodName: call.methodName || '', target: call.target || undefined };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isUri(resource?: Uri | any): resource is Uri {
    if (!resource) {
        return false;
    }
    const uri = resource as Uri;
    return typeof uri.path === 'string' && typeof uri.scheme === 'string';
}

function removeUserPaths(value: string) {
    // Where possible strip user names from paths, then users will be more likely to provide the logs.
    const indexOfStart = homeAsLowerCase ? value.toLowerCase().indexOf(homeAsLowerCase) : -1;
    return indexOfStart === -1 ? value : `~${value.substring(indexOfStart + homeAsLowerCase.length)}`;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatArgument(target: Object, method: MethodName, arg: any, parameterIndex: number) {
    if (isUri(arg)) {
        // Where possible strip user names from paths, then users will be more likely to provide the logs.
        return removeUserPaths(arg.path);
    }
    if (!arg) {
        return arg;
    }
    const parameterInfos = formattedParameters.get(target)?.get(method);
    const info = parameterInfos?.find((info) => info.parameterIndex === parameterIndex);
    if (!info) {
        return typeof arg === 'string' ? removeUserPaths(arg) : arg;
    }
    if ('ignore' in info && info.ignore) {
        return '';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let valueToLog: any = arg;
    if ('propertyOfParameterToLog' in info && info.propertyOfParameterToLog) {
        valueToLog = arg[info.propertyOfParameterToLog];
    }
    return typeof valueToLog === 'string' ? removeUserPaths(valueToLog) : valueToLog;
}
function formatMessages(info: LogInfo, traced: TraceInfo, call?: CallInfo): string {
    call = normalizeCall(call!);
    ``;
    const messages = [info.message];
    messages.push(`${call.kind} name = ${call.name}`.trim());
    if (traced) {
        messages.push(`completed in ${traced.elapsed}ms`);
        messages.push(`has a ${traced.returnValue ? 'truthy' : 'falsy'} return value`);
    } else {
        messages[messages.length - 1] = `${messages[messages.length - 1]} (started execution)`;
    }
    if ((info.opts & TraceOptions.Arguments) === TraceOptions.Arguments) {
        if (info.level === LogLevel.Debug) {
            // This is slower, hence do this only when user enables trace logging.
            messages.push(
                argsToLogString(
                    call.args.map((arg, index) =>
                        call ? formatArgument(call.target, call.methodName, arg, index) : arg
                    )
                )
            );
        } else {
            messages.push(argsToLogString(call.args));
        }
    }
    if (traced && (info.opts & TraceOptions.ReturnValue) === TraceOptions.ReturnValue) {
        messages.push(returnValueToLogString(traced.returnValue));
    }
    return messages.join(', ');
}

function logResult(info: LogInfo, traced: TraceInfo, call?: CallInfo) {
    const formatted = formatMessages(info, traced, call);
    if (!traced) {
        if (info.level && info.level !== LogLevel.Error) {
            logTo(info.level, formatted);
        }
    } else if (traced.err === undefined) {
        // The call did not fail.
        if (info.level && info.level === LogLevel.Error) {
            // No errors, hence nothing to log.
        } else if (info.level) {
            logTo(info.level, formatted);
        } else {
            logTo(LogLevel.Info, formatted);
        }
    } else {
        logTo(LogLevel.Error, formatted, traced.err);
    }
}

function logTo(logLevel: LogLevel, message: string, ...args: Arguments): void {
    switch (logLevel) {
        case LogLevel.Error:
            logger.error(message, ...args);
            break;
        case LogLevel.Warning:
            logWarning(message, ...args);
            break;
        case LogLevel.Info:
            logger.info(message, ...args);
            break;
        case LogLevel.Debug:
        case LogLevel.Trace:
            logger.debug(message, ...args);
            break;
        default:
            break;
    }
}
