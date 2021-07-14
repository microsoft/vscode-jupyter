import * as React from 'react';
import { inputStyle } from '../styles';

interface IProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setArgs(args: any): void;
}

interface IState {
    normalizeRangeStart: string;
    normalizeRangeEnd: string;
}

export class NormalizeDataSection extends React.Component<IProps, IState> {
    constructor(props: IProps) {
        super(props);
        this.state = {
            normalizeRangeStart: '0',
            normalizeRangeEnd: '1'
        };
        this.props.setArgs({
            start: 0,
            end: 1,
            isPreview: true
        });
    }

    render() {
        return (
            <div className="slice-control-row" style={{ paddingBottom: '5px', paddingTop: '6px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '98%' }}>
                    <span>{'New start range'}</span>
                    <input
                        value={this.state.normalizeRangeStart}
                        onChange={this.handleNormalizeStartChange}
                        className={'slice-data'}
                        style={inputStyle}
                        autoComplete="on"
                    />
                    <span>{'New end range'}</span>
                    <input
                        value={this.state.normalizeRangeEnd}
                        onChange={this.handleNormalizeEndChange}
                        className={'slice-data'}
                        style={inputStyle}
                        autoComplete="on"
                    />
                </div>
            </div>
        );
    }

    private handleNormalizeStartChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeStart: event.currentTarget.value });
        this.props.setArgs({
            start: this.getNumber(event.currentTarget.value),
            end: this.getNumber(this.state.normalizeRangeEnd),
            isPreview: true
        });
    };

    private handleNormalizeEndChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        this.setState({ normalizeRangeEnd: event.currentTarget.value });
        this.props.setArgs({
            start: this.getNumber(this.state.normalizeRangeStart),
            end: this.getNumber(event.currentTarget.value),
            isPreview: true
        });
    };

    private getNumber(num: string) {
        return num === "" ? NaN : +num;
    }
}
