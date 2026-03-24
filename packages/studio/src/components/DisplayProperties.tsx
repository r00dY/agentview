import { PropertyListItem, PropertyListTextValue, PropertyListTitle } from "./PropertyList"

import { ErrorBoundary } from "./internal/ErrorBoundary"
import type { DisplayProperty } from "../types"

export function DisplayProperties<T>(props: { displayProperties: DisplayProperty<T>[], inputArgs: T }) {
    return <ErrorBoundary>
        {props.displayProperties.map((property) => {
            return <PropertyListItem key={property?.title}>
                <PropertyListTitle>{property?.title ?? "Unknown property"}</PropertyListTitle>
                <PropertyListTextValue>
                    <DisplayPropertyRenderer value={property?.value} inputArgs={props.inputArgs} />
                </PropertyListTextValue>
            </PropertyListItem>
        })}
    </ErrorBoundary>
}


function DisplayPropertyRenderer<T>({ value, inputArgs }: { value: (inputArgs: T) => React.ReactNode, inputArgs: T }) {
    const val = value(inputArgs);
    if (val === undefined || val === null) {
        return <div className="text-muted-foreground">Empty</div>
    }
    return <div>{val}</div>
}