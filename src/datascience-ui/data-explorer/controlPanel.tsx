import * as React from 'react';
import { DropColumnsSection } from './controls/DropColumnSection';
import { DropMissingValuesSection } from './controls/DropMissingValuesSection';
import { NormalizeDataSection } from './controls/NormalizeDataSection';
import { PlotHistogramSection } from './controls/PlotHistogramSection';
import { RenameColumnsSection } from './controls/RenameColumnsSection';
import { Toolbar } from './controls/toolbar';
import { ISlickRow } from './reactSlickGrid';

import './sliceControl.css';

interface IControlPanelProps {
    data: ISlickRow[];
    headers: string[];
    submitCommand(data: { command: string; args: any }): void;
}

export class ControlPanel extends React.Component<IControlPanelProps> {
    constructor(props: IControlPanelProps) {
        super(props);
    }

    render() {
        const columnDropdownOptions = this.generateColumnDropdownOptions();

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
                <Toolbar submitCommand={this.props.submitCommand} />
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
                <DropColumnsSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <NormalizeDataSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <RenameColumnsSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <DropMissingValuesSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <PlotHistogramSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />

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

    private generateColumnDropdownOptions() {
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
        return result;
    }
}
