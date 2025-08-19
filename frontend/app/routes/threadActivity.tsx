import type { Route } from "./+types/threadActivity";
import { Header, HeaderTitle } from "~/components/header";

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
    return {}
}

export default function ThreadActivityPage() {

    return  <div className="flex-1  flex flex-col">  

        <Header>
            <HeaderTitle title={`Activity`} />
        </Header>
        <div className="flex-1 overflow-y-auto">

            <div className=" p-6 max-w-4xl space-y-6">
                Hello Activity
            </div>

        </div>
    </div>
}
