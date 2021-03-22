import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    histogramColumnText: string | null | undefined;
}

export class PlotHistogramSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = { histogramColumnText: '' };
    }

    render() {
        return (
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
                        options={this.props.options}
                        className="dropdownTitleOverrides"
                        onChange={this.updateHistogramTarget}
                    />
                    <button
                        onClick={() => {
                            if (this.state.histogramColumnText) {
                                this.props.submitCommand({
                                    command: 'pyplot.hist',
                                    args: {
                                        target: this.state.histogramColumnText
                                    }
                                });
                                this.setState({ histogramColumnText: '' });
                            }
                        }}
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
        );
    }
    private updateHistogramTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ histogramColumnText: option?.text });
    };
}
