// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../client/common/extensions';

import * as fastDeepEqual from 'fast-deep-equal';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';
import { connect } from 'react-redux';

import { Identifiers } from '../../client/datascience/constants';
import { CellState, IExternalWebviewCellButton, IJupyterExtraSettings } from '../../client/datascience/types';
import { CellInput } from '../interactive-common/cellInput';
import { CellOutput } from '../interactive-common/cellOutput';
import { ExecutionCount } from '../interactive-common/executionCount';
import { InputHistory } from '../interactive-common/inputHistory';
import { ICellViewModel, IFont } from '../interactive-common/mainState';
import { IKeyboardEvent } from '../react-common/event';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import { IMonacoModelContentChangeEvent } from '../react-common/monacoHelpers';
import { actionCreators } from './redux/actions';

interface IScratchCellBaseProps {
    role?: string;
    cellVM: ICellViewModel;
    language: string;
    baseTheme: string;
    codeTheme: string;
    testMode?: boolean;
    autoFocus: boolean;
    maxTextSize?: number;
    enableScroll?: boolean;
    showWatermark: boolean;
    monacoTheme: string | undefined;
    editorOptions?: monacoEditor.editor.IEditorOptions;
    editExecutionCount?: string;
    editorMeasureClassName?: string;
    font: IFont;
    settings: IJupyterExtraSettings;
    focusPending: number;
    externalButtons: IExternalWebviewCellButton[];
}

type IScratchCellProps = IScratchCellBaseProps & typeof actionCreators;

/* eslint-disable */
export class ScratchCell extends React.Component<IScratchCellProps> {
    private codeRef: React.RefObject<CellInput> = React.createRef<CellInput>();
    private wrapperRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private inputHistory: InputHistory | undefined;

    constructor(prop: IScratchCellProps) {
        super(prop);
        this.inputHistory = new InputHistory();
    }

    public render() {
        return this.renderNormalCell();
    }

    public componentDidUpdate(prevProps: IScratchCellProps) {
        if (this.props.cellVM.selected && !prevProps.cellVM.selected && !this.props.cellVM.focused) {
            this.giveFocus();
        }
    }

    public shouldComponentUpdate(nextProps: IScratchCellProps): boolean {
        return !fastDeepEqual(this.props, nextProps);
    }

    private giveFocus() {
        // Start out with ourselves
        if (this.wrapperRef && this.wrapperRef.current) {
            // Give focus to the cell if not already owning focus
            if (!this.wrapperRef.current.contains(document.activeElement)) {
                this.wrapperRef.current.focus();
            }

            // Scroll into view (since we have focus). However this function
            // is not supported on enzyme
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((this.wrapperRef.current as any).scrollIntoView) {
                this.wrapperRef.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
            }
        }
    }

    private getCell = () => {
        return this.props.cellVM.cell;
    };

    private isCodeCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'code';
    };

    private renderNormalCell() {
        const cellOuterClass = this.props.cellVM.editable ? 'cell-outer-editable' : 'cell-outer';
        const cellWrapperClass = this.props.cellVM.editable ? 'cell-wrapper' : 'cell-wrapper cell-wrapper-noneditable';
        const themeMatplotlibPlots = this.props.settings.themeMatplotlibPlots ? true : false;
        // Only render if we are allowed to.
            return (
                <div
                    className={cellWrapperClass}
                    role={this.props.role}
                    ref={this.wrapperRef}
                    tabIndex={0}
                    onKeyDown={this.onKeyDown}
                    onKeyUp={this.onKeyUp}
                    onClick={this.onMouseClick}
                >
                    <div className={cellOuterClass}>
                        {this.renderControls()}
                        <div className="content-div">
                            <div className="cell-result-container">
                                {this.renderInput()}
                                <div>
                                    <CellOutput
                                        cellVM={this.props.cellVM}
                                        baseTheme={this.props.baseTheme}
                                        expandImage={this.props.showPlot}
                                        maxTextSize={this.props.maxTextSize}
                                        enableScroll={this.props.enableScroll}
                                        themeMatplotlibPlots={themeMatplotlibPlots}
                                        widgetFailed={this.props.widgetFailed}
                                        openSettings={this.props.openSettings}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
    }

    private renderNormalToolbar = () => {
        const cell = this.getCell();
        const cellId = cell.id;
        const copyCode = () => this.props.copyCellCode(cellId);
        const hasNoSource = !cell || !cell.file || cell.file === Identifiers.EmptyFileName;

        return (
            <div className="cell-toolbar" key={0}>
                <ImageButton
                    baseTheme={this.props.baseTheme}
                    onClick={copyCode}
                    tooltip={getLocString('DataScience.copyBackToSourceButtonTooltip', 'Paste code into file')}
                    hidden={!hasNoSource}
                >
                    <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Copy} />
                </ImageButton>
            </div>
        );
    };

    private onMouseClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        // When we receive a click, propagate upwards. Might change our state
        ev.stopPropagation();
        this.props.clickCell(this.props.cellVM.cell.id);
    };

    private renderControls = () => {
        const busy =
            this.props.cellVM.cell.state === CellState.init || this.props.cellVM.cell.state === CellState.executing;
        const executionCount =
            this.props.cellVM &&
            this.props.cellVM.cell &&
            this.props.cellVM.cell.data &&
            this.props.cellVM.cell.data.execution_count
                ? this.props.cellVM.cell.data.execution_count.toString()
                : '-';
        const isEditOnlyCell = this.props.cellVM.cell.id === Identifiers.EditCellId;
        const toolbar = isEditOnlyCell ? null : this.renderNormalToolbar();

        return (
            <div className="controls-div">
                <ExecutionCount
                    isBusy={busy}
                    count={
                        isEditOnlyCell && this.props.editExecutionCount ? this.props.editExecutionCount : executionCount
                    }
                    visible={this.isCodeCell()}
                />
                {toolbar}
            </div>
        );
    };

    private renderInput = () => {
        if (this.isCodeCell()) {
            return (
                <CellInput
                    cellVM={this.props.cellVM}
                    editorOptions={this.props.editorOptions}
                    history={this.inputHistory}
                    codeTheme={this.props.codeTheme}
                    onCodeChange={this.onCodeChange}
                    onCodeCreated={this.onCodeCreated}
                    unfocused={this.onUnfocused}
                    testMode={this.props.testMode ? true : false}
                    showWatermark={this.props.showWatermark}
                    ref={this.codeRef}
                    monacoTheme={this.props.monacoTheme}
                    openLink={this.openLink}
                    editorMeasureClassName={this.props.editorMeasureClassName}
                    keyDown={this.isEditCell() ? this.onEditCellKeyDown : undefined}
                    showLineNumbers={this.props.cellVM.showLineNumbers}
                    font={this.props.font}
                    disableUndoStack={this.props.cellVM.cell.id !== Identifiers.EditCellId}
                    codeVersion={this.props.cellVM.codeVersion ? this.props.cellVM.codeVersion : 0}
                    focusPending={this.props.focusPending}
                    language={this.props.language}
                    isNotebookTrusted={true}
                />
            );
        }
        return null;
    };

    private isEditCell(): boolean {
        return this.getCell().id === Identifiers.EditCellId;
    }

    private onUnfocused = () => {
        this.props.unfocus(this.getCell().id);
    };

    private onCodeChange = (e: IMonacoModelContentChangeEvent) => {
        this.props.editCell(this.getCell().id, e);
    };

    private onCodeCreated = (_code: string, _file: string, cellId: string, modelId: string) => {
        this.props.codeCreated(cellId, modelId);
    };

    private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Handle keydown events for the entire cell
        if (this.getCell().id === Identifiers.EditCellId) {
            const e: IKeyboardEvent = {
                code: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                target: event.target as HTMLDivElement,
                stopPropagation: () => event.stopPropagation(),
                preventDefault: () => event.preventDefault()
            };
            this.onEditCellKeyDown(Identifiers.EditCellId, e);
        }
    };

    private onKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Handle keydown events for the entire cell
        if (this.getCell().id === Identifiers.EditCellId) {
            const e: IKeyboardEvent = {
                code: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                target: event.target as HTMLDivElement,
                stopPropagation: () => event.stopPropagation(),
                preventDefault: () => event.preventDefault()
            };
            this.onEditCellKeyUp(Identifiers.EditCellId, e);
        }
    };

    private onEditCellKeyDown = (_cellId: string, e: IKeyboardEvent) => {
        if (e.code === 'Enter' && e.shiftKey) {
            this.editCellSubmit(e);
        } else if (e.code === 'NumpadEnter' && e.shiftKey) {
            this.editCellSubmit(e);
        } else if (e.code === 'KeyU' && e.ctrlKey && e.editorInfo && !e.editorInfo.isSuggesting) {
            e.editorInfo.clear();
            e.stopPropagation();
            e.preventDefault();
        } else if (e.code === 'Escape' && !e.shiftKey && e.editorInfo && !e.editorInfo.isSuggesting) {
            e.editorInfo.clear();
            e.stopPropagation();
            e.preventDefault();
        }
    };

    private onEditCellKeyUp = (_cellId: string, e: IKeyboardEvent) => {
        // Special case. Escape + Shift only comes as a key up because shift comes as the
        // key down.
        if (e.code === 'Escape' && e.shiftKey) {
            this.editCellShiftEscape(e);
        }
    };

    private editCellSubmit(e: IKeyboardEvent) {
        if (e.editorInfo && e.editorInfo.contents) {
            // Prevent shift+enter from turning into a enter
            e.stopPropagation();
            e.preventDefault();

            // Remove empty lines off the end
            let endPos = e.editorInfo.contents.length - 1;
            while (endPos >= 0 && e.editorInfo.contents[endPos] === '\n') {
                endPos -= 1;
            }
            const content = e.editorInfo.contents.slice(0, endPos + 1);

            // Send to the input history too if necessary
            if (this.inputHistory) {
                this.inputHistory.add(content, e.editorInfo.isDirty);
            }

            // Clear our editor
            e.editorInfo.clear();

            // Send to jupyter
            this.props.submitInput(content, this.props.cellVM.cell.id);
        }
    }

    private findTabStop(direction: number, element: Element): HTMLElement | undefined {
        if (element) {
            const allFocusable = document.querySelectorAll('input, button, select, textarea, a[href]');
            if (allFocusable) {
                const tabable = Array.prototype.filter.call(allFocusable, (i: HTMLElement) => i.tabIndex >= 0);
                const self = tabable.indexOf(element);
                return direction >= 0 ? tabable[self + 1] || tabable[0] : tabable[self - 1] || tabable[0];
            }
        }
    }

    private editCellShiftEscape = (e: IKeyboardEvent) => {
        const focusedElement = document.activeElement;
        if (focusedElement !== null) {
            const nextTabStop = this.findTabStop(1, focusedElement);
            if (nextTabStop) {
                e.stopPropagation();
                e.preventDefault();
                nextTabStop.focus();
            }
        }
    };

    private openLink = (uri: monacoEditor.Uri) => {
        this.props.linkClick(uri.toString());
    };
}

// Main export, return a redux connected editor
export const ScratchCellComponent = connect(null, actionCreators)(ScratchCell);
