// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import type { Uri } from 'vscode';
import { CallInfo, trace as traceDecorator } from '../common/utils/decorators';
import { TraceInfo, tracing as _tracing } from '../common/utils/misc';
import { sendTelemetryEvent } from '../../telemetry';
import { LogLevel } from './levels';
import { ILogger, logToAll } from './logger';
import { argsToLogString, returnValueToLogString } from './util';
const homeAsLowerCase = (require('untildify')('~') || '').toLowerCase();

// The information we want to log.
export enum TraceOptions {
    None = 0,
    Arguments = 1,
    ReturnValue = 2,
    /**
     * Default is to log after a method call.
     * This allows logging of the method call before it is done.
     */
    BeforeCall = 4
}

type ParameterLogInformation =
    | {
          parameterIndex: number;
          propertyOfParaemterToLog: string;
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
            propertyOfParaemterToLog: property as string
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
export function createTracingDecorator(loggers: ILogger[], logInfo: LogInfo) {
    return traceDecorator(
        (call, traced) => logResult(loggers, logInfo, traced, call),
        (logInfo.opts & TraceOptions.BeforeCall) > 0
    );
}

// This is like a "context manager" that logs tracing info.
export function tracing<T>(loggers: ILogger[], logInfo: LogInfo, run: () => T, call?: CallInfo): T {
    return _tracing(
        (traced) => logResult(loggers, logInfo, traced, call),
        run,
        (logInfo.opts & TraceOptions.BeforeCall) > 0
    );
}

export type LogInfo = {
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
    const indexOfStart = value.toLowerCase().indexOf(homeAsLowerCase);
    return indexOfStart === -1 ? value : `~${value.substring(indexOfStart + homeAsLowerCase.length)}`;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatArgument(target: Object, method: MethodName, arg: any, parameterIndex: number) {
    if (isUri(arg)) {
        // Where possible strip user names from paths, then users will be more likely to provide the logs.
        return removeUserPaths(arg.fsPath);
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
    if ('propertyOfParaemterToLog' in info && info.propertyOfParaemterToLog) {
        valueToLog = arg[info.propertyOfParaemterToLog];
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
        if (info.level === LogLevel.Trace) {
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

function logResult(loggers: ILogger[], info: LogInfo, traced: TraceInfo, call?: CallInfo) {
    const formatted = formatMessages(info, traced, call);
    if (!traced) {
        if (info.level && info.level !== LogLevel.Error) {
            logToAll(loggers, info.level, [formatted]);
        }
    } else if (traced.err === undefined) {
        // The call did not fail.
        if (info.level && info.level === LogLevel.Error) {
            // No errors, hence nothing to log.
        } else if (info.level) {
            logToAll(loggers, info.level, [formatted]);
        } else {
            logToAll(loggers, LogLevel.Info, [formatted]);
        }
    } else {
        logToAll(loggers, LogLevel.Error, [formatted, traced.err]);
        sendTelemetryEvent(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            'ERROR' as any,
            undefined,
            {
                failureCategory: 'methodException',
                failureSubCategory: call ? `${call.name}:${call.methodName}` : 'unknown'
            },
            traced.err,
            true
        );
    }
}
