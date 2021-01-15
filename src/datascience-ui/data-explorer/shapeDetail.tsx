import * as React from 'react';

interface IShapeDetailProps {
    highlightedIndex: number,
    shapeComponents: number[] | undefined
}

export class ShapeDetail extends React.Component<IShapeDetailProps> {
    public render() {
        if (this.props.shapeComponents) {
            const shape = this.props.shapeComponents.map((component, index) => 
                <Cell data={component.toString()} selected={index === this.props.highlightedIndex} first={index===0}/>
            );
            return <div style={{display: 'flex', justifyContent: 'center', alignSelf: 'center'}}>
                <span>(</span>
                {shape}
                <span>)</span>
            </div>;
        }
        return null;
    }
}

interface ICellProps  {
    data: string,
    selected: boolean,
    first: boolean
}

class Cell extends React.PureComponent<ICellProps> {
    public render() {
        const style = {
            color: this.props.selected ? 'green' : 'var(--vscode-editor-foreground)' 
        }
        const comma = this.props.first ? undefined : <span style={{color: 'var(--vscode-editor-foreground)'}}>{', '}</span>;
        return (
            <div style={{display: 'flex', justifyContent: 'center'}}>
                {comma}
                <span style={style}>{this.props.data}</span>
            </div>
        );
    }
}
