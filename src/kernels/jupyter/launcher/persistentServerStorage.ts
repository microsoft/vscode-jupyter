// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter, Memento, env } from 'vscode';
import { inject, injectable, named } from 'inversify';
import { IMemento, GLOBAL_MEMENTO, IDisposableRegistry } from '../../../platform/common/types';
import { logger } from '../../../platform/logging';
// Removed unused import noop
import { DisposableBase } from '../../../platform/common/utils/lifecycle';

/**
 * Information about a persistent Jupyter server launched by the extension.
 */
export interface IPersistentServerInfo {
    /**
     * Display name for the server.
     */
    displayName: string;
    /**
     * Server URL with token.
     */
    url: string;
    /**
     * Authentication token.
     */
    token: string;
    /**
     * Working directory for the server.
     */
    workingDirectory: string;
    /**
     * Process ID if the server was launched by this extension.
     */
    processId?: number;
    /**
     * Whether this server was launched by the extension.
     */
    launchedByExtension: boolean;
    /**
     * When the server was created/last updated.
     */
    time: number;
    /**
     * Unique identifier for this server instance.
     */
    serverId: string;
}

/**
 * Symbol for dependency injection of persistent server storage.
 */
export const IPersistentServerStorage = Symbol('IPersistentServerStorage');

/**
 * Interface for persistent server storage operations.
 */
export interface IPersistentServerStorage {
    /**
     * Event fired when servers are loaded from storage.
     */
    readonly onDidLoad: EventEmitter<void>['event'];
    
    /**
     * Event fired when a server is added.
     */
    readonly onDidAdd: EventEmitter<IPersistentServerInfo>['event'];
    
    /**
     * Event fired when a server is removed.
     */
    readonly onDidRemove: EventEmitter<string>['event'];
    
    /**
     * Event fired when servers change.
     */
    readonly onDidChange: EventEmitter<void>['event'];
    
    /**
     * Get all stored persistent servers.
     */
    readonly all: IPersistentServerInfo[];
    
    /**
     * Add or update a persistent server.
     */
    add(serverInfo: IPersistentServerInfo): Promise<void>;
    
    /**
     * Remove a persistent server.
     */
    remove(serverId: string): Promise<void>;
    
    /**
     * Update server information.
     */
    update(serverId: string, updates: Partial<IPersistentServerInfo>): Promise<void>;
    
    /**
     * Clear all persistent servers.
     */
    clear(): Promise<void>;
    
    /**
     * Get a specific server by ID.
     */
    get(serverId: string): IPersistentServerInfo | undefined;
}

/**
 * Storage implementation for persistent Jupyter servers.
 */
@injectable()
export class PersistentServerStorage extends DisposableBase implements IPersistentServerStorage {
    private _onDidLoad = this._register(new EventEmitter<void>());
    public get onDidLoad() {
        return this._onDidLoad.event;
    }
    
    private _onDidAdd = this._register(new EventEmitter<IPersistentServerInfo>());
    public get onDidAdd() {
        return this._onDidAdd.event;
    }
    
    private _onDidRemove = this._register(new EventEmitter<string>());
    public get onDidRemove() {
        return this._onDidRemove.event;
    }
    
    private _onDidChange = this._register(new EventEmitter<void>());
    public get onDidChange() {
        return this._onDidChange.event;
    }
    
    private readonly mementoKey: string;
    private _servers: IPersistentServerInfo[] = [];
    private loaded = false;
    
    public get all(): IPersistentServerInfo[] {
        this.ensureLoaded();
        return [...this._servers];
    }
    
    constructor(
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalMemento: Memento,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry
    ) {
        super();
        disposables.push(this);
        
        // Ensure the key is unique per machine
        this.mementoKey = `MEMENTO_KEY_FOR_PERSISTENT_JUPYTER_SERVERS_${env.machineId}`;
    }
    
    private ensureLoaded(): void {
        if (this.loaded) {
            return;
        }
        
        this.loaded = true;
        const stored = this.globalMemento.get<IPersistentServerInfo[]>(this.mementoKey, []);
        this._servers = stored.filter(server => {
            // Validate stored data
            return server.serverId && server.url && server.workingDirectory;
        });
        
        this._onDidLoad.fire();
    }
    
    public async add(serverInfo: IPersistentServerInfo): Promise<void> {
        this.ensureLoaded();
        
        logger.ci(`Adding persistent server: ${serverInfo.serverId}`);
        
        // Remove existing server with same ID
        this._servers = this._servers.filter(s => s.serverId !== serverInfo.serverId);
        
        // Add new server at the beginning (most recent first)
        this._servers.unshift({
            ...serverInfo,
            time: Date.now()
        });
        
        await this.save();
        this._onDidAdd.fire(serverInfo);
        this._onDidChange.fire();
    }
    
    public async remove(serverId: string): Promise<void> {
        this.ensureLoaded();
        
        const initialLength = this._servers.length;
        this._servers = this._servers.filter(s => s.serverId !== serverId);
        
        if (this._servers.length !== initialLength) {
            logger.ci(`Removing persistent server: ${serverId}`);
            await this.save();
            this._onDidRemove.fire(serverId);
            this._onDidChange.fire();
        }
    }
    
    public async update(serverId: string, updates: Partial<IPersistentServerInfo>): Promise<void> {
        this.ensureLoaded();
        
        const server = this._servers.find(s => s.serverId === serverId);
        if (server) {
            Object.assign(server, updates, { time: Date.now() });
            await this.save();
            this._onDidChange.fire();
        }
    }
    
    public async clear(): Promise<void> {
        this.ensureLoaded();
        
        if (this._servers.length > 0) {
            const removedIds = this._servers.map(s => s.serverId);
            this._servers = [];
            await this.save();
            
            removedIds.forEach(id => this._onDidRemove.fire(id));
            this._onDidChange.fire();
        }
    }
    
    public get(serverId: string): IPersistentServerInfo | undefined {
        this.ensureLoaded();
        return this._servers.find(s => s.serverId === serverId);
    }
    
    private async save(): Promise<void> {
        try {
            await this.globalMemento.update(this.mementoKey, this._servers);
        } catch (error) {
            logger.error('Failed to save persistent server storage', error);
            throw error;
        }
    }
}