import { data, useLoaderData, useNavigate, useOutletContext, useParams, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, RouteObject } from "react-router";
import { Header, HeaderTitle } from "~/components/header";
import type { Session } from "~/lib/shared/apiTypes";
import { getAllSessionItems } from "~/lib/shared/sessionUtils";
import { CommentThread } from "~/components/comments";
import { apiFetch } from "~/lib/apiFetch";
import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { getListParams, toQueryParams } from "~/lib/listParams";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { PropertyList } from "~/components/PropertyList";
import { TerminalIcon } from "lucide-react";

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
                <PropertyList.Root>
                    <PropertyList.Item>
                        <PropertyList.Title>Status</PropertyList.Title>
                        <PropertyList.TextValue>
                            {run.state}
                        </PropertyList.TextValue>
                    </PropertyList.Item>
                    <PropertyList.Item>
                        <PropertyList.Title>Version</PropertyList.Title>
                        <PropertyList.TextValue>
                            {run.version?.version ?? "-"}
                        </PropertyList.TextValue>
                    </PropertyList.Item>

                    <PropertyList.Item>
                        <PropertyList.Title>Started at</PropertyList.Title>
                        <PropertyList.TextValue>
                            {new Date(run.createdAt).toLocaleString()}
                        </PropertyList.TextValue>
                    </PropertyList.Item>
                    <PropertyList.Item>
                        <PropertyList.Title>Duration</PropertyList.Title>
                        <PropertyList.TextValue>
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
                        </PropertyList.TextValue>
                    </PropertyList.Item>
                    {run.failReason && (
                        <PropertyList.Item>
                            <PropertyList.Title>Fail reason</PropertyList.Title>
                            <PropertyList.TextValue className="text-red-500">
                                {run.failReason.message ?? "Unknown reason"}
                            </PropertyList.TextValue>
                        </PropertyList.Item>
                    )}

                </PropertyList.Root>


                <div className="mt-8 flex flex-col gap-2 items-start">  
                <p className="text-sm">To see request / response of your Agent API call, full error details or metadata click the button below.</p>
                <Button variant="outline" onClick={() => {
                    console.log({
                        id: run.id,
                        createdAt: run.createdAt,
                        finishedAt: run.finishedAt,
                        state: run.state,
                        version: run.version,
                        request: run.responseData?.request,
                        response: run.responseData?.response,
                        metadata: run.metadata,
                        error: run.failReason,
                    })
                }}><TerminalIcon className="size-4" />Print all details to console</Button>

                



                </div>
                
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
