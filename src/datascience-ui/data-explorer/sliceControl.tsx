import { Dropdown, IDropdownOption, TextField } from '@fluentui/react';
import * as React from 'react';
import { IGetSliceRequest } from '../../client/datascience/data-viewing/types';

interface ISliceControlProps {
    originalVariableShape: number[];
    handleSliceRequest(slice: IGetSliceRequest): void;
}

interface ISliceControlState {
    sliceExpression: string;
    inputValue: string;
    isExpanded: boolean;
    isActive: boolean;
    selectedAxis0?: number;
    selectedIndex0?: number;
    selectedAxis1?: number;
    selectedIndex1?: number;
}

export class SliceControl extends React.Component<ISliceControlProps, ISliceControlState> {
    constructor(props: ISliceControlProps) {
        super(props);
        const initialSlice = this.preselectedSliceExpression();
        this.state = { isExpanded: false, isActive: false, sliceExpression: initialSlice, inputValue: initialSlice };

        this.handleChange = this.handleChange.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
    }

    public handleChange = (_event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue: string | undefined) => {
        this.setState({ inputValue: newValue ?? '' });
    }

    public handleSubmit = (event: React.SyntheticEvent) => {
        event.preventDefault();
        this.setState({ sliceExpression: this.state.inputValue });
        // Update axis and index dropdown selections
        this.applyInputBoxToDropdowns();
        this.props.handleSliceRequest({
            slice: this.state.inputValue
        });
    }

    private preselectedSliceExpression() {
        let numDimensionsToPreselect = this.props.originalVariableShape.length - 2;
        return '[' + this.props.originalVariableShape.map(() => {
            if (numDimensionsToPreselect > 0) {
                numDimensionsToPreselect -= 1;
                return '0';
            }
            return ':';
        }).join(', ') + ']';
    }

    public toggleEnablement = () => {
        const isActive = !this.state.isActive;
        const state = { isActive };
        const slice = isActive ? this.state.sliceExpression : '[' + this.props.originalVariableShape.map(() => ':').join(', ') + ']';
        this.props.handleSliceRequest({ slice });
        this.applyInputBoxToDropdowns();
        this.setState(state);
    }

    private renderReadonlyIndicator = () => {
        if (this.state.isActive) {
            return (<span style={{ marginLeft: '10px', paddingLeft: '5px', paddingRight: '5px', paddingBottom: '2px', paddingTop: '0px', backgroundColor: 'var(--vscode-input-background)' }}>{this.state.sliceExpression}</span>);
        }
    }

    render() {
        const indexOptions = this.generateIndexDropdownOptions();
        const axisOptions = this.generateAxisDropdownOptions();
        return <details className="slicing-control">
            <summary style={{ display: 'flex', flexDirection: 'row' }}>
                <span style={{ paddingBottom: '2px' }}>SLICING</span>
                {this.renderReadonlyIndicator()}
            </summary>
            <div className="slice-data-control-container" style={{ display: 'flex', justifyContent: 'space-around' }}>
                <form onSubmit={this.handleSubmit} style={{ alignSelf: 'center', flexDirection: 'column', justifyContent: 'space-between', padding: '4px' }}>
                    <div style={{ paddingTop: '4px', paddingBottom: '4px'}}>
                        <input type="checkbox" id="slice-enablement-checkbox" onChange={this.toggleEnablement} style={{width: '20px', backgroundColor: 'var(--vscode-input-background)', marginRight: '6px'}}/>
                        <label htmlFor="slice-enablement-checkbox">Slice Data</label>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', marginLeft: '30px', marginTop: '10px' }}>
                        <TextField 
                            value={this.state.inputValue}
                            onGetErrorMessage={this.validateSliceExpression}
                            onChange={this.handleChange}
                            autoComplete="on"
                            inputClassName="slice-data"
                            disabled={!this.state.isActive} />
                        <input className="submit-slice-button" type="submit" disabled={!this.state.isActive} value="Apply" />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', marginLeft: '30px' }}>
                        <Dropdown label="Axis" style={{ marginRight: '10px' }} selectedKey={this.state.selectedAxis0} styles={{ dropdown: { backgroundColor: 'var(--vscode-dropdown-listBackground)' }}} disabled={!this.state.isActive} options={axisOptions} onChange={this.updateAxis} />
                        <Dropdown label="Index" disabled={!this.state.isActive || this.state.selectedAxis0 === undefined} selectedKey={this.state.selectedIndex0} options={indexOptions} onChange={this.updateIndex}/>
                    </div>
                </form>
            </div>
        </details>;
    }

    private validateSliceExpression = () => {
        const { inputValue } = this.state;
        const parsedExpression = parseShape(inputValue);
        if (parsedExpression && parsedExpression.length !== this.props.originalVariableShape.length) {
            return 'Invalid slice expression';
        }
        return '';
    }

    private applyInputBoxToDropdowns = () => {
        setTimeout(() => {
            const shape = this.state.sliceExpression;
            if (shape.startsWith('[') && shape.endsWith(']')) {
                const dropdowns: { axis: number, index: number }[] = [];
                shape.substring(1, shape.length - 1)
                    .split(',')
                    .forEach((shapeEl, idx) => {
                        const val = parseInt(shapeEl);
                        const isNumber = Number.isInteger(val);
                        if (isNumber) {
                            dropdowns.push({ axis: idx, index: val })
                        }
                    });
                const state = {};
                if (dropdowns.length === this.props.originalVariableShape.length - 2) {
                    // Apply values to dropdowns
                    for (let i = 0; i < dropdowns.length; i++) {
                        const selection = dropdowns[i];
                        (state as any)[`selectedAxis${i.toString()}`] = selection.axis;
                        (state as any)[`selectedIndex${i.toString()}`] = selection.index;
                    }
                } else {
                    // Unset dropdowns
                    const state = {};
                    for (const key in this.state) {
                        if (key.startsWith('selected')) {
                            console.log('match', key);
                            (state as any)[key] = null; // This isn't working
                        }
                    }
                }
                this.setState(state);
            }
        });
    }

    private applyDropdownsToInputBox = () => {
        setTimeout(() => {
            if (this.state.selectedAxis0 !== undefined && this.state.selectedIndex0 !== undefined) {
                // Calculate new slice expression from dropdown values
                const newSliceExpression = '[' + this.props.originalVariableShape.map((_val, idx) => {
                    if (idx === this.state.selectedAxis0) {
                        return this.state.selectedIndex0;
                    }
                    return ':';
                }).join(', ') + ']';
                this.setState({ sliceExpression: newSliceExpression, inputValue: newSliceExpression });
                // Submit slice request
                this.props.handleSliceRequest({ slice: newSliceExpression });
            }
        });
    }

    private updateAxis = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ selectedAxis0: option?.key as number });
        this.applyDropdownsToInputBox();
    }

    private updateIndex = (_data: React.FormEvent, option: IDropdownOption | undefined) => {
        this.setState({ selectedIndex0: option?.key as number });
        this.applyDropdownsToInputBox();
    }

    private generateAxisDropdownOptions = () => {
        return this.props.originalVariableShape.map((_val, idx) => { 
            return { key: idx, text: idx.toString()};
        });
    }

    private generateIndexDropdownOptions = () => {
        if (this.state.selectedAxis0 !== undefined) {
            const range = this.props.originalVariableShape[this.state.selectedAxis0];
            const result = [];
            for (let i = 0; i < range; i++) {
                result.push({ key: i, text: i.toString() });
            }
            return result;
        }
        return [];
    }
}

// class Range {
//     constructor(public start: number, public stop: number) {}
// }

// const shapeRegex = /(?:(?<Start>[0-9]+)(?::(?<Stop>[0-9]+))?(?::(?<Step>[0-9]+))?)/;

// Parse a string of the form (1, 2, 3)
function parseShape(shape: string) {
    if (shape.startsWith('[') && shape.endsWith(']')) {
        return shape
            .substring(1, shape.length - 1)
            .split(',')
            .map((shapeEl) => parseInt(shapeEl));
    }
    return undefined;
}
