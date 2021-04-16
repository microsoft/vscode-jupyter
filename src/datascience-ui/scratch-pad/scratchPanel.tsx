// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import * as React from 'react';
import { connect } from 'react-redux';
import { buildSettingsCss } from '../interactive-common/buildSettingsCss';
import { ContentPanel, IContentPanelProps } from '../interactive-common/contentPanel';
import { handleLinkClick } from '../interactive-common/handlers';
import {
    ICellViewModel,
    IMainState
} from '../interactive-common/mainState';
import { IStore } from '../interactive-common/redux/store';
import { ErrorBoundary } from '../react-common/errorBoundary';
import { Progress } from '../react-common/progress';
import { getConnectedScratchCell } from './scratchCell';
import './scratchPanel.less';
import { actionCreators } from './redux/actions';
import { ToolbarComponent } from './toolbar';
import { getLocString } from '../react-common/locReactSide';

type IScratchPanelProps = IMainState & typeof actionCreators;

function mapStateToProps(state: IStore): IMainState {
    return { ...state.main };
}

const ConnectedScratchCell = getConnectedScratchCell();

export class ScratchPanel extends React.Component<IScratchPanelProps> {
    private renderCount: number = 0;
    private waitingForLoadRender = true;
    private mainPanelToolbarRef: React.RefObject<HTMLDivElement> = React.createRef();

    public componentDidMount() {
        this.props.editorLoaded();
        window.addEventListener('keydown', this.mainKeyDown);
        window.addEventListener('resize', () => this.forceUpdate(), true);
        document.addEventListener('click', this.linkClick, true);
    }

    public componentWillUnmount() {
        window.removeEventListener('keydown', this.mainKeyDown);
        window.removeEventListener('resize', () => this.forceUpdate());
        document.removeEventListener('click', this.linkClick);
        this.props.editorUnmounted();
    }

    public componentDidUpdate(prevProps: IMainState) {
        if (this.props.loaded && !prevProps.loaded && this.waitingForLoadRender) {
            this.waitingForLoadRender = false;
            // After this render is complete (see this SO)
            // https://stackoverflow.com/questions/26556436/react-after-render-code,
            // indicate we are done loading. We want to wait for the render
            // so we get accurate timing on first launch.
            setTimeout(() => {
                window.requestAnimationFrame(() => {
                    this.props.loadedAllCells();
                });
            });
        }
    }

    public render() {
        const dynamicFont: React.CSSProperties = {
            fontSize: this.props.font.size,
            fontFamily: this.props.font.family
        };

        // If in test mode, update our count. Use this to determine how many renders a normal update takes.
        if (this.props.testMode) {
            this.renderCount = this.renderCount + 1;
        }

        // If we're hiding the UI, just render the empty string
        if (this.props.hideUI) {
            return (
                <div id="main-panel" className="native-editor-celltoolbar-middle">
                    <div className="styleSetter">
                        <style>{`${this.props.rootCss ? this.props.rootCss : ''}
                        ${buildSettingsCss(this.props.settings)}`}</style>
                    </div>
                    <label className="inputLabel">
                                {getLocString('DataScience.scratchPadEmpty', 'Select a notebook to get a scratch pad.')}
                    </label>
                </div>
            )
        }
        // Update the state controller with our new state
        const progressBar = (this.props.busy || !this.props.loaded) && !this.props.testMode ? <Progress /> : undefined;
        return (
            <div id="main-panel" role="Main" style={dynamicFont}>
                <div className="styleSetter">
                    <style>{`${this.props.rootCss ? this.props.rootCss : ''}
${buildSettingsCss(this.props.settings)}`}</style>
                </div>
                <header ref={this.mainPanelToolbarRef} id="main-panel-toolbar">
                    {this.renderToolbarPanel()}
                    {progressBar}
                </header>
                <main id="main-panel-content">
                    {this.renderContentPanel(this.props.baseTheme)}
                </main>
            </div>
        );
    }

    private renderToolbarPanel() {
        return <ToolbarComponent />;
    }

    private renderContentPanel(baseTheme: string) {
        // Skip if the tokenizer isn't finished yet. It needs
        // to finish loading so our code editors work.
        if (!this.props.monacoReady && !this.props.testMode) {
            console.log('Not rendering content because of monaco ready')

            return null;
        }

        // Otherwise render our cells.
        const contentProps = this.getContentProps(baseTheme);
        return <ContentPanel {...contentProps} />;
    }

    private getContentProps = (baseTheme: string): IContentPanelProps => {
        return {
            baseTheme: baseTheme,
            cellVMs: this.props.cellVMs,
            testMode: this.props.testMode,
            codeTheme: this.props.codeTheme,
            submittedText: this.props.submittedText,
            skipNextScroll: this.props.skipNextScroll ? true : false,
            editable: true,
            renderCell: this.renderCell,
            scrollToBottom: this.scrollDiv,
            scrollBeyondLastLine: false
        };
    };

    // eslint-disable-next-line complexity
    private mainKeyDown = (event: KeyboardEvent) => {
        // Handler for key down presses in the main panel
        switch (event.key) {
            default:
                break;
        }
    };


    private renderCell = (cellVM: ICellViewModel): JSX.Element | null => {
        // Don't render until we have settings
        if (!this.props.settings || !this.props.editorOptions) {
            console.log('Not rendering cell because of settings')
            return null;
        }
        const maxOutputSize = this.props.settings.maxOutputSize;
        const outputSizeLimit = 10000;
        const maxTextSize =
            maxOutputSize && maxOutputSize < outputSizeLimit && maxOutputSize > 0
                ? maxOutputSize
                : this.props.settings.enableScrollingForCellOutputs
                ? 400
                : undefined;

        return (
            <div key={cellVM.cell.id} id={cellVM.cell.id}>
                <ErrorBoundary>
                    <ConnectedScratchCell
                        role="listitem"
                        maxTextSize={maxTextSize}
                        enableScroll={this.props.settings.enableScrollingForCellOutputs}
                        testMode={this.props.testMode}
                        cellVM={cellVM}
                        baseTheme={this.props.baseTheme}
                        codeTheme={this.props.codeTheme}
                        monacoTheme={this.props.monacoTheme}
                        lastCell={true}
                        firstCell={true}
                        font={this.props.font}
                        allowUndo={this.props.undoStack.length > 0}
                        editorOptions={this.props.editorOptions}
                        themeMatplotlibPlots={this.props.settings.themeMatplotlibPlots}
                        // Focus pending does not apply to native editor.
                        focusPending={0}
                        busy={this.props.busy}
                        useCustomEditorApi={this.props.settings?.extraSettings.useCustomEditorApi}
                        language={this.props.kernel.language}
                    />
                </ErrorBoundary>
            </div>
        );
    };

    private scrollDiv = (_div: HTMLDivElement) => {
        // Doing nothing for now. This should be implemented once redux refactor is done.
    };

    private linkClick = (ev: MouseEvent) => {
        handleLinkClick(ev, this.props.linkClick);
    };
}

// Main export, return a redux connected editor
export function getConnectedScratchPanel() {
    return connect(mapStateToProps, actionCreators)(ScratchPanel);
}
