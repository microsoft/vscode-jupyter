import * as React from 'react';
import { HistorySection } from './controls/HistorySection';
import { ISlickRow } from './reactSlickGrid';

import './sliceControl.css';
import { ColumnsSection } from './controls/ColumnsSection';
import { RowsSection } from './controls/RowsSection';
import { HistogramSection } from './controls/HistogramSection';
import { IGetColsResponse } from '../../client/datascience/data-viewing/types';

interface IControlPanelProps {
    data: ISlickRow[];
    headers: string[];
    historyList: any[];
    histogramData?: IGetColsResponse;
    currentVariableName: string;
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
                    width: '100%',
                    zIndex: 99999,
                    border: '1px solid var(--vscode-sideBar-border)',
                    color: 'var(--vscode-sideBar-foreground)',
                    backgroundColor: 'var(--vscode-sideBar-background)'
                }}
            >
                {this.props.histogramData && this.props.histogramData.cols && this.props.histogramData.cols.length > 0 ? (
                <HistogramSection
                    histogramData={this.props.histogramData}
                    submitCommand={this.props.submitCommand}
                    headers={this.props.headers}/>) : ''}
                <ColumnsSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <RowsSection
                    submitCommand={this.props.submitCommand}
                    options={columnDropdownOptions}
                    headers={this.props.headers}
                />
                <HistorySection
                    historyList={this.props.historyList}
                    currentVariableName={this.props.currentVariableName}
                    submitCommand={this.props.submitCommand}
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
