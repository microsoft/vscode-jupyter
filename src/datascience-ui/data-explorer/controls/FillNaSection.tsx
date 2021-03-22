import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    fillNaReplacement: string | undefined;
    fillNaTargets: number[];
}

export class FillNaSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            fillNaReplacement: '',
            fillNaTargets: []
        };
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
                    <span className="slice-summary-detail">{'HANDLE MISSING VALUES'}</span>
                </summary>
                <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                    <Dropdown
                        responsiveMode={ResponsiveMode.xxxLarge}
                        label={'Columns to fill:'}
                        style={{ marginRight: '10px' }}
                        styles={dropdownStyles}
                        multiSelect
                        options={this.props.options}
                        className="dropdownTitleOverrides"
                        onChange={this.updateFillNaTargets}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }}>
                        <span>{'Replace null with:'}</span>
                        <input
                            value={this.state.fillNaReplacement ?? '0'}
                            onChange={this.handleFillNaReplacement}
                            className={'slice-data'}
                            style={{ width: '100px', marginTop: '4px', marginBottom: '4px' }}
                            autoComplete="on"
                        />
                    </div>
                    <button
                        onClick={() =>
                            this.props.submitCommand({
                                command: 'fillna',
                                args: {
                                    newValue: this.state.fillNaReplacement,
                                    targets: this.state.fillNaTargets
                                        .map((v) => this.props.headers[v as number])
                                        .filter((v) => !!v)
                                }
                            })
                        }
                        style={{
                            width: '70px',
                            backgroundColor: 'var(--vscode-button-background)',
                            color: 'var(--vscode-button-foreground)',
                            margin: '4px',
                            padding: '4px',
                            border: 'none',
                            cursor: 'pointer',
                            height: '26px',
                            marginTop: '27px',
                            marginLeft: '20px'
                        }}
                    >
                        Replace
                    </button>
                </div>
            </details>
        );
    }

    private updateFillNaTargets = (_data: React.FormEvent, item: IDropdownOption | undefined) => {
        if (item) {
            this.setState({
                fillNaTargets: item.selected
                    ? [...this.state.fillNaTargets, item.key as number]
                    : this.state.fillNaTargets.filter((key) => key !== item.key)
            });
        }
    };
    private handleFillNaReplacement = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ fillNaReplacement: event.currentTarget.value });
    };
}
