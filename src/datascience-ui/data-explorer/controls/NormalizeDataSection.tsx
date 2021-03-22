import { Dropdown, IDropdownOption, ResponsiveMode } from '@fluentui/react';
import * as React from 'react';
import { dropdownStyles } from './styles';

interface IProps {
    headers: string[];
    options: IDropdownOption[];
    submitCommand(data: { command: string; args: any }): void;
}

interface IState {
    normalizeTargetText: string | null | undefined;
    normalizeRangeStart: number;
    normalizeRangeEnd: number;
}

export class NormalizeDataSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            normalizeTargetText: '',
            normalizeRangeStart: -1,
            normalizeRangeEnd: 1
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
                    <span className="slice-summary-detail">{'NORMALIZE DATA'}</span>
                </summary>
                <div className="slice-control-row slice-form-container" style={{ paddingBottom: '5px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100px', paddingTop: '6px' }}>
                        <Dropdown
                            responsiveMode={ResponsiveMode.xxxLarge}
                            label={'Column to normalize:'}
                            style={{ marginRight: '10px', width: '150px' }}
                            styles={dropdownStyles}
                            options={this.props.options}
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
                            onClick={() => {
                                if (this.state.normalizeTargetText) {
                                    const target = this.state.normalizeTargetText;
                                    this.props.submitCommand({
                                        command: 'normalize',
                                        args: {
                                            start: this.state.normalizeRangeStart,
                                            end: this.state.normalizeRangeEnd,
                                            target
                                        }
                                    });
                                    this.setState({ normalizeTargetText: '' });
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
                                marginLeft: '0px'
                            }}
                        >
                            Normalize
                        </button>
                    </div>
                </div>
            </details>
        );
    }

    private handleNormalizeStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeStart: parseInt(event.currentTarget.value) });
    };

    private handleNormalizeEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeEnd: parseInt(event.currentTarget.value) });
    };

    private updateNormalizeColumnTarget = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ normalizeTargetText: option?.text });
    };
}
