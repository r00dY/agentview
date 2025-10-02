import { Header, HeaderTitle } from "~/components/header"

export function CustomPage() {
    return <div className="flex-1">
        <Header>
            <HeaderTitle title={`Custom Page`} />
        </Header>
        <div className="p-6">
            Hello!

        </div>
    </div>
}