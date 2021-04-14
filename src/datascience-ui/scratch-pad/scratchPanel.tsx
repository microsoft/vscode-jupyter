// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as React from 'react';
import { connect } from 'react-redux';
import { buildSettingsCss } from '../interactive-common/buildSettingsCss';
import { handleLinkClick } from '../interactive-common/handlers';
import { JupyterInfo } from '../interactive-common/jupyterInfo';
import { IMainWithVariables, IStore } from '../interactive-common/redux/store';
import { ErrorBoundary } from '../react-common/errorBoundary';
import { getLocString } from '../react-common/locReactSide';
import { Progress } from '../react-common/progress';
import { ScratchCellComponent } from './scratchCell';
import './scratchPanel.less';
import { actionCreators } from './redux/actions';

/* eslint-disable  */

export type IScratchPanelProps = IMainWithVariables & typeof actionCreators;

function mapStateToProps(state: IStore): IMainWithVariables {
    return { ...state.main, variableState: state.variables };
}

export class ScratchPanel extends React.Component<IScratchPanelProps> {
    private mainPanelRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private mainPanelToolbarRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    private renderCount: number = 0;

    constructor(props: IScratchPanelProps) {
        super(props);
    }

    public componentDidMount() {
        document.addEventListener('click', this.linkClick, true);
        this.props.editorLoaded();
    }

    public componentWillUnmount() {
        document.removeEventListener('click', this.linkClick);
        this.props.editorUnmounted();
    }

    public render() {
        const dynamicFont: React.CSSProperties = {
            fontSize: this.props.font.size,
            fontFamily: this.props.font.family
        };

        const progressBar = (this.props.busy || !this.props.loaded) && !this.props.testMode ? <Progress /> : undefined;

        // If in test mode, update our count. Use this to determine how many renders a normal update takes.
        if (this.props.testMode) {
            this.renderCount = this.renderCount + 1;
        }

        return (
            <div id="main-panel" ref={this.mainPanelRef} role="Main" style={dynamicFont}>
                <div className="styleSetter">
                    <style>{`${this.props.rootCss ? this.props.rootCss : ''}
${buildSettingsCss(this.props.settings)}`}</style>
                </div>
                <header id="main-panel-toolbar" ref={this.mainPanelToolbarRef}>
                    {this.renderToolbarPanel()}
                    {progressBar}
                </header>
                <section
                    id="main-panel-footer"
                    onClick={this.footerPanelClick}
                    aria-label={getLocString('DataScience.editSection', 'Input new cells here')}
                >
                    {this.renderCell(this.props.baseTheme)}
                </section>
            </div>
        );
    }

    // Make the entire footer focus our input, instead of having to click directly on the monaco editor
    private footerPanelClick = (_event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        this.props.focusInput();
    };

    // eslint-disable-next-line
    private renderToolbarPanel() {
        return (
            <div id="toolbar-panel">
                <div className="toolbar-menu-bar">
                    {this.renderKernelSelection()}
                </div>
            </div>
        );
    }

    private renderKernelSelection() {
        return (
            <JupyterInfo
                baseTheme={this.props.baseTheme}
                font={this.props.font}
                kernel={this.props.kernel}
                selectServer={this.props.selectServer}
                selectKernel={this.props.selectKernel}
                shouldShowTrustMessage={false}
            />
        );
    }

    private renderCell(baseTheme: string) {
        // Skip if the tokenizer isn't finished yet. It needs
        // to finish loading so our code editors work.
        if (
            !this.props.monacoReady ||
            !this.props.editCellVM ||
            !this.props.settings ||
            !this.props.editorOptions ||
            !this.props.settings.allowInput
        ) {
            return null;
        }

        const executionCount = this.getInputExecutionCount();
        const editPanelClass = this.props.settings.colorizeInputBox ? 'edit-panel-colorized' : 'edit-panel';

        return (
            <div className={editPanelClass}>
                <ErrorBoundary>
                    <ScratchCellComponent
                        role="form"
                        editorOptions={this.props.editorOptions}
                        maxTextSize={undefined}
                        enableScroll={false}
                        autoFocus={document.hasFocus()}
                        testMode={this.props.testMode}
                        cellVM={this.props.editCellVM}
                        baseTheme={baseTheme}
                        codeTheme={this.props.codeTheme}
                        showWatermark={true}
                        editExecutionCount={executionCount.toString()}
                        monacoTheme={this.props.monacoTheme}
                        font={this.props.font}
                        settings={this.props.settings}
                        focusPending={this.props.focusPending}
                        language={this.props.kernel.language}
                        externalButtons={this.props.externalButtons}
                    />
                </ErrorBoundary>
            </div>
        );
    }

    private getInputExecutionCount = (): number => {
        return this.props.currentExecutionCount + 1;
    };

    private linkClick = (ev: MouseEvent) => {
        handleLinkClick(ev, this.props.linkClick);
    };
}

// Main export, return a redux connected editor
export function getConnectedScratchEditor() {
    return connect(mapStateToProps, actionCreators)(ScratchPanel);
}
