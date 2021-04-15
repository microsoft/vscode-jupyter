// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../client/common/extensions';

import { nbformat } from '@jupyterlab/coreutils';
import * as fastDeepEqual from 'fast-deep-equal';
import * as monacoEditor from 'monaco-editor/esm/vs/editor/editor.api';
import * as React from 'react';
import { connect } from 'react-redux';

import { OSType } from '../../client/common/utils/platform';
import {
    Identifiers,
} from '../../client/datascience/constants';
import { CellState } from '../../client/datascience/types';
import { concatMultilineString } from '../common';
import { CellInput } from '../interactive-common/cellInput';
import { CellOutput } from '../interactive-common/cellOutput';
import { ExecutionCount } from '../interactive-common/executionCount';
import { CursorPos, ICellViewModel, IFont } from '../interactive-common/mainState';
import { getOSType } from '../react-common/constants';
import { IKeyboardEvent } from '../react-common/event';
import { Image, ImageName } from '../react-common/image';
import { ImageButton } from '../react-common/imageButton';
import { getLocString } from '../react-common/locReactSide';
import { IMonacoModelContentChangeEvent } from '../react-common/monacoHelpers';
import { actionCreators } from './redux/actions';

namespace CssConstants {
    export const CellOutputWrapper = 'cell-output-wrapper';
    export const CellOutputWrapperClass = `.${CellOutputWrapper}`;
    export const ImageButtonClass = '.image-button';
}

interface IScratchCellBaseProps {
    role?: string;
    cellVM: ICellViewModel;
    language: string;

    baseTheme: string;
    codeTheme: string;
    testMode?: boolean;
    maxTextSize?: number;
    enableScroll?: boolean;
    monacoTheme: string | undefined;
    lastCell: boolean;
    firstCell: boolean;
    font: IFont;
    allowUndo: boolean;
    editorOptions: monacoEditor.editor.IEditorOptions;
    themeMatplotlibPlots: boolean | undefined;
    focusPending: number;
    busy: boolean;
    useCustomEditorApi: boolean;
}

type IScratchCellProps = IScratchCellBaseProps & typeof actionCreators;

/* eslint-disable  */
export class ScratchCell extends React.Component<IScratchCellProps> {
    private inputRef: React.RefObject<CellInput> = React.createRef<CellInput>();
    private wrapperRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();

    constructor(prop: IScratchCellProps) {
        super(prop);
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

    // Public for testing
    public getUnknownMimeTypeFormatString() {
        return getLocString('DataScience.unknownMimeTypeFormat', 'Unknown Mime Type');
    }

    private giveFocus() {
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

    private isMarkdownCell = () => {
        return this.props.cellVM.cell.data.cell_type === 'markdown';
    };

    private isSelected = () => {
        return this.props.cellVM.selected;
    };

    private isFocused = () => {
        return this.props.cellVM.focused;
    };

    private renderNormalCell() {
        const cellOuterClass = this.props.cellVM.editable ? 'cell-outer-editable' : 'cell-outer';
        let cellWrapperClass = this.props.cellVM.editable ? 'cell-wrapper' : 'cell-wrapper cell-wrapper-noneditable';
        if (this.isSelected() && !this.isFocused()) {
            cellWrapperClass += ' cell-wrapper-selected';
        }
        if (this.isFocused()) {
            cellWrapperClass += ' cell-wrapper-focused';
        }

        // Content changes based on if a markdown cell or not.
        const content =
            this.isMarkdownCell() && !this.isShowingMarkdownEditor() ? (
                <div className="cell-result-container">
                    <div className="cell-row-container">
                        {this.renderCollapseBar(false)}
                        {this.renderOutput()}
                    </div>
                </div>
            ) : (
                <div className="cell-result-container">
                    <div className="cell-row-container">
                        {this.renderCollapseBar(true)}
                        {this.renderControls()}
                        {this.renderInput()}
                    </div>
                    <div className="cell-row-container">
                        {this.renderCollapseBar(false)}
                        {this.renderOutput()}
                    </div>
                </div>
            );

        return (
            <div
                className={cellWrapperClass}
                role={this.props.role}
                ref={this.wrapperRef}
                tabIndex={0}
                onKeyDown={this.onOuterKeyDown}
                onClick={this.onMouseClick}
                onDoubleClick={this.onMouseDoubleClick}
            >
                <div className={cellOuterClass}>
                    <div className="content-div">{content}</div>
                </div>
            </div>
        );
    }

    private allowClickPropagation(elem: HTMLElement): boolean {
        if (this.isMarkdownCell()) {
            return true;
        }
        if (!elem.closest(CssConstants.ImageButtonClass) && !elem.closest(CssConstants.CellOutputWrapperClass)) {
            return true;
        }
        return false;
    }

    private onMouseClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        if (ev.nativeEvent.target) {
            const elem = ev.nativeEvent.target as HTMLElement;
            if (this.allowClickPropagation(elem)) {
                // Not a click on an button in a toolbar or in output, select the cell.
                ev.stopPropagation();
                this.props.selectCell(this.cellId);
            }
        }
    };

    private onMouseDoubleClick = (ev: React.MouseEvent<HTMLDivElement>) => {
        const elem = ev.nativeEvent.target as HTMLElement;
        if (this.allowClickPropagation(elem)) {
            // When we receive double click, propagate upwards. Might change our state
            ev.stopPropagation();
            this.props.focusCell(this.cellId, CursorPos.Current);
        }
    };

    private shouldRenderCodeEditor = (): boolean => {
        return this.isCodeCell() && (this.props.cellVM.inputBlockShow || this.props.cellVM.editable);
    };

    private shouldRenderMarkdownEditor = (): boolean => {
        return (
            this.isMarkdownCell() &&
            (this.isShowingMarkdownEditor() || this.props.cellVM.cell.id === Identifiers.EditCellId)
        );
    };

    private isShowingMarkdownEditor = (): boolean => {
        return this.isMarkdownCell() && (this.props.cellVM.focused);
    };

    private shouldRenderInput(): boolean {
        return this.shouldRenderCodeEditor() || this.shouldRenderMarkdownEditor();
    }

    private hasOutput = () => {
        return (
            this.getCell().state === CellState.finished ||
            this.getCell().state === CellState.error ||
            this.getCell().state === CellState.executing
        );
    };

    private getCodeCell = () => {
        return this.props.cellVM.cell.data as nbformat.ICodeCell;
    };

    private shouldRenderOutput(): boolean {
        if (this.isCodeCell()) {
            const cell = this.getCodeCell();
            return (
                this.hasOutput() &&
                cell.outputs &&
                !this.props.cellVM.hideOutput &&
                Array.isArray(cell.outputs) &&
                cell.outputs.length !== 0
            );
        } else if (this.isMarkdownCell()) {
            return !this.isShowingMarkdownEditor();
        }
        return false;
    }

    // eslint-disable-next-line complexity,
    private keyDownInput = (cellId: string, e: IKeyboardEvent) => {
        if (!isCellNavigationKeyboardEvent(e)) {
            return;
        }
        const isFocusedWhenNotSuggesting = this.isFocused() && e.editorInfo && !e.editorInfo.isSuggesting;
        switch (e.code) {
            case 's':
                if ((e.ctrlKey && getOSType() !== OSType.OSX) || (e.metaKey && getOSType() === OSType.OSX)) {
                    // This is save, save our cells
                    this.props.save();
                }
                break;

            case 'Escape':
                if (isFocusedWhenNotSuggesting) {
                    this.escapeCell(e);
                }
                break;
            case 'y':
                if (!this.isFocused() && this.isSelected() && this.isMarkdownCell()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.changeCellType(cellId);
                }
                break;
            case 'm':
                if (!this.isFocused() && this.isSelected() && this.isCodeCell()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.changeCellType(cellId);
                }
                break;
            case 'l':
                if (!this.isFocused() && this.isSelected()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.toggleLineNumbers(cellId);
                }
                break;
            case 'o':
                if (!this.isFocused() && this.isSelected()) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.props.toggleOutput(cellId);
                }
                break;
            case 'NumpadEnter':
            case 'Enter':
                if (e.shiftKey) {
                    this.shiftEnterCell(e);
                } else if (e.ctrlKey) {
                    this.ctrlEnterCell(e);
                } else if (e.altKey) {
                    this.altEnterCell(e);
                } else {
                    this.enterCell(e);
                }
                break;
            case 'z':
            case 'Z':
                if (!this.isFocused() && !this.props.useCustomEditorApi) {
                    if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                        e.stopPropagation();
                    } else if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                        e.stopPropagation();
                    }
                }
                break;
            default:
                break;
        }
    };

    private get cellId(): string {
        return this.props.cellVM.cell.id;
    }

    private escapeCell = (e: IKeyboardEvent) => {
        // Unfocus the current cell by giving focus to the cell itself
        if (this.wrapperRef && this.wrapperRef.current && this.isFocused()) {
            e.stopPropagation();
            this.wrapperRef.current.focus();
        }
    };

    private enterCell = (e: IKeyboardEvent) => {
        // If focused, then ignore this call. It should go to the focused cell instead.
        if (!this.isFocused() && !e.editorInfo && this.wrapperRef && this.wrapperRef && this.isSelected()) {
            e.stopPropagation();
            e.preventDefault();
            this.props.focusCell(this.cellId, CursorPos.Current);
        }
    };

    private shiftEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Submit and move to the next.
        this.submitCell(this.getCurrentCode(), 'none');
    };

    private altEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Submit this cell
        this.submitCell(this.getCurrentCode(), 'none');
    };

    private ctrlEnterCell = (e: IKeyboardEvent) => {
        // Prevent shift enter from add an enter
        e.stopPropagation();
        e.preventDefault();

        // Escape the current cell if it is markdown to make it render
        if (this.isMarkdownCell()) {
            this.escapeCell(e);
        }

        // Submit this cell
        this.submitCell(this.getCurrentCode(), 'none');
    };

    private submitCell = (code: string, moveOp: 'add' | 'select' | 'none') => {
        this.props.executeCell(this.cellId, code, moveOp);
    };

    private getCurrentCode(): string {
        // Input may not be open at this time. If not, then use current cell contents.
        const contents = this.inputRef.current ? this.inputRef.current.getContents() : undefined;
        return contents || concatMultilineString(this.props.cellVM.cell.data.source);
    }

    private renderMiddleToolbar = () => {
        const cellId = this.props.cellVM.cell.id;
        const runCell = () => {
            this.submitCell(this.getCurrentCode(), 'none');
        };
        const switchTooltip =
            this.props.cellVM.cell.data.cell_type === 'code'
                ? getLocString('DataScience.switchToMarkdown', 'Change to markdown')
                : getLocString('DataScience.switchToCode', 'Change to code');
        const otherCellType = this.props.cellVM.cell.data.cell_type === 'code' ? 'markdown' : 'code';
        const otherCellImage = otherCellType === 'markdown' ? ImageName.SwitchToMarkdown : ImageName.SwitchToCode;
        const switchCellType = (event: React.MouseEvent<HTMLButtonElement>) => {
            // Prevent this mouse click from stealing focus so that we
            // can give focus to the cell input.
            event.stopPropagation();
            event.preventDefault();
            this.props.changeCellType(cellId);
        };
        const toolbarClassName = this.props.cellVM.cell.data.cell_type === 'code' ? '' : 'markdown-toolbar';
        return (
            <div className={toolbarClassName}>
                <div className="native-editor-celltoolbar-middle">
                    <ImageButton
                        baseTheme={this.props.baseTheme}
                        onClick={runCell}
                        tooltip={getLocString('DataScience.runCell', 'Run cell')}
                        hidden={this.isMarkdownCell()}
                        disabled={this.props.busy}
                    >
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={ImageName.Run} />
                    </ImageButton>
                    <ImageButton
                        baseTheme={this.props.baseTheme}
                        onMouseDown={switchCellType}
                        tooltip={switchTooltip}
                    >
                        <Image baseTheme={this.props.baseTheme} class="image-button-image" image={otherCellImage} />
                    </ImageButton>
                </div>
                <div className="native-editor-celltoolbar-divider" />
            </div>
        );
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

        return (
            <div className="controls-div">
                <ExecutionCount isBusy={busy} count={executionCount} visible={this.isCodeCell()} />
            </div>
        );
    };

    private renderInput = () => {
        if (this.shouldRenderInput()) {
            // Make sure the glyph margin is always there for native cells.
            // We need it for debugging.
            const options = {
                ...this.props.editorOptions,
                glyphMargin: true
            };
            return (
                <div className="cell-input-wrapper">
                    {this.renderMiddleToolbar()}
                    <CellInput
                        cellVM={this.props.cellVM}
                        editorOptions={options}
                        history={undefined}
                        codeTheme={this.props.codeTheme}
                        onCodeChange={this.onCodeChange}
                        onCodeCreated={this.onCodeCreated}
                        testMode={this.props.testMode ? true : false}
                        showWatermark={false}
                        ref={this.inputRef}
                        monacoTheme={this.props.monacoTheme}
                        openLink={this.openLink}
                        editorMeasureClassName={undefined}
                        focused={this.onCodeFocused}
                        unfocused={this.onCodeUnfocused}
                        keyDown={this.keyDownInput}
                        showLineNumbers={this.props.cellVM.showLineNumbers}
                        font={this.props.font}
                        disableUndoStack={this.props.useCustomEditorApi}
                        codeVersion={this.props.cellVM.codeVersion ? this.props.cellVM.codeVersion : 1}
                        focusPending={this.props.focusPending}
                        language={this.props.language}
                        isNotebookTrusted={true}
                    />
                </div>
            );
        }
        return null;
    };

    private onCodeFocused = () => {
        this.props.focusCell(this.cellId, CursorPos.Current);
    };

    private onCodeUnfocused = () => {
        // Make sure to save the code from the editor into the cell
        this.props.unfocusCell(this.cellId, this.getCurrentCode());
    };

    private onCodeChange = (e: IMonacoModelContentChangeEvent) => {
        this.props.editCell(this.getCell().id, e);
    };

    private onCodeCreated = (_code: string, _file: string, cellId: string, modelId: string) => {
        this.props.codeCreated(cellId, modelId);
    };

    private renderOutput = (): JSX.Element | null => {
        const themeMatplotlibPlots = this.props.themeMatplotlibPlots ? true : false;
        const toolbar = this.props.cellVM.cell.data.cell_type === 'markdown' ? this.renderMiddleToolbar() : null;
        if (this.shouldRenderOutput()) {
            return (
                <div className={CssConstants.CellOutputWrapper}>
                    {toolbar}
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
            );
        }
        return null;
    };

    private onOuterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // Handle keydown events for the entire cell when we don't have focus
        if (event.key !== 'Tab' && !this.isFocused() && !this.focusInOutput()) {
            this.keyDownInput(this.props.cellVM.cell.id, {
                code: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                target: event.target as HTMLDivElement,
                stopPropagation: () => event.stopPropagation(),
                preventDefault: () => event.preventDefault()
            });
        }
    };

    private focusInOutput(): boolean {
        const focusedElement = document.activeElement as HTMLElement;
        if (focusedElement) {
            return focusedElement.closest(CssConstants.CellOutputWrapperClass) !== null;
        }
        return false;
    }

    private renderCollapseBar = (input: boolean) => {
        let classes = 'collapse-bar';

        if (this.isSelected() && !this.isFocused()) {
            classes += ' collapse-bar-selected';
        }
        if (this.isFocused()) {
            classes += ' collapse-bar-focused';
        }

        if (input) {
            return <div className={classes}></div>;
        }

        if (this.props.cellVM.cell.data.cell_type === 'markdown') {
            classes += ' collapse-bar-markdown';
        } else if (
            Array.isArray(this.props.cellVM.cell.data.outputs) &&
            this.props.cellVM.cell.data.outputs.length !== 0
        ) {
            classes += ' collapse-bar-output';
        } else {
            return null;
        }

        return <div className={classes}></div>;
    };

    private openLink = (uri: monacoEditor.Uri) => {
        this.props.linkClick(uri.toString());
    };
}

// Main export, return a redux connected editor
export function getConnectedScratchCell() {
    return connect(null, actionCreators)(ScratchCell);
}

function isCellNavigationKeyboardEvent(e: IKeyboardEvent) {
    return (
        ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.shiftKey && !e.ctrlKey && !e.altKey) ||
        e.code === 'ArrowUp' ||
        e.code === 'k' ||
        e.code === 'ArrowDown' ||
        e.code === 'j' ||
        e.code === 'Escape'
    );
}
