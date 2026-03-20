import { data, useLoaderData, useNavigate, useOutletContext, useParams, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Header, HeaderTitle } from "../components/header";
import type { Session } from "agentview/apiTypes";
import { getAllSessionItems } from "agentview/sessionUtils";
import { useEffect } from "react";
import { Button } from "../components/ui/button";
import { getListParams, toQueryParams } from "../lib/listParams";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { PropertyList, PropertyListItem, PropertyListTextValue, PropertyListTitle } from "../components/PropertyList";
import { AlertCircleIcon, TerminalIcon } from "lucide-react";
import { requireRunConfig, requireAgentConfig, requireChannelConfig, findChannelConfig, findAgentConfig } from "agentview/baseConfigUtils";
import { config } from "../config";
import { DisplayProperties } from "../components/DisplayProperties";
import type { ActionResponse } from "../lib/errors";
import type { AgentViewError, RunConfig } from "agentview";
import { Alert, AlertDescription } from "../components/ui/alert";

function loader({ request, params }: LoaderFunctionArgs) {
    const listParams = getListParams(request);

    return {
        listParams
    }
}

function Component() {
    const navigate = useNavigate();
    const params = useParams();
    const { session } = useOutletContext<{ session: Session }>();
    const { listParams } = useLoaderData<typeof loader>();
    const run = session.runs.find((run) => run.id === params.runId);

    if (!run) {
        throw data({ message: "Run not found" }, { status: 404 });
    }

    const channelConfig = findChannelConfig(config, session.channel);
    const agentConfig = findAgentConfig(config, channelConfig?.agent);

    let runConfig: RunConfig | undefined = undefined;
    let error: string | undefined = undefined;

    if (agentConfig) {
        try {
            runConfig = requireRunConfig(agentConfig, run.sessionItems[0].content);
        } catch (err) {
            error = (err as AgentViewError).message;
        }
    }

    if (!runConfig && !error) {
        error = "Agent config not found";
    }

    console.log({ runConfig, error });

    // const runConfig = requireRunConfig(agentConfig, run.sessionItems[0].content);


    const close = () => {
        navigate(`../?${toQueryParams(listParams)}`);
    }

    return <Dialog
        open={true}
        onOpenChange={(open) => {
            if (!open) {
                close();
            }
        }}
    >
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Run details</DialogTitle>
            </DialogHeader>
            <DialogBody>
                <PropertyList>
                    <PropertyListItem>
                        <PropertyListTitle>Status</PropertyListTitle>
                        <PropertyListTextValue>
                            {run.status}
                        </PropertyListTextValue>
                    </PropertyListItem>

                    {run.failReason && (
                        <PropertyListItem>
                            <PropertyListTitle>Fail reason</PropertyListTitle>
                            <PropertyListTextValue className="text-red-500">
                                {run.failReason.message ?? "Unknown reason"}
                            </PropertyListTextValue>
                        </PropertyListItem>
                    )}

                    <PropertyListItem>
                        <PropertyListTitle>Version</PropertyListTitle>
                        <PropertyListTextValue>
                            {run.agentRef?.version ?? "-"}
                        </PropertyListTextValue>
                    </PropertyListItem>

                    <PropertyListItem>
                        <PropertyListTitle>Started at</PropertyListTitle>
                        <PropertyListTextValue>
                            {new Date(run.createdAt).toLocaleString()}
                        </PropertyListTextValue>
                    </PropertyListItem>
                    <PropertyListItem>
                        <PropertyListTitle>Duration</PropertyListTitle>
                        <PropertyListTextValue>
                            {run.finishedAt
                                ? (() => {
                                    const ms = new Date(run.finishedAt).getTime() - new Date(run.createdAt).getTime();
                                    const totalSeconds = Math.floor(ms / 1000);
                                    const minutes = Math.floor(totalSeconds / 60);
                                    const seconds = totalSeconds % 60;
                                    if (minutes > 0) {
                                        return `${minutes}m ${seconds}s`;
                                    }
                                    return `${seconds}s`;
                                })()
                                : "-"}
                        </PropertyListTextValue>
                    </PropertyListItem>

                    {runConfig && runConfig.displayProperties && <DisplayProperties displayProperties={runConfig.displayProperties} inputArgs={{ session, run }} />}

                    {!runConfig && error && <Alert variant="destructive">
                        <AlertCircleIcon className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>}
                </PropertyList>

                {/* <div className="mt-8 border p-4 rounded-lg flex flex-row gap-4 items-center">

                    <div>
                        <div className="text-sm font-medium">Debug in console</div>
                        <div className="text-sm text-muted-foreground">
                            See request / response of your Agent API call, full error details or metadata.
                        </div>
                    </div>
                    <Button variant="default" onClick={() => { debugRun(run); }}>Print to console</Button>

                </div> */}

                {/* <div className="mt-8 flex flex-col gap-2 items-start">  
                <Button variant="outline" onClick={() => {
                    console.log({
                        id: run.id,
                        createdAt: run.createdAt,
                        finishedAt: run.finishedAt,
                        state: run.state,
                        version: run.agentRef?.version,
                        request: run.responseData?.request,
                        response: run.responseData?.response,
                        metadata: run.metadata,
                        error: run.failReason,
                    })
                }}><TerminalIcon className="size-4" />Print all details to console</Button>
                <p className="text-sm text-muted-foreground">See request / response of your Agent API call, full error details or metadata click the button below.</p>

                </div> */}

            </DialogBody>
            <DialogFooter>
                <Button variant="default" onClick={close}>Close</Button>
            </DialogFooter>

        </DialogContent>
    </Dialog>
    // return <Drawer open={true} onOpenChange={(open) => {
    //     if (!open) {
    //         navigate(`../?${toQueryParams(listParams)}`);
    //     }
    // }}>
    //     <DrawerContent>
    //         <DrawerHeader>
    //             <DrawerTitle>Are you absolutely sure?</DrawerTitle>
    //             <DrawerDescription>This action cannot be undone.</DrawerDescription>
    //         </DrawerHeader>
    //         <DrawerFooter>
    //             <Button>Submit</Button>
    //             <DrawerClose>
    //                 <Button variant="outline">Cancel</Button>
    //             </DrawerClose>
    //         </DrawerFooter>
    //     </DrawerContent>
    // </Drawer>
}

export const sessionRunRoute: RouteObject = {
    Component,
    loader
}
