// // Copyright (c) Microsoft Corporation.
// // Licensed under the MIT License.

// 'use strict';
// /* eslint-disable @typescript-eslint/no-explicit-any */

// import type { JSONObject } from '@lumino/coreutils';
// // eslint-disable-next-line
// import { Telemetry } from './platform/common/constants';
// import { CheckboxState, EventName, SliceOperationSource } from './platform/telemetry/constants';
// import { DebuggingTelemetry } from './notebooks/debugger/constants';
// import { EnvironmentType } from './platform/pythonEnvironments/info';
// import { TelemetryErrorProperties, ErrorCategory } from './platform/errors/types';
// import { ExportFormat } from './notebooks/export/types';
// import {
//     InterruptResult,
//     KernelActionSource,
//     KernelConnectionMetadata,
//     KernelInterpreterDependencyResponse
// } from './kernels/types';
// // eslint-disable-next-line
// import { IExportedKernelService } from './standalone/api/extension';
// import { SelectJupyterUriCommandSource } from './kernels/jupyter/serverSelector';
// import { PreferredKernelExactMatchReason } from './notebooks/controllers/types';
// import { KernelFailureReason } from './platform/errors/errorUtils';
// import { ExcludeType, PickType, UnionToIntersection } from './platform/common/utils/misc';

// export * from './platform/telemetry/index';
// export type DurationMeasurement = {
//     /**
//      * Duration of a measure in milliseconds.
//      * Common measurement used across a number of events.
//      */
//     duration: number;
// };
// export type ResourceTypeTelemetryProperty = {
//     /**
//      * Used to determine whether this event is related to a Notebooks or Interactive window.
//      */
//     resourceType?: 'notebook' | 'interactive';
// };

// export type ResourceSpecificTelemetryProperties = Partial<
//     ResourceTypeTelemetryProperty & {
//         /**
//          * Whether the user executed a cell.
//          */
//         userExecutedCell?: boolean;
//         /**
//          * Hash of the Kernel Connection id.
//          */
//         kernelId: string;
//         /**
//          * Whether the notebook startup UI (progress indicator & the like) was displayed to the user or not.
//          * If its not displayed, then its considered an auto start (start in the background, like pre-warming kernel)
//          */
//         disableUI?: boolean;
//         /**
//          * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
//          * If we run the same notebook tomorrow, the hash will be the same.
//          */
//         resourceHash?: string;
//         /**
//          * Unique identifier for an instance of a notebook session.
//          * If we restart or run this notebook tomorrow, this id will be different.
//          * Id could be something as simple as a hash of the current Epoch time.
//          */
//         kernelSessionId: string;
//         /**
//          * Whether this resource is using the active Python interpreter or not.
//          */
//         isUsingActiveInterpreter?: boolean;
//         /**
//          * Found plenty of issues when starting kernels with conda, hence useful to capture this info.
//          */
//         pythonEnvironmentType?: EnvironmentType;
//         /**
//          * A key, so that rest of the information is tied to this. (hash)
//          */
//         pythonEnvironmentPath?: string;
//         /**
//          * Found plenty of issues when starting Conda Python 3.7, Python 3.7 Python 3.9 (in early days when ipykernel was not up to date)
//          */
//         pythonEnvironmentVersion?: string;
//         /**
//          * Total number of python environments.
//          */
//         pythonEnvironmentCount?: number;
//         /**
//          * Comma delimited list of hashed packages & their versions.
//          */
//         pythonEnvironmentPackages?: string;
//         /**
//          * Whether kernel was started using kernel spec, interpreter, etc.
//          */
//         kernelConnectionType?: KernelConnectionMetadata['kind'];
//         /**
//          * Language of the kernel connection.
//          */
//         kernelLanguage: string;
//         /**
//          * This number gets reset after we attempt a restart or change kernel.
//          */
//         interruptCount?: number;
//         /**
//          * This number gets reset after change the kernel.
//          */
//         restartCount?: number;
//         /**
//          * Number of times starting the kernel failed.
//          */
//         startFailureCount?: number;
//         /**
//          * Number of times the kernel was changed.
//          */
//         switchKernelCount?: number;
//         /**
//          * Total number of kernel specs in the kernel spec list.
//          */
//         kernelSpecCount: number;
//         /**
//          * Total number of interpreters in the kernel spec list.
//          */
//         kernelInterpreterCount: number;
//         /**
//          * Total number of live kernels in the kernel spec list.
//          */
//         kernelLiveCount: number;
//         /**
//          * Whether this was started by Jupyter extension or a 3rd party.
//          */
//         actionSource: KernelActionSource;
//         /**
//          * Whether we managed to capture the environment variables or not.
//          * In the case of conda environments, `false` would be an error condition, as we must have env variables for conda to work.
//          */
//         capturedEnvVars?: boolean;
//     }
// >;

// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////
// ////////////////////////////////////

// //////
// //////
// //////
// //////
// //////
// //////
// //////

// type Owner = 'donjayamanne' | 'amunger' | 'IanMatthewHuff' | 'rebornix' | 'roblourens' | 'unknown';
// type YearsOf2020 = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
// type FullYear = `202${YearsOf2020}`;
// type Months = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';
// type ExtensionVersions = `${FullYear}.${Months}`;
// type Feature =
//     | 'Notebook'
//     | 'InteractiveWindow'
//     | 'PlotViewer'
//     | 'DataFrameViewer'
//     | 'Debugger'
//     | 'KernelPicker'
//     | 'Import-Export'
//     | 'VariableViewer';
// type EventTag = 'Cell Execution' | 'Remote' | 'Widgets' | 'KernelStartup';
// type EventSource = 'User Action' | 'Non-UserAction' | 'Either' | 'N/A';
// type IGDPREventData = {
//     owner: Owner;
//     // We extract the jsdoc comments from IEvenNamePropertyMapping found in in telemetry.ts.
//     // comment: string;
//     expiration?: string;
//     comment?: string;
// };
// type ICustomEventData = {
//     /**
//      * Extension Version when this event was defined.
//      * E.g. during development if we add a new event, this will contain the current dev version from package.json.
//      * This will provide a timeline for when we can expect to see this event.
//      * (Specific to Jupyter extension, non-gdpr).
//      */
//     effectiveVersion?: 'unknown' | ExtensionVersions;
//     feature: 'N/A' | Feature[];
//     tags?: EventTag[];
//     source?: EventSource;
// };
// export type IEventData = IGDPREventData & ICustomEventData;
// /**
//  * Used to define an individual property (data item) of an Event.
//  */
// type IBasePropertyData = {
//     /**
//      * EndUserPseudonymizedInformation is what allows us to identify a particular user across time, although we don't know the actual identity of the user. machineId or instanceId fall in this category.
//      * PublicPersonalData and PublicNonPersonalData is information that users provide us with, for example, publisher information on the marketplace.
//      * CustomerContent is information the user generated such as urls of repositories or custom snippets.
//      * CallstackOrException is for error data like callbacks and exceptions. Everything else is SystemMetaData.
//      */
//     classification:
//         | 'SystemMetaData'
//         | 'CallstackOrException'
//         | 'CustomerContent'
//         | 'PublicNonPersonalData'
//         | 'EndUserPseudonymizedInformation';
//     /**
//      * FeatureInsight or PerformanceAndHealth.
//      * We only use BusinessInsight for events generated by surveys.
//      */
//     purpose: 'PerformanceAndHealth' | 'FeatureInsight' | 'BusinessInsight';
//     /**
//      * Used to specify a reason for collecting the event. This is meant to be more descriptive than `classification` & `purpose`.
//      * (if not specified here, then we need jsDoc comments for the corresponding property).
//      * The telemetry generation tool will ensure we have necessary comments.
//      */
//     comment?: string;
//     /**
//      * Used if you would like to dictate the max product version this telemetry event should be sent in.
//      * This allows external tools to specify which events should be removed from the codebase.
//      */
//     expiration?: string;
//     /**
//      * Defaults to none. That's appropriate for pretty much all properties rather than a couple of common properties.
//      *
//      * @type {string}
//      * @memberof IPropertyData
//      */
//     endpoint?: string;
//     /**
//      * Extension Version when this event was defined.
//      * E.g. during development if we add a new event, this will contain the current dev version from package.json.
//      * This will provide a timeline for when we can expect to see this event.
//      * (Specific to Jupyter extension, non-gdpr).
//      *
//      * If undefined, then this means this was added along with the event.
//      * If this is an existing event and we add new data, then this must have a value.
//      */
//     effectiveVersion?: 'SameAsEvent' | ExtensionVersions;
// };

// type IPropertyDataNonMeasurement = IBasePropertyData & {
//     /**
//      * If numbers to are to be sent, they must be sent as measures.
//      */
//     isMeasurement?: false;
// };
// type IPropertyDataMeasurement = IBasePropertyData & {
//     /**
//      * Numbers are handled differently in the telemetry system.
//      */
//     isMeasurement: true;
// };

// /**
//  * TelemetryErrorProperties is common to all events, hence the properties of this are common to all events.
//  * Similarly `duration` is a common measure that's sent for a lot of events)
//  */
// type CommonProperties =
//     | keyof TelemetryErrorProperties
//     | keyof DurationMeasurement
//     | keyof ResourceTypeTelemetryProperty;

// /**
//  * This will include all of the properties for an Event.
//  * This will also include common properties such as error properties, duration, etc.
//  */
// type AllEventPropertiesData<T> = {
//     [P in keyof Required<T>]: Required<T>[P] extends number ? IPropertyDataMeasurement : IPropertyDataNonMeasurement;
// };
// // type AllEventMeasuresData<T> = {
// //     [P in keyof Required<T>]: Required<T>[P] extends number ? IPropertyDataNonMeasurement : never;
// // };

// /**
//  * This will include all of the properties for an Event, excluding the common properties.
//  * These are the properties that need to be documented and defined.
//  */
// type EventPropertiesData<T> = AllEventPropertiesData<T>;
// // type EventMeasuresData<T> = Omit<AllEventPropertiesData<T>, CommonProperties>;

// type GDPREventDefinition<P> = P extends never
//     ? IEventData
//     : keyof EventPropertiesData<ExcludeType<P, number>> extends never
//     ? keyof EventPropertiesData<PickType<P, number>> extends never
//         ? IEventData
//         : IEventData & { measures: EventPropertiesData<PickType<P, number>> }
//     : keyof EventPropertiesData<PickType<P, number>> extends never | undefined
//     ? IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> }
//     : IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> } & {
//           measures: EventPropertiesData<PickType<P, number>>;
//       };

// // // type XYZ<T> = (EventPropertiesData<PickType<T, number>> extends (never | undefined) ? IEventData : (IEventData & {measures: EventPropertiesData<PickType<T, number>>}))
// // // type XYZ<T> = (EventPropertiesData<PickType<T, number>> extends undefined) ? (IEventData & EventPropertiesData<ExcludeType<T, number>>): (IEventData & {properties: EventPropertiesData<ExcludeType<T, number>>} & {measures: EventPropertiesData<PickType<T, number>>});
// // type XYZ<T> = EventPropertiesData<PickType<T, number>> extends never | undefined
// //     ? IEventData & { properties: EventPropertiesData<ExcludeType<T, number>> }
// //     : IEventData & { properties: EventPropertiesData<ExcludeType<T, number>> } & {
// //           measures: EventPropertiesData<PickType<T, number>>;
// //       }> = {};

// type AllGDPREventDefinitions<T extends IEventNamePropertyMapping = IEventNamePropertyMapping> = {
//     [P in keyof IEventNamePropertyMapping]: GDPREventDefinition<UnionToIntersection<T[P]>>;
// };
// const commonClassificationForDurationProperties: AllEventPropertiesData<DurationMeasurement> = {
//     duration: {
//         classification: 'PublicNonPersonalData',
//         comment: 'Time taken to perform an operation',
//         purpose: 'PerformanceAndHealth',
//         isMeasurement: true,
//         effectiveVersion: 'SameAsEvent'
//     }
// };
// const commonClassificationForResourceType: AllEventPropertiesData<ResourceTypeTelemetryProperty> = {
//     resourceType: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'FeatureInsight',
//         effectiveVersion: 'SameAsEvent'
//     }
// };
// const commonClassificationForErrorProperties: AllEventPropertiesData<TelemetryErrorProperties> = {
//     failed: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     failureCategory: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     failureSubCategory: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     pythonErrorFile: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     pythonErrorFolder: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     pythonErrorPackage: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     },
//     stackTrace: {
//         classification: 'PublicNonPersonalData',
//         comment: '',
//         purpose: 'PerformanceAndHealth',
//         effectiveVersion: 'SameAsEvent'
//     }
// };
// const commonClassificationForResourceSpecificTelemetryProperties: AllEventPropertiesData<ResourceSpecificTelemetryProperties> =
//     {
//         actionSource: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         disableUI: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         interruptCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         userExecutedCell: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         switchKernelCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         startFailureCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         restartCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         resourceHash: {
//             classification: 'PublicNonPersonalData',
//             comment: `Hash of the Notebook or Interactive Window URI. Used to check whether a particular notebook fails across time or not.
//             This is also used to map different telemetry events related to this same resource. E.g. we could have an event sent for starting a notebook with this hash,
//             and then later we get yet another event indicating starting a notebook failed. And another event indicating the Python environment used for this notebook is a conda environment or
//             we have some other event indicating some other piece of data for this resource. With the information across multiple resources we can now join the different data points
//             and have a better understanding of what is going on, e.g. why something failed.`,
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         pythonEnvironmentVersion: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         pythonEnvironmentType: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         pythonEnvironmentPath: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         pythonEnvironmentPackages: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         pythonEnvironmentCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelSpecCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelSessionId: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelLiveCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelLanguage: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelInterpreterCount: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true,
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelId: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         kernelConnectionType: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         isUsingActiveInterpreter: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         capturedEnvVars: {
//             classification: 'PublicNonPersonalData',
//             comment: '',
//             purpose: 'PerformanceAndHealth',
//             effectiveVersion: 'SameAsEvent'
//         },
//         ...commonClassificationForResourceType
//     };

// //////
// //////
// //////
// //////
// //////
// //////
// //////
// //////
// // type GDPRDdata<P, M> = {
// //     owner: string;
// //     properties: Record<keyof P, { why: string; ok: boolean; measure: false }> &
// //         Record<keyof M, { why: string; ok: boolean; measure: true }>;
// //     // more: Everything<P>
// // };

// type UnionGDPREventDefinition<P> = P extends never
//     ? IEventData
//     : keyof EventPropertiesData<ExcludeType<UnionToIntersection<P>, number>> extends never
//     ? keyof EventPropertiesData<PickType<UnionToIntersection<P>, number>> extends never
//         ? IEventData
//         : IEventData & { measures: EventPropertiesData<PickType<UnionToIntersection<P>, number>> }
//     : keyof EventPropertiesData<PickType<UnionToIntersection<P>, number>> extends never | undefined
//     ? IEventData & { properties: EventPropertiesData<ExcludeType<UnionToIntersection<P>, number>> }
//     : IEventData & {
//           properties: UnionToIntersection<EventPropertiesData<ExcludeType<UnionToIntersection<P>, number>>>;
//       } & {
//           measures: EventPropertiesData<PickType<UnionToIntersection<P>, number>>;
//       };
// type WrapperUnionGDPREventDefinition<P> = UnionGDPREventDefinition<UnionToIntersection<P>>;

// type ComplexType = (DurationMeasurement & ResourceSpecificTelemetryProperties) | TelemetryErrorProperties;

// type ABC = WrapperUnionGDPREventDefinition<ComplexType>;
// const abcValue: ABC = {
//     owner: 'IanMatthewHuff',
//     feature: 'N/A',
//     properties: {
//         ...commonClassificationForErrorProperties
//         // ...commonClassificationForResourceSpecificTelemetryProperties
//     },
//     measures: commonClassificationForDurationProperties
// };
// console.log(abcValue);

// export type TelemetryEventInfo<P> = GDPREventDefinition<P>;
// export class NewMapping {
//     // [EventName.EXTENSION_LOAD]: RevisedGDPREventDefinition<{
//     //     helloWorld: string;
//     // } | {testing:boolean}> = {
//     //     owner: 'amunger',
//     //     effectiveVersion: 'unknown',
//     //     feature: ['DataFrameViewer'],
//     //     source: 'N/A',
//     //     tags: ['Remote'],
//     //     // counter: {
//     //     //     why:'For someting',
//     //     //     measure: true,
//     //     //     ok: false
//     //     // },
//     //     properties: {
//     //         helloWorld: {
//     //             classification: 'CallstackOrException',
//     //             comment: '',
//     //             effectiveVersion: 'SameAsEvent',
//     //             purpose: 'PerformanceAndHealth',
//     //             isMeasurement: false
//     //         },
//     //         testing: {
//     //             classification: 'CallstackOrException',
//     //             comment: '',
//     //             effectiveVersion: 'SameAsEvent',
//     //             purpose: 'PerformanceAndHealth',
//     //             isMeasurement: false
//     //         }
//     //     }
//     // };
//     [EventName.EXTENSION_LOAD]: WrapperRevisedGDPREventDefinition<EXTENSION_LOAD_Type> = {
//         owner: 'amunger',
//         effectiveVersion: 'unknown',
//         feature: ['DataFrameViewer'],
//         source: 'N/A',
//         tags: ['Remote'],
//         // counter: {
//         //     why:'For someting',
//         //     measure: true,
//         //     ok: false
//         // },
//         properties: {
//             helloWorld: {
//                 classification: 'CallstackOrException',
//                 comment: '',
//                 effectiveVersion: 'SameAsEvent',
//                 purpose: 'PerformanceAndHealth',
//                 isMeasurement: false
//             }
//         },
//         measures: {
//             counter: {
//                 classification: 'CallstackOrException',
//                 comment: '',
//                 effectiveVersion: 'SameAsEvent',
//                 purpose: 'PerformanceAndHealth',
//                 isMeasurement: true
//             },
//             cellCounter: {
//                 classification: 'CallstackOrException',
//                 comment: '',
//                 effectiveVersion: 'SameAsEvent',
//                 purpose: 'PerformanceAndHealth',
//                 isMeasurement: true
//             }
//         }
//     };
//     [EventName.ENVFILE_WORKSPACE]: WrapperRevisedGDPREventDefinition<{
//         one: string;
//         // notebookCount: number;
//     }> =
//         // {
//         //     counter: number;
//         // }
//         {
//             owner: 'amunger',
//             effectiveVersion: 'unknown',
//             feature: ['DataFrameViewer'],
//             source: 'Either',
//             tags: ['Remote'],
//             // measures: {},
//             properties: {
//                 one: {
//                     classification: 'CallstackOrException',
//                     comment: '',
//                     effectiveVersion: 'SameAsEvent',
//                     purpose: 'PerformanceAndHealth',
//                     isMeasurement: false
//                 }
//             }
//             // measures: {
//             //     // snotebookCount: {
//             //     //     classification: 'CallstackOrException',
//             //     //     comment: '',
//             //     //     effectiveVersion: 'SameAsEvent',
//             //     //     purpose: 'PerformanceAndHealth',
//             //     //     isMeasurement: true
//             //     // }
//             // }
//         };
//     public [Telemetry.JupyterInstalled]: WrapperRevisedGDPREventDefinition<JupyterInstalledType> = {} as any;
// }
// // type RevisedGDPREventDefinition<P> = P extends never
// //     ? IEventData
// //     : IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> };

// type RevisedGDPREventDefinition<P> = P extends never
//     ? IEventData
//     : keyof EventPropertiesData<ExcludeType<P, number>> extends never
//     ? keyof EventPropertiesData<PickType<P, number>> extends never
//         ? IEventData
//         : IEventData & { measures: EventPropertiesData<PickType<P, number>> }
//     : keyof EventPropertiesData<PickType<P, number>> extends never | undefined
//     ? IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> }
//     : IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> } & {
//           measures: EventPropertiesData<PickType<P, number>>;
//       };
// // type WrapperRevisedGDPREventDefinition<P> = RevisedGDPREventDefinition<P>;
// type WrapperRevisedGDPREventDefinition<P> = RevisedGDPREventDefinition<P>;

// function sendInfo<P extends NewMapping, E extends keyof P>(
//     eventName: E,
//     // properties?: (P[E] extends WrapperRevisedGDPREventDefinition<infer R> ? R : never) | undefined,
//     properties?:
//         | (P[E] extends WrapperRevisedGDPREventDefinition<infer R>
//               ? ExcludeType<UnionToIntersection<R>, number>
//               : never)
//         | undefined,
//     measures?:
//         | (P[E] extends WrapperRevisedGDPREventDefinition<infer R>
//               ? keyof PickType<UnionToIntersection<R>, number> extends never | undefined
//                   ? undefined
//                   : PickType<UnionToIntersection<R>, number>
//               : undefined)
//         | undefined
// ) {
//     console.log(eventName, properties, measures);
// }
// type EXTENSION_LOAD_Type = {
//     helloWorld: string;
//     counter: number;
//     cellCounter: number;
// };
// type EXT_1 = UnionToIntersection<EXTENSION_LOAD_Type>;

// type JupyterInstalledType =
//     | {
//           failed: true;
//           reason: 'notInstalled111';
//           // counter: number;
//           frontEnd: 'notebook' | 'lab';
//           counter: number;
//       }
//     | {
//           /**
//            * Jupyter is in current path of process owned by VS Code.
//            * I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].
//            */
//           detection: 'process';
//           frontEnd: 'notebook' | 'lab';
//           /**
//            * Version of the form 6.11, 4.8
//            */
//           frontEndVersion: number;
//       };

// // type X1324 = WrapperRevisedGDPREventDefinition<JupyterInstalledType>;

// // const x11: X1324 = {
// //     measures: {
// //         frontEndVersion: {

// //         }
// //     }
// // };
// type TESTING = {
//     // a:number;
//     that: boolean;
// };
// type File = keyof PickType<TESTING, number>;

// sendInfo(EventName.EXTENSION_LOAD, { helloWorld: '2134' }, { cellCounter: 44, counter: 44 }); //{ counter: 1234, cellCounter: 4 });
// sendInfo(EventName.ENVFILE_WORKSPACE, { one: 'world' }, undefined);
// sendInfo(
//     Telemetry.JupyterInstalled,
//     { detection: 'process', failed: true, frontEnd: 'lab', reason: 'notInstalled111' },
//     { counter: 1324, frontEndVersion: 1234 }
// );

// // const abc: TelemetryEventInfo<{
// //     helloWorld: string;
// //     counter: number;
// // }> = {};

// // ////////////////////////////////////
// // ////////////////////////////////////
// // ////////////////////////////////////
// // ////////////////////////////////////
// // ////////////////////////////////////
// // ////////////////////////////////////
// // ////////////////////////////////////
// // export class IEventNamePropertyMapping {
// //     /**
// //      * Telemetry event sent with perf measures related to activation and loading of extension.
// //      */
// //     public [EventName.EXTENSION_LOAD]: TelemetryEventInfo<{
// //         /**
// //          * Number of workspace folders opened
// //          */
// //         workspaceFolderCount: number;
// //         /**
// //          * Time taken to activate the extension.
// //          */
// //         totalActivateTime: number;
// //         /**
// //          * Time taken to load the code.
// //          */
// //         codeLoadingTime: number;
// //         /**
// //          * Time when activation started.
// //          */
// //         startActivateTime: number;
// //         /**
// //          * Time when activation completed.
// //          */
// //         endActivateTime: number;
// //     }> = {
// //         owner:'donjayamanne',
// //         effectiveVersion:'unknown',
// //         feature:'N/A',
// //         measures:{
// //             codeLoadingTime: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth',
// //                 isMeasurement:true
// //             },
// //             totalActivateTime: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth',
// //                 isMeasurement:true
// //             },
// //             workspaceFolderCount: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth',
// //                 isMeasurement:true
// //             },
// //             endActivateTime: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth',
// //                 isMeasurement:true
// //             },
// //             startActivateTime: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth',
// //                 isMeasurement:true
// //             }
// //         }
// //     };
// //     /**
// //      * Telemetry event sent when substituting Environment variables to calculate value of variables.
// //      * E.g. user has a a .env file with tokens that need to be replaced with env variables.
// //      * such as an env file having the variable `${HOME}`.
// //      * Gives us an idea of whether users have variable references in their .env files or not.
// //      */
// //     [EventName.ENVFILE_VARIABLE_SUBSTITUTION]: TelemetryEventInfo<never | undefined> = {
// //         owner:'donjayamanne',
// //         feature:'N/A'
// //     };
// //     /**
// //      * Telemetry event sent when an environment file is detected in the workspace.
// //      */
// //     [EventName.ENVFILE_WORKSPACE]: TelemetryEventInfo<{
// //         /**
// //          * If there's a custom path specified in the python.envFile workspace settings.
// //          */
// //         hasCustomEnvPath: boolean;
// //     }> = {
// //         owner:'donjayamanne',
// //         feature:'N/A',
// //         properties:{
// //             hasCustomEnvPath: {
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             }
// //         }
// //     };
// //     /**
// //      * Telemetry event sent with hash of an imported python package.
// //      * Used to detect the popularity of a package, that would help determine which packages
// //      * need to be prioritized when resolving issues with intellisense or supporting similar issues related to a (known) specific package.
// //      */
// //     [EventName.HASHED_PACKAGE_NAME]: TelemetryEventInfo<{
// //         /**
// //          * Hash of the package name
// //          */
// //         hashedNamev2: string;
// //     }> = {
// //         owner:'unknown',
// //         feature:'N/A',
// //         properties:{
// //             hashedNamev2:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight',
// //                 comment:'Hash of the package name'
// //             }
// //         }
// //     };
// //     /**
// //      * Telemetry sent for local Python Kernels.
// //      * Tracking whether we have managed to launch the kernel that matches the interpreter.
// //      * If match=false, then this means we have failed to launch the right kernel.
// //      */
// //     [Telemetry.PythonKerneExecutableMatches]: TelemetryEventInfo<{
// //         /**
// //          * Whether we've managed to correctly identify the Python Environment.
// //          */
// //         match: 'true' | 'false';
// //         /**
// //          * Type of kernel connection, whether its local, remote or a python environment.
// //          */
// //         kernelConnectionType:
// //             | 'startUsingLocalKernelSpec'
// //             | 'startUsingPythonInterpreter'
// //             | 'startUsingRemoteKernelSpec';
// //     }> = {
// //         owner:'donjayamanne',
// //         feature:'N/A',
// //         tags:['KernelStartup'],
// //         properties:{
// //             kernelConnectionType:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             match:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             }
// //         }
// //     };
// //     /**
// //      * Time taken to list the Python interpreters.
// //      */
// //     [Telemetry.InterpreterListingPerf]: TelemetryEventInfo<{
// //         /**
// //          * Whether this is the first time in the session.
// //          * (fetching kernels first time in the session is slower, later its cached).
// //          * This is a generic property supported for all telemetry (sent by decorators).
// //          */
// //         firstTime?: boolean;
// //         /**
// //          * Total time taken to list interpreters.
// //          */
// //         duration: number;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         properties: {
// //             firstTime:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             }
// //         },
// //         measures: commonClassificationForDurationProperties
// //     };
// //     [Telemetry.ActiveInterpreterListingPerf]: TelemetryEventInfo<{
// //         /**
// //          * Whether this is the first time in the session.
// //          * (fetching kernels first time in the session is slower, later its cached).
// //          * This is a generic property supported for all telemetry (sent by decorators).
// //          */
// //         firstTime?: boolean;
// //         /**
// //          * Total time taken to list interpreters.
// //          */
// //          duration: number;
// //         }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         properties: {
// //             firstTime:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             }
// //         },
// //         measures: commonClassificationForDurationProperties
// //     };
// //     [Telemetry.KernelListingPerf]: TelemetryEventInfo<{
// //         /**
// //          * Whether this is the first time in the session.
// //          * (fetching kernels first time in the session is slower, later its cached).
// //          * This is a generic property supported for all telemetry (sent by decorators).
// //          */
// //         firstTime?: boolean;
// //         /**
// //          * Whether this telemetry is for listing of all kernels or just python or just non-python.
// //          * (fetching kernels first time in the session is slower, later its cached).
// //          */
// //         kind: 'remote' | 'local' | 'localKernelSpec' | 'localPython';
// //         /**
// //          * Total time taken to list kernels.
// //          */
// //          duration: number;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         properties: {
// //             firstTime:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             },
// //             kind: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             }
// //         },
// //         measures: commonClassificationForDurationProperties
// //     };
// //     /**
// //      * Total number of Local kernel specifications.
// //      */
// //     [Telemetry.NumberOfLocalKernelSpecs]: TelemetryEventInfo<{
// //         /**
// //          * Number of kernel specs found on disc.
// //          */
// //         count: number;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         measures: {
// //             count: {
// //                 classification:'SystemMetaData',
// //                 isMeasurement:true,
// //                 purpose:'FeatureInsight'
// //             }
// //         }
// //     };
// //     /**
// //      * Total number of Remote kernel specifications.
// //      */
// //      [Telemetry.NumberOfRemoteKernelSpecs]: TelemetryEventInfo<{
// //         /**
// //          * Number of remote kernel specs.
// //          */
// //         count: number;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         measures: {
// //             count: {
// //                 classification:'SystemMetaData',
// //                 isMeasurement:true,
// //                 purpose:'FeatureInsight'
// //             }
// //         }
// //     };
// //     /**
// //      * Hash of the mime type of a cell output.
// //      * Used to detect the popularity of a mime type, that would help determine which mime types are most common.
// //      * E.g. if we see widget mimetype, then we know how many use ipywidgets and the like and helps us prioritize widget issues,
// //      * or prioritize rendering of widgets when opening an existing notebook or the like.
// //      */
// //     [Telemetry.HashedCellOutputMimeType]: TelemetryEventInfo<{
// //         /**
// //          * Hash of the cell output mimetype
// //          */
// //         hashedName: string;
// //         /**
// //          * Whether the mime type has the word 'text' in it.
// //          */
// //         hasText: boolean;
// //         /**
// //          * Whether the mime type has the word 'latex' in it.
// //          */
// //          hasLatex: boolean;
// //         /**
// //          * Whether the mime type has the word 'html' in it.
// //          */
// //         hasHtml: boolean;
// //         /**
// //          * Whether the mime type has the word 'svg' in it.
// //          */
// //         hasSvg: boolean;
// //         /**
// //          * Whether the mime type has the word 'xml' in it.
// //          */
// //         hasXml: boolean;
// //         /**
// //          * Whether the mime type has the word 'json' in it.
// //          */
// //         hasJson: boolean;
// //         /**
// //          * Whether the mime type has the word 'image' in it.
// //          */
// //         hasImage: boolean;
// //         /**
// //          * Whether the mime type has the word 'geo' in it.
// //          */
// //         hasGeo: boolean;
// //         /**
// //          * Whether the mime type has the word 'plotly' in it.
// //          */
// //         hasPlotly: boolean;
// //         /**
// //          * Whether the mime type has the word 'vega' in it.
// //          */
// //         hasVega: boolean;
// //         /**
// //          * Whether the mime type has the word 'widget' in it.
// //          */
// //         hasWidget: boolean;
// //         /**
// //          * Whether the mime type has the word 'jupyter' in it.
// //          */
// //         hasJupyter: boolean;
// //         /**
// //          * Whether the mime type has the word 'vnd' in it.
// //          */
// //         hasVnd: boolean;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         properties:{
// //             hasGeo: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hashedName: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasHtml: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasImage: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasJson: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasLatex: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             }
// //             ,hasJupyter: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasPlotly:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasSvg:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasText:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasVega:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasVnd:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasWidget:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             hasXml:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             }
// //         }
// //     };
// //     /**
// //      * Used to capture time taken to get environment variables for a python environment.
// //      * Also lets us know whether it worked or not.
// //      */
// //     [Telemetry.GetActivatedEnvironmentVariables]: TelemetryEventInfo<{
// //         /**
// //          * Type of the Python environment.
// //          */
// //         envType?: EnvironmentType;
// //         /**
// //          * Duplicate of `envType`, the property `envType` doesn't seem to be coming through.
// //          * If we can get `envType`, then we'll deprecate this new property.
// //          * Else we just deprecate & remote the old property.
// //          */
// //         pythonEnvType?: EnvironmentType;
// //         /**
// //          * Whether the env variables were fetched successfully or not.
// //          */
// //         failed: boolean;
// //         /**
// //          * Source where the env variables were fetched from.
// //          * If `python`, then env variables were fetched from Python extension.
// //          * If `jupyter`, then env variables were fetched from Jupyter extension.
// //          */
// //         source: 'python' | 'jupyter';
// //         /**
// //          * Reason for not being able to get the env variables.
// //          */
// //         reason?:
// //             | 'noActivationCommands'
// //             | 'unknownOS'
// //             | 'emptyVariables'
// //             | 'unhandledError'
// //             | 'emptyFromCondaRun'
// //             | 'emptyFromPython'
// //             | 'failedToGetActivatedEnvVariablesFromPython'
// //             | 'failedToGetCustomEnvVariables';
// //         /**
// //          * Time taken.
// //          */
// //         duration: number;
// //     }> = {
// //         owner: 'donjayamanne',
// //         feature:'N/A',
// //         properties:{
// //             envType: {
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             failed:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             },
// //             pythonEnvType:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             },
// //             reason:{
// //                 classification:'SystemMetaData',
// //                 purpose:'PerformanceAndHealth'
// //             },
// //             source:{
// //                 classification:'SystemMetaData',
// //                 purpose:'FeatureInsight'
// //             }
// //         },
// //         measures: commonClassificationForDurationProperties
// //     };
// //     [EventName.HASHED_PACKAGE_PERF]: TelemetryEventInfo<never | undefined> = {

// //     };
// //     [EventName.PYTHON_INTERPRETER_ACTIVATION_ENVIRONMENT_VARIABLES]: TelemetryEventInfo<{
// //         /**
// //          * Carries `true` if environment variables are present, `false` otherwise
// //          *
// //          * @type {boolean}
// //          */
// //         hasEnvVars?: boolean;
// //         /**
// //          * Carries `true` if fetching environment variables failed, `false` otherwise
// //          *
// //          * @type {boolean}
// //          */
// //         failed?: boolean;
// //         /**
// //          * Whether the environment was activated within a terminal or not.
// //          *
// //          * @type {boolean}
// //          */
// //         activatedInTerminal?: boolean;
// //         /**
// //          * Whether the environment was activated by the wrapper class.
// //          * If `true`, this telemetry is sent by the class that wraps the two activation providers   .
// //          *
// //          * @type {boolean}
// //          */
// //         activatedByWrapper?: boolean;
// //     }> = {};
// //     /**
// //      * Telemetry event sent with details when a user has requested to opt it or out of an experiment group
// //      */
// //     [EventName.JUPYTER_EXPERIMENTS_OPT_IN_OUT]: TelemetryEventInfo<{
// //         /**
// //          * Carries the name of the experiment user has been opted into manually
// //          */
// //         expNameOptedInto?: string;
// //         /**
// //          * Carries the name of the experiment user has been opted out of manually
// //          */
// //         expNameOptedOutOf?: string;
// //     }> = {};
// //     /**
// //      * Telemetry event sent when user opens the data viewer.
// //      */
// //     [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_REQUEST]: never | undefined;
// //     [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_ERROR]: never | undefined;
// //     [EventName.OPEN_DATAVIEWER_FROM_VARIABLE_WINDOW_SUCCESS]: never | undefined;
// //     /**
// //      * Telemetry event sent when user adds a cell below the current cell for IW.
// //      */
// //     [Telemetry.AddCellBelow]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.CodeLensAverageAcquisitionTime]: DurationMeasurement;
// //     [Telemetry.ConnectFailedJupyter]: TelemetryErrorProperties;
// //     [Telemetry.ConnectLocalJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ConnectRemoteJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Connecting to an existing Jupyter server, but connecting to localhost.
// //      */
// //     [Telemetry.ConnectRemoteJupyterViaLocalHost]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ConnectRemoteFailedJupyter]: TelemetryErrorProperties;
// //     /**
// //      * Jupyter server's certificate is not from a trusted authority.
// //      */
// //     [Telemetry.ConnectRemoteSelfCertFailedJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Jupyter server's certificate has expired.
// //      */
// //     [Telemetry.ConnectRemoteExpiredCertFailedJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.RegisterAndUseInterpreterAsKernel]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SwitchToExistingKernel]: TelemetryEventInfo<{ language: string }>= {};
// //     [Telemetry.SwitchToInterpreterAsKernel]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.CreateNewNotebook]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.DataScienceSettings]: JSONObject;
// //     /**
// //      * Telemetry event sent when user hits the `continue` button while debugging IW
// //      */
// //     [Telemetry.DebugContinue]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when user debugs the cell in the IW
// //      */
// //     [Telemetry.DebugCurrentCell]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when user hits the `step over` button while debugging IW
// //      */
// //     [Telemetry.DebugStepOver]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when user hits the `stop` button while debugging IW
// //      */
// //     [Telemetry.DebugStop]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when user debugs the file in the IW
// //      */
// //     [Telemetry.DebugFileInteractive]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.FailedToUpdateKernelSpec]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)
// //      */
// //     [Telemetry.DisableInteractiveShiftEnter]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Disables using Shift+Enter to run code in IW (this is in response to the prompt recommending users to enable this to use the IW)
// //      */
// //     [Telemetry.EnableInteractiveShiftEnter]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent to capture first time execution of a cell.
// //      * If `notebook = true`, this its telemetry for Jupyter notebooks, else applies to IW.
// //      */
// //     [Telemetry.ExecuteCellPerceivedCold]: TelemetryEventInfo<DurationMeasurement & ResourceTypeTelemetryProperty> = {};
// //     /**
// //      * Telemetry sent to capture subsequent execution of a cell.
// //      * If `notebook = true`, this its telemetry for native editor/notebooks.
// //      * (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)
// //      */
// //     [Telemetry.ExecuteCellPerceivedWarm]: TelemetryEventInfo<DurationMeasurement & ResourceTypeTelemetryProperty> = {};
// //     /**
// //      * Time take for jupyter server to start and be ready to run first user cell.
// //      * (Note: The property `notebook` only gets sent correctly in Jupyter version 2022.8.0 or later)
// //      */
// //     [Telemetry.PerceivedJupyterStartupNotebook]: TelemetryEventInfo<DurationMeasurement & ResourceSpecificTelemetryProperties> = {};
// //     /**
// //      * Time take for jupyter server to be busy from the time user first hit `run` cell until jupyter reports it is busy running a cell.
// //      */
// //     [Telemetry.StartExecuteNotebookCellPerceivedCold]: TelemetryEventInfo<DurationMeasurement & ResourceSpecificTelemetryProperties>= {};
// //     /**
// //      * User exports a .py file with cells as a Jupyter Notebook.
// //      */
// //     [Telemetry.ExportPythonFileInteractive]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * User exports a .py file with cells along with the outputs from the current IW as a Jupyter Notebook.
// //      */
// //     [Telemetry.ExportPythonFileAndOutputInteractive]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * User exports the IW or Notebook to a specific format.
// //      */
// //     [Telemetry.ClickedExportNotebookAsQuickPick]: TelemetryEventInfo<{ format: ExportFormat }> = {};
// //     /**
// //      * Called when user imports a Jupyter Notebook into a Python file.
// //      * Command is `Jupyter: Import Jupyter Notebook`
// //      * Basically user is exporting some jupyter notebook into a Python file or other.
// //      */
// //     [Telemetry.ExportNotebookAs]: TelemetryEventInfo<{ format: ExportFormat; cancelled?: boolean; successful?: boolean; opened?: boolean }> = {};
// //     /**
// //      * Called when user imports a Jupyter Notebook into a Python file.
// //      * Command is `Jupyter: Import Jupyter Notebook`
// //      * Basically user is exporting some jupyter notebook into a Python file.
// //      */
// //     [Telemetry.ImportNotebook]: TelemetryEventInfo<{ scope: 'command' | 'file' }>={};
// //     /**
// //      * Called when user exports a Jupyter Notebook or IW into a Python file, HTML, PDF, etc.
// //      * Command is `Jupyter: Export to Python Script` or `Jupyter: Export to HTML`
// //      * Basically user is exporting some jupyter notebook or IW into a Python file or other.
// //      */
// //     [Telemetry.ExportNotebookAsCommand]: TelemetryEventInfo<{ format: ExportFormat }>= {};
// //     /**
// //      * Export fails
// //      */
// //     [Telemetry.ExportNotebookAsFailed]: TelemetryEventInfo<{ format: ExportFormat }>= {};
// //     [Telemetry.GetPasswordAttempt]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.GetPasswordFailure]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.GetPasswordSuccess]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ImportNotebook]: TelemetryEventInfo<{ scope: 'command' | 'file' }>= {};
// //     /**
// //      * User interrupts a cell
// //      * Identical to `Telemetry.InterruptJupyterTime`
// //      */
// //     [Telemetry.Interrupt]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * User interrupts a cell
// //      * Identical to `Telemetry.Interrupt`
// //      */
// //     [Telemetry.InterruptJupyterTime]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Total number of cells executed. Telemetry Sent when VS Code is closed.
// //      */
// //     [Telemetry.NotebookRunCount]: TelemetryEventInfo<{ count: number }>= {};
// //     /**
// //      * Total number of Jupyter notebooks or IW opened. Telemetry Sent when VS Code is closed.
// //      */
// //     [Telemetry.NotebookOpenCount]: TelemetryEventInfo<{ count: number }>= {};
// //     [Telemetry.PandasNotInstalled]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.PandasTooOld]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.PandasOK]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.PandasInstallCanceled]: TelemetryEventInfo<{ version: string }>= {};
// //     [Telemetry.OpenNotebookAll]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.OpenPlotViewer]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Total time taken to restart a kernel.
// //      * Identical to `Telemetry.RestartKernel`
// //      */
// //     [Telemetry.RestartJupyterTime]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Total time taken to restart a kernel.
// //      * Identical to `Telemetry.RestartJupyterTime`
// //      */
// //     [Telemetry.RestartKernel]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when IW or Notebook is restarted.
// //      */
// //     [Telemetry.RestartKernelCommand]: ResourceSpecificTelemetryProperties;
// //     /**
// //      * Run all Cell Commands in Interactive Python
// //      */
// //     [Telemetry.RunAllCells]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run a Selection or Line in Interactive Python
// //      */
// //     [Telemetry.RunSelectionOrLine]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run the current Cell in Interactive Python
// //      */
// //     [Telemetry.RunCurrentCell]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run all the above cells in Interactive Python
// //      */
// //     [Telemetry.RunAllCellsAbove]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run current cell and all below in Interactive Python
// //      */
// //     [Telemetry.RunCellAndAllBelow]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run current cell and advance cursor in Interactive Python
// //      */
// //     [Telemetry.RunCurrentCellAndAdvance]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Run file in Interactive Python
// //      */
// //     [Telemetry.RunFileInteractive]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.RunToLine]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.RunFromLine]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Cell Edit Commands in Interactive Python
// //      */
// //     [Telemetry.InsertCellBelowPosition]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.InsertCellBelow]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.InsertCellAbove]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.DeleteCells]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelectCell]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelectCellContents]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ExtendSelectionByCellAbove]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ExtendSelectionByCellBelow]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.MoveCellsUp]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.MoveCellsDown]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ChangeCellToMarkdown]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ChangeCellToCode]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.GotoNextCellInFile]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.GotoPrevCellInFile]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.RunCurrentCellAndAddBelow]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelfCertsMessageClose]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelfCertsMessageEnabled]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelectJupyterURI]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Captures the telemetry when the Uri is manually entered by the user as part of the workflow when selecting a Kernel.
// //      */
// //     [Telemetry.EnterJupyterURI]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelectLocalJupyterKernel]: ResourceSpecificTelemetryProperties;
// //     [Telemetry.SelectRemoteJupyterKernel]: ResourceSpecificTelemetryProperties;
// //     [Telemetry.SessionIdleTimeout]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.JupyterNotInstalledErrorShown]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.UserInstalledJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.UserInstalledPandas]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.UserDidNotInstallJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.UserDidNotInstallPandas]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.PythonNotInstalled]: TelemetryEventInfo<{
// //         action:
// //             | 'displayed' // Message displayed.
// //             | 'dismissed' // user dismissed the message.
// //             | 'download'; // User chose click the download link.
// //     }> = {};
// //     [Telemetry.PythonExtensionNotInstalled]: TelemetryEventInfo<{
// //         action:
// //             | 'displayed' // Message displayed.
// //             | 'dismissed' // user dismissed the message.
// //             | 'download'; // User chose click the download link.
// //     }> = {};
// //     [Telemetry.PythonExtensionInstalledViaKernelPicker]: TelemetryEventInfo<{
// //         action:
// //             | 'success' // Correctly installed and hooked the API
// //             | 'failed'; // Failed to install correctly
// //     }> = {};
// //     [Telemetry.PythonModuleInstall]: TelemetryEventInfo<{
// //         moduleName: string;
// //         /**
// //          * Whether the module was already (once before) installed into the python environment or
// //          * whether this already exists (detected via `pip list`)
// //          */
// //         isModulePresent?: 'true' | undefined;
// //         action:
// //             | 'cancelled' // User cancelled the installation or closed the notebook or the like.
// //             | 'displayed' // Install prompt may have been displayed.
// //             | 'prompted' // Install prompt was displayed.
// //             | 'installed' // Installation disabled (this is what python extension returns).
// //             | 'ignored' // Installation disabled (this is what python extension returns).
// //             | 'disabled' // Installation disabled (this is what python extension returns).
// //             | 'failed' // Installation disabled (this is what python extension returns).
// //             | 'install' // User chose install from prompt.
// //             | 'donotinstall' // User chose not to install from prompt.
// //             | 'differentKernel' // User chose to select a different kernel.
// //             | 'error' // Some other error.
// //             | 'installedInJupyter' // The package was successfully installed in Jupyter whilst failed to install in Python ext.
// //             | 'failedToInstallInJupyter' // Failed to install the package in Jupyter as well as Python ext.
// //             | 'dismissed' // User chose to dismiss the prompt.
// //             | 'moreInfo'; // User requested more information on the module in question
// //         /**
// //          * Hash of the resource (notebook.uri or pythonfile.uri associated with this).
// //          * If we run the same notebook tomorrow, the hash will be the same.
// //          */
// //         resourceHash?: string;
// //         pythonEnvType?: EnvironmentType;
// //     } & ResourceTypeTelemetryProperty> = {};
// //     /**
// //      * This telemetry tracks the display of the Picker for Jupyter Remote servers.
// //      */
// //     [Telemetry.SetJupyterURIUIDisplayed]: TelemetryEventInfo<{
// //         /**
// //          * This telemetry tracks the source of this UI.
// //          * nonUser - Invoked internally by our code.
// //          * toolbar - Invoked by user from Native or Interactive window toolbar.
// //          * commandPalette - Invoked from command palette by the user.
// //          * nativeNotebookStatusBar - Invoked from Native notebook statusbar.
// //          * nativeNotebookToolbar - Invoked from Native notebook toolbar.
// //          */
// //         commandSource: SelectJupyterUriCommandSource;
// //     }> = {};
// //     [Telemetry.SetJupyterURIToLocal]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SetJupyterURIToUserSpecified]: TelemetryEventInfo<{
// //         azure: boolean;
// //     }> = {};
// //     [Telemetry.ShiftEnterBannerShown]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.StartShowDataViewer]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.ShowDataViewer]: TelemetryEventInfo<{ rows: number | undefined; columns: number | undefined };
// //     [Telemetry.FailedShowDataViewer]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Sent when the jupyter.refreshDataViewer command is invoked
// //      */
// //     [Telemetry.RefreshDataViewer]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.CreateNewInteractive]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.StartJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.StartJupyterProcess]: TelemetryEventInfo<DurationMeasurement> = {};
// //     /**
// //      * Telemetry event sent when jupyter has been found in interpreter but we cannot find kernelspec.
// //      *
// //      * @type {(never | undefined)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.JupyterInstalledButNotKernelSpecModule]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.VariableExplorerFetchTime]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.VariableExplorerVariableCount]: TelemetryEventInfo<{ variableCount: number }>= {};
// //     [Telemetry.WaitForIdleJupyter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.WebviewStartup]: TelemetryEventInfo<{ type: string }>= {};
// //     [Telemetry.RegisterInterpreterAsKernel]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent when user selects an interpreter to start jupyter server.
// //      *
// //      * @type {(never | undefined)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.SelectJupyterInterpreterCommand]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.SelectJupyterInterpreter]: TelemetryEventInfo<{
// //         /**
// //          * The result of the selection.
// //          * notSelected - No interpreter was selected.
// //          * selected - An interpreter was selected (and configured to have jupyter and notebook).
// //          * installationCancelled - Installation of jupyter and/or notebook was cancelled for an interpreter.
// //          *
// //          * @type {('notSelected' | 'selected' | 'installationCancelled')}
// //          */
// //         result?: 'notSelected' | 'selected' | 'installationCancelled';
// //     }> = {};
// //     [Telemetry.SelectJupyterInterpreterMessageDisplayed]: TelemetryEventInfo<undefined | never>= {};
// //     /**
// //      * Telemetry event sent when starting a session for a local connection failed.
// //      *
// //      * @type {(undefined | never)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.StartSessionFailedJupyter]: TelemetryEventInfo<undefined | never>= {};
// //     /**
// //      * Telemetry event sent to indicate the language used in a notebook
// //      *
// //      * @type { language: string }
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.NotebookLanguage]: TelemetryEventInfo<{
// //         /**
// //          * Language found in the notebook if a known language. Otherwise 'unknown'
// //          */
// //         language: string;
// //     }> = {};
// //     [Telemetry.KernelSpecLanguage]: TelemetryEventInfo<{
// //         /**
// //          * Language of the kernelSpec.
// //          */
// //         language: string;
// //         /**
// //          * Whether this is a local or remote kernel.
// //          */
// //         kind: 'local' | 'remote';
// //         /**
// //          * Whether shell is used to start the kernel. E.g. `"/bin/sh"` is used in the argv of the kernelSpec.
// //          * OCaml is one such kernel.
// //          */
// //         usesShell?: boolean;
// //     }> = {};
// //     /**
// //      * Telemetry event sent to indicate 'jupyter kernelspec' is not possible.
// //      *
// //      * @type {(undefined | never)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.KernelSpecNotFound]: TelemetryEventInfo<undefined | never>= {};
// //     /**
// //      * Total time taken to Launch a raw kernel.
// //      */
// //     [Telemetry.KernelLauncherPerf]: TelemetryEventInfo<
// //         | (DurationMeasurement & ResourceSpecificTelemetryProperties)
// //         | TelemetryErrorProperties>= {};
// //     /**
// //      * Total time taken to find a kernel on disc or on a remote machine.
// //      */
// //     [Telemetry.RankKernelsPerf]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Total time taken to list kernels for VS Code.
// //      */
// //     [Telemetry.KernelProviderPerf]: TelemetryEventInfo<undefined | never>= {};
// //     /**
// //      * Telemetry sent when we have attempted to find the preferred kernel.
// //      */
// //     [Telemetry.PreferredKernel]: TelemetryEventInfo<{
// //         result: 'found' | 'notfound' | 'failed'; // Whether a preferred kernel was found or not.
// //         language: string; // Language of the associated notebook or interactive window.
// //         hasActiveInterpreter?: boolean; // Whether we have an active interpreter or not.
// //     } & ResourceTypeTelemetryProperty> = {};
// //     /**
// //      * Telemetry event sent to when user customizes the jupyter command line
// //      * @type {(undefined | never)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.JupyterCommandLineNonDefault]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when a user runs the interactive window with a new file
// //      * @type {(undefined | never)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.NewFileForInteractiveWindow]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when a kernel picked crashes on startup
// //      * @type {(undefined | never)}
// //      * @memberof IEventNamePropertyMapping
// //      */
// //     [Telemetry.KernelInvalid]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when the ZMQ native binaries do not work.
// //      */
// //     [Telemetry.ZMQNotSupported]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when the ZMQ native binaries do work.
// //      */
// //     [Telemetry.ZMQSupported]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent with name of a Widget that is used.
// //      */
// //     [Telemetry.HashedIPyWidgetNameUsed]: TelemetryEventInfo<{
// //         /**
// //          * Hash of the widget
// //          */
// //         hashedName: string;
// //         /**
// //          * Where did we find the hashed name (CDN or user environment or remote jupyter).
// //          */
// //         source?: 'cdn' | 'local' | 'remote';
// //         /**
// //          * Whether we searched CDN or not.
// //          */
// //         cdnSearched: boolean;
// //     }> = {};
// //     /**
// //      * Telemetry event sent with name of a Widget found.
// //      */
// //     [Telemetry.HashedIPyWidgetNameDiscovered]: TelemetryEventInfo<{
// //         /**
// //          * Hash of the widget
// //          */
// //         hashedName: string;
// //         /**
// //          * Where did we find the hashed name (CDN or user environment or remote jupyter).
// //          */
// //         source?: 'cdn' | 'local' | 'remote';
// //     }> = {};
// //     /**
// //      * Total time taken to discover all IPyWidgets.
// //      * This is how long it takes to discover all widgets on disc (from python environment).
// //      */
// //     [Telemetry.DiscoverIPyWidgetNamesPerf]: TelemetryEventInfo<{
// //         /**
// //          * Whether we're looking for widgets on local Jupyter environment (local connections) or remote.
// //          */
// //         type: 'local' | 'remote';
// //     }> = {};
// //     /**
// //      * Something went wrong in looking for a widget.
// //      */
// //     [Telemetry.HashedIPyWidgetScriptDiscoveryError]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when an ipywidget module loads. Module name is hashed.
// //      */
// //     [Telemetry.IPyWidgetLoadSuccess]: TelemetryEventInfo<{ moduleHash: string; moduleVersion: string }>= {};
// //     /**
// //      * Telemetry event sent when an ipywidget module fails to load. Module name is hashed.
// //      */
// //     [Telemetry.IPyWidgetLoadFailure]: TelemetryEventInfo<{
// //         isOnline: boolean;
// //         moduleHash: string;
// //         moduleVersion: string;
// //         // Whether we timedout getting the source of the script (fetching script source in extension code).
// //         timedout: boolean;
// //     }> = {};
// //     /**
// //      * Telemetry event sent when an ipywidget version that is not supported is used & we have trapped this and warned the user abou it.
// //      */
// //     [Telemetry.IPyWidgetWidgetVersionNotSupportedLoadFailure]: TelemetryEventInfo<{ moduleHash: string; moduleVersion: string }>= {};
// //     /**
// //      * Telemetry sent when we prompt user to use a CDN for IPyWidget scripts.
// //      * This is always sent when we display a prompt.
// //      */
// //     [Telemetry.IPyWidgetPromptToUseCDN]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent when user does something with the prompt displayed to user about using CDN for IPyWidget scripts.
// //      */
// //     [Telemetry.IPyWidgetPromptToUseCDNSelection]: TelemetryEventInfo<{
// //         selection: 'ok' | 'cancel' | 'dismissed' | 'doNotShowAgain';
// //     }> = {};
// //     /**
// //      * Telemetry event sent to indicate the overhead of syncing the kernel with the UI.
// //      */
// //     [Telemetry.IPyWidgetOverhead]: TelemetryEventInfo<{
// //         totalOverheadInMs: number;
// //         numberOfMessagesWaitedOn: number;
// //         averageWaitTime: number;
// //         numberOfRegisteredHooks: number;
// //     }> = {};
// //     /**
// //      * Telemetry event sent when the widget render function fails (note, this may not be sufficient to capture all failures).
// //      */
// //     [Telemetry.IPyWidgetRenderFailure]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry event sent when the widget tries to send a kernel message but nothing was listening
// //      */
// //     [Telemetry.IPyWidgetUnhandledMessage]: TelemetryEventInfo<{
// //         msg_type: string;
// //     }> = {};

// //     // Telemetry send when we create a notebook for a raw kernel or jupyter
// //     [Telemetry.RawKernelCreatingNotebook]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * After starting a kernel we send a request to get the kernel info.
// //      * This tracks the total time taken to get the response back (or wether we timedout).
// //      * If we timeout and later we find successful comms for this session, then timeout is too low
// //      * or we need more attempts.
// //      */
// //     [Telemetry.RawKernelInfoResonse]: TelemetryEventInfo<{
// //         /**
// //          * Total number of attempts and sending a request and waiting for response.
// //          */
// //         attempts: number;
// //         /**
// //          * Whether we timedout while waiting for response for Kernel info request.
// //          */
// //         timedout: boolean;
// //     } & DurationMeasurement &
// //         ResourceSpecificTelemetryProperties> = {};
// //     [Telemetry.JupyterCreatingNotebook]:TelemetryEventInfo<
// //         | (DurationMeasurement & ResourceSpecificTelemetryProperties & TelemetryErrorProperties)
// //         | (DurationMeasurement & ResourceSpecificTelemetryProperties)>= {};

// //     // Raw kernel timing events
// //     [Telemetry.RawKernelSessionConnect]: TelemetryEventInfo<DurationMeasurement & ResourceSpecificTelemetryProperties>= {};
// //     [Telemetry.RawKernelStartRawSession]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.RawKernelProcessLaunch]: TelemetryEventInfo<never | undefined> = {};

// //     // Applies to everything (interactive+Notebooks & local+remote)
// //     /**
// //      * Executes a cell, applies to IW and Notebook.
// //      * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
// //      */
// //     [Telemetry.ExecuteCell]: TelemetryEventInfo<ResourceSpecificTelemetryProperties>= {};
// //     /**
// //      * Starts a kernel, applies to IW and Notebook.
// //      * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
// //      */
// //     [Telemetry.NotebookStart]:TelemetryEventInfo<
// //         | /** Sent if starting notebooks is a success. */ ResourceSpecificTelemetryProperties
// //         | /** Sent when we fail to start a notebook and have a failureCategory. */ ({
// //               failed: true;
// //               failureCategory: ErrorCategory | KernelFailureReason;
// //           } & ResourceSpecificTelemetryProperties)
// //         | /** Sent if there any any unhandled exceptions. */ (ResourceSpecificTelemetryProperties & TelemetryErrorProperties)>= {}; // If there any any unhandled exceptions.
// //     /**
// //      * Triggered when the kernel selection changes (note: This can also happen automatically when a notebook is opened).
// //      * WARNING: Due to changes in VS Code, this isn't necessarily a user action, hence difficult to tell if the user changed it or it changed automatically.
// //      */
// //     [Telemetry.SwitchKernel]: TelemetryEventInfo<ResourceSpecificTelemetryProperties>= {}; // If there are unhandled exceptions;
// //     /**
// //      * Similar to Telemetry.SwitchKernel, but doesn't contain as much information as Telemetry.SwitchKernel.
// //      * WARNING: Due to changes in VS Code, this isn't necessarily a user action, hence difficult to tell if the user changed it or it changed automatically.
// //      */
// //     [Telemetry.SwitchToExistingKernel]: TelemetryEventInfo<{ language: string }>= {};
// //     [Telemetry.SwitchToInterpreterAsKernel]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Total time taken to interrupt a kernel
// //      * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
// //      */
// //     [Telemetry.NotebookInterrupt]:TelemetryEventInfo<
// //         | ({
// //               /**
// //                * The result of the interrupt,
// //                */
// //               result: InterruptResult;
// //           } & DurationMeasurement &
// //               ResourceSpecificTelemetryProperties) // If successful (interrupted, timeout, restart).
// //         | (DurationMeasurement & ResourceSpecificTelemetryProperties & TelemetryErrorProperties)>= {}; // If there are unhandled exceptions;
// //     /**
// //      * Restarts the Kernel.
// //      * Check the `resourceType` to determine whether its a Jupyter Notebook or IW.
// //      */
// //     [Telemetry.NotebookRestart]:TelemetryEventInfo<
// //         | /** Sent to capture just the time taken to restart, see comments. */ ({
// //               /**
// //                * If true, this is the total time taken to restart the kernel (excluding times to stop current cells and the like).
// //                * Also in the case of raw kernels, we keep a separate process running, and when restarting we just switch to that process.
// //                * In such cases this value will be `undefined`. In the case of raw kernels this will be true only when starting a new kernel process from scratch.
// //                */
// //               startTimeOnly: true;
// //           } & DurationMeasurement &
// //               ResourceSpecificTelemetryProperties)
// //         | /** Sent when we fail to interrupt a kernel and have a failureCategory. */ ({
// //               failed: true;
// //               failureCategory: ErrorCategory;
// //           } & ResourceSpecificTelemetryProperties)
// //         | /** If there are unhandled exceptions. */ (ResourceSpecificTelemetryProperties & TelemetryErrorProperties)>= {}; // If there are unhandled exceptions;

// //     // Raw kernel single events
// //     [Telemetry.RawKernelSessionStart]:TelemetryEventInfo<
// //         | (DurationMeasurement & ResourceSpecificTelemetryProperties)
// //         | /** Sent when we fail to restart a kernel and have a failureCategory. */ ({
// //               failed: true;
// //               failureCategory: ErrorCategory;
// //           } & ResourceSpecificTelemetryProperties)
// //         | /** If there are unhandled exceptions. */ (ResourceSpecificTelemetryProperties & TelemetryErrorProperties)>= {}; // If there are unhandled exceptions;
// //     [Telemetry.RawKernelSessionStartSuccess]: TelemetryEventInfo<ResourceSpecificTelemetryProperties>= {};
// //     [Telemetry.RawKernelSessionStartException]: TelemetryEventInfo<ResourceSpecificTelemetryProperties>= {};
// //     [Telemetry.RawKernelSessionStartUserCancel]: TelemetryEventInfo<ResourceSpecificTelemetryProperties>= {};
// //     [Telemetry.RawKernelSessionStartNoIpykernel]: TelemetryEventInfo<{
// //         reason: KernelInterpreterDependencyResponse;
// //     } & TelemetryErrorProperties>= {};
// //     /**
// //      * This event is sent when the underlying kernelProcess for a
// //      * RawJupyterSession exits.
// //      */
// //     [Telemetry.RawKernelSessionKernelProcessExited]: TelemetryEventInfo<{
// //         /**
// //          * The kernel process's exit reason, based on the error
// //          * object's reason
// //          */
// //         exitReason: string | undefined;
// //         /**
// //          * The kernel process's exit code.
// //          */
// //         exitCode: number | undefined;
// //     } & ResourceSpecificTelemetryProperties>= {};
// //     /**
// //      * This event is sent when a RawJupyterSession's `shutdownSession`
// //      * method is called.
// //      */
// //     [Telemetry.RawKernelSessionShutdown]: TelemetryEventInfo<{
// //         /**
// //          * This indicates whether the session being shutdown
// //          * is a restart session.
// //          */
// //         isRequestToShutdownRestartSession: boolean | undefined;
// //         /**
// //          * This is the callstack at the time that the `shutdownSession`
// //          * method is called, intended for us to be ale to identify who
// //          * tried to shutdown the session.
// //          */
// //         stacktrace: string | undefined;
// //     } & ResourceSpecificTelemetryProperties;
// //     /**
// //      * This event is sent when a RawSession's `dispose` method is called.
// //      */
// //     [Telemetry.RawKernelSessionDisposed]: TelemetryEventInfo<{
// //         /**
// //          * This is the callstack at the time that the `dispose` method
// //          * is called, intended for us to be able to identify who called
// //          * `dispose` on the RawSession.
// //          */
// //         stacktrace: string | undefined;
// //     } & ResourceSpecificTelemetryProperties>= {};

// //     // Run by line events
// //     [Telemetry.RunByLineVariableHover]: TelemetryEventInfo<never | undefined> = {};

// //     // Misc
// //     [Telemetry.KernelCount]: TelemetryEventInfo<{
// //         kernelSpecCount: number; // Total number of kernel specs in the kernel list.
// //         kernelInterpreterCount: number; // Total number of interpreters in the kernel list.
// //         kernelLiveCount: number; // Total number of live kernels in the kernel list.
// //         /**
// //          * Total number of conda environments that share the same interpreter
// //          * This happens when we create conda envs without the `python` argument.
// //          * Such conda envs don't work today in the extension.
// //          * Hence users with such environments could hvae issues with starting kernels or packages not getting loaded correctly or at all.
// //          */
// //         condaEnvsSharingSameInterpreter: number;
// //     } & DurationMeasurement &
// //         ResourceSpecificTelemetryProperties>= {};

// //     [Telemetry.VSCNotebookCellTranslationFailed]: TelemetryEventInfo<{
// //         isErrorOutput: boolean; // Whether we're trying to translate an error output when we shuldn't be.
// //     }> = {};

// //     // When users connect to a remote kernel, we store the kernel id so we can re-connect to that
// //     // when user opens the same notebook. We only store the last 100.
// //     // Count is the number of entries saved in the list.
// //     [Telemetry.NumberOfSavedRemoteKernelIds]: TelemetryEventInfo<{ count: number }>= {};

// //     // Whether we've attempted to start a raw Python kernel without any interpreter information.
// //     // If we don't detect such telemetry in a few months, then we can remove this along with the temporary code associated with this telemetry.
// //     [Telemetry.AttemptedToLaunchRawKernelWithoutInterpreter]: TelemetryEventInfo<{
// //         /**
// //          * Indicates whether the python extension is installed.
// //          * If we send telemetry fro this & this is `true`, then we have a bug.
// //          * If its `false`, then we can ignore this telemetry.
// //          */
// //         pythonExtensionInstalled: boolean;
// //     } & ResourceSpecificTelemetryProperties>= {};
// //     // Capture telemetry re: how long returning a tooltip takes
// //     [Telemetry.InteractiveFileTooltipsPerf]: TelemetryEventInfo<{
// //         // Result is null if user signalled cancellation or if we timed out
// //         isResultNull: boolean;
// //     }> = {};

// //     // Native variable view events
// //     [Telemetry.NativeVariableViewLoaded]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.NativeVariableViewMadeVisible]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent when a command is executed.
// //      */
// //     [Telemetry.CommandExecuted]: TelemetryEventInfo<{
// //         /**
// //          * Name of the command executed.
// //          */
// //         command: string;
// //     }> = {};
// //     /**
// //      * Telemetry event sent whenever the user toggles the checkbox
// //      * controlling whether a slice is currently being applied to an
// //      * n-dimensional variable.
// //      */
// //     [Telemetry.DataViewerSliceEnablementStateChanged]: TelemetryEventInfo<{
// //         /**
// //          * This property is either 'checked' when the result of toggling
// //          * the checkbox is for slicing to be enabled, or 'unchecked'
// //          * when the result of toggling the checkbox is for slicing
// //          * to be disabled.
// //          */
// //         newState: CheckboxState;
// //     }> = {};
// //     /**
// //      * Telemetry event sent when a slice is first applied in a
// //      * data viewer instance to a sliceable Python variable.
// //      */
// //     [Telemetry.DataViewerDataDimensionality]: TelemetryEventInfo<{
// //         /**
// //          * This property represents the number of dimensions
// //          * on the target variable being sliced. This should
// //          * always be 2 at minimum.
// //          */
// //         numberOfDimensions: number;
// //     }> = {};
// //     /**
// //      * Telemetry event sent whenever the user applies a valid slice
// //      * to a sliceable Python variable in the data viewer.
// //      */
// //     [Telemetry.DataViewerSliceOperation]: TelemetryEventInfo<{
// //         /**
// //          * This property indicates whether the slice operation
// //          * was triggered using the dropdown or the textbox in
// //          * the slice control panel. `source` is one of `dropdown`,
// //          * `textbox`, or `checkbox`.
// //          */
// //         source: SliceOperationSource;
// //     }> = {};
// //     /*
// //      * Telemetry sent when we fail to create a Notebook Controller (an entry for the UI kernel list in Native Notebooks).
// //      */
// //     [Telemetry.FailedToCreateNotebookController]: TelemetryEventInfo<{
// //         /**
// //          * What kind of kernel spec did we fail to create.
// //          */
// //         kind:
// //             | 'startUsingPythonInterpreter'
// //             | 'startUsingDefaultKernel'
// //             | 'startUsingLocalKernelSpec'
// //             | 'startUsingRemoteKernelSpec'
// //             | 'connectToLiveRemoteKernel';
// //     } & Partial<TelemetryErrorProperties>>= {};
// //     /*
// //      * Telemetry sent when we recommend installing an extension.
// //      */
// //     [Telemetry.RecommendExtension]: TelemetryEventInfo<{
// //         /**
// //          * Extension we recommended the user to install.
// //          */
// //         extensionId: string;
// //         /**
// //          * `displayed` - If prompt was displayed
// //          * `dismissed` - If prompt was displayed & dismissed by the user
// //          * `ok` - If prompt was displayed & ok clicked by the user
// //          * `cancel` - If prompt was displayed & cancel clicked by the user
// //          * `doNotShowAgain` - If prompt was displayed & doNotShowAgain clicked by the user
// //          */
// //         action: 'displayed' | 'dismissed' | 'ok' | 'cancel' | 'doNotShowAgain';
// //     }> = {};
// //     [DebuggingTelemetry.clickedOnSetup]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.closedModal]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.ipykernel6Status]: TelemetryEventInfo<{
// //         status: 'installed' | 'notInstalled';
// //     }> = {};
// //     [DebuggingTelemetry.clickedRunByLine]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.successfullyStartedRunByLine]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent when we have managed to successfully start the Interactive Window debugger using the Jupyter protocol.
// //      */
// //     [DebuggingTelemetry.successfullyStartedIWJupyterDebugger]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.clickedRunAndDebugCell]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.successfullyStartedRunAndDebugCell]: TelemetryEventInfo<never | undefined> = {};
// //     [DebuggingTelemetry.endedSession]: TelemetryEventInfo<{
// //         reason: 'normally' | 'onKernelDisposed' | 'onAnInterrupt' | 'onARestart' | 'withKeybinding';
// //     }> = {};
// //     [Telemetry.JupyterKernelApiUsage]: TelemetryEventInfo<{
// //         extensionId: string;
// //         pemUsed: keyof IExportedKernelService;
// //     }> = {};
// //     [Telemetry.JupyterKernelApiAccess]: TelemetryEventInfo<{
// //         extensionId: string;
// //         allowed: 'yes' | 'no';
// //     }> = {};
// //     [Telemetry.KernelStartupCodeFailure]: TelemetryEventInfo<{
// //         ename: string;
// //         evalue: string;
// //     }> = {};
// //     [Telemetry.UserStartupCodeFailure]: TelemetryEventInfo<{
// //         ename: string;
// //         evalue: string;
// //     }> = {};
// //     [Telemetry.PythonVariableFetchingCodeFailure]: TelemetryEventInfo<{
// //         ename: string;
// //         evalue: string;
// //     }> = {};
// //     [Telemetry.InteractiveWindowDebugSetupCodeFailure]: TelemetryEventInfo<{
// //         ename: string;
// //         evalue: string;
// //     }> = {};
// //     [Telemetry.KernelCrash]: TelemetryEventInfo<ResourceSpecificTelemetryProperties> = {};
// //     [Telemetry.JupyterKernelHiddenViaFilter]: TelemetryEventInfo<never | undefined> = {};
// //     [Telemetry.JupyterKernelFilterUsed]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * Telemetry sent when we have loaded some controllers.
// //      */
// //     [Telemetry.FetchControllers]: TelemetryEventInfo<{
// //         /**
// //          * Whether this is from a cached result or not
// //          */
// //         cached: boolean;
// //         /**
// //          * Whether we've loaded local or remote controllers.
// //          */
// //         kind: 'local' | 'remote';
// //     }> = {};
// //     [Telemetry.RunTest]: TelemetryEventInfo<{
// //         testName: string;
// //         testResult: string;
// //         perfWarmup?: 'true';
// //         commitHash?: string;
// //         timedCheckpoints?: string;
// //     }> = {};
// //     [Telemetry.PreferredKernelExactMatch]: TelemetryEventInfo<{
// //         matchedReason: PreferredKernelExactMatchReason;
// //     }> = {};
// //     /**
// //      * Event sent when trying to talk to a remote server and the browser gives us a generic fetch error
// //      */
// //     [Telemetry.FetchError]: TelemetryEventInfo<{
// //         /**
// //          * What we were doing when the fetch error occurred
// //          */
// //         currentTask: 'connecting';
// //     }> = {};
// //     /*
// //      * Telemetry event sent to provide information on whether we have successfully identify the type of shell used.
// //      * This information is useful in determining how well we identify shells on users machines.
// //      * This impacts extraction of env variables from current shell.
// //      * So, the better this works, the better it is for the user.
// //      * failed - If true, indicates we have failed to identify the shell. Note this impacts impacts ability to activate environments in the terminal & code.
// //      * shellIdentificationSource - How was the shell identified. One of 'terminalName' | 'settings' | 'environment' | 'default'
// //      *                             If terminalName, then this means we identified the type of the shell based on the name of the terminal.
// //      *                             If settings, then this means we identified the type of the shell based on user settings in VS Code.
// //      *                             If environment, then this means we identified the type of the shell based on their environment (env variables, etc).
// //      *                                 I.e. their default OS Shell.
// //      *                             If default, then we reverted to OS defaults (cmd on windows, and bash on the rest).
// //      *                                 This is the worst case scenario.
// //      *                                 I.e. we could not identify the shell at all.
// //      * hasCustomShell - If undefined (not set), we didn't check.
// //      *                  If true, user has customzied their shell in VSC Settings.
// //      * hasShellInEnv - If undefined (not set), we didn't check.
// //      *                 If true, user has a shell in their environment.
// //      *                 If false, user does not have a shell in their environment.
// //      */
// //     [Telemetry.TerminalShellIdentification]: TelemetryEventInfo<{
// //         failed: boolean;
// //         reason: 'unknownShell' | undefined;
// //         terminalProvided: boolean;
// //         shellIdentificationSource: 'terminalName' | 'settings' | 'environment' | 'default' | 'vscode';
// //         hasCustomShell: undefined | boolean;
// //         hasShellInEnv: undefined | boolean;
// //     }> = {};

// //     /**
// //      * Telemetry sent only when we fail to extract the env variables for a shell.
// //      */
// //     [Telemetry.TerminalEnvVariableExtraction]: TelemetryEventInfo<{
// //         failed: true;
// //         reason:
// //             | 'unknownOs'
// //             | 'getWorkspace'
// //             | 'terminalCreation'
// //             | 'fileCreation'
// //             | 'commandExecution'
// //             | 'waitForCommand'
// //             | 'parseOutput'
// //             | undefined;
// //     }> = {};
// //     [Telemetry.JupyterInstalled]:TelemetryEventInfo<
// //         | {
// //               failed: true;
// //               reason: 'notInstalled';
// //               frontEnd: 'notebook' | 'lab';
// //           }
// //         | {
// //               /**
// //                * Jupyter is in current path of process owned by VS Code.
// //                * I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].
// //                */
// //               detection: 'process';
// //               frontEnd: 'notebook' | 'lab';
// //               /**
// //                * Version of the form 6.11, 4.8
// //                */
// //               frontEndVersion: number;
// //           }> = {};
// //     /**
// //      * Telemetry event sent once we've successfully or unsuccessfully parsed the extension.js file in the widget folder.
// //      * E.g. if we have a widget named ipyvolume, we attempt to parse the nbextensions/ipyvolume/extension.js file to get some info out of it.
// //      */
// //     [Telemetry.IPyWidgetExtensionJsInfo]:TelemetryEventInfo<
// //         | {
// //               /**
// //                * Hash of the widget folder name.
// //                */
// //               widgetFolderNameHash: string;
// //               /**
// //                * Total number of entries in the require config.
// //                */
// //               requireEntryPointCount: number;
// //               /**
// //                * Pattern (code style) used to register require.config enties.
// //                */
// //               patternUsedToRegisterRequireConfig: string;
// //           }
// //         | {
// //               /**
// //                * Hash of the widget folder name.
// //                */
// //               widgetFolderNameHash: string;
// //               failed: true;
// //               failure: 'couldNotLocateRequireConfigStart' | 'couldNotLocateRequireConfigEnd' | 'noRequireConfigEntries';
// //               /**
// //                * Pattern (code style) used to register require.config enties.
// //                */
// //               patternUsedToRegisterRequireConfig: string | undefined;
// //           }> = {};
// //     /**
// //      * Total time take to copy the nb extensions folder.
// //      */
// //     [Telemetry.IPyWidgetNbExtensionCopyTime]: TelemetryEventInfo<DurationMeasurement>= {};
// //     /**
// //      * Useful when we need an active kernel session in order to execute commands silently.
// //      * Used by the dataViewerDependencyService.
// //      */
// //     [Telemetry.NoActiveKernelSession]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * When the Data Viewer installer is using the Python interpreter.
// //      */
// //     [Telemetry.DataViewerUsingInterpreter]: TelemetryEventInfo<never | undefined> = {};
// //     /**
// //      * When the Data Viewer installer is using the Kernel.
// //      */
// //     [Telemetry.DataViewerUsingKernel]: TelemetryEventInfo<never | undefined> = {};
// // }

/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
/////////////////////////////////////////////////////
// export class MyNewClass {
// /**
//  * Telemetry event sent with perf measures related to activation and loading of extension.
//  */
// public [EventName.EXTENSION_LOAD]: XGDPREventDefinition<{
//     /**
//      * Number of workspace folders opened
//      */
//     workspaceFolderCount: number;
//     /**
//      * Time taken to activate the extension.
//      */
//     totalActivateTime: number;
//     /**
//      * Time taken to load the code.
//      */
//     codeLoadingTime: number;
//     /**
//      * Time when activation started.
//      */
//     startActivateTime: number;
//     /**
//      * Time when activation completed.
//      */
//     endActivateTime: number;
// }> = {
//     owner: 'donjayamanne',
//     effectiveVersion: 'unknown',
//     feature: 'N/A',
//     measures: {
//         codeLoadingTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true
//         },
//         totalActivateTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true
//         },
//         workspaceFolderCount: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true
//         },
//         endActivateTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true
//         },
//         startActivateTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth',
//             isMeasurement: true
//         }
//     }
// };
// /**
//  * Telemetry event sent when substituting Environment variables to calculate value of variables.
//  * E.g. user has a a .env file with tokens that need to be replaced with env variables.
//  * such as an env file having the variable `${HOME}`.
//  * Gives us an idea of whether users have variable references in their .env files or not.
//  */
// [EventName.ENVFILE_VARIABLE_SUBSTITUTION]: XGDPREventDefinition<never | undefined> = {
//     owner: 'donjayamanne',
//     feature: 'N/A'
// };
// /**
//  * Telemetry event sent when an environment file is detected in the workspace.
//  */
// [EventName.ENVFILE_WORKSPACE]: XGDPREventDefinition<{
//     /**
//      * If there's a custom path specified in the python.envFile workspace settings.
//      */
//     hasCustomEnvPath: boolean;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         hasCustomEnvPath: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         }
//     }
// };
// /**
//  * Telemetry event sent with hash of an imported python package.
//  * Used to detect the popularity of a package, that would help determine which packages
//  * need to be prioritized when resolving issues with intellisense or supporting similar issues related to a (known) specific package.
//  */
// [EventName.HASHED_PACKAGE_NAME]: XGDPREventDefinition<{
//     /**
//      * Hash of the package name
//      */
//     hashedNamev2: string;
// }> = {
//     owner: 'unknown',
//     feature: 'N/A',
//     properties: {
//         hashedNamev2: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight',
//             comment: 'Hash of the package name'
//         }
//     }
// };
// /**
//  * Telemetry sent for local Python Kernels.
//  * Tracking whether we have managed to launch the kernel that matches the interpreter.
//  * If match=false, then this means we have failed to launch the right kernel.
//  */
// [Telemetry.PythonKerneExecutableMatches]: XGDPREventDefinition<{
//     /**
//      * Whether we've managed to correctly identify the Python Environment.
//      */
//     match: 'true' | 'false';
//     /**
//      * Type of kernel connection, whether its local, remote or a python environment.
//      */
//     kernelConnectionType:
//         | 'startUsingLocalKernelSpec'
//         | 'startUsingPythonInterpreter'
//         | 'startUsingRemoteKernelSpec';
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     tags: ['KernelStartup'],
//     properties: {
//         kernelConnectionType: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         match: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         }
//     }
// };
// /**
//  * Time taken to list the Python interpreters.
//  */
// [Telemetry.InterpreterListingPerf]: XGDPREventDefinition<{
//     /**
//      * Whether this is the first time in the session.
//      * (fetching kernels first time in the session is slower, later its cached).
//      * This is a generic property supported for all telemetry (sent by decorators).
//      */
//     firstTime?: boolean;
//     /**
//      * Total time taken to list interpreters.
//      */
//     duration: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         firstTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         }
//     },
//     measures: commonClassificationForDurationProperties
// };
// [Telemetry.ActiveInterpreterListingPerf]: XGDPREventDefinition<{
//     /**
//      * Whether this is the first time in the session.
//      * (fetching kernels first time in the session is slower, later its cached).
//      * This is a generic property supported for all telemetry (sent by decorators).
//      */
//     firstTime?: boolean;
//     /**
//      * Total time taken to list interpreters.
//      */
//     duration: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         firstTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         }
//     },
//     measures: commonClassificationForDurationProperties
// };
// [Telemetry.KernelListingPerf]: XGDPREventDefinition<{
//     /**
//      * Whether this is the first time in the session.
//      * (fetching kernels first time in the session is slower, later its cached).
//      * This is a generic property supported for all telemetry (sent by decorators).
//      */
//     firstTime?: boolean;
//     /**
//      * Whether this telemetry is for listing of all kernels or just python or just non-python.
//      * (fetching kernels first time in the session is slower, later its cached).
//      */
//     kind: 'remote' | 'local' | 'localKernelSpec' | 'localPython';
//     /**
//      * Total time taken to list kernels.
//      */
//     duration: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         firstTime: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         },
//         kind: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         }
//     },
//     measures: commonClassificationForDurationProperties
// };
// /**
//  * Total number of Local kernel specifications.
//  */
// [Telemetry.NumberOfLocalKernelSpecs]: XGDPREventDefinition<{
//     /**
//      * Number of kernel specs found on disc.
//      */
//     count: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     measures: {
//         count: {
//             classification: 'SystemMetaData',
//             isMeasurement: true,
//             purpose: 'FeatureInsight'
//         }
//     }
// };
// /**
//  * Total number of Remote kernel specifications.
//  */
// [Telemetry.NumberOfRemoteKernelSpecs]: XGDPREventDefinition<{
//     /**
//      * Number of remote kernel specs.
//      */
//     count: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     measures: {
//         count: {
//             classification: 'SystemMetaData',
//             isMeasurement: true,
//             purpose: 'FeatureInsight'
//         }
//     }
// };
// /**
//  * Hash of the mime type of a cell output.
//  * Used to detect the popularity of a mime type, that would help determine which mime types are most common.
//  * E.g. if we see widget mimetype, then we know how many use ipywidgets and the like and helps us prioritize widget issues,
//  * or prioritize rendering of widgets when opening an existing notebook or the like.
//  */
// [Telemetry.HashedCellOutputMimeType]: XGDPREventDefinition<{
//     /**
//      * Hash of the cell output mimetype
//      */
//     hashedName: string;
//     /**
//      * Whether the mime type has the word 'text' in it.
//      */
//     hasText: boolean;
//     /**
//      * Whether the mime type has the word 'latex' in it.
//      */
//     hasLatex: boolean;
//     /**
//      * Whether the mime type has the word 'html' in it.
//      */
//     hasHtml: boolean;
//     /**
//      * Whether the mime type has the word 'svg' in it.
//      */
//     hasSvg: boolean;
//     /**
//      * Whether the mime type has the word 'xml' in it.
//      */
//     hasXml: boolean;
//     /**
//      * Whether the mime type has the word 'json' in it.
//      */
//     hasJson: boolean;
//     /**
//      * Whether the mime type has the word 'image' in it.
//      */
//     hasImage: boolean;
//     /**
//      * Whether the mime type has the word 'geo' in it.
//      */
//     hasGeo: boolean;
//     /**
//      * Whether the mime type has the word 'plotly' in it.
//      */
//     hasPlotly: boolean;
//     /**
//      * Whether the mime type has the word 'vega' in it.
//      */
//     hasVega: boolean;
//     /**
//      * Whether the mime type has the word 'widget' in it.
//      */
//     hasWidget: boolean;
//     /**
//      * Whether the mime type has the word 'jupyter' in it.
//      */
//     hasJupyter: boolean;
//     /**
//      * Whether the mime type has the word 'vnd' in it.
//      */
//     hasVnd: boolean;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         hasGeo: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hashedName: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasHtml: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasImage: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasJson: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasLatex: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasJupyter: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasPlotly: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasSvg: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasText: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasVega: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasVnd: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasWidget: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         hasXml: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         }
//     }
// };
// /**
//  * Used to capture time taken to get environment variables for a python environment.
//  * Also lets us know whether it worked or not.
//  */
// [Telemetry.GetActivatedEnvironmentVariables]: XGDPREventDefinition<{
//     /**
//      * Type of the Python environment.
//      */
//     envType?: EnvironmentType;
//     /**
//      * Duplicate of `envType`, the property `envType` doesn't seem to be coming through.
//      * If we can get `envType`, then we'll deprecate this new property.
//      * Else we just deprecate & remote the old property.
//      */
//     pythonEnvType?: EnvironmentType;
//     /**
//      * Whether the env variables were fetched successfully or not.
//      */
//     failed: boolean;
//     /**
//      * Source where the env variables were fetched from.
//      * If `python`, then env variables were fetched from Python extension.
//      * If `jupyter`, then env variables were fetched from Jupyter extension.
//      */
//     source: 'python' | 'jupyter';
//     /**
//      * Reason for not being able to get the env variables.
//      */
//     reason?:
//         | 'noActivationCommands'
//         | 'unknownOS'
//         | 'emptyVariables'
//         | 'unhandledError'
//         | 'emptyFromCondaRun'
//         | 'emptyFromPython'
//         | 'failedToGetActivatedEnvVariablesFromPython'
//         | 'failedToGetCustomEnvVariables';
//     /**
//      * Time taken.
//      */
//     duration: number;
// }> = {
//     owner: 'donjayamanne',
//     feature: 'N/A',
//     properties: {
//         envType: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         failed: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         },
//         pythonEnvType: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         },
//         reason: {
//             classification: 'SystemMetaData',
//             purpose: 'PerformanceAndHealth'
//         },
//         source: {
//             classification: 'SystemMetaData',
//             purpose: 'FeatureInsight'
//         }
//     },
//     measures: commonClassificationForDurationProperties
// };
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////
// export class MyNewClass {
//     public [Telemetry.JupyterInstalled]: TInfo<{
//         failed: true;
//         reason: 'notInstalled';
//         frontEnd: 'notebook' | 'lab';
//         counter: number;
//         // duration: number;
//     }> =
//         // | {
//         //       /**
//         //        * Jupyter is in current path of process owned by VS Code.
//         //        * I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].
//         //        */
//         //       detection: 'process';
//         //       frontEnd: 'notebook' | 'lab';
//         //       /**
//         //        * Version of the form 6.11, 4.8
//         //        */
//         //       frontEndVersion: number;
//         //   }
//         {} as any;
//     public [Telemetry.JupyterCreatingNotebook]: TInfo<{
//         duration: number;
//     }> = {} as any;
// }
// export class MyNewClass1234 {
//     public ['Telemetry.JupyterInstalled']: TInfo<{ one: string }> =
//         // | {
//         //       /**
//         //        * Jupyter is in current path of process owned by VS Code.
//         //        * I.e. jupyter can be found in the path as defined by the env variable process.env['PATH'].
//         //        */
//         //       detection: 'process';
//         //       frontEnd: 'notebook' | 'lab';
//         //       /**
//         //        * Version of the form 6.11, 4.8
//         //        */
//         //       frontEndVersion: number;
//         //   }
//         {} as any;
//     public ['Telemetry.JupyterCreatingNotebook']: TInfo<{ one: number }> = {} as any;
//     public ['Telemetry.Hello']: TInfo<{ abc: boolean }> = {} as any;
//     public ['Telemetry.Foo']: TInfo<{ xyz: number }> = {} as any;
// }
// type XGDPREventDefinition<P> = P extends never
//     ? IEventData
//     : keyof EventPropertiesData<ExcludeType<P, number>> extends never
//     ? keyof EventPropertiesData<PickType<P, number>> extends never
//         ? IEventData
//         : IEventData & { measures: EventPropertiesData<PickType<P, number>> }
//     : keyof EventPropertiesData<PickType<P, number>> extends never | undefined
//     ? IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> }
//     : IEventData & { properties: EventPropertiesData<ExcludeType<P, number>> } & {
//           measures: EventPropertiesData<PickType<P, number>>;
//       };
// type TInfo<P> = XGDPREventDefinition<P>;
// export function sendTelemetryEventX<P extends MyNewClass, E extends keyof P>(
//     eventName: E,
//     measures?: (P[E] extends TInfo<infer R> ? PickType<R, number> : undefined) | undefined,
//     properties?: (P[E] extends TInfo<infer R> ? ExcludeType<R, number> : undefined) | undefined,
//     ex?: Error,
//     sendOriginalEventWithErrors?: boolean
// ) {
//     console.log(eventName, measures, properties, ex, sendOriginalEventWithErrors);
// }
// // sendTelemetryEvent(Telemetry.GetActivatedEnvironmentVariables, {duration:1234}, '1234');
// sendTelemetryEventX(
//     Telemetry.JupyterInstalled,
//     { frontEndVersion: 234, counter: 33 },
//     { frontEnd: 'lab', failed: true, reason: 'notInstalled' }
// );

// // export type PickTypeNumberProps<T, Value> = {
// //     [P in keyof T as T[P] extends Value ? P : never]: T[P];
// // };
// // export type PickTypeNumberProps2<T, Value> = {
// //     [P in keyof T as T[P] extends TInfo<infer R> ? (keyof PickTypeNumberProps<R, Value> extends never ? never : P) : never]: T[P];
// // };

// // type X111 = PickTypeNumberProps2<MyNewClass1234, number>;

// // export function captureTelemetry<P extends MyNewClass1234, E extends keyof PickTypeNumberProps2<P, number>>  (
// //     eventName: E
// // ) {
// //     console.log(eventName);
// // }
// // captureTelemetry()
