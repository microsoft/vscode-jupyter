// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { KernelMessage } from '@jupyterlab/services';
import fetch from 'node-fetch';
import { IExtensionSyncActivationService } from '../platform/activation/types';
import { IDisposableRegistry } from '../platform/common/types';
import { IKernel, IKernelProvider } from './types';

@injectable()
export class KernelStartupMonitor implements IExtensionSyncActivationService {
    private startupTimes = new WeakMap<IKernel, number>();

    constructor(
        @inject(IKernelProvider) private kernelProvider: IKernelProvider,
        @inject(IDisposableRegistry) private disposableRegistry: IDisposableRegistry
    ) {}

    public activate(): void {
        this.kernelProvider.onKernelStatusChanged(this.onKernelStatusChanged, this, this.disposableRegistry);
    }

    private onKernelStatusChanged({ kernel, status }: { status: KernelMessage.Status; kernel: IKernel }) {
        if (status === 'starting') {
            this.startupTimes.set(kernel, Date.now());
        } else if (status === 'idle' || status === 'busy') {
            const startTime = this.startupTimes.get(kernel);
            if (startTime) {
                const duration = Date.now() - startTime;
                this.logMetric(kernel, duration, 'connect');
                this.startupTimes.delete(kernel);
            }
        } else if (status === 'dead' || status === 'autorestarting') {
            const startTime = this.startupTimes.get(kernel);
            if (startTime) {
                const duration = Date.now() - startTime;
                this.logMetric(kernel, duration, 'crash');
                this.startupTimes.delete(kernel);
            } else {
                // Kernel crashed after it was already running (not during startup)
                // Log it anyway with 0 duration to track runtime crashes
                this.logMetric(kernel, 0, 'crash');
            }
        }
    }

    private logMetric(kernel: IKernel, duration: number, eventType: 'connect' | 'crash') {
        let userName = 'unknown-user';
        try {
            // Attempt to extract username from connection metadata or kernel info
            // @ts-ignore
            if (kernel.kernelConnectionMetadata?.userName) {
                // @ts-ignore
                userName = kernel.kernelConnectionMetadata.userName;
            } else if ((kernel.kernelConnectionMetadata?.interpreter as any)?.sysPrefix) {
                // Try to guess from python environment path if available
                // @ts-ignore
                const parts = (kernel.kernelConnectionMetadata.interpreter as any).sysPrefix.split(path.sep);
                const userIndex = parts.indexOf('Users');
                if (userIndex !== -1 && userIndex + 1 < parts.length) {
                    userName = parts[userIndex + 1];
                }
            } else {
                // Fallback: try to regex it from the kernel id or generic metadata if possible,
                // otherwise default to 'user' or empty.
                // The log provided shows: http://notebook-server.prd.meesho.int/user/dharma.shashank@meesho.com/
                // We might be able to get it from the baseUrl if it's a remote kernel.
                if (
                    kernel.kernelConnectionMetadata?.kind === 'connectToLiveRemoteKernel' ||
                    kernel.kernelConnectionMetadata?.kind === 'startUsingRemoteKernelSpec'
                ) {
                    const baseUrl = kernel.kernelConnectionMetadata.baseUrl;
                    if (baseUrl) {
                        const match = baseUrl.match(/\/user\/([^/]+)\//);
                        if (match && match[1]) {
                            userName = match[1];
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[KernelStartupMonitor] Error extracting username:', e);
        }

        let kernelName = 'unknown-kernel';
        try {
            // @ts-ignore
            if (kernel.kernelConnectionMetadata?.kernelSpec?.display_name) {
                // @ts-ignore
                kernelName = kernel.kernelConnectionMetadata.kernelSpec.display_name;
            } else if ((kernel.kernelConnectionMetadata as any)?.driverDisplayName) {
                kernelName = (kernel.kernelConnectionMetadata as any).driverDisplayName;
            } else if ((kernel.kernelConnectionMetadata as any)?.display_name) {
                kernelName = (kernel.kernelConnectionMetadata as any).display_name;
            } else if (kernel.id) {
                kernelName = kernel.id;
            }
        } catch (e) {
            console.error('[KernelStartupMonitor] Error extracting kernel name:', e);
            kernelName = kernel.id || 'unknown-kernel';
        }

        let fileName = 'unknown-file';
        try {
            if (kernel.notebook?.uri) {
                fileName = path.basename(kernel.notebook.uri.fsPath);
            } else if (kernel.resourceUri) {
                fileName = path.basename(kernel.resourceUri.fsPath);
            }
        } catch (e) {
            console.error('[KernelStartupMonitor] Error extracting file name:', e);
        }

        // Skip logging if duration is 0 (runtime crashes without startup timing)
        if (duration === 0) {
            console.log('[KernelStartupMonitor] Skipping API call for runtime crash (duration = 0)');
            return;
        }

        const timestamp = new Date().toISOString();

        const data = {
            username: userName || 'unknown-user',
            kernel: kernelName || 'unknown-kernel',
            file: fileName || 'unknown-file',
            time: String(duration || 0),
            timestamp: timestamp,
            status: eventType || 'connect'
        };

        // Debug: Log what we're sending
        console.log('[KernelStartupMonitor] Sending data to API:', JSON.stringify(data, null, 2));
        console.log('[KernelStartupMonitor] Request body:', JSON.stringify(data));

        try {
            fetch('http://cursor-monitoring-service.prd.meesho.int/api/v1/kernel-logs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
                .then((response) => {
                    if (!response.ok) {
                        console.error('[KernelStartupMonitor] Failed to log kernel metric to API', response.statusText);
                        return response.text().then((text) => {
                            console.error('[KernelStartupMonitor] Response body:', text);
                        });
                    } else {
                        console.log('[KernelStartupMonitor] Successfully logged kernel metric');
                    }
                })
                .catch((ex) => {
                    console.error('[KernelStartupMonitor] Failed to send kernel metric to API', ex);
                });
        } catch (ex) {
            console.error('[KernelStartupMonitor] Failed to initiate kernel metric request', ex);
        }
    }
}
