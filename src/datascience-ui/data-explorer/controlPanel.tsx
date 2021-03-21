import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { ISlickRow } from './reactSlickGrid';

// These styles are passed to the FluentUI dropdown controls
const styleOverrides = {
    color: 'var(--vscode-dropdown-foreground) !important',
    backgroundColor: 'var(--vscode-dropdown-background) !important',
    fontFamily: 'var(--vscode-font-family)',
    fontWeight: 'var(--vscode-font-weight)',
    fontSize: 'var(--vscode-font-size)',
    opacity: 1,
    border: 'var(--vscode-dropdown-border)',
    ':focus': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':active': {
        color: 'var(--vscode-dropdown-foreground)'
    },
    ':hover': {
        color: 'var(--vscode-dropdown-foreground)',
        backgroundColor: 'var(--vscode-dropdown-background)'
    }
};
const dropdownStyles = {
    root: {
        color: 'var(--vscode-dropdown-foreground) !important'
    },
    dropdownItems: {
        ...styleOverrides,
        selectors: {
            '@media(min-width: 300px)': {
                maxHeight: 100
            }
        }
    },
    caretDown: {
        visibility: 'hidden' // Override the FluentUI caret and use ::after selector on the caretDownWrapper in order to match VS Code. See sliceContro.css
    }
};

import './sliceControl.css';

interface IControlPanelProps {
    data: ISlickRow[];
    headers: string[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IControlPanelState {
    columnRenameTargetKey: number | undefined;
    newColumnName: string | undefined;
    columnsToDrop: number[]; // Indices
    fillNaReplacement: string | undefined;
    fillNaTargets: number[];
    dropNaTarget: number;
    normalizeTargetKey: number;
    normalizeRangeStart: number;
    normalizeRangeEnd: number;
    histogramColumnKey: number;
}

export class ControlPanel extends React.Component<IControlPanelProps, IControlPanelState> {
    constructor(props: IControlPanelProps) {
        super(props);
        this.state = {
            normalizeTargetKey: 0,
            normalizeRangeStart: -1,
            normalizeRangeEnd: 1,
            columnRenameTargetKey: 1,
            newColumnName: '',
            columnsToDrop: [],
            fillNaReplacement: '',
            fillNaTargets: [],
            dropNaTarget: 0,
            histogramColumnKey: 0
        };
    }

    render() {
        return (
            <div
                style={{
                    resize: 'horizontal',
                    width: '40%',
                    height: '1000px',
                    border: '1px solid var(--vscode-sideBar-border)',
                    color: 'var(--vscode-sideBar-foreground)',
                    backgroundColor: 'var(--vscode-sideBar-background)'
                }}
            >
                <div
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px',
                        paddingLeft: '5px'
                    }}
                >
                    <div
                        className="codicon codicon-export codicon-button"
                        onClick={() => this.props.submitCommand({ command: 'export_to_csv', args: null })}
                        title="Export to CSV"
                    />
                    <div className="codicon codicon-go-to-file codicon-button" title="Open in Python Script" />
                    <div className="codicon codicon-notebook codicon-button" title="Open in Notebook" />
                    <div
                        className="codicon codicon-window codicon-button"
                        onClick={() =>
                            this.props.submitCommand({ command: 'open_interactive_window', args: undefined })
                        }
                        title="Open in Interactive Window"
                    />
                </div>
                {/* <details className="slicing-control" style={{ borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)', paddingTop: '4px', paddingBottom: '4px'}}>
					<summary className="slice-summary">
                        <span className="slice-summary-detail">
                            {'TRANSFORMATIONS HISTORY'}
                            <div className="codicon codicon-copy codicon-button" title="Copy code"/>
                        </span>
                    </summary>
                    <div style={{ border: 'var(--vscode-editor-inactiveSelectionBackground)', marginLeft: '10px', marginRight: '10px', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)', fontFamily: 'var(--vscode-editor-font-family)', padding: '20px' }}>
                        <span>
                            {`import pandas as pd\n`}
                        </span>
                        <span>
                            {`df = pd.read_csv("./iris.csv")`}
                        </span>
                        <span>
                            {`import numpy as np`}
                        </span>
                        <span>
                            {`df = df.replace(np.inf, np.nan)`}
                        </span>
                    </div>
                </details>
                <details className="slicing-control" style={{ borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)', paddingTop: '4px', paddingBottom: '4px'}}>
					<summary className="slice-summary">
                        <span className="slice-summary-detail">
                            {'EVALUATE CUSTOM EXPRESSIONS'}
                        </span>
                    </summary>
                    <input
                        value={'df = df.groupby(["species"]).replace("setosa", "Setosa")'}
                        className={'slice-data'}
                        style={{ width: '400px !important', marginTop: '4px', marginBottom: '4px', marginLeft: '30px', fontFamily: 'var(--vscode-editor-font-family)'  }}
                        autoComplete="on"
                    />
                </details> */}
                <details
                    className="slicing-control"
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px'
                    }}
                >
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">{'DROP COLUMNS'}</span>
                    </summary>
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                        <Dropdown
                            responsiveMode={ResponsiveMode.xxxLarge}
                            label={'Column(s) to drop:'}
                            style={{ marginRight: '10px', width: '150px' }}
                            styles={dropdownStyles}
                            multiSelect
                            options={this.generateColumnRenameOptions()}
                            className="dropdownTitleOverrides"
                            onChange={this.updateDropTarget}
                        />
                        <button
                            onClick={() =>
                                this.props.submitCommand({
                                    command: 'drop',
                                    args: {
                                        targets: this.state.columnsToDrop
                                            .map((v) => this.props.headers[v as number])
                                            .filter((v) => !!v)
                                    }
                                })
                            }
                            style={{
                                backgroundColor: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                                margin: '4px',
                                padding: '4px',
                                border: 'none',
                                cursor: 'pointer',
                                height: '26px',
                                marginTop: '27px',
                                marginLeft: '0px'
                            }}
                        >
                            Drop
                        </button>
                    </div>
                </details>
                <details
                    className="slicing-control"
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px'
                    }}
                >
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">{'NORMALIZE DATA'}</span>
                    </summary>
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }}>
                            <Dropdown
                                responsiveMode={ResponsiveMode.xxxLarge}
                                label={'Column to normalize:'}
                                style={{ marginRight: '10px', width: '150px' }}
                                styles={dropdownStyles}
                                options={this.generateColumnRenameOptions()}
                                className="dropdownTitleOverrides"
                                onChange={this.updateNormalizeColumnTarget}
                            />
                            <span>{'New start range:'}</span>
                            <input
                                value={this.state.normalizeRangeStart}
                                onChange={this.handleNormalizeStartChange}
                                className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
                                autoComplete="on"
                            />
                            <span>{'New end range:'}</span>
                            <input
                                value={this.state.normalizeRangeEnd}
                                onChange={this.handleNormalizeEndChange}
                                className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
                                autoComplete="on"
                            />
                            <button
                                onClick={() =>
                                    this.props.submitCommand({
                                        command: 'normalize',
                                        args: {
                                            start: this.state.normalizeRangeStart,
                                            end: this.state.normalizeRangeEnd,
                                            target: this.generateColumnRenameOptions()[this.state.normalizeTargetKey]
                                                .text
                                        }
                                    })
                                }
                                style={{
                                    backgroundColor: 'var(--vscode-button-background)',
                                    color: 'var(--vscode-button-foreground)',
                                    margin: '4px',
                                    padding: '4px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    height: '26px',
                                    marginLeft: '0px'
                                }}
                            >
                                Normalize
                            </button>
                        </div>
                    </div>
                </details>
                <details
                    className="slicing-control"
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px'
                    }}
                >
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">{'RENAME COLUMNS'}</span>
                    </summary>
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }}>
                            <Dropdown
                                responsiveMode={ResponsiveMode.xxxLarge}
                                label={'Rename column:'}
                                style={{ marginRight: '10px', width: '100px' }}
                                styles={dropdownStyles}
                                selectedKey={this.state.columnRenameTargetKey}
                                options={this.generateColumnRenameOptions()}
                                className="dropdownTitleOverrides"
                                onChange={this.updateRenameTarget}
                            />
                            <span>{'To:'}</span>
                            <input
                                value={this.state.newColumnName}
                                onChange={this.handleChange}
                                className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
                                autoComplete="on"
                            />
                            <button
                                onClick={() => {
                                    if (this.state.newColumnName)
                                        this.props.submitCommand({
                                            command: 'rename',
                                            args: {
                                                old: this.props.headers[this.state.columnRenameTargetKey!],
                                                new: this.state.newColumnName
                                            }
                                        });
                                }}
                                style={{
                                    backgroundColor: 'var(--vscode-button-background)',
                                    color: 'var(--vscode-button-foreground)',
                                    margin: '4px',
                                    padding: '4px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    height: '26px'
                                }}
                            >
                                Submit
                            </button>
                        </div>
                    </div>
                </details>
                <details
                    className="slicing-control"
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px'
                    }}
                >
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">{'HANDLE MISSING VALUES'}</span>
                    </summary>
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                        {/* <Dropdown
							responsiveMode={ResponsiveMode.xxxLarge}
							label={'Columns to fill:'}
							style={{ marginRight: '10px' }}
							styles={dropdownStyles}
                            multiSelect
							options={this.generateColumnRenameOptions()}
							className="dropdownTitleOverrides" 
							onChange={this.updateFillNaTargets}
						/> */}
                        {/* <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }} >
							<span>
								{'Replace null with:'}
							</span>
							<input
								value={this.state.fillNaReplacement ?? '0'}
								onChange={this.handleFillNaReplacement}
								className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
								autoComplete="on"
							/>
						</div> */}
                        {/* <button onClick={() => this.props.submitCommand({ command: 'fillna', args: { newValue: this.state.fillNaReplacement, targets: this.state.fillNaTargets.map((v) => this.props.headers[v as number]).filter((v) => !!v) } })} style={{ width: '70px', backgroundColor: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', margin: '4px', padding: '4px',border: 'none', cursor: 'pointer', height: '26px', marginTop: '27px', marginLeft: '20px'  }}>Replace</button> */}
                        <div
                            style={{
                                /* paddingLeft: '10px', */ display: 'flex',
                                flexDirection: 'column',
                                width: '100px',
                                paddingTop: '6px'
                            }}
                        >
                            <Dropdown
                                responsiveMode={ResponsiveMode.xxxLarge}
                                label={'Drop:'}
                                style={{ marginRight: '10px' }}
                                styles={dropdownStyles}
                                options={this.generateDropNaOptions()}
                                className="dropdownTitleOverrides"
                                onChange={this.updateDropNaTarget}
                            />
                        </div>
                        <button
                            onClick={() =>
                                this.props.submitCommand({
                                    command: 'dropna',
                                    args: { target: this.state.dropNaTarget }
                                })
                            }
                            style={{
                                width: '50px',
                                backgroundColor: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                                margin: '0px',
                                padding: '4px',
                                border: 'none',
                                cursor: 'pointer',
                                height: '26px',
                                marginTop: '32px'
                            }}
                        >
                            Drop
                        </button>
                    </div>
                </details>
                <details
                    className="slicing-control"
                    style={{
                        borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)',
                        paddingTop: '4px',
                        paddingBottom: '4px'
                    }}
                >
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">{'PLOT HISTOGRAM'}</span>
                    </summary>
                    {/* <Dropdown
							responsiveMode={ResponsiveMode.xxxLarge}
							label={'Columns to fill:'}
							style={{ marginRight: '10px' }}
							styles={dropdownStyles}
                            multiSelect
							options={this.generateColumnRenameOptions()}
							className="dropdownTitleOverrides" 
							onChange={this.updateFillNaTargets}
						/> */}
                    {/* <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }} >
							<span>
								{'Replace null with:'}
							</span>
							<input
								value={this.state.fillNaReplacement ?? '0'}
								onChange={this.handleFillNaReplacement}
								className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
								autoComplete="on"
							/>
						</div> */}
                    {/* <button onClick={() => this.props.submitCommand({ command: 'fillna', args: { newValue: this.state.fillNaReplacement, targets: this.state.fillNaTargets.map((v) => this.props.headers[v as number]).filter((v) => !!v) } })} style={{ width: '70px', backgroundColor: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)', margin: '4px', padding: '4px',border: 'none', cursor: 'pointer', height: '26px', marginTop: '27px', marginLeft: '20px'  }}>Replace</button> */}
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                        <Dropdown
                            responsiveMode={ResponsiveMode.xxxLarge}
                            label={'Target column:'}
                            style={{ marginRight: '10px', width: '150px' }}
                            styles={dropdownStyles}
                            options={this.generateColumnRenameOptions()}
                            className="dropdownTitleOverrides"
                            onChange={this.updateHistogramTarget}
                        />
                        <button
                            onClick={() =>
                                this.props.submitCommand({
                                    command: 'pyplot.hist',
                                    args: {
                                        target: this.generateColumnRenameOptions()[this.state.histogramColumnKey!]
                                            .text
                                    }
                                })
                            }
                            style={{
                                backgroundColor: 'var(--vscode-button-background)',
                                color: 'var(--vscode-button-foreground)',
                                margin: '4px',
                                padding: '4px',
                                border: 'none',
                                cursor: 'pointer',
                                height: '26px',
                                marginTop: '27px',
                                marginLeft: '0px'
                            }}
                        >
                            Plot
                        </button>
                    </div>
                </details>
                {/* <details className="slicing-control" style={{ borderBottom: '1px solid var(--vscode-editor-inactiveSelectionBackground)', paddingTop: '4px', paddingBottom: '4px'}}>
                    <summary className="slice-summary">
                        <span className="slice-summary-detail">
                            {'HANDLE OUTLIERS'}
                        </span>
                    </summary>
                    <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
						<Dropdown
							responsiveMode={ResponsiveMode.xxxLarge}
							label={'In column:'}
							style={{ marginRight: '10px', width: '100px' }}
							styles={dropdownStyles}
							selectedKey={3}
							options={this.generateColumnRenameOptions()}
							className="dropdownTitleOverrides"
							onChange={this.updateRenameTarget}
						/>
						<div style={{ paddingLeft: '10px', display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px', paddingRight: '20px' }} >
							<span>
								{'Replace value:'}
							</span>
							<input
								value={'inf'}
								onChange={this.handleChange}
								className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px', marginRight: '10px' }}
								autoComplete="on"
							/>
						</div>
						<div style={{ paddingLeft: '10px', display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }} >
							<span>
								{'With new value:'}
							</span>
							<input
								value={'nan'}
								onChange={this.handleChange}
								className={'slice-data'}
                                style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
								autoComplete="on"
							/>
						</div>
					</div>
                </details> */}
            </div>
        );
    }
    private updateDropTarget = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                columnsToDrop: item.selected
                    ? [...this.state.columnsToDrop, item.key as number]
                    : this.state.columnsToDrop.filter((key) => key !== item.key)
            });
        }
    };

    private updateFillNaTargets = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                fillNaTargets: item.selected
                    ? [...this.state.fillNaTargets, item.key as number]
                    : this.state.fillNaTargets.filter((key) => key !== item.key)
            });
        }
    };
    private updateRenameTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ columnRenameTargetKey: option?.key as number });
    };
    private updateHistogramTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ histogramColumnKey: option?.key as number });
    };
    private updateNormalizeColumnTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ normalizeTargetKey: option?.key as number });
    };
    private handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ newColumnName: event.currentTarget.value });
    };
    private handleNormalizeStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeStart: parseInt(event.currentTarget.value) });
    };

    private handleNormalizeEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeEnd: parseInt(event.currentTarget.value) });
    };

    private handleFillNaReplacement = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ fillNaReplacement: event.currentTarget.value });
    };

    private generateColumnRenameOptions() {
        const result = [];
        if (this.props.headers && this.props.headers.length) {
            const range = this.props.headers.length;
            for (let i = 0; i < range; i++) {
                const text = this.props.headers[i];
                if (text) {
                    result.push({ key: i, text });
                }
            }
        }
        console.log('column rename options', result);
        return result;
    }

    private generateDropNaOptions() {
        return [
            { key: 0, text: 'Rows' },
            { key: 1, text: 'Columns' }
        ];
    }

    private updateDropNaTarget = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({ dropNaTarget: item.key as number });
        }
    };
}
