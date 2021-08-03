// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as vscode from 'vscode';

import { IAsyncDisposable } from '../../../common/types';
import { ClassType } from '../../../ioc/types';

export interface IRoleBasedObject extends IAsyncDisposable {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class RoleBasedFactory<T extends IRoleBasedObject, CtorType extends ClassType<T>> {
    private ctorArgs: ConstructorParameters<CtorType>[];
    private createPromise: Promise<T> | undefined;
    private sessionChangedEmitter = new vscode.EventEmitter<void>();
    constructor(private hostCtor: CtorType, ...args: ConstructorParameters<CtorType>) {
        this.ctorArgs = args;
        this.createPromise = this.createBasedOnRole(); // We need to start creation immediately or one side may call before we init.
    }

    public get sessionChanged(): vscode.Event<void> {
        return this.sessionChangedEmitter.event;
    }

    public get(): Promise<T> {
        // Make sure only one create happens at a time
        if (this.createPromise) {
            return this.createPromise;
        }
        this.createPromise = this.createBasedOnRole();
        return this.createPromise;
    }

    private async createBasedOnRole(): Promise<T> {
        const ctor: CtorType = this.hostCtor;
        const obj = new ctor(...this.ctorArgs);

        // Rewrite the object's dispose so we can get rid of our own state.
        const oldDispose = obj.dispose.bind(obj);
        obj.dispose = () => {
            // Make sure we don't destroy the create promise. Otherwise
            // dispose will end up causing the creation code to run again.
            return oldDispose();
        };

        return obj;
    }
}
