// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, Event, EventEmitter } from 'vscode';

import { IDebugService } from '../../platform/common/application/types';
import { IDisposableRegistry } from '../../platform/common/types';
import { DebugLocationTracker } from './debugLocationTracker';
import { IDebugLocationTracker, IDebugLocationTrackerFactory } from './debuggingTypes';

// Hook up our IDebugLocationTracker to python debugging sessions
@injectable()
export class DebugLocationTrackerFactory
    implements IDebugLocationTracker, IDebugLocationTrackerFactory, DebugAdapterTrackerFactory
{
    private activeTrackers = new WeakMap<DebugSession, DebugLocationTracker>();
    private activeTrackersById = new Map<string, DebugLocationTracker>();
    private updatedEmitter: EventEmitter<void> = new EventEmitter<void>();

    constructor(
        @inject(IDebugService) debugService: IDebugService,
        @inject(IDisposableRegistry) private readonly disposableRegistry: IDisposableRegistry
    ) {
        disposableRegistry.push(debugService.registerDebugAdapterTrackerFactory('python', this));
    }

    public createDebugAdapterTracker(session: DebugSession): DebugAdapterTracker {
        const result = new DebugLocationTracker(session.id);
        this.activeTrackers.set(session, result);
        this.activeTrackersById.set(session.id, result);
        result.sessionEnded(
            () => {
                this.activeTrackers.delete(session);
                this.activeTrackersById.delete(session.id);
            },
            this,
            this.disposableRegistry
        );
        result.debugLocationUpdated(this.onLocationUpdated, this, this.disposableRegistry);
        this.onLocationUpdated();
        return result;
    }

    public get updated(): Event<void> {
        return this.updatedEmitter.event;
    }

    public getLocation(session: DebugSession) {
        const tracker = this.activeTrackers.get(session) || this.activeTrackersById.get(session.id);
        if (tracker) {
            return tracker.debugLocation;
        }
    }

    private onLocationUpdated() {
        this.updatedEmitter.fire();
    }
}
