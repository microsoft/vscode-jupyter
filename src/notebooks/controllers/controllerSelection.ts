// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

'use strict';
import { injectable, inject } from 'inversify';
import { Event, EventEmitter, NotebookDocument } from 'vscode';
import { IDisposable, IDisposableRegistry } from '../../platform/common/types';
import { traceInfoIfCI } from '../../platform/logging';
import { IControllerRegistration, IControllerSelection, IVSCodeNotebookController } from './types';

/**
 * This class keeps track of selected controllers
 */
@injectable()
export class ControllerSelection implements IControllerSelection {
    public get onControllerSelected(): Event<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }> {
        return this.selectedEmitter.event;
    }
    public get onControllerSelectionChanged(): Event<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }> {
        return this.selectionChangedEmitter.event;
    }
    private selectedEmitter = new EventEmitter<{ notebook: NotebookDocument; controller: IVSCodeNotebookController }>();
    private selectionChangedEmitter = new EventEmitter<{
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
        selected: boolean;
    }>();
    private selectedControllers = new Map<string, IVSCodeNotebookController>();
    constructor(
        @inject(IControllerRegistration) readonly registration: IControllerRegistration,
        @inject(IDisposableRegistry) readonly disposables: IDisposableRegistry
    ) {
        registration.onChanged(({ added }) => added.forEach((e) => this.onCreatedController(e)), this, disposables);
    }
    public getSelected(document: NotebookDocument): IVSCodeNotebookController | undefined {
        return this.selectedControllers.get(document.uri.toString());
    }
    private onCreatedController(controller: IVSCodeNotebookController) {
        // Hook up to if this NotebookController is selected or de-selected
        const controllerDisposables: IDisposable[] = [];
        controller.onNotebookControllerSelected(this.handleOnNotebookControllerSelected, this, controllerDisposables);
        controller.onNotebookControllerSelectionChanged(
            (e) => this.selectionChangedEmitter.fire({ ...e, controller }),
            this,
            controllerDisposables
        );
        controller.onDidDispose(
            () => {
                controllerDisposables.forEach((d) => d.dispose());
            },
            this,
            controllerDisposables
        );
    }
    private handleOnNotebookControllerSelected(event: {
        notebook: NotebookDocument;
        controller: IVSCodeNotebookController;
    }) {
        traceInfoIfCI(`Controller ${event.controller?.id} selected`);
        this.selectedControllers.set(event.notebook.uri.toString(), event.controller);
        // Now notify out that we have updated a notebooks controller
        this.selectedEmitter.fire(event);
    }
}
