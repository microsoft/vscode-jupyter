// import { SpawnOptions } from 'child_process';
// // Copyright (c) Microsoft Corporation. All rights reserved.
// // Licensed under the MIT License.

// import { Uri } from 'vscode';
// import { Resource } from '../common/types';

// export const IEnvironmentActivationService = Symbol('IEnvironmentActivationService');
// export interface IEnvironmentActivationService {
//     getActivatedEnvironmentVariables(
//         resource: Resource,
//         interpreter?: PythonEnvironment,
//         noIdeaWhatThisIs?: boolean
//     ): Promise<NodeJS.ProcessEnv | undefined>;
// }

// /**
//  * A representation of a Python runtime's version.
//  */
// export type PythonVersion = {
//     raw: string;
//     major: number;
//     minor: number;
//     patch: number;
//     build: string[];
//     prerelease: string[];
// };

// /**
//  * Details about a Python runtime.
//  */
// export type InterpreterInformation = {
//     path: string;
//     version?: PythonVersion;
//     sysPrefix: string;
// };

// /**
//  * Details about a Python environment.
//  */
// export type PythonEnvironment = InterpreterInformation & {
//     displayName?: string;
// };

// export const IInterpreterService = Symbol('IInterpreterService');
// export interface IInterpreterService {
//     getInterpreters(resource: Resource): Promise<PythonEnvironment[]>;
//     getActiveInterpreter(resource: Resource): Promise<PythonEnvironment | undefined>;
//     getInterpreterDetails(pythonPath: string): Promise<PythonEnvironment | undefined>;
//     getExecutionDetails(
//         options:
//             | {
//                   args: string[];
//                   moduleName: string;
//                   options: SpawnOptions;
//               }
//             | {
//                   args: string[];
//                   fileName: string;
//                   options: SpawnOptions;
//               }
//             | {
//                   args: string[];
//                   code?: string;
//                   options: SpawnOptions;
//               }
//     ): Promise<PythonExecutionInfo>;
// }

// export type PythonExecutionInfo = {
//     command: string;
//     args: string[];
//     options: SpawnOptions;
// };

// export type PythonApi = {
//     getInterpreters(resource?: Uri): Promise<PythonEnvironment[]>;
//     getActiveInterpreter(resource?: Uri): Promise<PythonEnvironment | undefined>;
//     getInterpreterDetails(pythonPath: string): Promise<undefined | PythonEnvironment>;
//     getActivatedEnvironmentVariables(options: {
//         pythonPath: string;
//         resource?: Uri;
//     }): Promise<NodeJS.ProcessEnv | undefined>;
//     getExecutionDetails(
//         options:
//             | {
//                   args: string[];
//                   moduleName: string;
//                   options: SpawnOptions;
//               }
//             | {
//                   args: string[];
//                   fileName: string;
//                   options: SpawnOptions;
//               }
//             | {
//                   args: string[];
//                   code?: string;
//                   options: SpawnOptions;
//               }
//     ): Promise<PythonExecutionInfo>;
// };
