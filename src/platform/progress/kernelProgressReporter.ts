// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { CancellationToken, Disposable, Progress, ProgressLocation, window } from 'vscode';
import { IExtensionSyncActivationService } from '../activation/types';
import { raceCancellation } from '../common/cancellation';
import { dispose } from '../common/utils/lifecycle';
import { IDisposable, IDisposableRegistry, Resource } from '../common/types';
import { createDeferred } from '../common/utils/async';
import { noop } from '../common/utils/misc';
import { traceError } from '../logging';
import { getComparisonKey } from '../vscode-path/resources';
import { getUserMessageForAction } from './messages';
import { ReportableAction } from './types';

type ProgressReporter = IDisposable & { show?: () => void };

/**
 * Used to report any progress related to Kernels, such as start, restart, interrupt, install, etc.
 */
@injectable()
export class KernelProgressReporter implements IExtensionSyncActivationService {
    private static disposables = new Set<IDisposable>();
    private static instance?: KernelProgressReporter;
    private kernelResourceProgressReporter = new Map<
        string,
        {
            title: string;
            pendingProgress: string[];
            /**
             * List of messages displayed in the progress UI.
             */
            progressList: string[];
            reporter?: Progress<{ message?: string; increment?: number }>;
        } & ProgressReporter
    >();
    constructor(@inject(IDisposableRegistry) disposables: IDisposableRegistry) {
        disposables.push(this);
        KernelProgressReporter.instance = this;
    }
    activate(): void {
        //
    }
    public dispose() {
        dispose(Array.from(KernelProgressReporter.disposables));
    }

    /**
     * Creates the progress reporter, however if one exists for the same resource, then it will use the existing one.
     * If `initiallyHidden` is true, then we still create the progress reporter, but its not displayed.
     * Later this progress indicator can be displayed.
     *
     * This is done so as to maintain a progress progress stack.
     * E.g. we start kernels automatically, then there's no progress, but we keep the object.
     * Then later we need to display progress indicator we display it and set a message,
     * After the code now completes, we can properly unwind the stack and when the top most
     * operation completes, the progress is disposed (i.e only the first caller can completely hide it)
     * For this to happen, the progress reporter must be created and hidden.
     */
    public static createProgressReporter(
        resource: Resource,
        title: string,
        initiallyHidden?: boolean
    ): ProgressReporter {
        if (!KernelProgressReporter.instance) {
            return new Disposable(noop);
        }

        // If we have a progress reporter, then use it.
        const key = resource ? getComparisonKey(resource) : '';
        if (KernelProgressReporter.instance.kernelResourceProgressReporter.has(key)) {
            return KernelProgressReporter.reportProgress(resource, title);
        } else {
            return KernelProgressReporter.createProgressReporterInternal(key, title, initiallyHidden);
        }
    }

    /**
     * Reports the progress reporter for the duration of a method.
     * If one exists for the same resource, then it will use the existing one, else it will just get queued as in `reportProgress`.
     * Behavior is identical to that of `reportProgress`
     */
    public static wrapAndReportProgress<T>(resource: Resource, title: string, cb: () => Promise<T>): Promise<T> {
        const key = resource ? getComparisonKey(resource) : '';
        if (!KernelProgressReporter.instance) {
            return cb();
        }
        const progress = KernelProgressReporter.reportProgressInternal(key, title);
        return cb().finally(() => progress?.dispose());
    }

    /**
     * Will not create a progress reporter, but only update the progress message.
     * If the progress reporter is not already created, then the progress messages will be tracked so they
     * can be displayed if a progress reporter is available before this progress completes.
     */
    public static reportProgress(resource: Resource, action: ReportableAction): IDisposable;
    public static reportProgress(resource: Resource, title: string): IDisposable;
    public static reportProgress(resource: Resource, option: string | ReportableAction): IDisposable {
        const progressMessage = getUserMessageForAction(option as unknown as ReportableAction) || option;
        const key = resource ? getComparisonKey(resource) : '';
        if (!progressMessage) {
            return new Disposable(() => noop);
        }

        return KernelProgressReporter.reportProgressInternal(key, progressMessage || '');
    }
    private static reportProgressInternal(key: string, title: string): IDisposable {
        if (!KernelProgressReporter.instance) {
            return new Disposable(noop);
        }
        let progressInfo = KernelProgressReporter.instance.kernelResourceProgressReporter.get(key);
        if (!progressInfo) {
            progressInfo = {
                title,
                pendingProgress: [],
                progressList: [],
                dispose: noop
            };
            KernelProgressReporter.instance!.kernelResourceProgressReporter.set(key, progressInfo);
        }

        if (progressInfo.reporter) {
            progressInfo.progressList.push(title);
            progressInfo.reporter.report({ message: title });
        } else {
            // if we've display this message in the past, then no need to display it again.
            // Due to the async nature of things, we may have already displayed it and we don't want to display it again.
            // Also displaying the same message again & again could confuse the user.
            // It could look as though the same operation is being performed multiple times (when in fact its possible we have caching in place).
            // Eg. we could be attempting to start a python process, which requires activation, thats cached, however calling it multiple times
            // could result in multiple messages being displayed.
            // Perhaps its the right thing to do and display the message multiple times, but for now, we'll just not display it.
            if (progressInfo.progressList.includes(title)) {
                return new Disposable(noop);
            }
            progressInfo.pendingProgress.push(title);
        }
        // Unwind the progress messages.
        return {
            dispose: () => {
                try {
                    if (!progressInfo) {
                        return;
                    }
                    // Find the list of progress messages just before this one.
                    const index = progressInfo.progressList.findIndex((value) => value === title);
                    if (index >= 0) {
                        progressInfo.progressList.splice(index);
                    }
                    // If we have previous messages, display the last item.
                    if (progressInfo.progressList.length > 0) {
                        const message = progressInfo.progressList[progressInfo.progressList.length - 1];
                        if (progressInfo.reporter) {
                            progressInfo.reporter.report({
                                message: message === progressInfo.title && progressInfo.reporter ? '' : message
                            });
                        }
                    } else {
                        // If we have no more messages, then remove the reporter.
                        KernelProgressReporter.instance!.kernelResourceProgressReporter.delete(key);
                        progressInfo.dispose();
                    }
                } catch (ex) {
                    traceError(`Failed to dispose Progress reporter for ${key}`, ex);
                }
            }
        };
    }

    private static createProgressReporterInternal(key: string, title: string, initiallyHidden?: boolean) {
        const deferred = createDeferred();
        const disposable = new Disposable(() => deferred.resolve());
        const existingInfo = KernelProgressReporter.instance!.kernelResourceProgressReporter.get(key) || {
            title,
            pendingProgress: [] as string[],
            progressList: [] as string[],
            tokenSources: [],
            dispose: () => {
                disposable.dispose();
            }
        };

        let shownOnce = false;
        const show = () => {
            if (shownOnce) {
                // Its already visible.
                return;
            }
            shownOnce = true;
            window
                .withProgress(
                    { location: ProgressLocation.Notification, title },
                    async (progress, token: CancellationToken) => {
                        const info = KernelProgressReporter.instance!.kernelResourceProgressReporter.get(key);
                        if (!info) {
                            return;
                        }
                        info.reporter = progress;
                        // If we have any messages, then report them.
                        while (info.pendingProgress.length > 0) {
                            const message = info.pendingProgress.shift();
                            if (message === title) {
                                info.progressList.push(message);
                            } else if (message !== title && message) {
                                info.progressList.push(message);
                                progress.report({ message });
                            }
                        }
                        await raceCancellation(token, deferred.promise);
                        if (KernelProgressReporter.instance!.kernelResourceProgressReporter.get(key) === info) {
                            KernelProgressReporter.instance!.kernelResourceProgressReporter.delete(key);
                        }
                        KernelProgressReporter.disposables.delete(disposable);
                    }
                )
                .then(noop, noop);
        };

        KernelProgressReporter.instance!.kernelResourceProgressReporter.set(key, {
            ...existingInfo,
            dispose: () => disposable.dispose(),
            show
        });
        KernelProgressReporter.disposables.add(disposable);
        existingInfo.pendingProgress.push(title);

        if (!initiallyHidden) {
            show();
        }

        return { dispose: () => disposable.dispose(), show };
    }
}
